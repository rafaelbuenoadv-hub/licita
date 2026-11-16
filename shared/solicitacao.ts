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

/** Item pedido na solicitação. Quantidade e valor unitário podem ficar em branco quando ainda não são conhecidos. */
export interface ItemSolicitacao { descricao: string; unidade: string; quantidade: number | null; valor_unitario: number | null }
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
  return [
    "| Item | Descrição | Un. | Qtd. | Valor unitário | Valor total |",
    "|---|---|---|---|---|---|",
    ...itens.map((i, k) => `| ${k + 1} | ${cel(i.descricao)} | ${cel(i.unidade) || "—"} | ${i.quantidade == null ? "—" : numero(i.quantidade)} | ${i.valor_unitario == null ? "—" : real(i.valor_unitario)} | ${totalDoItem(i) == null ? "—" : real(totalDoItem(i)!)} |`),
    ...(total == null ? [] : [`| | Total estimado | | | | ${real(total)} |`]),
  ].join("\n");
}
const TITULO_ITENS = "## Itens solicitados";
/** Garante o quadro de itens no texto mesmo quando o modelo do órgão não tem o campo [[Itens]]: entra antes das assinaturas. */
export function inserirItens(texto: string, itens: ItemSolicitacao[]) {
  if (!itens.length || !texto.trim() || /\[\[\s*(?:preencher:\s*)?itens(?: solicitados)?\s*\]\]/i.test(texto) || texto.split("\n").some((l) => l.trim() === TITULO_ITENS)) return texto;
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
