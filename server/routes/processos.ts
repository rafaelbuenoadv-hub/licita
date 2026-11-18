import { anexosDaRequisicao, apoiosComTextoLocal, hashDoAnexo, incorporarApoios, nomeAnexoEnviado, parametrosApoios, receberAnexosSolicitacao, referenciasApoios, salvarApoios } from "../anexos-solicitacao.js";
import { fornecedorNoTexto, limparNomeFornecedor, nomeDoArquivoSemExtensao, nomeFornecedorOrcamento, type OrcamentoLido } from "../../shared/orcamentos.js";
import { documentoDaSolicitacao, LIMITE_SOLICITACAO, MODELO_SOLICITACAO, valorDasCotacoes, normalizarCotacao, type ItemSolicitacao } from "../../shared/solicitacao.js";
import { modeloSolicitacao, preencherSolicitacao } from "../solicitacao.js";
import { inserirTitularesDfd, preencherPortarias, secretariosDoProcesso, sugestoesCadastro } from "../portarias.js";
import { consultarPca, type ItemConsultaPca } from "../../shared/consulta-pca.js";
import { Router, type Request, type Response } from "express";
import multer from "multer";
import type { PoolClient } from "pg";
import { z } from "zod";
import { q, q1, tx, auditar } from "../db.js";
import { exigeLogin, exigePapel, temPapel } from "../auth.js";
import { ErroHttp } from "../erros.js";
import { minutaParaDocx } from "../docx.js";
import { minutaParaPdf } from "../pdf.js";
import { lerTimbrado, timbradosDoOrgao } from "../timbrados.js";
import { extrairTexto } from "../extrair.js";
import { conferirEtapa, proximaEtapa } from "../conferencia.js";
import { camposDo, documentoDosCampos, sincronizarCampos, sugestoesDosCampos } from "../campos.js";
import {
  ETAPAS, aplicarPendencias, atual, concluido, etapaDoItem, etapaPorId, itensDe, liberada, limparValores, podeMarcar, trilhaDoProcesso,
  type Checks, type Tipo, type Via, type Valores,
} from "../../shared/etapas.js";

export const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });
/** Nome do arquivo enviado. O navegador manda em UTF-8 e o multer lê como latin1: sem isto, "orçamento" vira "orÃ§amento". */
export const nomeEnviado = nomeAnexoEnviado;

// O nº do processo e o do procedimento não entram aqui: são gravados ao final, em /processos/:id/numeracao.
const camposProc = z.object({
  requisitante: z.string().max(200).default(""),
  areas_adicionais: z.array(z.string().trim().min(1).max(200)).max(30).optional(),
  objeto: z.string().min(5).max(4000),
  tipo: z.enum(["bens", "servicos", "obra"]),
  via: z.enum(["licitacao", "dispensa", "inexigibilidade"]),
  valor_estimado: z.number().nonnegative().nullable().default(null),
  classe: z.string().max(200).default(""),
  ano: z.number().int().min(2021).max(2100),
  pca_item_id: z.number().int().nullable().default(null),
  pca_automatico: z.boolean().default(false),
  normas: z.string().max(20000).default(""),
  obs: z.string().max(20000).default(""),
});

export interface Processo {
  id: number; orgao_id: number; tipo: Tipo; via: Via; objeto: string; protocolo: string; numero: string; procedimento: string;
  requisitante: string; areas_adicionais: string[]; valor_estimado: number | null; classe: string; ano: number; normas: string; obs: string;
  situacao: string; pca_item_id: number | null;
}

/** Carrega o processo garantindo que pertence ao órgão do usuário. */
export async function processoDo(req: Request, id = Number(req.params.id)) {
  const p = await q1<Processo>("select * from processos where id = $1 and orgao_id = $2 and excluido_em is null", [id, req.usuario!.orgao_id]);
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
export async function salvarMinuta(processoId: number, etapa: string, texto: string, origem: string, usuario: number, versaoEsperada?: number) {
  return tx(async (c) => {
    const registro = await c.query("select id from processos where id=$1 and excluido_em is null for update", [processoId]);
    if (!registro.rowCount) throw new ErroHttp(404, "Processo não encontrado.");
    const ult = (await c.query("select versao, texto from minutas where processo_id=$1 and etapa=$2 order by versao desc limit 1 for update", [processoId, etapa])).rows[0];
    if (versaoEsperada !== undefined && (ult?.versao ?? 0) !== versaoEsperada) {
      throw new ErroHttp(409, "A minuta foi alterada. Recarregue antes de aplicar.");
    }
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

async function timbradoDoProcesso(orgaoId: number, codigo: unknown) {
  if (!codigo) return;
  const orgao = await q1<{ nome: string; cnpj: string | null }>("select nome, cnpj from orgaos where id=$1", [orgaoId]);
  const timbrado = await lerTimbrado(orgao, codigo);
  if (!timbrado) throw new ErroHttp(404, "Timbrado não encontrado.");
  return timbrado;
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

async function validarItemPca(id: number | null, orgao: number, ano: number) {
  if (id === null) return;
  const item = await q1("select 1 from pca_itens where id=$1 and orgao_id=$2 and ano=$3", [id, orgao, ano]);
  if (!item) throw new ErroHttp(400, "Selecione um item do PCA do órgão para o exercício do processo.");
}

const idOrcamento = z.number().int().positive().max(2147483647);
const itensSolicitacao = z.array(z.object({
  descricao: z.string().trim().min(1).max(500),
  unidade: z.string().trim().max(30).default(""),
  quantidade: z.number().nonnegative().max(1e12).nullable().default(null),
  valor_unitario: z.number().nonnegative().max(1e12).nullable().default(null),
  criterio: z.enum(["media", "mediana", "menor"]).optional(),
  cotacoes: z.array(z.object({
    orcamento_id: idOrcamento.nullable(),
    fornecedor: z.string().trim().max(200),
    valor_unitario: z.number().positive().max(1e12).nullable(),
    fonte: z.enum(["fornecedor", "loja", "pncp", "outra"]).optional(),
    link: z.string().trim().max(1500).pipe(z.union([z.url({ protocol: /^https?$/ }), z.literal("")])).optional(),
    consultado_em: z.iso.date().optional(),
  })).max(20).optional(),
})).max(200);

export const itensSolicitacaoOpcionais = z.preprocess((valor) => {
  if (typeof valor !== "string") return valor;
  try { return JSON.parse(valor); } catch { return null; }
}, itensSolicitacao.optional());

export function calcularItens(itens: ItemSolicitacao[]) {
  return itens.map((item, indice) => {
    if (!item.cotacoes) return item;
    const fornecedores = new Set<string>();
    const anexos = new Set<number>();
    for (const cotacao of item.cotacoes) {
      const nome = normalizarCotacao(cotacao.fornecedor);
      if (cotacao.valor_unitario != null && !nome) throw new ErroHttp(400, `Informe o fornecedor da cotação do item ${indice + 1}.`);
      const anexo = cotacao.orcamento_id;
      if ((anexo != null && anexos.has(anexo)) || (nome && fornecedores.has(nome))) {
        throw new ErroHttp(400, `Use uma única cotação por fornecedor no item ${indice + 1}.`);
      }
      if (anexo != null) anexos.add(anexo);
      if (nome) fornecedores.add(nome);
    }
    return { ...item, valor_unitario: valorDasCotacoes(item.cotacoes, item.criterio) };
  });
}

async function conferirOrcamentos(c: PoolClient, processo: number, itens: ItemSolicitacao[]) {
  const vinculados = new Map<number, Set<string>>();
  for (const item of itens) {
    for (const cotacao of item.cotacoes ?? []) {
      const id = cotacao.orcamento_id;
      if (id == null) continue;
      const nomes = vinculados.get(id) ?? new Set<string>();
      const fornecedor = limparNomeFornecedor(cotacao.fornecedor);
      if (fornecedor) nomes.add(fornecedor);
      vinculados.set(id, nomes);
    }
  }
  if (!vinculados.size) return;
  const encontrados = await c.query<OrcamentoLido>(
    "select id,nome,fornecedor,fornecedor_manual,dados from orcamentos where processo_id=$1 and id=any($2::int[]) order by id for update",
    [processo, [...vinculados.keys()]],
  );
  if (encontrados.rowCount !== vinculados.size) throw new ErroHttp(400, "Selecione orçamentos anexados a este processo.");
  for (const orcamento of encontrados.rows) {
    const nomes = vinculados.get(orcamento.id)!;
    if (nomes.size === 1 && !nomeFornecedorOrcamento(orcamento)) {
      await c.query("update orcamentos set fornecedor_manual=$1 where id=$2", [[...nomes][0], orcamento.id]);
    }
  }
}

/**
 * Texto recebido em formulário com arquivos (multipart): o navegador troca as quebras de linha por "\r\n".
 * Sem normalizar, a comparação com o texto salvo acusava "A solicitação mudou" em toda edição.
 */
const textoDoFormulario = z.string().transform((t) => t.replace(/\r\n?/g, "\n"));

export function rotasProcessos() {
  const r = Router();
  r.use("/processos", exigeLogin);

  r.get("/processos", async (req, res) => {
    const ano = req.query.ano ? Number(req.query.ano) : null;
    const rows = await q(
      `select p.id, p.protocolo, p.numero, p.procedimento, p.objeto, p.tipo, p.via, p.valor_estimado, p.ano, p.situacao, p.requisitante, p.areas_adicionais, p.atualizado_em,
              coalesce((select array_agg(item) from checagens c where c.processo_id = p.id), '{}') as itens
         from processos p where p.orgao_id = $1 and p.excluido_em is null and ($2::int is null or p.ano = $2) order by p.atualizado_em desc`,
      [req.usuario!.orgao_id, ano]);
    res.json(rows.map(({ itens, ...p }) => {
      const c: Checks = Object.fromEntries((itens as string[]).map((i) => [i, true]));
      return { ...p, trilha: trilhaDoProcesso(p, c), etapa_atual: atual(p, c), concluido: concluido(p, c), feitas: ETAPAS.map((e) => itensDe(e, p).every((i) => c[i.id])) };
    }));
  });

  r.post("/processos", exigePapel("requisitante", "contratacao"), async (req, res) => {
    const d = camposProc.parse(req.body);
    const orgao = req.usuario!.orgao_id;
    await validarItemPca(d.pca_item_id, orgao, d.ano);
    if ((d.pca_automatico || req.body.pca_item_id === undefined) && d.pca_item_id === null) {
      const itens = await q<ItemConsultaPca>(
        "select id, descricao, tipo, tipo_oficial, ordem_oficial, pagina_oficial from pca_itens where orgao_id=$1 and ano=$2", [orgao, d.ano],
      );
      d.pca_item_id = consultarPca(d.objeto, d.tipo, itens).vinculo?.id ?? null;
    }
    const p = await tx(async (c) => {
      // Próximo protocolo do órgão no exercício; a linha da sequência fica travada até o fim da transação.
      const k = (await c.query(
        `insert into sequencias (orgao_id, ano, chave, ultimo) values ($1,$2,'protocolo',1)
         on conflict (orgao_id, ano, chave) do update set ultimo = sequencias.ultimo + 1 returning ultimo`, [orgao, d.ano])).rows[0].ultimo as number;
      const protocolo = `${d.ano}/${String(k).padStart(4, "0")}`;
      return (await c.query(
        `insert into processos (orgao_id, protocolo, requisitante, objeto, tipo, via, valor_estimado, classe, ano, pca_item_id, normas, obs, criado_por, areas_adicionais)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) returning id, protocolo`,
        [orgao, protocolo, d.requisitante, d.objeto, d.tipo, d.via, d.valor_estimado, d.classe, d.ano, d.pca_item_id, d.normas, d.obs, req.usuario!.id, d.areas_adicionais ?? []])).rows[0] as { id: number; protocolo: string };
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
      `select o.id, coalesce(o.fornecedor_manual, o.fornecedor) as fornecedor, o.fornecedor_manual, o.valor, o.nome, octet_length(o.arquivo) as bytes, o.texto <> '' as lido, o.criado_em, o.dados, o.lido_em, u.nome as usuario
         from orcamentos o left join usuarios u on u.id = o.usuario_id where o.processo_id = $1 order by o.id`, [p.id]);
    const solicitacoes = await q(
      `select s.id, s.secretaria, s.referencia, s.descricao, s.nome_arquivo, s.objeto, s.justificativa, s.itens,
        coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'nome',a.nome) order by a.id) from solicitacao_anexos a where a.solicitacao_id=s.id), '[]') as apoios
        from solicitacoes_processo s where s.processo_id=$1 order by s.id`, [p.id],
    );
    const orgao = await q1<{ nome: string; cnpj: string | null }>("select nome, cnpj from orgaos where id=$1", [p.orgao_id]);
    const secretarias = await q<{ secretaria: string }>("select secretaria from secretarios where orgao_id=$1 order by secretaria", [p.orgao_id]);
    const c: Checks = Object.fromEntries(checagens.map((x) => [x.item, true]));
    const campos = await camposDo(p.id);
    const pca_item = p.pca_item_id ? await q1(
      "select ano, descricao, ordem_oficial, periodo_oficial, prioridade, modalidade_prevista, requisitante from pca_itens where id=$1 and orgao_id=$2", [p.pca_item_id, p.orgao_id]) : null;
    res.json({
      ...p, campos, pca_item, sugestoes_campos: await sugestoesDosCampos(p, campos), checagens, minutas, anexos, orcamentos, solicitacoes, timbrados: timbradosDoOrgao(orgao), secretarias: secretarias.map((s) => s.secretaria), etapa_atual: atual(p, c), concluido: concluido(p, c),
      trilha: trilhaDoProcesso(p, c),
      numeracao: { liberada: numeracaoLiberada(p, c), sugestao: await sugestaoNumeracao(p) },
      pode: { editar: temPapel(req.usuario!, "requisitante", "contratacao"), numerar: temPapel(req.usuario!, "contratacao", "autoridade"), etapas: ETAPAS.filter((e) => podeMarcar(req.usuario!.papeis, e)).map((e) => e.id) },
    });
  });

  r.put("/processos/:id", exigePapel("requisitante", "contratacao"), async (req, res) => {
    const p = await processoDo(req);
    const d = camposProc.parse(req.body);
    if (d.pca_item_id !== p.pca_item_id || d.ano !== p.ano) await validarItemPca(d.pca_item_id, p.orgao_id, d.ano);
    await q(
      `update processos set requisitante=$1, objeto=$2, tipo=$3, via=$4, valor_estimado=$5, classe=$6, ano=$7, pca_item_id=$8, normas=$9, obs=$10, areas_adicionais=coalesce($12::text[], areas_adicionais), atualizado_em=now()
        where id=$11`,
      [d.requisitante, d.objeto, d.tipo, d.via, d.valor_estimado, d.classe, d.ano, d.pca_item_id, d.normas, d.obs, p.id, d.areas_adicionais ?? null]);
    // Mudança de tipo ou via altera os itens aplicáveis: remove marcações que deixaram de existir.
    const validos = ETAPAS.flatMap((e) => itensDe(e, d).map((i) => i.id));
    await q("delete from checagens where processo_id=$1 and not (item = any($2))", [p.id, validos]);
    await sincronizarCampos({ ...p, ...d, areas_adicionais: d.areas_adicionais ?? p.areas_adicionais }, req.usuario!.id);
    await auditar({ orgao: p.orgao_id, usuario: req.usuario!.id, processo: p.id, acao: "processo.alterado" });
    res.json({ ok: true });
  });

  r.delete("/processos/:id", exigePapel("contratacao"), async (req, res) => {
    const id = z.coerce.number().int().positive().max(2147483647).parse(req.params.id);
    const usuario = req.usuario!;
    await tx(async (c) => {
      const { rows: [p] } = await c.query(
        "update processos set excluido_em=now() where id=$1 and orgao_id=$2 and excluido_em is null returning id,protocolo",
        [id, usuario.orgao_id],
      );
      if (!p) throw new ErroHttp(404, "Processo não encontrado.");
      await auditar({ orgao: usuario.orgao_id, usuario: usuario.id, processo: id, acao: "processo.excluido", detalhe: { protocolo: p.protocolo } }, c);
    });
    res.json({ ok: true });
  });

  r.get("/processos/:id/solicitacoes/modelo", async (req, res) => {
    const p = await processoDo(req);
    res.json({ texto: await modeloSolicitacao(p.orgao_id) });
  });

  r.post("/processos/:id/solicitacoes/apoios", exigePapel("requisitante", "contratacao"), receberAnexosSolicitacao, async (req, res) => {
    const p = await processoDo(req);
    if (p.situacao !== "preparacao") throw new ErroHttp(409, "O processo deve estar em preparação para anexar documentos.");
    const usuario = req.usuario!.id;
    const { chave } = z.object({ chave: z.uuid() }).parse(req.body);
    const { apoios } = anexosDaRequisicao(req);
    if (!apoios.length) throw new ErroHttp(400, "Selecione um documento de apoio.");
    const documentos = await apoiosComTextoLocal(apoios);
    const ids = await tx(async (c) => {
      await c.query("delete from solicitacao_anexos_pendentes where criado_em < now() - interval '1 day'");
      const ids: number[] = [];
      for (const a of documentos) {
        const { rows: [linha] } = await c.query<{ id: number }>(
          `insert into solicitacao_anexos_pendentes (processo_id,usuario_id,chave,nome,arquivo,texto,sha256)
           values ($1,$2,$3,$4,$5,$6,$7) on conflict (processo_id,usuario_id,chave,sha256)
           do update set criado_em=now() returning id`,
          [p.id, usuario, chave, a.nome, a.arquivo, a.texto, hashDoAnexo(a.arquivo)],
        );
        ids.push(linha.id);
      }
      return ids;
    });
    res.status(201).json({ ids });
  });

  r.post("/processos/:id/solicitacoes", exigePapel("requisitante", "contratacao"), receberAnexosSolicitacao, async (req, res) => {
    const p = await processoDo(req);
    const { principal, apoios } = anexosDaRequisicao(req);
    const d = z.object({
      chave_envio: z.uuid(),
      ...referenciasApoios,
      secretaria: z.string().trim().min(2).max(200),
      referencia: z.string().trim().max(120).default(""),
      descricao: textoDoFormulario.pipe(z.string().trim().max(LIMITE_SOLICITACAO)).default(""),
      objeto_solicitacao: z.string().trim().max(4000).default(""),
      justificativa: z.string().trim().max(8000).default(""),
      itens: z.preprocess((v) => {
        if (typeof v !== "string") return v ?? [];
        try { return JSON.parse(v || "[]"); } catch { return null; }
      }, itensSolicitacao),
    }).parse(req.body);
    const pendentes = parametrosApoios(d, p.id, req.usuario!.id);
    if (!d.descricao && !principal?.size && !apoios.length && !d.apoios_ids.length) throw new ErroHttp(400, "Descreva a solicitação ou anexe o documento.");
    if (principal && !principal.size) throw new ErroHttp(400, "O documento anexado está vazio.");
    const nome = principal ? nomeEnviado(principal) : null;
    if (nome && !/\.(pdf|docx|txt|md|csv)$/i.test(nome)) {
      throw new ErroHttp(415, "Envie uma solicitação em PDF, Word ou texto.");
    }
    const arquivo = principal?.buffer ?? null;
    const texto = nome && arquivo && !/\.pdf$/i.test(nome)
      ? await extrairTexto(nome, arquivo).catch(() => "")
      : "";
    const documentos = await apoiosComTextoLocal(apoios);
    const itens = calcularItens(d.itens);
    const descricao = await preencherSolicitacao(p, { ...d, itens });
    if (descricao.length > LIMITE_SOLICITACAO) throw new ErroHttp(400, "A solicitação preenchida ultrapassa 30 mil caracteres. Reduza o texto ou os itens.");
    const resultado = await tx(async (c) => {
      const { rows: [processo] } = await c.query("select situacao from processos where id=$1 and orgao_id=$2 and excluido_em is null for update", [p.id, p.orgao_id]);
      if (!processo) throw new ErroHttp(404, "Processo não encontrado.");
      const { rows: [existente] } = await c.query(
        "select id from solicitacoes_processo where processo_id=$1 and chave_envio=$2", [p.id, d.chave_envio],
      );
      if (existente) return { id: existente.id, nova: false };
      if (processo.situacao !== "preparacao") {
        throw new ErroHttp(409, "A solicitação só pode ser adicionada enquanto o processo estiver em preparação.");
      }
      await conferirOrcamentos(c, p.id, itens);
      const { rows: [nova] } = await c.query(
        `insert into solicitacoes_processo (processo_id, chave_envio, secretaria, referencia, descricao, nome_arquivo, arquivo, texto_arquivo, usuario_id, objeto, justificativa, itens)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning id`,
        [p.id, d.chave_envio, d.secretaria, d.referencia, descricao, nome, arquivo, texto, req.usuario!.id, d.objeto_solicitacao, d.justificativa, JSON.stringify(itens)],
      );
      await salvarApoios(c, nova.id, documentos);
      await incorporarApoios(c, nova.id, pendentes);
      await c.query("update processos set atualizado_em=now() where id=$1", [p.id]);
      await auditar({ orgao: p.orgao_id, usuario: req.usuario!.id, processo: p.id, acao: "solicitacao.incluida", detalhe: { id: nova.id, secretaria: d.secretaria } }, c);
      return { id: nova.id, nova: true };
    });
    res.status(resultado.nova ? 201 : 200).json({ id: resultado.id });
  });

  r.put("/processos/:id/solicitacoes/:sid", exigePapel("requisitante", "contratacao"), receberAnexosSolicitacao, async (req, res) => {
    const p = await processoDo(req);
    const sid = z.coerce.number().int().min(1).max(2147483647).parse(req.params.sid);
    const { apoios } = anexosDaRequisicao(req);
    const d = z.object({
      ...referenciasApoios,
      anterior: textoDoFormulario.pipe(z.string().max(LIMITE_SOLICITACAO)),
      descricao: textoDoFormulario.pipe(z.string().trim().max(LIMITE_SOLICITACAO)),
      itens: itensSolicitacaoOpcionais,
      itens_anteriores: itensSolicitacaoOpcionais,
    }).refine((dados) => dados.itens === undefined || dados.itens_anteriores !== undefined, "Reabra a solicitação antes de editar os itens.").parse(req.body);
    const s = await q1<{ secretaria: string; referencia: string; objeto_solicitacao: string; justificativa: string; itens: ItemSolicitacao[] }>(
      "select secretaria, referencia, objeto as objeto_solicitacao, justificativa, itens from solicitacoes_processo where processo_id=$1 and id=$2", [p.id, sid],
    );
    if (!s) throw new ErroHttp(404, "Solicitação não encontrada.");
    const pendentes = parametrosApoios(d, p.id, req.usuario!.id);
    const documentos = await apoiosComTextoLocal(apoios);
    const itens = d.itens && calcularItens(d.itens);
    const descricao = await preencherSolicitacao(p, { ...s, descricao: d.descricao, itens: itens ?? s.itens });
    if (descricao.length > LIMITE_SOLICITACAO) throw new ErroHttp(400, "A solicitação preenchida ultrapassa 30 mil caracteres. Reduza o texto ou os itens.");
    await tx(async (c) => {
      const { rows: [processo] } = await c.query("select situacao from processos where id=$1 and excluido_em is null for update", [p.id]);
      if (processo?.situacao !== "preparacao") throw new ErroHttp(409, "O processo deve estar em preparação para editar a solicitação.");
      const { rows: [existente] } = await c.query<{ descricao: string; tem_arquivo: boolean; itens_iguais: boolean }>(
        `select descricao, (arquivo is not null or exists (select 1 from solicitacao_anexos a where a.solicitacao_id=solicitacoes_processo.id)) as tem_arquivo, ($3::jsonb is null or itens = $3::jsonb) as itens_iguais
         from solicitacoes_processo where processo_id=$1 and id=$2 for update`,
        [p.id, sid, JSON.stringify(d.itens_anteriores ?? s.itens)],
      );
      if (!existente) throw new ErroHttp(404, "Solicitação não encontrada.");
      if (existente.descricao !== d.anterior || !existente.itens_iguais) throw new ErroHttp(409, "A solicitação mudou. Reabra para ver a versão atualizada.");
      if (!descricao && !existente.tem_arquivo && !documentos.length && !d.apoios_ids.length) throw new ErroHttp(400, "Preencha a descrição da solicitação.");
      if (!itens && descricao === existente.descricao && !documentos.length && !d.apoios_ids.length) return;
      if (itens) await conferirOrcamentos(c, p.id, itens);
      await salvarApoios(c, sid, documentos);
      await incorporarApoios(c, sid, pendentes);
      await c.query("update solicitacoes_processo set descricao=$1, itens=coalesce($2::jsonb,itens) where id=$3", [descricao, itens ? JSON.stringify(itens) : null, sid]);
      await c.query("update processos set atualizado_em=now() where id=$1", [p.id]);
      await auditar({ orgao: p.orgao_id, usuario: req.usuario!.id, processo: p.id, acao: "solicitacao.alterada", detalhe: { id: sid } }, c);
    });
    res.json({ ok: true });
  });

  r.get(["/processos/:id/solicitacoes/:sid/docx", "/processos/:id/solicitacoes/:sid/pdf"], async (req, res) => {
    const formato = /\/pdf\/?$/i.test(req.path) ? "pdf" : "docx";
    const exportar = formato === "pdf" ? minutaParaPdf : minutaParaDocx;
    const p = await processoDo(req);
    const sid = z.coerce.number().int().min(1).max(2147483647).parse(req.params.sid);
    const s = await q1<{ descricao: string; itens: ItemSolicitacao[] }>(
      "select descricao, itens from solicitacoes_processo where processo_id=$1 and id=$2", [p.id, sid],
    );
    if (!s?.descricao) throw new ErroHttp(404, "Texto da solicitação não encontrado.");
    const timbrado = await timbradoDoProcesso(p.orgao_id, req.query.timbrado);
    const arquivo = await exportar(documentoDaSolicitacao(s.descricao, s.itens), MODELO_SOLICITACAO.doc, timbrado);
    enviarArquivo(res, `solicitacao-${p.protocolo.replace(/[^0-9a-z-]/gi, "-")}-${sid}.${formato}`, arquivo);
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

  r.get("/processos/:id/solicitacoes/:sid/apoios/:aid", async (req, res) => {
    const processo = await processoDo(req);
    const id = z.coerce.number().int().positive().max(2147483647);
    const a = await q1<{ nome: string; arquivo: Buffer }>(
      `select a.nome,a.arquivo from solicitacao_anexos a join solicitacoes_processo s on s.id=a.solicitacao_id
       where s.processo_id=$1 and s.id=$2 and a.id=$3`,
      [processo.id, id.parse(req.params.sid), id.parse(req.params.aid)],
    );
    if (!a) throw new ErroHttp(404, "Documento de apoio não encontrado.");
    res.set("Cache-Control", "private, no-store");
    enviarArquivo(res, a.nome, a.arquivo);
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
    if (e.itens.find((i) => i.id === item)?.auto) throw new ErroHttp(400, "Este item é conferido pelo sistema: preencha os campos da etapa.");
    exigeEtapaEditavel(req, p, await checksDo(p.id), e.id);
    if (marcado) await q("insert into checagens (processo_id, item, usuario_id) values ($1,$2,$3) on conflict do nothing", [p.id, item, req.usuario!.id]);
    else await q("delete from checagens where processo_id=$1 and item=$2", [p.id, item]);
    await q("update processos set atualizado_em = now() where id = $1", [p.id]);
    await auditar({ orgao: p.orgao_id, usuario: req.usuario!.id, processo: p.id, acao: marcado ? "item.marcado" : "item.desmarcado", detalhe: { item, etapa: e.id } });
    const c = await checksDo(p.id);
    res.json({ etapa_atual: atual(p, c), concluido: concluido(p, c) });
  });

  // Concluir e avançar: confere a etapa (campos, documento e conferência) e aponta o que falta.
  r.post("/processos/:id/etapas/:etapa/concluir", async (req, res) => {
    const p = await processoDo(req);
    const checks = await checksDo(p.id);
    const e = exigeEtapaEditavel(req, p, checks, String(req.params.etapa));
    const lista = await conferirEtapa(p, e, checks, await camposDo(p.id));
    const prox = proximaEtapa(e);
    if (lista.some((x) => x.bloqueia)) return res.json({ concluida: false, pendencias: lista, proxima: null });
    const protocolado = e.id === "fiscal";
    await auditar({ orgao: p.orgao_id, usuario: req.usuario!.id, processo: p.id, acao: protocolado ? "processo.protocolado" : "etapa.concluida", detalhe: { etapa: e.id } });
    res.json({ concluida: true, protocolado, pendencias: lista, proxima: prox ? { id: prox.id, nome: prox.nome } : null });
  });

  // Campos de preenchimento da etapa.
  r.put("/processos/:id/campos/:etapa", async (req, res) => {
    const p = await processoDo(req);
    const e = exigeEtapaEditavel(req, p, await checksDo(p.id), String(req.params.etapa));
    if (!e.campos.length) throw new ErroHttp(400, "Esta etapa não tem campos de preenchimento.");
    const { valores } = z.object({
      valores: z.record(z.string(), z.union([z.string().max(20000), z.array(z.string().max(100)).max(20)])),
    }).parse(req.body);
    const limpos = limparValores(e, valores as Valores);
    await q(`insert into campos_etapa (processo_id, etapa, valores, usuario_id) values ($1,$2,$3,$4)
      on conflict (processo_id, etapa) do update set valores=excluded.valores, usuario_id=excluded.usuario_id, atualizado_em=now()`,
      [p.id, e.id, JSON.stringify(limpos), req.usuario!.id]);
    await q("update processos set atualizado_em = now() where id = $1", [p.id]);
    await sincronizarCampos(p, req.usuario!.id, [e]);
    await auditar({ orgao: p.orgao_id, usuario: req.usuario!.id, processo: p.id, acao: "campos.salvos", detalhe: { etapa: e.id } });
    const c = await checksDo(p.id);
    res.json({ ok: true, etapa_atual: atual(p, c) });
  });

  // Monta o documento da etapa só com os campos preenchidos (sem IA) e salva como nova versão.
  r.post("/processos/:id/minutas/:etapa/dos-campos", async (req, res) => {
    const p = await processoDo(req);
    const e = exigeEtapaEditavel(req, p, await checksDo(p.id), String(req.params.etapa));
    if (!e.modelo || !e.campos.length) throw new ErroHttp(400, "Esta etapa não tem documento montado pelos campos.");
    const campos = await camposDo(p.id);
    if (!Object.values(campos[e.id] ?? {}).some((x) => (Array.isArray(x) ? x.length : String(x).trim()))) throw new ErroHttp(400, "Preencha e salve os campos da etapa antes de montar o documento.");
    const autor = await q1<{ nome: string; cargo: string }>("select nome, cargo from usuarios where id=$1", [req.usuario!.id]);
    const texto = preencherPortarias(await documentoDosCampos(p, e, campos, autor!), await secretariosDoProcesso(p));
    const r1 = await salvarMinuta(p.id, e.id, texto, "campos", req.usuario!.id);
    if (r1.nova) await auditar({ orgao: p.orgao_id, usuario: req.usuario!.id, processo: p.id, acao: "minuta.campos", detalhe: { etapa: e.id, versao: r1.versao } });
    res.json(r1);
  });

  // Minutas
  r.get("/processos/:id/minutas/:etapa", async (req, res) => {
    const p = await processoDo(req);
    if (!etapaPorId(String(req.params.etapa))) throw new ErroHttp(404, "Etapa inexistente.");
    const vig = await minutaVigente(p.id, String(req.params.etapa));
    const versoes = await q(
      `select m.versao, m.origem, m.criado_em, u.nome as autor, length(m.texto) as caracteres from minutas m left join usuarios u on u.id = m.usuario_id
        where m.processo_id=$1 and m.etapa=$2 order by m.versao desc`, [p.id, req.params.etapa]);
    const dfd = req.params.etapa === "dfd";
    const cadastro = dfd || vig ? await secretariosDoProcesso(p) : undefined;
    const sugestoes_cadastro = vig && cadastro ? sugestoesCadastro(vig.texto, cadastro) : [];
    const texto = vig?.texto ?? "";
    const titulares_dfd = dfd && cadastro ? {
      pode_inserir: inserirTitularesDfd(texto, cadastro) !== texto,
      areas_sem_cadastro: cadastro.areasSemCadastro,
      areas_sem_portaria: cadastro.secretarios.filter((s) => !s.portaria).map((s) => s.secretaria),
      total: cadastro.secretarios.length,
    } : null;
    const pesquisa = await q1(
      `select x.texto, x.fontes, x.criado_em, u.nome as autor from pesquisas_minuta x left join usuarios u on u.id = x.usuario_id
        where x.processo_id=$1 and x.etapa=$2 order by x.id desc limit 1`, [p.id, req.params.etapa]);
    res.json({ vigente: vig ?? null, versoes, sugestoes_cadastro, titulares_dfd, pesquisa: pesquisa ?? null });
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
    const r1 = await salvarMinuta(p.id, e.id, preencherPortarias(texto, await secretariosDoProcesso(p)), origem, req.usuario!.id);
    if (r1.nova) await auditar({ orgao: p.orgao_id, usuario: req.usuario!.id, processo: p.id, acao: "minuta.salva", detalhe: { etapa: e.id, versao: r1.versao, origem } });
    res.json(r1);
  });
  r.post("/processos/:id/minutas/dfd/titulares", async (req, res) => {
    const p = await processoDo(req);
    exigeEtapaEditavel(req, p, await checksDo(p.id), "dfd");
    const { versao } = z.object({ versao: z.number().int().nonnegative() }).parse(req.body);
    const vig = await minutaVigente(p.id, "dfd");
    if ((vig?.versao ?? 0) !== versao) throw new ErroHttp(409, "A minuta foi alterada. Recarregue antes de aplicar.");
    const cadastro = await secretariosDoProcesso(p);
    if (!cadastro.secretarios.length) throw new ErroHttp(400, "Nenhuma área requisitante tem titular identificado no cadastro.");
    const texto = inserirTitularesDfd(preencherPortarias(vig?.texto ?? "", cadastro), cadastro);
    const resultado = await salvarMinuta(p.id, "dfd", texto, "pendencias", req.usuario!.id, versao);
    if (resultado.nova) await auditar({ orgao: p.orgao_id, usuario: req.usuario!.id, processo: p.id, acao: "minuta.titulares", detalhe: { versao: resultado.versao } });
    res.json(resultado);
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
    const r1 = await salvarMinuta(p.id, e.id, texto, "pendencias", req.usuario!.id, versao);
    await auditar({ orgao: p.orgao_id, usuario: req.usuario!.id, processo: p.id, acao: "minuta.pendencias", detalhe: { etapa: e.id, versao: r1.versao, aplicados } });
    res.json({ ...r1, aplicados });
  });
  r.get(["/processos/:id/minutas/:etapa/docx", "/processos/:id/minutas/:etapa/pdf"], async (req, res) => {
    const formato = /\/pdf\/?$/i.test(req.path) ? "pdf" : "docx";
    const exportar = formato === "pdf" ? minutaParaPdf : minutaParaDocx;
    const p = await processoDo(req);
    const e = etapaPorId(String(req.params.etapa));
    const v = req.query.versao ? Number(req.query.versao) : null;
    const m = v
      ? await q1("select texto, versao from minutas where processo_id=$1 and etapa=$2 and versao=$3", [p.id, req.params.etapa, v])
      : await minutaVigente(p.id, String(req.params.etapa));
    if (!e || !m) throw new ErroHttp(404, "Minuta não encontrada.");
    const timbrado = await timbradoDoProcesso(p.orgao_id, req.query.timbrado);
    const buf = await exportar(m.texto, e.doc ?? e.nome, timbrado);
    const nome = `${e.nome} - ${p.numero ? `PA ${p.numero}` : `Protocolo ${p.protocolo}`} - v${m.versao}.${formato}`.replace(/[\\/:*?"<>|]/g, "-");
    enviarArquivo(res, nome, buf);
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
    const orcamentos: { id: number; nome: string; fornecedor: string; dados: null }[] = [];
    const daSolicitacao = req.query.origem === "solicitacao";
    if (daSolicitacao && p.situacao !== "preparacao") throw new ErroHttp(409, "O processo deve estar em preparação para anexar a cotação.");
    for (const f of arquivos) {
      const nome = nomeEnviado(f);
      // A leitura do texto é um extra: planilha, imagem ou PDF que não puder ser lido fica só com o arquivo.
      const podeExtrair = /\.(docx|xlsx|txt|csv)$/i.test(nome) || (!daSolicitacao && /\.pdf$/i.test(nome));
      const texto = podeExtrair ? await extrairTexto(nome, f.buffer).catch(() => "") : "";
      const identificado = fornecedorNoTexto(texto);
      const fornecedor = identificado || nomeDoArquivoSemExtensao(nome);
      const o = await q1("insert into orcamentos (processo_id, fornecedor, nome, arquivo, texto, usuario_id) values ($1,$2,$3,$4,$5,$6) returning id",
        [p.id, fornecedor, nome, f.buffer, texto, req.usuario!.id]);
      ids.push(o.id);
      orcamentos.push({ id: o.id, nome, fornecedor: identificado, dados: null });
      await auditar({ orgao: p.orgao_id, usuario: req.usuario!.id, processo: p.id, acao: "orcamento.incluido", detalhe: { nome } });
    }
    await q("update processos set atualizado_em = now() where id = $1", [p.id]);
    res.status(201).json({ ids, orcamentos });
  });
  // Valor e fornecedor informados na linha do orçamento.
  r.put("/processos/:id/orcamentos/:oid", exigePapel("requisitante", "contratacao"), async (req, res) => {
    const p = await processoDo(req);
    const { valor, fornecedor } = z.object({
      valor: z.number().nonnegative().nullable().optional(),
      fornecedor: z.string().trim().max(200).transform(limparNomeFornecedor).optional(),
    }).refine((d) => d.valor !== undefined || d.fornecedor !== undefined, "Informe o valor ou o fornecedor.").parse(req.body);
    const oid = idOrcamento.parse(Number(req.params.oid));
    const o = await q1(`update orcamentos
      set valor=case when $1 then $2 else valor end,
          fornecedor_manual=case when $3 then nullif($4,'') else fornecedor_manual end
      where id=$5 and processo_id=$6 returning id,nome,fornecedor_manual,fornecedor,dados`,
    [valor !== undefined, valor ?? null, fornecedor !== undefined, fornecedor ?? "", oid, p.id]);
    if (!o) throw new ErroHttp(404, "Orçamento não encontrado.");
    if (valor !== undefined) await auditar({ orgao: p.orgao_id, usuario: req.usuario!.id, processo: p.id, acao: "orcamento.valor", detalhe: { nome: o.nome, valor } });
    if (fornecedor !== undefined) await auditar({ orgao: p.orgao_id, usuario: req.usuario!.id, processo: p.id, acao: "orcamento.fornecedor", detalhe: { nome: o.nome, fornecedor } });
    res.json({ ok: true, fornecedor: nomeFornecedorOrcamento(o) });
  });
  r.get("/processos/:id/orcamentos/:oid/arquivo", async (req, res) => {
    const p = await processoDo(req);
    const o = await q1<{ nome: string; arquivo: Buffer }>("select nome, arquivo from orcamentos where id=$1 and processo_id=$2", [Number(req.params.oid), p.id]);
    if (!o) throw new ErroHttp(404, "Orçamento não encontrado.");
    enviarArquivo(res, o.nome, o.arquivo);
  });
  r.delete("/processos/:id/orcamentos/:oid", exigePapel("requisitante", "contratacao"), async (req, res) => {
    const p = await processoDo(req);
    const oid = z.coerce.number().int().positive().max(2147483647).parse(req.params.oid);
    await tx(async (c) => {
      await c.query("select id from processos where id=$1 for update", [p.id]);
      const vinculos = await c.query("select 1 from solicitacoes_processo where processo_id=$1 and itens @> $2::jsonb limit 1",
        [p.id, JSON.stringify([{ cotacoes: [{ orcamento_id: oid }] }])]);
      if (vinculos.rowCount) throw new ErroHttp(409, "Retire o vínculo nos itens da Solicitação antes de remover este orçamento.");
      const { rows: [o] } = await c.query("delete from orcamentos where id=$1 and processo_id=$2 returning fornecedor, nome", [oid, p.id]);
      if (!o) throw new ErroHttp(404, "Orçamento não encontrado.");
      await auditar({ orgao: p.orgao_id, usuario: req.usuario!.id, processo: p.id, acao: "orcamento.removido", detalhe: o }, c);
    });
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
