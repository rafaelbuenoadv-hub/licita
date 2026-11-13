import { Router } from "express";
import { z } from "zod";
import { q, q1, auditar } from "../db.js";
import { exigeLogin, exigePapel } from "../auth.js";
import { ErroHttp } from "../erros.js";
import { limitesDoOrgao } from "./admin.js";
import { processoDo } from "./processos.js";

const itemPca = z.object({
  ano: z.number().int().min(2021).max(2100),
  descricao: z.string().min(3).max(2000),
  classe: z.string().max(200).default(""),
  tipo: z.enum(["bens", "servicos", "obra"]),
  valor_estimado: z.number().nonnegative(),
  trimestre: z.number().int().min(1).max(4).nullable().default(null),
  requisitante: z.string().max(200).default(""),
});

const norm = (s: string) => s.trim().toLowerCase();

/**
 * Fracionamento (art. 75, § 1º): soma, no exercício, as dispensas por valor da mesma natureza.
 * Obras e serviços de engenharia usam o limite do inciso I; os demais, o do inciso II.
 */
export async function resumoFracionamento(orgao: number, ano: number) {
  const limites = (await limitesDoOrgao(orgao)).filter((l) => l.ano === ano);
  const lim = (inciso: "I" | "II") => limites.find((l) => l.inciso === inciso) ?? null;
  const procs = await q(
    `select id, protocolo, numero, objeto, classe, tipo, via, valor_estimado, situacao, pca_item_id from processos
      where orgao_id=$1 and ano=$2 and situacao <> 'cancelado'`, [orgao, ano]);
  const itens = await q("select * from pca_itens where orgao_id=$1 and ano=$2 order by trimestre nulls last, id", [orgao, ano]);
  const classes = new Map<string, { classe: string; inciso: "I" | "II"; planejado: number; processos: number; dispensas: number; ids: number[] }>();
  const pega = (classe: string, tipo: string) => {
    const k = norm(classe) || "(sem natureza informada)";
    let c = classes.get(k);
    if (!c) { c = { classe: classe.trim() || "(sem natureza informada)", inciso: "II", planejado: 0, processos: 0, dispensas: 0, ids: [] }; classes.set(k, c); }
    if (tipo === "obra") c.inciso = "I";
    return c;
  };
  for (const i of itens) pega(i.classe, i.tipo).planejado += i.valor_estimado ?? 0;
  for (const p of procs) {
    const c = pega(p.classe, p.tipo);
    c.processos += p.valor_estimado ?? 0;
    if (p.via === "dispensa") { c.dispensas += p.valor_estimado ?? 0; c.ids.push(p.id); }
  }
  const resumo = [...classes.values()].map((c) => {
    const l = lim(c.inciso);
    const alerta = !l ? (c.dispensas > 0 ? "sem_limite" : null)
      : c.dispensas > l.valor ? "excede"
      : c.dispensas > 0 && c.planejado > l.valor ? "planejado_excede"
      : null;
    return { ...c, limite: l?.valor ?? null, limite_fonte: l?.fonte ?? null, alerta };
  }).sort((a, b) => a.classe.localeCompare(b.classe, "pt-BR"));
  return { itens, processos: procs, resumo, limites };
}

export function rotasPca() {
  const r = Router();
  r.use("/pca", exigeLogin);

  r.get("/pca", async (req, res) => {
    const ano = Number(req.query.ano ?? new Date().getFullYear());
    const d = await resumoFracionamento(req.usuario!.orgao_id, ano);
    res.json({
      ano, ...d,
      fora_do_plano: d.processos.filter((p) => !p.pca_item_id).map((p) => ({ id: p.id, protocolo: p.protocolo, numero: p.numero, objeto: p.objeto, valor_estimado: p.valor_estimado })),
      total_planejado: d.itens.reduce((s, i) => s + (i.valor_estimado ?? 0), 0),
    });
  });

  r.post("/pca", exigePapel("contratacao", "requisitante"), async (req, res) => {
    const d = itemPca.parse(req.body);
    const i = await q1(
      `insert into pca_itens (orgao_id, ano, descricao, classe, tipo, valor_estimado, trimestre, requisitante) values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`,
      [req.usuario!.orgao_id, d.ano, d.descricao, d.classe, d.tipo, d.valor_estimado, d.trimestre, d.requisitante]);
    await auditar({ orgao: req.usuario!.orgao_id, usuario: req.usuario!.id, acao: "pca.incluido", detalhe: { id: i.id, ...d } });
    res.status(201).json({ id: i.id });
  });
  r.put("/pca/:id", exigePapel("contratacao", "requisitante"), async (req, res) => {
    const d = itemPca.parse(req.body);
    const r1 = await q(
      `update pca_itens set ano=$1, descricao=$2, classe=$3, tipo=$4, valor_estimado=$5, trimestre=$6, requisitante=$7 where id=$8 and orgao_id=$9 returning id`,
      [d.ano, d.descricao, d.classe, d.tipo, d.valor_estimado, d.trimestre, d.requisitante, Number(req.params.id), req.usuario!.orgao_id]);
    if (!r1.length) throw new ErroHttp(404, "Item não encontrado.");
    await auditar({ orgao: req.usuario!.orgao_id, usuario: req.usuario!.id, acao: "pca.alterado", detalhe: { id: req.params.id } });
    res.json({ ok: true });
  });
  r.delete("/pca/:id", exigePapel("contratacao"), async (req, res) => {
    const r1 = await q("delete from pca_itens where id=$1 and orgao_id=$2 returning id", [Number(req.params.id), req.usuario!.orgao_id]);
    if (!r1.length) throw new ErroHttp(404, "Item não encontrado.");
    await auditar({ orgao: req.usuario!.orgao_id, usuario: req.usuario!.id, acao: "pca.removido", detalhe: { id: req.params.id } });
    res.json({ ok: true });
  });

  // Situação de fracionamento para um processo específico.
  r.get("/processos/:id/fracionamento", exigeLogin, async (req, res) => {
    const p = await processoDo(req);
    const d = await resumoFracionamento(p.orgao_id, p.ano);
    const c = d.resumo.find((x) => norm(x.classe) === (norm(p.classe) || "(sem natureza informada)"));
    res.json({ classe: c ?? null, outros: d.processos.filter((x) => c?.ids.includes(x.id) && x.id !== p.id) });
  });

  return r;
}
