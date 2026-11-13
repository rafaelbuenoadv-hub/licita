import { Router } from "express";
import { z } from "zod";
import { q, q1, auditar } from "../db.js";
import { exigeLogin, exigePapel, hashSenha, senhaValida } from "../auth.js";
import { ETAPAS, PAPEIS, type Papel } from "../../shared/etapas.js";

const papelEnum = z.enum(Object.keys(PAPEIS) as [Papel, ...Papel[]]);

export function rotasAdmin() {
  const r = Router();
  r.use("/admin", exigeLogin);

  // Dados do órgão: qualquer usuário lê; admin altera.
  r.get("/orgao", exigeLogin, async (req, res) => {
    res.json(await q1("select id, nome, cnpj, municipio, uf, normas from orgaos where id = $1", [req.usuario!.orgao_id]));
  });
  r.put("/admin/orgao", exigePapel("admin"), async (req, res) => {
    const d = z.object({ nome: z.string().min(2), cnpj: z.string().optional(), municipio: z.string().optional(), uf: z.string().max(2).optional(), normas: z.string().max(20000) }).parse(req.body);
    await q("update orgaos set nome=$1, cnpj=$2, municipio=$3, uf=$4, normas=$5 where id=$6", [d.nome, d.cnpj ?? null, d.municipio ?? null, d.uf ?? null, d.normas, req.usuario!.orgao_id]);
    await auditar({ orgao: req.usuario!.orgao_id, usuario: req.usuario!.id, acao: "orgao.atualizado" });
    res.json({ ok: true });
  });

  // Usuários do órgão
  r.get("/admin/usuarios", exigePapel("admin"), async (req, res) => {
    res.json(await q("select id, nome, email, cargo, papeis, ativo, criado_em from usuarios where orgao_id = $1 order by nome", [req.usuario!.orgao_id]));
  });
  r.post("/admin/usuarios", exigePapel("admin"), async (req, res) => {
    const d = z.object({ nome: z.string().min(2), email: z.string().email(), cargo: z.string().default(""), papeis: z.array(papelEnum).min(1), senha: z.string() }).parse(req.body);
    if (!senhaValida(d.senha)) return res.status(400).json({ erro: "A senha inicial precisa ter ao menos 10 caracteres." });
    const existe = await q1("select 1 from usuarios where email = lower($1)", [d.email]);
    if (existe) return res.status(409).json({ erro: "Já existe um usuário com esse e-mail." });
    const u = await q1("insert into usuarios (orgao_id, nome, email, cargo, papeis, senha_hash) values ($1,$2,lower($3),$4,$5,$6) returning id",
      [req.usuario!.orgao_id, d.nome, d.email, d.cargo, d.papeis, await hashSenha(d.senha)]);
    await auditar({ orgao: req.usuario!.orgao_id, usuario: req.usuario!.id, acao: "usuario.criado", detalhe: { id: u.id, email: d.email, papeis: d.papeis } });
    res.status(201).json({ id: u.id });
  });
  r.put("/admin/usuarios/:id", exigePapel("admin"), async (req, res) => {
    const d = z.object({ nome: z.string().min(2), cargo: z.string().default(""), papeis: z.array(papelEnum).min(1), ativo: z.boolean(), senha: z.string().optional() }).parse(req.body);
    const id = Number(req.params.id);
    if (id === req.usuario!.id && (!d.ativo || !d.papeis.includes("admin"))) return res.status(400).json({ erro: "Você não pode remover o próprio acesso de administrador." });
    if (d.senha && !senhaValida(d.senha)) return res.status(400).json({ erro: "A senha precisa ter ao menos 10 caracteres." });
    const r1 = await q("update usuarios set nome=$1, cargo=$2, papeis=$3, ativo=$4 where id=$5 and orgao_id=$6 returning id", [d.nome, d.cargo, d.papeis, d.ativo, id, req.usuario!.orgao_id]);
    if (!r1.length) return res.status(404).json({ erro: "Usuário não encontrado." });
    if (d.senha) await q("update usuarios set senha_hash=$1 where id=$2", [await hashSenha(d.senha), id]);
    if (d.senha || !d.ativo) await q("delete from sessoes where usuario_id = $1", [id]);
    await auditar({ orgao: req.usuario!.orgao_id, usuario: req.usuario!.id, acao: "usuario.alterado", detalhe: { id, papeis: d.papeis, ativo: d.ativo, senha_redefinida: !!d.senha } });
    res.json({ ok: true });
  });

  // Modelos de documento por etapa (padrão do sistema ou personalizado pelo órgão)
  r.get("/modelos", exigeLogin, async (req, res) => {
    const proprios = await q("select etapa, texto, atualizado_em from modelos where orgao_id = $1", [req.usuario!.orgao_id]);
    res.json(ETAPAS.filter((e) => e.modelo).map((e) => {
      const p = proprios.find((x) => x.etapa === e.id);
      return { etapa: e.id, nome: e.nome, doc: e.doc, padrao: e.modelo, texto: p?.texto ?? e.modelo, personalizado: !!p, atualizado_em: p?.atualizado_em ?? null };
    }));
  });
  r.put("/admin/modelos/:etapa", exigePapel("admin", "contratacao"), async (req, res) => {
    const e = ETAPAS.find((x) => x.id === req.params.etapa && x.modelo);
    if (!e) return res.status(404).json({ erro: "Etapa sem modelo." });
    const { texto } = z.object({ texto: z.string().max(60000) }).parse(req.body);
    if (!texto.trim()) await q("delete from modelos where orgao_id=$1 and etapa=$2", [req.usuario!.orgao_id, e.id]);
    else await q("insert into modelos (orgao_id, etapa, texto) values ($1,$2,$3) on conflict (orgao_id, etapa) do update set texto=excluded.texto, atualizado_em=now()", [req.usuario!.orgao_id, e.id, texto]);
    await auditar({ orgao: req.usuario!.orgao_id, usuario: req.usuario!.id, acao: "modelo.alterado", detalhe: { etapa: e.id } });
    res.json({ ok: true });
  });

  // Limites de dispensa (tabela nacional, mantida pelos administradores)
  r.get("/limites", exigeLogin, async (req, res) => {
    res.json(await limitesDoOrgao(req.usuario!.orgao_id));
  });
  r.put("/admin/limites", exigePapel("admin"), async (req, res) => {
    const d = z.object({ ano: z.number().int().min(2021).max(2100), inciso: z.enum(["I", "II"]), valor: z.number().positive(), fonte: z.string().min(3) }).parse(req.body);
    await q("insert into limites_dispensa (orgao_id, ano, inciso, valor, fonte) values ($1,$2,$3,$4,$5) on conflict (orgao_id, ano, inciso) do update set valor=excluded.valor, fonte=excluded.fonte", [req.usuario!.orgao_id, d.ano, d.inciso, d.valor, d.fonte]);
    await auditar({ orgao: req.usuario!.orgao_id, usuario: req.usuario!.id, acao: "limite.alterado", detalhe: d });
    res.json({ ok: true });
  });

  return r;
}

/** Limites vigentes para o órgão: o valor próprio do órgão prevalece sobre o nacional. */
export async function limitesDoOrgao(orgao: number) {
  return q<{ ano: number; inciso: "I" | "II"; valor: number; fonte: string; proprio: boolean }>(
    `select distinct on (ano, inciso) ano, inciso, valor, fonte, orgao_id <> 0 as proprio
       from limites_dispensa where orgao_id in (0, $1) order by ano desc, inciso, orgao_id desc`, [orgao]);
}
