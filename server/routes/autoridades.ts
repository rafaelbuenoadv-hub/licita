import { Router } from "express";
import { z } from "zod";
import { q, q1, tx, auditar } from "../db.js";
import { exigeLogin, exigePapel } from "../auth.js";
import { ErroHttp } from "../erros.js";
import { AUTORIDADES_IBAITI } from "../autoridades-ibaiti.js";

// Cadastro de secretários e responsáveis do órgão, com o ato de nomeação. Todos consultam; o administrador mantém.
const campos = z.object({
  unidade: z.string().trim().min(2).max(300),
  sigla: z.string().trim().max(30).default(""),
  titular: z.string().trim().min(2).max(200),
  cargo: z.string().trim().min(2).max(300),
  ato: z.string().trim().max(200).default(""),
  publicacao: z.string().trim().max(300).default(""),
  link: z.string().trim().max(500).refine((v) => v === "" || /^https?:\/\//i.test(v), "O link deve começar com http:// ou https://").default(""),
  email: z.string().trim().max(200).default(""),
  telefone: z.string().trim().max(60).default(""),
  obs: z.string().trim().max(2000).default(""),
  ativo: z.boolean().default(true),
});
const COLS = "unidade, sigla, titular, cargo, ato, publicacao, link, email, telefone, obs, ativo";
const valores = (d: z.infer<typeof campos>) => [d.unidade, d.sigla, d.titular, d.cargo, d.ato, d.publicacao, d.link, d.email, d.telefone, d.obs, d.ativo];

/** Inclui os secretários de Ibaiti que ainda não constam (mesma unidade e mesmo titular). Devolve quantos entraram. */
export async function importarIbaiti(orgao: number) {
  return tx(async (c) => {
    let n = 0;
    for (const a of AUTORIDADES_IBAITI) {
      const r = await c.query(
        `insert into autoridades (orgao_id, ${COLS}) select $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,true
          where not exists (select 1 from autoridades where orgao_id=$1 and lower(unidade)=lower($2) and lower(titular)=lower($4))`,
        [orgao, a.unidade, a.sigla, a.titular, a.cargo, a.ato, a.publicacao, a.link, a.email, a.telefone, a.obs]);
      n += r.rowCount ?? 0;
    }
    return n;
  });
}
/** Na subida do servidor: órgão de Ibaiti que ainda não tem nenhum cadastro recebe a lista pronta. */
export async function semearIbaiti() {
  const orgaos = await q<{ id: number }>(
    `select o.id from orgaos o where (o.nome ilike '%ibaiti%' or o.municipio ilike '%ibaiti%') and not exists (select 1 from autoridades a where a.orgao_id = o.id)`);
  for (const o of orgaos) console.log(`Cadastro de secretários de Ibaiti carregado no órgão ${o.id}: ${await importarIbaiti(o.id)} registros.`);
}

export function rotasAutoridades() {
  const r = Router();
  r.get("/autoridades", exigeLogin, async (req, res) => {
    res.json(await q(`select id, ${COLS} from autoridades where orgao_id=$1 order by ativo desc, unidade, titular`, [req.usuario!.orgao_id]));
  });
  r.post("/admin/autoridades", exigePapel("admin"), async (req, res) => {
    const d = campos.parse(req.body);
    const a = await q1(`insert into autoridades (orgao_id, ${COLS}) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning id`, [req.usuario!.orgao_id, ...valores(d)]);
    await auditar({ orgao: req.usuario!.orgao_id, usuario: req.usuario!.id, acao: "autoridade.incluida", detalhe: { id: a.id, unidade: d.unidade, titular: d.titular } });
    res.status(201).json({ id: a.id });
  });
  r.put("/admin/autoridades/:id", exigePapel("admin"), async (req, res) => {
    const d = campos.parse(req.body);
    const r1 = await q(
      `update autoridades set unidade=$1, sigla=$2, titular=$3, cargo=$4, ato=$5, publicacao=$6, link=$7, email=$8, telefone=$9, obs=$10, ativo=$11, atualizado_em=now()
        where id=$12 and orgao_id=$13 returning id`, [...valores(d), Number(req.params.id), req.usuario!.orgao_id]);
    if (!r1.length) throw new ErroHttp(404, "Cadastro não encontrado.");
    await auditar({ orgao: req.usuario!.orgao_id, usuario: req.usuario!.id, acao: "autoridade.alterada", detalhe: { id: Number(req.params.id), titular: d.titular, ativo: d.ativo } });
    res.json({ ok: true });
  });
  r.delete("/admin/autoridades/:id", exigePapel("admin"), async (req, res) => {
    const r1 = await q("delete from autoridades where id=$1 and orgao_id=$2 returning unidade, titular", [Number(req.params.id), req.usuario!.orgao_id]);
    if (!r1.length) throw new ErroHttp(404, "Cadastro não encontrado.");
    await auditar({ orgao: req.usuario!.orgao_id, usuario: req.usuario!.id, acao: "autoridade.removida", detalhe: r1[0] });
    res.json({ ok: true });
  });
  r.post("/admin/autoridades/importar-ibaiti", exigePapel("admin"), async (req, res) => {
    const incluidos = await importarIbaiti(req.usuario!.orgao_id);
    await auditar({ orgao: req.usuario!.orgao_id, usuario: req.usuario!.id, acao: "autoridade.importadas", detalhe: { incluidos } });
    res.json({ incluidos });
  });
  return r;
}
