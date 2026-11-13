import { Router, type Request } from "express";
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

const camposProc = z.object({
  numero: z.string().max(60).default(""),
  procedimento: z.string().max(120).default(""),
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
  id: number; orgao_id: number; tipo: Tipo; via: Via; objeto: string; numero: string; procedimento: string;
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

export function rotasProcessos() {
  const r = Router();
  r.use("/processos", exigeLogin);

  r.get("/processos", async (req, res) => {
    const ano = req.query.ano ? Number(req.query.ano) : null;
    const rows = await q(
      `select p.id, p.numero, p.procedimento, p.objeto, p.tipo, p.via, p.valor_estimado, p.ano, p.situacao, p.requisitante, p.atualizado_em,
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
    const p = await q1(
      `insert into processos (orgao_id, numero, procedimento, requisitante, objeto, tipo, via, valor_estimado, classe, ano, pca_item_id, normas, obs, criado_por)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) returning id`,
      [req.usuario!.orgao_id, d.numero, d.procedimento, d.requisitante, d.objeto, d.tipo, d.via, d.valor_estimado, d.classe, d.ano, d.pca_item_id, d.normas, d.obs, req.usuario!.id]);
    await auditar({ orgao: req.usuario!.orgao_id, usuario: req.usuario!.id, processo: p.id, acao: "processo.criado", detalhe: { objeto: d.objeto } });
    res.status(201).json({ id: p.id });
  });

  r.get("/processos/:id", async (req, res) => {
    const p = await processoDo(req);
    const checagens = await q(
      `select c.item, c.em, u.nome as usuario from checagens c left join usuarios u on u.id = c.usuario_id where c.processo_id = $1`, [p.id]);
    const minutas = await q(
      `select distinct on (etapa) etapa, versao, origem, criado_em from minutas where processo_id = $1 order by etapa, versao desc`, [p.id]);
    const anexos = await q("select id, nome, length(texto) as caracteres, criado_em from anexos where processo_id = $1 order by id", [p.id]);
    const c: Checks = Object.fromEntries(checagens.map((x) => [x.item, true]));
    res.json({
      ...p, checagens, minutas, anexos, etapa_atual: atual(p, c), concluido: concluido(p, c),
      pode: { editar: temPapel(req.usuario!, "requisitante", "contratacao"), etapas: ETAPAS.filter((e) => podeMarcar(req.usuario!.papeis, e)).map((e) => e.id) },
    });
  });

  r.put("/processos/:id", exigePapel("requisitante", "contratacao"), async (req, res) => {
    const p = await processoDo(req);
    const d = camposProc.parse(req.body);
    await q(
      `update processos set numero=$1, procedimento=$2, requisitante=$3, objeto=$4, tipo=$5, via=$6, valor_estimado=$7, classe=$8, ano=$9, pca_item_id=$10, normas=$11, obs=$12, atualizado_em=now()
        where id=$13`,
      [d.numero, d.procedimento, d.requisitante, d.objeto, d.tipo, d.via, d.valor_estimado, d.classe, d.ano, d.pca_item_id, d.normas, d.obs, p.id]);
    // Mudança de tipo ou via altera os itens aplicáveis: remove marcações que deixaram de existir.
    const validos = ETAPAS.flatMap((e) => itensDe(e, d).map((i) => i.id));
    await q("delete from checagens where processo_id=$1 and not (item = any($2))", [p.id, validos]);
    await auditar({ orgao: p.orgao_id, usuario: req.usuario!.id, processo: p.id, acao: "processo.alterado" });
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
    const nome = `${e.nome}${p.numero ? ` - PA ${p.numero}` : ""} - v${m.versao}.docx`.replace(/[\\/:*?"<>|]/g, "-");
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
    const texto = await extrairTexto(req.file.originalname, req.file.buffer);
    const a = await q1("insert into anexos (processo_id, nome, texto, usuario_id) values ($1,$2,$3,$4) returning id", [p.id, req.file.originalname, texto, req.usuario!.id]);
    await auditar({ orgao: p.orgao_id, usuario: req.usuario!.id, processo: p.id, acao: "anexo.incluido", detalhe: { nome: req.file.originalname } });
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

  r.get("/processos/:id/historico", async (req, res) => {
    const p = await processoDo(req);
    res.json(await q(
      `select a.acao, a.detalhe, a.em, u.nome as usuario from auditoria a left join usuarios u on u.id = a.usuario_id
        where a.processo_id = $1 order by a.em desc limit 300`, [p.id]));
  });

  return r;
}
