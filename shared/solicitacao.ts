import { pendencias } from "./etapas.js";

export const ASSINATURA_SOLICITACAO = [
  "@ [[Nome do secretário]]",
  "@ Titular da área requisitante · [[Secretaria]]",
  "@ Portaria de nomeação nº [[Portaria de nomeação]]",
].join("\n");

export const MODELO_SOLICITACAO = {
  id: "solicitacao",
  nome: "Solicitação",
  doc: "Solicitação da secretaria",
  modelo: [
    "# SOLICITAÇÃO DE CONTRATAÇÃO",
    "Protocolo [[Protocolo]]",
    "",
    "## Unidade requisitante",
    "[[Secretaria]]",
    "",
    "## Objeto",
    "[[Objeto]]",
    "",
    "## Justificativa da necessidade",
    "[[Justificativa da contratação]]",
    "",
    "## Itens solicitados",
    "[[Itens]]",
    "",
    "## Quantidades e prazo",
    "[[Quantidades e prazo de atendimento]]",
    "",
    ASSINATURA_SOLICITACAO,
  ].join("\n"),
};

export const CRITERIOS_PRECO = { media: "Média", mediana: "Mediana", menor: "Menor valor" };
export type CriterioPreco = keyof typeof CRITERIOS_PRECO;
export const FONTES_COTACAO = { fornecedor: "Orçamento de fornecedor", loja: "Loja na internet", pncp: "Valor do PNCP", outra: "Outras fontes" };
export type FonteCotacao = keyof typeof FONTES_COTACAO;
export interface CotacaoItem {
  orcamento_id: number | null;
  fornecedor: string;
  valor_unitario: number | null;
  fonte?: FonteCotacao;
  link?: string;
  consultado_em?: string;
}
export interface ItemSolicitacao {
  descricao: string;
  unidade: string;
  quantidade: number | null;
  valor_unitario: number | null;
  cotacoes?: CotacaoItem[];
  criterio?: CriterioPreco;
}

export function valorDasCotacoes(cotacoes: CotacaoItem[], criterio: CriterioPreco = "media") {
  const valores = cotacoes.flatMap((c) => c.orcamento_id != null && c.fornecedor.trim() && c.valor_unitario != null && c.valor_unitario > 0
    ? [Math.round((c.valor_unitario + Number.EPSILON) * 100)] : []).sort((a, b) => a - b);
  if (!valores.length) return null;
  const meio = Math.floor(valores.length / 2);
  if (criterio === "menor") return valores[0] / 100;
  if (criterio === "mediana") return Math.round(valores.length % 2 ? valores[meio] : (valores[meio - 1] + valores[meio]) / 2) / 100;
  return Math.round(valores.reduce((soma, v) => soma + v, 0) / valores.length) / 100;
}

export const normalizarCotacao = (texto: string) =>
  texto.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim().replace(/\s+/g, " ");
export const LIMITE_SOLICITACAO = 30000;

const real = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const numero = (v: number) => v.toLocaleString("pt-BR", { maximumFractionDigits: 4 });
export const totalDoItem = (i: ItemSolicitacao) => (i.quantidade != null && i.valor_unitario != null ? Math.round(i.quantidade * i.valor_unitario * 100) / 100 : null);
/** Soma dos itens que têm quantidade e valor; null quando nenhum tem. */
export function totalDosItens(itens: ItemSolicitacao[]) {
  const t = itens.map(totalDoItem).filter((x): x is number => x != null);
  return t.length ? Math.round(t.reduce((a, b) => a + b, 0) * 100) / 100 : null;
}
/** Quadro de itens no formato das minutas (linhas com barras verticais). */
export function quadroDeItens(itens: ItemSolicitacao[]) {
  if (!itens.length) return "";
  const cel = (t: string) => t.replace(/\s*\n\s*/g, " ").replace(/\|/g, "/").trim();
  const total = totalDosItens(itens);
  const temCotacoes = itens.some((i) => i.cotacoes !== undefined);
  const parcial = temCotacoes && itens.some((i) => totalDoItem(i) == null);
  return [
    temCotacoes ? CABECALHO_COTACOES : CABECALHO_ANTERIOR,
    "|---|---|---|---|---|---|",
    ...itens.map((i, k) => `| ${k + 1} | ${cel(i.descricao)} | ${cel(i.unidade) || "—"} | ${i.quantidade == null ? "—" : numero(i.quantidade)} | ${i.valor_unitario == null ? "—" : real(i.valor_unitario)} | ${totalDoItem(i) == null ? "—" : real(totalDoItem(i)!)} |`),
    ...(total == null ? [] : [`| | ${parcial ? "Subtotal dos itens com valor" : "Total estimado"} | | | | ${real(total)} |`]),
  ].join("\n");
}
const CABECALHO_ANTERIOR = "| Item | Descrição | Un. | Qtd. | Valor unitário | Valor total |";
const CABECALHO_COTACOES = "| Item | Descrição | Un. | Qtd. | Valor unitário estimado | Valor total |";
const TITULO_ITENS = "## Itens solicitados";
/** Garante o quadro de itens no texto mesmo quando o modelo do órgão não tem o campo [[Itens]]: entra antes das assinaturas. */
export function inserirItens(texto: string, itens: ItemSolicitacao[]) {
  if (!texto.trim()) return texto;
  const linhas = texto.split("\n");
  const indice = linhas.findIndex((l) => [CABECALHO_ANTERIOR, CABECALHO_COTACOES].includes(l.trim()));
  if (indice >= 0) {
    let fim = indice + 1;
    while (fim < linhas.length && linhas[fim].trimStart().startsWith("|")) fim++;
    linhas.splice(indice, fim - indice, quadroDeItens(itens) || "[[Itens]]");
    return linhas.join("\n");
  }
  if (!itens.length || /\[\[\s*(?:preencher:\s*)?itens(?: solicitados)?\s*\]\]/i.test(texto)) return texto;
  const titulo = linhas.findIndex((l) => l.trim() === TITULO_ITENS);
  if (titulo >= 0) {
    linhas.splice(titulo + 1, 0, quadroDeItens(itens), "");
    return linhas.join("\n");
  }
  const assinatura = texto.search(/^\s*@ /m);
  const antes = assinatura < 0 ? texto.trimEnd() : texto.slice(0, assinatura).trimEnd();
  const depois = assinatura < 0 ? "" : texto.slice(assinatura).trimStart();
  return [antes, `${TITULO_ITENS}\n${quadroDeItens(itens)}`, depois].filter(Boolean).join("\n\n");
}

export function camposDaSolicitacao(texto: string, dados: {
  secretaria: string;
  referencia: string;
  protocolo: string;
  objeto: string;
  titular?: { nome: string; portaria: string | null } | null;
  /** Objeto genérico, justificativa e itens informados no formulário da solicitação. */
  objeto_solicitacao?: string;
  justificativa?: string;
  itens?: ItemSolicitacao[];
}) {
  const itens = dados.itens ?? [];
  const total = totalDosItens(itens);
  const justificativa = dados.justificativa?.trim() ?? "";
  const valores: Record<string, string> = {
    secretaria: dados.secretaria,
    protocolo: dados.protocolo,
    objeto: dados.objeto_solicitacao?.trim() || dados.objeto,
    "objeto generico": dados.objeto_solicitacao?.trim() || dados.objeto,
    justificativa,
    "justificativa da contratacao": justificativa,
    "justificativa da necessidade": justificativa,
    itens: quadroDeItens(itens),
    "itens solicitados": quadroDeItens(itens),
    "valor total": total == null ? "" : real(total),
    "valor estimado": total == null ? "" : real(total),
    referencia: dados.referencia,
    "nome do secretario": dados.titular?.nome ?? "",
    "portaria de nomeacao": dados.titular?.portaria ?? "",
  };
  return Object.fromEntries(pendencias(texto).flatMap(({ i, rotulo }) => {
    const chave = rotulo.replace(/^preencher:\s*/i, "").normalize("NFD").replace(/\p{M}/gu, "").trim().toLowerCase();
    return Object.hasOwn(valores, chave) && valores[chave] ? [[i, valores[chave]]] : [];
  }));
}
