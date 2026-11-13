import { Router, type Request, type Response } from "express";
import multer from "multer";
import { z } from "zod";
import { q, q1, tx, auditar } from "../db.js";
import { exigeLogin, exigePapel, temPapel } from "../auth.js";
import { ErroHttp } from "../erros.js";
import { minutaParaDocx } from "../docx.js";
import { extrairTexto } from "../extrair.js";
import {
  ETAPAS, aplicarPendencias, atual, concluido, etapaDoItem, etapaPorId, itensDe, liberada, podeMarcar,
  type Checks, type Tipo, type Via,
} from "../../shared/etapas.js";

export const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });
/** Nome do arquivo enviado. O navegador manda em UTF-8 e o multer lê como latin1: sem isto, "orçamento" vira "orÃ§amento". */
export const nomeEnviado = (f: Express.Multer.File) => Buffer.from(f.originalname, "latin1").toString("utf8");

// O nº do processo e o do procedimento não entram aqui: são gravados ao final, em /processos/:id/numeracao.
const camposProc = z.object({
  requisitante: z.string().max(200).default(""),
  objeto: z.string().min(5).max(4000),
  tipo: z.enum(["bens", "servicos", "obra"]),
  via: z.enum(["licitacao", "dispensa", "inexigibilidade"]),
  valor_estimado: z.number().nonnegative().nullable().default(null),
  classe: z.string().max(200).default(""),
  ano: z.number().int().min(2021).max(2100),
  pca_item_id: z.number().int().nullable().default(null),
  normas: z.string().max(20000).default(""),
  obs: z.string().max(20000).default(""),
});

export interface Processo {
  id: number; orgao_id: number; tipo: Tipo; via: Via; objeto: string; protocolo: string; numero: string; procedimento: string;
  requisitante: string; valor_estimado: number | null; classe: string; ano: number; normas: string; obs: string;
  situacao: string; pca_item_id: number | null;
}

/** Carrega o processo garantindo que pertence ao órgão do usuário. */
export async function processoDo(req: Request, id = Number(req.params.id)) {
  const p = await q1<Processo>("select * from processos where id = $1 and orgao_id = $2", [id, req.usuario!.orgao_id]);
  if (!p) throw new ErroHttp(404, "Processo não encontrado.");
  return p;
}
export async function checksDo(processoId: number): Promise<Checks> {
  const rows = await q("select item from checagens where processo_id = $1", [processoId]);
  return Object.fromEntries(rows.map((r) => [r.item, true]));
}
export async function minutaVigente(processoId: number, etapa: string) {
  return q1<{ versao: number; texto: string; origem: string; criado_em: string; autor: string | null }>(
    `select m.versao, m.texto, m.origem, m.criado_em, u.nome as autor from minutas m left join usuarios u on u.id = m.usuario_id
      where m.processo_id = $1 and m.etapa = $2 order by m.versao desc limit 1`, [processoId, etapa]);
}
export async function salvarMinuta(processoId: number, etapa: string, texto: string, origem: string, usuario: number) {
  return tx(async (c) => {
    const ult = (await c.query("select versao, texto from minutas where processo_id=$1 and etapa=$2 order by versao desc limit 1 for update", [processoId, etapa])).rows[0];
    if (ult && ult.texto === texto) return { versao: ult.versao as number, nova: false };
    const versao = (ult?.versao ?? 0) + 1;
    await c.query("insert into minutas (processo_id, etapa, versao, texto, origem, usuario_id) values ($1,$2,$3,$4,$5,$6)", [processoId, etapa, versao, texto, origem, usuario]);
    await c.query("update processos set atualizado_em = now() where id = $1", [processoId]);
    return { versao, nova: true };
  });
}
function exigeEtapaEditavel(req: Request, p: Processo, checks: Checks, etapaId: string) {
  const ix = ETAPAS.findIndex((e) => e.id === etapaId);
  if (ix < 0) throw new ErroHttp(404, "Etapa inexistente.");
  if (!podeMarcar(req.usuario!.papeis, ETAPAS[ix])) throw new ErroHttp(403, `Seu perfil não atua na etapa "${ETAPAS[ix].nome}".`);
  if (!liberada(ix, p, checks)) throw new ErroHttp(409, "Conclua as etapas anteriores para liberar esta.");
  if (p.situacao === "cancelado") throw new ErroHttp(409, "Processo cancelado.");
  return ETAPAS[ix];
}

const TIPOS_ORC: Record<string, string> = {
  pdf: "application/pdf", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", xls: "application/vnd.ms-excel",
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", txt: "text/plain; charset=utf-8", csv: "text/csv; charset=utf-8",
};
const tipoOrcamento = (nome: string): string | undefined => TIPOS_ORC[nome.toLowerCase().split(".").pop() ?? ""];

function enviarArquivo(res: Response, nome: string, arquivo: Buffer) {
  const ascii = nome.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^\x20-\x7e]|["\\]/g, "_");
  res.setHeader("Content-Type", tipoOrcamento(nome) ?? "application/octet-stream");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Disposition", `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(nome)}`);
  res.send(arquivo);
}

/** A numeração é liberada quando só falta a última etapa (autorização e publicação) ou tudo já foi concluído. */
export const numeracaoLiberada = (p: Processo, c: Checks) => atual(p, c) >= ETAPAS.length - 1 || concluido(p, c);

const ROTULO_PROC: Record<Via, string> = { licitacao: "Licitação", dispensa: "Dispensa", inexigibilidade: "Inexigibilidade" };
/** Sugere o próximo número: maior "N/ano" já usado pelo órgão no exercício, mais um. Quem grava pode ajustar. */
export async function sugestaoNumeracao(p: Processo) {
  const prox = async (coluna: "numero" | "procedimento", filtroVia: boolean) => {
    const rows = await q<{ v: string }>(
      `select ${coluna} as v from processos where orgao_id=$1 and ano=$2 and id<>$3 and ${coluna} <> ''${filtroVia ? " and via=$4" : ""}`,
      filtroVia ? [p.orgao_id, p.ano, p.id, p.via] : [p.orgao_id, p.ano, p.id]);
    const usados = rows.map((r) => new RegExp(`(\\d+)\\s*/\\s*${p.ano}`).exec(r.v)?.[1]).filter(Boolean).map(Number);
    return Math.max(0, ...usados) + 1;
  };
  return {
    numero: p.numero || `${await prox("numero", false)}/${p.ano}`,
    procedimento: p.procedimento || `${ROTULO_PROC[p.via]} nº ${await prox("procedimento", true)}/${p.ano}`,
  };
}

export function rotasProcessos() {
  const r = Router();
  r.use("/processos", exigeLogin);

  r.get("/processos", async (req, res) => {
    const ano = req.query.ano ? Number(req.query.ano) : null;
    const rows = await q(
      `select p.id, p.protocolo, p.numero, p.procedimento, p.objeto, p.tipo, p.via, p.valor_estimado, p.ano, p.situacao, p.requisitante, p.atualizado_em,
              coalesce((select array_agg(item) from checagens c where c.processo_id = p.id), '{}') as itens
         from processos p where p.orgao_id = $1 and ($2::int is null or p.ano = $2) order by p.atualizado_em desc`,
      [req.usuario!.orgao_id, ano]);
    res.json(rows.map(({ itens, ...p }) => {
      const c: Checks = Object.fromEntries((itens as string[]).map((i) => [i, true]));
      return { ...p, etapa_atual: atual(p, c), concluido: concluido(p, c), feitas: ETAPAS.map((e) => itensDe(e, p).every((i) => c[i.id])) };
    }));
  });

  r.post("/processos", exigePapel("requisitante", "contratacao"), async (req, res) => {
    const d = camposProc.parse(req.body);
    if (d.pca_item_id) {
      const ok = await q1("select 1 from pca_itens where id=$1 and orgao_id=$2", [d.pca_item_id, req.usuario!.orgao_id]);
      if (!ok) throw new ErroHttp(400, "Item do PCA não encontrado.");
    }
    const orgao = req.usuario!.orgao_id;
    const p = await tx(async (c) => {
      // Próximo protocolo do órgão no exercício; a linha da sequência fica travada até o fim da transação.
      const k = (await c.query(
        `insert into sequencias (orgao_id, ano, chave, ultimo) values ($1,$2,'protocolo',1)
         on conflict (orgao_id, ano, chave) do update set ultimo = sequencias.ultimo + 1 returning ultimo`, [orgao, d.ano])).rows[0].ultimo as number;
      const protocolo = `${d.ano}/${String(k).padStart(4, "0")}`;
      return (await c.query(
        `insert into processos (orgao_id, protocolo, requisitante, objeto, tipo, via, valor_estimado, classe, ano, pca_item_id, normas, obs, criado_por)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) returning id, protocolo`,
        [orgao, protocolo, d.requisitante, d.objeto, d.tipo, d.via, d.valor_estimado, d.classe, d.ano, d.pca_item_id, d.normas, d.obs, req.usuario!.id])).rows[0] as { id: number; protocolo: string };
    });
    await auditar({ orgao, usuario: req.usuario!.id, processo: p.id, acao: "processo.criado", detalhe: { objeto: d.objeto, protocolo: p.protocolo } });
    res.status(201).json({ id: p.id, protocolo: p.protocolo });
  });

  r.get("/processos/:id", async (req, res) => {
    const p = await processoDo(req);
    const checagens = await q(
      `select c.item, c.em, u.nome as usuario from checagens c left join usuarios u on u.id = c.usuario_id where c.processo_id = $1`, [p.id]);
    const minutas = await q(
      `select distinct on (etapa) etapa, versao, origem, criado_em from minutas where processo_id = $1 order by etapa, versao desc`, [p.id]);
    const anexos = await q("select id, nome, length(texto) as caracteres, criado_em from anexos where processo_id = $1 order by id", [p.id]);
    const orcamentos = await q(
      `select o.id, o.fornecedor, o.valor, o.nome, octet_length(o.arquivo) as bytes, o.texto <> '' as lido, o.criado_em, u.nome as usuario
         from orcamentos o left join usuarios u on u.id = o.usuario_id where o.processo_id = $1 order by o.id`, [p.id]);
    const solicitacoes = await q(
      "select id, secretaria, referencia, descricao, nome_arquivo from solicitacoes_processo where processo_id=$1 order by id", [p.id],
    );
    const secretarias = await q<{ secretaria: string }>("select secretaria from secretarios where orgao_id=$1 order by secretaria", [p.orgao_id]);
    const c: Checks = Object.fromEntries(checagens.map((x) => [x.item, true]));
    res.json({
      ...p, checagens, minutas, anexos, orcamentos, solicitacoes, secretarias: secretarias.map((s) => s.secretaria), etapa_atual: atual(p, c), concluido: concluido(p, c),
      numeracao: { liberada: numeracaoLiberada(p, c), sugestao: await sugestaoNumeracao(p) },
      pode: { editar: temPapel(req.usuario!, "requisitante", "contratacao"), numerar: temPapel(req.usuario!, "contratacao", "autoridade"), etapas: ETAPAS.filter((e) => podeMarcar(req.usuario!.papeis, e)).map((e) => e.id) },
    });
  });

  r.put("/processos/:id", exigePapel("requisitante", "contratacao"), async (req, res) => {
    const p = await processoDo(req);
    const d = camposProc.parse(req.body);
    await q(
      `update processos set requisitante=$1, objeto=$2, tipo=$3, via=$4, valor_estimado=$5, classe=$6, ano=$7, pca_item_id=$8, normas=$9, obs=$10, atualizado_em=now()
        where id=$11`,
      [d.requisitante, d.objeto, d.tipo, d.via, d.valor_estimado, d.classe, d.ano, d.pca_item_id, d.normas, d.obs, p.id]);
    // Mudança de tipo ou via altera os itens aplicáveis: remove marcações que deixaram de existir.
    const validos = ETAPAS.flatMap((e) => itensDe(e, d).map((i) => i.id));
    await q("delete from checagens where processo_id=$1 and not (item = any($2))", [p.id, validos]);
    await auditar({ orgao: p.orgao_id, usuario: req.usuario!.id, processo: p.id, acao: "processo.alterado" });
    res.json({ ok: true });
  });

  r.post("/processos/:id/solicitacoes", exigePapel("requisitante", "contratacao"), upload.single("arquivo"), async (req, res) => {
    const p = await processoDo(req);
    const d = z.object({
      chave_envio: z.uuid(),
      secretaria: z.string().trim().min(2).max(200),
      referencia: z.string().trim().max(120).default(""),
      descricao: z.string().trim().min(1).max(10000),
    }).parse(req.body);
    const nome = req.file ? nomeEnviado(req.file) : null;
    if (nome && !/\.(pdf|docx|txt|md|csv)$/i.test(nome)) {
      throw new ErroHttp(415, "Envie uma solicitação em PDF, Word ou texto.");
    }
    const arquivo = req.file?.buffer ?? null;
    const texto = nome && arquivo && !/\.pdf$/i.test(nome)
      ? await extrairTexto(nome, arquivo).catch(() => "")
      : "";
    const resultado = await tx(async (c) => {
      const { rows: [processo] } = await c.query("select situacao from processos where id=$1 and orgao_id=$2 for update", [p.id, p.orgao_id]);
      if (!processo) throw new ErroHttp(404, "Processo não encontrado.");
      const { rows: [existente] } = await c.query(
        "select id from solicitacoes_processo where processo_id=$1 and chave_envio=$2", [p.id, d.chave_envio],
      );
      if (existente) return { id: existente.id, nova: false };
      if (processo.situacao !== "preparacao") {
        throw new ErroHttp(409, "A solicitação só pode ser adicionada enquanto o processo estiver em preparação.");
      }
      const { rows: [nova] } = await c.query(
        `insert into solicitacoes_processo (processo_id, chave_envio, secretaria, referencia, descricao, nome_arquivo, arquivo, texto_arquivo, usuario_id)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`,
        [p.id, d.chave_envio, d.secretaria, d.referencia, d.descricao, nome, arquivo, texto, req.usuario!.id],
      );
      await c.query("update processos set atualizado_em=now() where id=$1", [p.id]);
      await auditar({ orgao: p.orgao_id, usuario: req.usuario!.id, processo: p.id, acao: "solicitacao.incluida", detalhe: { id: nova.id, secretaria: d.secretaria } }, c);
      return { id: nova.id, nova: true };
    });
    res.status(resultado.nova ? 201 : 200).json({ id: resultado.id });
  });

  r.get("/processos/:id/solicitacoes/:sid/arquivo", async (req, res) => {
    const p = await processoDo(req);
    const id = z.coerce.number().int().min(1).max(2147483647).parse(req.params.sid);
    const s = await q1<{ nome_arquivo: string; arquivo: Buffer }>(
      "select nome_arquivo, arquivo from solicitacoes_processo where id=$1 and processo_id=$2 and arquivo is not null", [id, p.id],
    );
    if (!s) throw new ErroHttp(404, "Arquivo da solicitação não encontrado.");
    enviarArquivo(res, s.nome_arquivo, s.arquivo);
  });

  // Numeração final: o nº do processo e o do procedimento só são gravados quando o processo chega à última etapa.
  r.post("/processos/:id/numeracao", exigePapel("contratacao", "autoridade"), async (req, res) => {
    const p = await processoDo(req);
    const d = z.object({ numero: z.string().trim().min(1).max(60), procedimento: z.string().trim().min(1).max(120) }).parse(req.body);
    if (p.situacao === "cancelado") throw new ErroHttp(409, "Processo cancelado.");
    if (!numeracaoLiberada(p, await checksDo(p.id))) throw new ErroHttp(409, "O nº do processo e o do procedimento são gerados por último: conclua as etapas anteriores à publicação.");
    await q("update processos set numero=$1, procedimento=$2, atualizado_em=now() where id=$3", [d.numero, d.procedimento, p.id]);
    await auditar({ orgao: p.orgao_id, usuario: req.usuario!.id, processo: p.id, acao: "processo.numerado", detalhe: d });
    res.json({ ok: true });
  });

  r.post("/processos/:id/situacao", exigePapel("contratacao", "autoridade"), async (req, res) => {
    const p = await processoDo(req);
    const { situacao } = z.object({ situacao: z.enum(["preparacao", "publicado", "contratado", "cancelado"]) }).parse(req.body);
    if (situacao === "publicado" && !concluido(p, await checksDo(p.id))) throw new ErroHttp(409, "Só é possível marcar como publicado com todas as etapas concluídas.");
    await q("update processos set situacao=$1, atualizado_em=now() where id=$2", [situacao, p.id]);
    await auditar({ orgao: p.orgao_id, usuario: req.usuario!.id, processo: p.id, acao: "processo.situacao", detalhe: { situacao } });
    res.json({ ok: true });
  });

  // Conferência de itens: registra quem marcou e quando; respeita ordem das etapas e papel.
  r.post("/processos/:id/checagens", async (req, res) => {
    const p = await processoDo(req);
    const { item, marcado } = z.object({ item: z.string(), marcado: z.boolean() }).parse(req.body);
    const e = etapaDoItem(item);
    if (!e || !itensDe(e, p).some((i) => i.id === item)) throw new ErroHttp(400, "Item não se aplica a este processo.");
    exigeEtapaEditavel(req, p, await checksDo(p.id), e.id);
    if (marcado) await q("insert into checagens (processo_id, item, usuario_id) values ($1,$2,$3) on conflict do nothing", [p.id, item, req.usuario!.id]);
    else await q("delete from checagens where processo_id=$1 and item=$2", [p.id, item]);
    await q("update processos set atualizado_em = now() where id = $1", [p.id]);
    await auditar({ orgao: p.orgao_id, usuario: req.usuario!.id, processo: p.id, acao: marcado ? "item.marcado" : "item.desmarcado", detalhe: { item, etapa: e.id } });
    const c = await checksDo(p.id);
    res.json({ etapa_atual: atual(p, c), concluido: concluido(p, c) });
  });

  // Minutas
  r.get("/processos/:id/minutas/:etapa", async (req, res) => {
    const p = await processoDo(req);
    if (!etapaPorId(String(req.params.etapa))) throw new ErroHttp(404, "Etapa inexistente.");
    const vig = await minutaVigente(p.id, String(req.params.etapa));
    const versoes = await q(
      `select m.versao, m.origem, m.criado_em, u.nome as autor, length(m.texto) as caracteres from minutas m left join usuarios u on u.id = m.usuario_id
        where m.processo_id=$1 and m.etapa=$2 order by m.versao desc`, [p.id, req.params.etapa]);
    res.json({ vigente: vig ?? null, versoes });
  });
  r.get("/processos/:id/minutas/:etapa/versoes/:v", async (req, res) => {
    const p = await processoDo(req);
    const m = await q1("select versao, texto, origem, criado_em from minutas where processo_id=$1 and etapa=$2 and versao=$3", [p.id, req.params.etapa, Number(req.params.v)]);
    if (!m) throw new ErroHttp(404, "Versão não encontrada.");
    res.json(m);
  });
  r.post("/processos/:id/minutas/:etapa", async (req, res) => {
    const p = await processoDo(req);
    const e = exigeEtapaEditavel(req, p, await checksDo(p.id), String(req.params.etapa));
    if (!e.modelo) throw new ErroHttp(400, "Esta etapa não tem documento.");
    const { texto, origem } = z.object({ texto: z.string().max(400000), origem: z.enum(["manual", "ia", "importado"]).default("manual") }).parse(req.body);
    const r1 = await salvarMinuta(p.id, e.id, texto, origem, req.usuario!.id);
    if (r1.nova) await auditar({ orgao: p.orgao_id, usuario: req.usuario!.id, processo: p.id, acao: "minuta.salva", detalhe: { etapa: e.id, versao: r1.versao, origem } });
    res.json(r1);
  });
  r.post("/processos/:id/minutas/:etapa/pendencias", async (req, res) => {
    const p = await processoDo(req);
    const e = exigeEtapaEditavel(req, p, await checksDo(p.id), String(req.params.etapa));
    const { versao, valores } = z.object({ versao: z.number().int(), valores: z.record(z.string(), z.string().max(4000)) }).parse(req.body);
    const vig = await minutaVigente(p.id, e.id);
    if (!vig) throw new ErroHttp(404, "Minuta não encontrada.");
    if (vig.versao !== versao) throw new ErroHttp(409, "A minuta foi alterada por outra pessoa. Recarregue antes de aplicar.");
    const { texto, aplicados } = aplicarPendencias(vig.texto, valores);
    if (!aplicados) throw new ErroHttp(400, "Preencha ao menos um campo antes de aplicar.");
    const r1 = await salvarMinuta(p.id, e.id, texto, "pendencias", req.usuario!.id);
    await auditar({ orgao: p.orgao_id, usuario: req.usuario!.id, processo: p.id, acao: "minuta.pendencias", detalhe: { etapa: e.id, versao: r1.versao, aplicados } });
    res.json({ ...r1, aplicados });
  });
  r.get("/processos/:id/minutas/:etapa/docx", async (req, res) => {
    const p = await processoDo(req);
    const e = etapaPorId(String(req.params.etapa));
    const v = req.query.versao ? Number(req.query.versao) : null;
    const m = v
      ? await q1("select texto, versao from minutas where processo_id=$1 and etapa=$2 and versao=$3", [p.id, req.params.etapa, v])
      : await minutaVigente(p.id, String(req.params.etapa));
    if (!e || !m) throw new ErroHttp(404, "Minuta não encontrada.");
    const buf = await minutaParaDocx(m.texto, e.doc ?? e.nome);
    const nome = `${e.nome} - ${p.numero ? `PA ${p.numero}` : `Protocolo ${p.protocolo}`} - v${m.versao}.docx`.replace(/[\\/:*?"<>|]/g, "-");
    const ascii = nome.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^\x20-\x7e]/g, "_");
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    res.setHeader("Content-Disposition", `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(nome)}`);
    res.send(buf);
  });

  // Documentos de apoio: guarda o texto extraído para a IA consultar.
  r.post("/processos/:id/anexos", upload.single("arquivo"), async (req, res) => {
    const p = await processoDo(req);
    if (!temPapel(req.usuario!, "requisitante", "contratacao", "juridico")) throw new ErroHttp(403, "Seu perfil não pode anexar documentos.");
    if (!req.file) throw new ErroHttp(400, "Envie um arquivo.");
    const nome = nomeEnviado(req.file);
    const texto = await extrairTexto(nome, req.file.buffer);
    const a = await q1("insert into anexos (processo_id, nome, texto, usuario_id) values ($1,$2,$3,$4) returning id", [p.id, nome, texto, req.usuario!.id]);
    await auditar({ orgao: p.orgao_id, usuario: req.usuario!.id, processo: p.id, acao: "anexo.incluido", detalhe: { nome } });
    res.status(201).json({ id: a.id, caracteres: texto.length });
  });
  r.get("/processos/:id/anexos/:aid", async (req, res) => {
    const p = await processoDo(req);
    const a = await q1("select id, nome, texto from anexos where id=$1 and processo_id=$2", [Number(req.params.aid), p.id]);
    if (!a) throw new ErroHttp(404, "Documento não encontrado.");
    res.json(a);
  });
  r.delete("/processos/:id/anexos/:aid", exigePapel("requisitante", "contratacao"), async (req, res) => {
    const p = await processoDo(req);
    await q("delete from anexos where id=$1 and processo_id=$2", [Number(req.params.aid), p.id]);
    await auditar({ orgao: p.orgao_id, usuario: req.usuario!.id, processo: p.id, acao: "anexo.removido", detalhe: { id: req.params.aid } });
    res.json({ ok: true });
  });

  // Orçamentos da solicitação: guarda o arquivo original; o texto é lido quando possível, para a IA consultar.
  r.post("/processos/:id/orcamentos", exigePapel("requisitante", "contratacao"), upload.array("arquivo", 20), async (req, res) => {
    const p = await processoDo(req);
    if (p.situacao === "cancelado") throw new ErroHttp(409, "Processo cancelado.");
    const arquivos = (req.files as Express.Multer.File[] | undefined) ?? [];
    if (!arquivos.length) throw new ErroHttp(400, "Envie ao menos um arquivo de orçamento.");
    // Confere todos antes de gravar: ou entram todos, ou nenhum.
    for (const f of arquivos) {
      if (!tipoOrcamento(nomeEnviado(f))) throw new ErroHttp(415, `"${nomeEnviado(f)}": formato não aceito. Envie .pdf, .docx, .xlsx, .xls, .jpg, .png, .txt ou .csv.`);
    }
    const ids: number[] = [];
    for (const f of arquivos) {
      const nome = nomeEnviado(f);
      // O orçamento é identificado pelo nome do arquivo, sem a extensão.
      const fornecedor = (nome.replace(/\.[^.]+$/, "").trim() || nome).slice(0, 200);
      // A leitura do texto é um extra: planilha, imagem ou PDF que não puder ser lido fica só com o arquivo.
      const texto = /\.(docx|pdf|txt|csv)$/i.test(nome) ? await extrairTexto(nome, f.buffer).catch(() => "") : "";
      const o = await q1("insert into orcamentos (processo_id, fornecedor, nome, arquivo, texto, usuario_id) values ($1,$2,$3,$4,$5,$6) returning id",
        [p.id, fornecedor, nome, f.buffer, texto, req.usuario!.id]);
      ids.push(o.id);
      await auditar({ orgao: p.orgao_id, usuario: req.usuario!.id, processo: p.id, acao: "orcamento.incluido", detalhe: { nome } });
    }
    await q("update processos set atualizado_em = now() where id = $1", [p.id]);
    res.status(201).json({ ids });
  });
  // Valor do orçamento: informado depois, na linha de cada arquivo.
  r.put("/processos/:id/orcamentos/:oid", exigePapel("requisitante", "contratacao"), async (req, res) => {
    const p = await processoDo(req);
    const { valor } = z.object({ valor: z.number().nonnegative().nullable() }).parse(req.body);
    const o = await q1("update orcamentos set valor=$1 where id=$2 and processo_id=$3 returning nome", [valor, Number(req.params.oid), p.id]);
    if (!o) throw new ErroHttp(404, "Orçamento não encontrado.");
    await auditar({ orgao: p.orgao_id, usuario: req.usuario!.id, processo: p.id, acao: "orcamento.valor", detalhe: { nome: o.nome, valor } });
    res.json({ ok: true });
  });
  r.get("/processos/:id/orcamentos/:oid/arquivo", async (req, res) => {
    const p = await processoDo(req);
    const o = await q1<{ nome: string; arquivo: Buffer }>("select nome, arquivo from orcamentos where id=$1 and processo_id=$2", [Number(req.params.oid), p.id]);
    if (!o) throw new ErroHttp(404, "Orçamento não encontrado.");
    enviarArquivo(res, o.nome, o.arquivo);
  });
  r.delete("/processos/:id/orcamentos/:oid", exigePapel("requisitante", "contratacao"), async (req, res) => {
    const p = await processoDo(req);
    const o = await q1("delete from orcamentos where id=$1 and processo_id=$2 returning fornecedor, nome", [Number(req.params.oid), p.id]);
    if (!o) throw new ErroHttp(404, "Orçamento não encontrado.");
    await auditar({ orgao: p.orgao_id, usuario: req.usuario!.id, processo: p.id, acao: "orcamento.removido", detalhe: o });
    res.json({ ok: true });
  });

  r.get("/processos/:id/historico", async (req, res) => {
    const p = await processoDo(req);
    res.json(await q(
      `select a.acao, a.detalhe, a.em, u.nome as usuario from auditoria a left join usuarios u on u.id = a.usuario_id
        where a.processo_id = $1 order by a.em desc limit 300`, [p.id]));
  });

  return r;
}
