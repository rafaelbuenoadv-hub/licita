import { Router, type Request } from "express";
import { z } from "zod";
import { q, q1, tx, auditar } from "../db.js";
import { exigeLogin, exigePapel, temPapel } from "../auth.js";
import { ErroHttp } from "../erros.js";
import { limiteAditivo } from "../../shared/etapas.js";

const data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "use o formato AAAA-MM-DD");
const camposContrato = z.object({
  processo_id: z.number().int().nullable().default(null),
  numero: z.string().min(1).max(60),
  objeto: z.string().min(3).max(4000),
  contratada: z.string().min(2).max(300),
  cnpj: z.string().max(20).default(""),
  tipo_objeto: z.enum(["obra", "servico", "compra", "reforma"]),
  valor_inicial: z.number().positive(),
  inicio: data,
  fim: data,
  gestor: z.string().max(200).default(""),
  fiscal: z.string().max(200).default(""),
  fiscal_substituto: z.string().max(200).default(""),
});

const hoje = () => new Date().toISOString().slice(0, 10);
const br = (iso: string) => iso.split("-").reverse().join("/");
const pct = (x: number, casas = 1) => (x * 100).toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas }) + "%";
const dias = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);

/** Números do contrato: valor atual, prazo atual, execução financeira e uso do limite do art. 125. */
export function calcular(c: any, aditivos: any[], medicoes: any[]) {
  const acrescimos = aditivos.filter((a) => a.tipo === "acrescimo").reduce((s, a) => s + a.valor, 0);
  const supressoes = aditivos.filter((a) => a.tipo === "supressao").reduce((s, a) => s + a.valor, 0);
  const reajustes = aditivos.filter((a) => a.tipo === "reajuste").reduce((s, a) => s + a.valor, 0);
  const valor_atual = c.valor_inicial + acrescimos - supressoes + reajustes;
  const base = c.valor_inicial + reajustes; // valor inicial atualizado (art. 125)
  const prazos = aditivos.filter((a) => a.nova_fim).map((a) => a.nova_fim as string);
  const fim_atual = [c.fim, ...prazos].sort().at(-1)!;
  const medido = medicoes.reduce((s, m) => s + m.valor, 0);
  const pago = medicoes.filter((m) => m.situacao === "paga").reduce((s, m) => s + m.valor, 0);
  const limite = limiteAditivo(c.tipo_objeto);
  const uso_acrescimo = base > 0 ? acrescimos / base : 0;
  const uso_supressao = base > 0 ? supressoes / base : 0;
  const dias_para_fim = dias(hoje(), fim_atual);
  const alertas: { nivel: "alto" | "medio"; texto: string }[] = [];
  if (c.situacao === "vigente") {
    if (dias_para_fim < 0) alertas.push({ nivel: "alto", texto: `Vigência encerrada há ${-dias_para_fim} dias e o contrato segue como vigente.` });
    else if (dias_para_fim <= 30) alertas.push({ nivel: "alto", texto: `Vigência termina em ${dias_para_fim} dias (${br(fim_atual)}).` });
    else if (dias_para_fim <= 90) alertas.push({ nivel: "medio", texto: `Vigência termina em ${dias_para_fim} dias (${br(fim_atual)}). Avalie prorrogação ou nova contratação.` });
    if (uso_acrescimo >= limite * 0.8) alertas.push({ nivel: uso_acrescimo >= limite ? "alto" : "medio", texto: `Acréscimos somam ${pct(uso_acrescimo)} do valor inicial atualizado; o limite do art. 125 é ${pct(limite, 0)}.` });
    if (medido > valor_atual) alertas.push({ nivel: "alto", texto: "Valor medido supera o valor atual do contrato." });
  }
  return { valor_atual, fim_atual, medido, pago, saldo: valor_atual - medido, acrescimos, supressoes, reajustes, limite, uso_acrescimo, uso_supressao, dias_para_fim, alertas };
}

async function contratoDo(req: Request) {
  const c = await q1("select * from contratos where id=$1 and orgao_id=$2", [Number(req.params.id), req.usuario!.orgao_id]);
  if (!c) throw new ErroHttp(404, "Contrato não encontrado.");
  return c;
}
async function completo(id: number) {
  const aditivos = await q("select * from aditivos where contrato_id=$1 order by data, id", [id]);
  const medicoes = await q("select * from medicoes where contrato_id=$1 order by data, id", [id]);
  const ocorrencias = await q(
    "select o.*, u.nome as autor from ocorrencias o left join usuarios u on u.id=o.usuario_id where contrato_id=$1 order by data desc, id desc", [id]);
  return { aditivos, medicoes, ocorrencias };
}

export function rotasContratos() {
  const r = Router();
  r.use("/contratos", exigeLogin);

  r.get("/contratos", async (req, res) => {
    const cs = await q("select * from contratos where orgao_id=$1 order by fim", [req.usuario!.orgao_id]);
    const ids = cs.map((c) => c.id);
    const ad = ids.length ? await q("select * from aditivos where contrato_id = any($1)", [ids]) : [];
    const me = ids.length ? await q("select * from medicoes where contrato_id = any($1)", [ids]) : [];
    res.json(cs.map((c) => ({ ...c, ...calcular(c, ad.filter((a) => a.contrato_id === c.id), me.filter((m) => m.contrato_id === c.id)) })));
  });

  r.post("/contratos", exigePapel("contratacao"), async (req, res) => {
    const d = camposContrato.parse(req.body);
    if (d.fim < d.inicio) throw new ErroHttp(400, "O fim da vigência é anterior ao início.");
    if (d.processo_id) {
      const p = await q1("select 1 from processos where id=$1 and orgao_id=$2", [d.processo_id, req.usuario!.orgao_id]);
      if (!p) throw new ErroHttp(400, "Processo não encontrado.");
    }
    const c = await tx(async (cx) => {
      const novo = (await cx.query(
        `insert into contratos (orgao_id, processo_id, numero, objeto, contratada, cnpj, tipo_objeto, valor_inicial, inicio, fim, gestor, fiscal, fiscal_substituto)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) returning id`,
        [req.usuario!.orgao_id, d.processo_id, d.numero, d.objeto, d.contratada, d.cnpj, d.tipo_objeto, d.valor_inicial, d.inicio, d.fim, d.gestor, d.fiscal, d.fiscal_substituto])).rows[0];
      if (d.processo_id) await cx.query("update processos set situacao='contratado', atualizado_em=now() where id=$1", [d.processo_id]);
      return novo;
    });
    await auditar({ orgao: req.usuario!.orgao_id, usuario: req.usuario!.id, contrato: c.id, processo: d.processo_id, acao: "contrato.criado", detalhe: { numero: d.numero } });
    res.status(201).json({ id: c.id });
  });

  r.get("/contratos/:id", async (req, res) => {
    const c = await contratoDo(req);
    const extra = await completo(c.id);
    const processo = c.processo_id ? await q1("select id, numero, procedimento, objeto from processos where id=$1", [c.processo_id]) : null;
    res.json({ ...c, ...extra, processo, ...calcular(c, extra.aditivos, extra.medicoes) });
  });

  r.put("/contratos/:id", exigePapel("contratacao"), async (req, res) => {
    const c = await contratoDo(req);
    const d = camposContrato.extend({ situacao: z.enum(["vigente", "encerrado", "rescindido"]) }).parse(req.body);
    await q(
      `update contratos set numero=$1, objeto=$2, contratada=$3, cnpj=$4, tipo_objeto=$5, valor_inicial=$6, inicio=$7, fim=$8, gestor=$9, fiscal=$10, fiscal_substituto=$11, situacao=$12 where id=$13`,
      [d.numero, d.objeto, d.contratada, d.cnpj, d.tipo_objeto, d.valor_inicial, d.inicio, d.fim, d.gestor, d.fiscal, d.fiscal_substituto, d.situacao, c.id]);
    await auditar({ orgao: c.orgao_id, usuario: req.usuario!.id, contrato: c.id, acao: "contrato.alterado" });
    res.json({ ok: true });
  });

  r.post("/contratos/:id/aditivos", exigePapel("contratacao"), async (req, res) => {
    const c = await contratoDo(req);
    const d = z.object({
      numero: z.string().min(1).max(40), tipo: z.enum(["prazo", "acrescimo", "supressao", "qualitativo", "reajuste"]),
      valor: z.number().nonnegative().default(0), nova_fim: data.nullable().default(null), justificativa: z.string().min(10).max(8000), data: data.default(hoje()),
    }).parse(req.body);
    if (d.tipo === "prazo" && !d.nova_fim) throw new ErroHttp(400, "Informe a nova data de fim da vigência.");
    if (["acrescimo", "supressao", "reajuste"].includes(d.tipo) && !d.valor) throw new ErroHttp(400, "Informe o valor do aditivo.");
    const { aditivos, medicoes } = await completo(c.id);
    const atual = calcular(c, aditivos, medicoes);
    if (d.tipo === "acrescimo") {
      const base = c.valor_inicial + atual.reajustes;
      const uso = (atual.acrescimos + d.valor) / base;
      if (uso > atual.limite + 1e-9) {
        throw new ErroHttp(409, `Com este aditivo os acréscimos chegariam a ${pct(uso, 2)} do valor inicial atualizado, acima do limite de ${pct(atual.limite, 0)} do art. 125 da Lei nº 14.133/2021.`);
      }
    }
    const a = await q1(
      "insert into aditivos (contrato_id, numero, tipo, valor, nova_fim, justificativa, data) values ($1,$2,$3,$4,$5,$6,$7) returning id",
      [c.id, d.numero, d.tipo, d.valor, d.nova_fim, d.justificativa, d.data]);
    await auditar({ orgao: c.orgao_id, usuario: req.usuario!.id, contrato: c.id, acao: "aditivo.incluido", detalhe: d });
    res.status(201).json({ id: a.id });
  });

  r.post("/contratos/:id/medicoes", exigePapel("fiscal", "contratacao"), async (req, res) => {
    const c = await contratoDo(req);
    const d = z.object({ referencia: z.string().min(1).max(200), valor: z.number().positive(), data: data.default(hoje()), observacao: z.string().max(4000).default("") }).parse(req.body);
    const m = await q1("insert into medicoes (contrato_id, referencia, valor, data, observacao) values ($1,$2,$3,$4,$5) returning id", [c.id, d.referencia, d.valor, d.data, d.observacao]);
    await auditar({ orgao: c.orgao_id, usuario: req.usuario!.id, contrato: c.id, acao: "medicao.incluida", detalhe: d });
    res.status(201).json({ id: m.id });
  });
  r.post("/contratos/:id/medicoes/:mid/situacao", exigeLogin, async (req, res) => {
    const c = await contratoDo(req);
    const { situacao } = z.object({ situacao: z.enum(["medida", "atestada", "paga"]) }).parse(req.body);
    // Fiscal atesta; pagamento registrado pelo setor de contratações.
    if (situacao === "atestada" && !temPapel(req.usuario!, "fiscal")) throw new ErroHttp(403, "Somente o fiscal atesta a medição.");
    if (situacao === "paga" && !temPapel(req.usuario!, "contratacao")) throw new ErroHttp(403, "Somente o setor de contratações registra pagamento.");
    const r1 = await q("update medicoes set situacao=$1 where id=$2 and contrato_id=$3 returning id", [situacao, Number(req.params.mid), c.id]);
    if (!r1.length) throw new ErroHttp(404, "Medição não encontrada.");
    await auditar({ orgao: c.orgao_id, usuario: req.usuario!.id, contrato: c.id, acao: "medicao.situacao", detalhe: { id: req.params.mid, situacao } });
    res.json({ ok: true });
  });

  r.post("/contratos/:id/ocorrencias", exigePapel("fiscal", "contratacao"), async (req, res) => {
    const c = await contratoDo(req);
    const d = z.object({ descricao: z.string().min(3).max(8000), providencia: z.string().max(8000).default(""), data: data.default(hoje()) }).parse(req.body);
    const o = await q1("insert into ocorrencias (contrato_id, descricao, providencia, data, usuario_id) values ($1,$2,$3,$4,$5) returning id", [c.id, d.descricao, d.providencia, d.data, req.usuario!.id]);
    await auditar({ orgao: c.orgao_id, usuario: req.usuario!.id, contrato: c.id, acao: "ocorrencia.registrada" });
    res.status(201).json({ id: o.id });
  });

  return r;
}
