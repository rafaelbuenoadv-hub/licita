import { Router } from "express";
import { z } from "zod";
import { exigeLogin } from "../auth.js";
import { ErroHttp } from "../erros.js";
import { SITUACOES_PNCP, UFS_PNCP, type ResultadoPncp } from "../../shared/pncp.js";

type Obj = Record<string, unknown>;

/**
 * A busca do portal do PNCP (/api/search) derruba parte das conexões de programas ("other side closed").
 * As consultas se identificam como o sistema e repetem a tentativa quando a conexão cai.
 */
const CABECALHOS_PNCP = { Accept: "application/json", "User-Agent": "Licita/1.0 (sistema de compras municipal)" };
/** Consulta ao PNCP com até três tentativas quando a conexão cai no meio (o PNCP derruba conexões com frequência). */
async function consultarPncp(carregar: typeof fetch, url: string | URL, tempo: number) {
  for (let tentativa = 1; ; tentativa++) {
    try { return await carregar(url, { headers: CABECALHOS_PNCP, signal: AbortSignal.timeout(tempo) }); }
    catch (e) {
      if ((e as Error)?.name === "TimeoutError" || tentativa >= 3) throw e;
      await new Promise((ok) => setTimeout(ok, 500 * tentativa));
    }
  }
}

const obj = (value: unknown): Obj =>
  value && typeof value === "object" ? (value as Obj) : {};

function list(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  const record = obj(value);
  for (const key of ["items", "data", "results", "resultado", "content"]) {
    if (Array.isArray(record[key])) return record[key] as unknown[];
    if (record[key] && typeof record[key] === "object") {
      const nested = list(record[key]);
      if (nested.length) return nested;
    }
  }
  return [];
}

function str(record: Obj, keys: string[]) {
  for (const key of keys)
    if (typeof record[key] === "string" && String(record[key]).trim())
      return String(record[key]).trim();
  return "";
}

function num(record: Obj, keys: string[]) {
  for (const key of keys) {
    const value = Number(record[key]);
    if (Number.isFinite(value) && value > 0) return value;
  }
  return 0;
}

function nestedStr(record: Obj, parentKeys: string[], keys: string[]) {
  for (const parentKey of parentKeys) {
    const value = str(obj(record[parentKey]), keys);
    if (value) return value;
  }
  return "";
}

const normalize = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

function parseControl(value: string) {
  const match = value.replace(/\s/g, "").match(/^(\d{14})-\d-(\d+)\/(\d{4})$/);
  return match
    ? { cnpj: match[1], sequence: Number(match[2]), year: Number(match[3]) }
    : null;
}

const filtros = z.object({
  q: z.string().trim().min(3, "Digite ao menos três caracteres.").max(220),
  uf: z.string().trim().toUpperCase().refine((uf) => uf === "" || uf === "BR" || UFS_PNCP.includes(uf), "Estado inválido.").default("PR"),
  status: z.enum(Object.keys(SITUACOES_PNCP) as [keyof typeof SITUACOES_PNCP, ...(keyof typeof SITUACOES_PNCP)[]]).default("todos"),
});

export async function buscarPncp(consulta: z.infer<typeof filtros>, carregar: typeof fetch = fetch): Promise<{ resultados: ResultadoPncp[]; incompleta: boolean }> {
  const query = consulta.q;
  const uf = consulta.uf === "BR" ? "" : consulta.uf;
  const url = new URL("https://pncp.gov.br/api/search/");
  url.search = new URLSearchParams({
    q: query, tipos_documento: "edital", ordenacao: "-data", pagina: "1", tam_pagina: "10", status: consulta.status,
    ...(uf ? { ufs: uf } : {}),
  }).toString();
  let notices: Obj[];
  try {
    const resposta = await consultarPncp(carregar, url, 12000);
    if (!resposta.ok) throw new Error(String(resposta.status));
    notices = list(await resposta.json()).slice(0, 10).map(obj);
  } catch (e) {
    console.warn("PNCP: falha na busca de editais", { url: url.toString(), erro: e instanceof Error ? `${e.name}: ${e.message}` : String(e), causa: String((e as { cause?: unknown })?.cause ?? "") });
    throw new ErroHttp(502, "O PNCP está indisponível neste momento. Tente a consulta novamente.");
  }
  const tokens = [...new Set(normalize(query).split(/[^a-z0-9]+/).filter((token) => token.length >= 3))];
  const lotes = await Promise.all(notices.map(async (notice) => {
    const code = str(notice, [
      "numero_controle_pncp",
      "numeroControlePNCP",
      "numero_controle",
      "numeroControle",
    ]);
    const parsed = parseControl(code);
    if (!parsed) return [];
    try {
      const detail = `https://pncp.gov.br/api/pncp/v1/orgaos/${parsed.cnpj}/compras/${parsed.year}/${parsed.sequence}/itens?pagina=1&tamanhoPagina=50`;
      const result = await consultarPncp(carregar, detail, 9000);
      if (result.status === 404 || result.status === 204) return [];
      if (!result.ok) return null;
      const organization =
        str(notice, [
          "orgao_nome",
          "orgaoNome",
          "razao_social",
          "razaoSocial",
        ]) || str(obj(notice.orgaoEntidade), ["razaoSocial", "nome"]);
      const state = str(notice, ["uf", "unidade_orgao_uf_sigla", "unidadeOrgaoUfSigla", "ufSigla"]) || str(obj(notice.unidadeOrgao), ["ufSigla", "uf"]);
      const municipality = str(notice, ["municipio_nome", "municipioNome", "unidade_orgao_municipio_nome", "unidadeOrgaoMunicipioNome"]) || nestedStr(notice, ["unidadeOrgao", "unidade_orgao"], ["municipioNome", "municipio_nome", "nomeMunicipio"]);
      const modality = str(notice, ["modalidade_nome", "modalidadeNome", "modalidade_licitacao_nome", "modalidadeLicitacaoNome"]) || nestedStr(notice, ["modalidade", "modalidadeContratacao"], ["nome", "descricao"]);
      const procurementNumber = str(notice, ["numero_compra", "numeroCompra", "numero_edital", "numeroEdital", "numero_contratacao", "numeroContratacao"]);
      const processNumber = str(notice, ["numero_processo", "numeroProcesso", "processo", "processo_numero"]);
      const statusName = str(notice, ["situacao_nome", "situacaoNome", "status_nome", "statusNome"]);
      const publicationDate = str(notice, ["data_publicacao_pncp", "dataPublicacaoPncp", "data_publicacao", "dataPublicacao"]);
      const proposalOpeningDate = str(notice, ["data_abertura_proposta", "dataAberturaProposta", "data_inicio_proposta", "dataInicioProposta"]);
      const sourceUrl = `https://pncp.gov.br/app/editais/${parsed.cnpj}/${parsed.year}/${parsed.sequence}`;
      return list(await result.json())
        .map(obj)
        .map((item) => {
          const description = str(item, [
            "descricao",
            "descricaoItem",
            "objeto",
          ]);
          const score = tokens.reduce(
            (sum, token) =>
              sum + (normalize(description).includes(token) ? 1 : 0),
            0,
          );
          return {
            control: code,
            organization,
            sourceUrl,
            description,
            itemNumber: num(item, ["numeroItem", "numero_item", "item"]),
            unit: str(item, ["unidadeMedida", "unidade_medida", "unidade"]),
            quantity: num(item, ["quantidade", "quantidadeItem"]),
            unitValue: num(item, [
              "valorUnitarioEstimado",
              "valor_unitario_estimado",
              "valorUnitario",
              "valor_unitario",
            ]),
            state,
            municipality,
            modality,
            procurementNumber,
            processNumber,
            statusName,
            publicationDate,
            proposalOpeningDate,
            score,
          };
        })
        .filter(
          (item) =>
            item.description && item.unitValue > 0 && item.score > 0,
        );
    } catch {
      return null;
    }
  }));
  const incompleta = lotes.some((itens) => itens === null);
  if (lotes.length && lotes.every((itens) => itens === null)) throw new ErroHttp(502, "O PNCP localizou contratações, mas não retornou os itens. Tente novamente.");
  const resultados = lotes.flatMap((itens) => itens ?? [])
    .filter((item) => !uf || !item.state || item.state === uf)
    .sort((a, b) => b.score - a.score)
    .slice(0, 30)
    .map(({ score: _score, ...item }) => item);
  return { resultados, incompleta };
}

export function rotasPncp() {
  const r = Router();
  r.get("/pncp-search", exigeLogin, async (req, res) => {
    res.set("Cache-Control", "private, max-age=300");
    res.json(await buscarPncp(filtros.parse(req.query)));
  });
  return r;
}
