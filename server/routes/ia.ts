import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { q, q1, auditar } from "../db.js";
import { exigeLogin, exigePapel } from "../auth.js";
import { ErroHttp } from "../erros.js";
import { FORMATO_MINUTA, MODELO, gerarEstruturado, gerarTexto, iaDisponivel, traduzErroIA } from "../ia.js";
import { extrairTexto } from "../extrair.js";
import { checksDo, minutaVigente, processoDo, salvarMinuta, upload, type Processo } from "./processos.js";
import { ETAPAS, TIPOS, VIAS, etapaPorId, itensDe, liberada, pendencias, podeMarcar, type Checks } from "../../shared/etapas.js";

const LIMITE_DOC = 150_000; // caracteres por documento enviados à IA

function corta(t: string) {
  return t.length <= LIMITE_DOC ? t : t.slice(0, LIMITE_DOC) + `\n[... documento com ${t.length} caracteres; enviados os primeiros ${LIMITE_DOC}]`;
}
const moeda = (v: number | null) => (v == null ? "não informado" : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }));

/** Monta o contexto do processo para a IA: dados, andamento, etapa, modelo do órgão, peças e anexos. */
async function contexto(req: Request, p: Processo, etapaId: string, opts: { incluirMinutaAtual: boolean }) {
  const e = etapaPorId(etapaId);
  if (!e) throw new ErroHttp(404, "Etapa inexistente.");
  const c = await checksDo(p.id);
  const orgao = await q1("select nome, municipio, uf, normas from orgaos where id=$1", [p.orgao_id]);
  const modelo = (await q1("select texto from modelos where orgao_id=$1 and etapa=$2", [p.orgao_id, e.id]))?.texto ?? e.modelo;
  const minutas = await q(
    `select distinct on (etapa) etapa, texto from minutas where processo_id=$1 order by etapa, versao desc`, [p.id]);
  const anexos = await q("select nome, texto from anexos where processo_id=$1 order by id", [p.id]);

  const l: string[] = ["DADOS DO PROCESSO"];
  l.push(`Órgão: ${orgao?.nome ?? ""}${orgao?.municipio ? ` (${orgao.municipio}/${orgao.uf ?? ""})` : ""}`);
  l.push(`Processo administrativo nº: ${p.numero || "não informado"}`, `Procedimento: ${p.procedimento || "não informado"}`);
  l.push(`Área requisitante: ${p.requisitante || "não informada"}`, `Objeto: ${p.objeto}`);
  l.push(`Tipo de objeto: ${TIPOS[p.tipo]}`, `Forma de contratação: ${VIAS[p.via]}`, `Valor estimado: ${moeda(p.valor_estimado)}`);
  l.push(`Exercício: ${p.ano}`, `Natureza/ramo (para fracionamento): ${p.classe || "não informada"}`);
  l.push(`Regulamentos locais do órgão: ${orgao?.normas || "não informados"}`, `Regulamentos citados neste processo: ${p.normas || "nenhum"}`);
  l.push(`Observações: ${p.obs || "nenhuma"}`, "", "ANDAMENTO");
  ETAPAS.forEach((x, i) => {
    const its = itensDe(x, p);
    l.push(`${i + 1}. ${x.nome}: ${its.filter((it) => c[it.id]).length} de ${its.length} itens conferidos`);
  });
  l.push("", `ETAPA ABERTA: ${e.nome}${e.doc ? ` — documento: ${e.doc}` : ""}`, e.oque, "", "CHECKLIST DA ETAPA");
  itensDe(e, p).forEach((i) => l.push(`${c[i.id] ? "[x]" : "[ ]"} ${i.texto}${i.base ? ` (${i.base})` : ""}`));
  l.push("", "PONTOS DE ATENÇÃO (erros que costumam voltar do jurídico)", ...e.atencao.map((a) => `- ${a}`));
  if (modelo) l.push("", "MODELO DO DOCUMENTO (padrão de layout do órgão)", modelo);
  for (const m of minutas) {
    if (m.etapa === e.id && !opts.incluirMinutaAtual) continue;
    const nome = etapaPorId(m.etapa)?.doc ?? m.etapa;
    l.push("", m.etapa === e.id ? `MINUTA ATUAL DESTA ETAPA (${nome})` : `OUTRA PEÇA DO PROCESSO: ${nome}`, corta(m.texto));
  }
  for (const a of anexos) l.push("", `DOCUMENTO DE APOIO ANEXADO: ${a.nome}`, corta(a.texto));
  return { texto: l.join("\n"), etapa: e, checks: c };
}

/** Resposta em linhas JSON (NDJSON): {"d": trecho} ... {"fim": true, ...} ou {"erro": "..."} */
function abreFluxo(req: Request, res: Response) {
  res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("X-Accel-Buffering", "no");
  const ctl = new AbortController();
  res.on("close", () => { if (!res.writableFinished) ctl.abort(); });
  return {
    sinal: ctl.signal,
    envia: (o: object) => { if (!res.writableEnded) res.write(JSON.stringify(o) + "\n"); },
    fim: (o: object) => { if (!res.writableEnded) res.end(JSON.stringify(o) + "\n"); },
  };
}

export function rotasIA() {
  const r = Router();

  r.get("/ia/status", exigeLogin, (_req, res) => { res.json({ disponivel: iaDisponivel(), modelo: MODELO }); });

  // Conversa sobre a etapa aberta.
  r.post("/processos/:id/ia/chat", exigeLogin, async (req, res) => {
    const p = await processoDo(req);
    const d = z.object({
      etapa: z.string(),
      mensagens: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().min(1).max(60000) })).min(1).max(40),
    }).parse(req.body);
    if (d.mensagens[0].role !== "user" || d.mensagens.at(-1)!.role !== "user") throw new ErroHttp(400, "A conversa deve começar e terminar com uma mensagem do usuário.");
    const ctx = await contexto(req, p, d.etapa, { incluirMinutaAtual: true });
    const f = abreFluxo(req, res);
    try {
      const out = await gerarTexto({
        effort: "medium",
        sinal: f.sinal,
        mensagens: [
          { role: "user", content: ctx.texto + "\n\nA seguir, a conversa com o servidor. Responda à última mensagem." },
          ...d.mensagens,
        ],
        onTexto: (t) => f.envia({ d: t }),
      });
      f.fim({ fim: true, truncado: out.truncado });
    } catch (e) {
      if (f.sinal.aborted) return;
      f.fim({ erro: traduzErroIA(e).message });
    }
  });

  // Redige a minuta da etapa no layout do órgão e salva como nova versão.
  r.post("/processos/:id/ia/redigir", exigeLogin, async (req, res) => {
    const p = await processoDo(req);
    const { etapa, orientacao } = z.object({ etapa: z.string(), orientacao: z.string().max(4000).default("") }).parse(req.body);
    const ctx = await contexto(req, p, etapa, { incluirMinutaAtual: false });
    const ix = ETAPAS.indexOf(ctx.etapa);
    if (!ctx.etapa.modelo) throw new ErroHttp(400, "Esta etapa não tem documento.");
    if (!podeMarcar(req.usuario!.papeis, ctx.etapa)) throw new ErroHttp(403, `Seu perfil não atua na etapa "${ctx.etapa.nome}".`);
    if (!liberada(ix, p, ctx.checks)) throw new ErroHttp(409, "Conclua as etapas anteriores para liberar esta.");
    const f = abreFluxo(req, res);
    try {
      const out = await gerarTexto({
        effort: "high",
        sinal: f.sinal,
        mensagens: [{
          role: "user",
          content: `${ctx.texto}\n\nTAREFA\nRedija a minuta completa do documento desta etapa, seguindo a ordem de seções do MODELO DO DOCUMENTO e adaptando ao objeto e à forma de contratação. Use as outras peças e os documentos de apoio como fonte dos dados, mantendo coerência entre eles.${orientacao ? `\nOrientação do servidor: ${orientacao}` : ""}\n\n${FORMATO_MINUTA}`,
        }],
        onTexto: (t) => f.envia({ d: t }),
      });
      const s = await salvarMinuta(p.id, ctx.etapa.id, out.texto, "ia", req.usuario!.id);
      await auditar({ orgao: p.orgao_id, usuario: req.usuario!.id, processo: p.id, acao: "minuta.ia", detalhe: { etapa: ctx.etapa.id, versao: s.versao, truncado: out.truncado } });
      f.fim({ fim: true, versao: s.versao, truncado: out.truncado });
    } catch (e) {
      if (f.sinal.aborted) return;
      f.fim({ erro: traduzErroIA(e).message });
    }
  });

  // Sugere valores para os campos pendentes [[...]] da minuta vigente.
  r.post("/processos/:id/ia/sugerir", exigeLogin, async (req, res) => {
    const p = await processoDo(req);
    const { etapa } = z.object({ etapa: z.string() }).parse(req.body);
    const vig = await minutaVigente(p.id, etapa);
    if (!vig) throw new ErroHttp(404, "Esta etapa ainda não tem minuta.");
    const lista = pendencias(vig.texto);
    if (!lista.length) return res.json({ versao: vig.versao, sugestoes: [] });
    const ctx = await contexto(req, p, etapa, { incluirMinutaAtual: true });
    const esquema = z.object({
      sugestoes: z.array(z.object({
        i: z.number().int(),
        valor: z.string().nullable(),
        fonte: z.string(),
        falta: z.string(),
      })),
    });
    try {
      const out = await gerarEstruturado(esquema, `${ctx.texto}

CAMPOS PENDENTES DA MINUTA ATUAL (cada linha é uma ocorrência; o símbolo ▮ marca o lugar do campo no trecho; campos com o mesmo texto podem pedir dados diferentes)
${lista.map((x) => `${x.i}. [${x.rotulo}] trecho: ${x.trecho}`).join("\n")}

TAREFA
Para cada campo pendente, proponha o texto que substitui a marca, de modo que a frase fique correta. Use somente o que consta dos dados do processo, das outras peças e dos documentos de apoio. Quando o campo oferecer alternativas separadas por "/", escolha a que os documentos sustentam e escreva o texto final já sem a alternativa descartada. Se a informação não constar, "valor" = null e diga em "falta" qual setor deve informar. Nunca invente número, data, valor, nome ou folha. Em "fonte", indique o documento e o item onde achou. Responda um objeto por campo, com "i" igual ao número do campo.`);
      const validos = out.sugestoes.filter((s) => s.i >= 0 && s.i < lista.length);
      await auditar({ orgao: p.orgao_id, usuario: req.usuario!.id, processo: p.id, acao: "ia.sugestoes", detalhe: { etapa, versao: vig.versao, campos: lista.length, sugeridos: validos.filter((s) => s.valor).length } });
      res.json({ versao: vig.versao, sugestoes: validos });
    } catch (e) {
      throw traduzErroIA(e);
    }
  });

  // Extrai dados para abrir um processo a partir de um documento (memorando, pedido, DFD antigo).
  r.post("/ia/extrair", exigePapel("requisitante", "contratacao"), upload.single("arquivo"), async (req, res) => {
    let texto = typeof req.body?.texto === "string" ? req.body.texto : "";
    if (req.file) texto = await extrairTexto(req.file.originalname, req.file.buffer);
    if (!texto.trim()) throw new ErroHttp(400, "Envie um arquivo ou cole o texto.");
    const esquema = z.object({
      numero: z.string().nullable(), procedimento: z.string().nullable(), requisitante: z.string().nullable(),
      objeto: z.string().nullable(), valor_estimado: z.number().nullable(), classe: z.string().nullable(),
      tipo: z.enum(["bens", "servicos", "obra"]).nullable(), via: z.enum(["licitacao", "dispensa", "inexigibilidade"]).nullable(),
      normas: z.string().nullable(), obs: z.string().nullable(),
    });
    try {
      const dados = await gerarEstruturado(esquema, `TAREFA
Extraia do TEXTO abaixo os dados para abrir um processo de contratação.
- objeto: descrição completa, sem marca comercial;
- classe: natureza ou ramo de atividade do objeto (ex.: "obras de construção civil", "material de expediente"), usado para controlar fracionamento;
- valor_estimado: número em reais, só se o texto informar;
- normas: leis e decretos locais citados;
- obs: prazos, quantidades, local e outros dados úteis para o ETP e o Termo de Referência.
Use null para o que não constar; não deduza número, valor nem data.

TEXTO
${corta(texto)}`, "medium");
      res.json({ dados, texto });
    } catch (e) {
      throw traduzErroIA(e);
    }
  });

  return r;
}
