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
export const TAMANHO_ANEXO_SOLICITACAO = 20 * 1024 * 1024;
export const TIPOS_ANEXOS_SOLICITACAO = ".pdf,.docx,.xlsx,.txt,.md,.csv,.jpg,.jpeg,.png";

const real = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const numero = (v: number) => v.toLocaleString("pt-BR", { maximumFractionDigits: 4 });
const celula = (texto: string) => texto.replace(/\s*\n\s*/g, " ").replace(/\|/g, "/").trim();
export const totalDoItem = (i: ItemSolicitacao) => (i.quantidade != null && i.valor_unitario != null ? Math.round(i.quantidade * i.valor_unitario * 100) / 100 : null);
/** Soma dos itens que têm quantidade e valor; null quando nenhum tem. */
export function totalDosItens(itens: ItemSolicitacao[]) {
  const t = itens.map(totalDoItem).filter((x): x is number => x != null);
  return t.length ? Math.round(t.reduce((a, b) => a + b, 0) * 100) / 100 : null;
}
const LIMITE_COLUNAS_COTACOES = 3;
const CABECALHO_ANTERIOR = "| Item | Descrição | Un. | Qtd. | Valor unitário | Valor total |";
const CABECALHO_COTACOES = "| Item | Descrição | Un. | Qtd. | Valor unitário estimado | Valor total |";

function cotacoesPorFornecedor(itens: ItemSolicitacao[]) {
  const fornecedores = new Map<string, string>();
  const cotacoes = itens.map((item) => {
    const precos = new Map<string, string>();
    for (const cotacao of item.cotacoes ?? []) {
      if (cotacao.valor_unitario == null) continue;
      const chave = normalizarCotacao(cotacao.fornecedor);
      const nome = celula(cotacao.fornecedor) || "Fornecedor a identificar";
      if (!fornecedores.has(chave)) fornecedores.set(chave, nome);
      const pendencia = cotacao.orcamento_id == null ? " (anexo pendente)" : "";
      precos.set(chave, real(cotacao.valor_unitario) + pendencia);
    }
    return precos;
  });
  return { fornecedores: [...fornecedores], cotacoes };
}

function linhaDeItem(item: ItemSolicitacao, indice: number, repetir: boolean) {
  const identificacao = `| ${indice + 1} | ${celula(item.descricao)} |`;
  if (repetir) return `${identificacao} | | | |`;
  const subtotal = totalDoItem(item);
  const qtd = item.quantidade == null ? "—" : numero(item.quantidade);
  const unitario = item.valor_unitario == null ? "—" : real(item.valor_unitario);
  return `${identificacao} ${celula(item.unidade) || "—"} | ${qtd} | ${unitario} | ${subtotal == null ? "—" : real(subtotal)} |`;
}

/** Quadro de itens no formato das minutas (linhas com barras verticais). */
export function quadroDeItens(itens: ItemSolicitacao[], incluirPrecosCotados = false) {
  if (!itens.length) return "";
  const total = totalDosItens(itens);
  const temCotacoes = itens.some((i) => i.cotacoes !== undefined);
  const parcial = temCotacoes && itens.some((i) => totalDoItem(i) == null);
  const cabecalho = temCotacoes ? CABECALHO_COTACOES : CABECALHO_ANTERIOR;
  const precos = incluirPrecosCotados ? cotacoesPorFornecedor(itens) : null;
  const fornecedores = precos?.fornecedores ?? [];
  const largura = Math.min(LIMITE_COLUNAS_COTACOES, fornecedores.length);
  const acrescentar = (linha: string, colunas: string[] = []) =>
    linha + Array.from({ length: largura }, (_, i) => colunas[i] ? ` ${colunas[i]} |` : " |").join("");

  const linhas: string[] = [];
  const mostrados = new Set<number>();
  // Grupos no mesmo quadro mantêm as colunas legíveis nos arquivos impressos.
  for (let inicio = 0; inicio < Math.max(1, fornecedores.length); inicio += Math.max(1, largura)) {
    const grupo = fornecedores.slice(inicio, inicio + largura);
    const titulos = grupo.map(([, nome]) => inicio ? `**${nome}**` : nome);
    const titulo = inicio ? cabecalho.replace(/[^|]+(?=\|)/g, (celula) => ` **${celula.trim()}** `) : cabecalho;
    linhas.push(acrescentar(titulo, titulos));
    if (!inicio) linhas.push(`|${"---|".repeat(6 + largura)}`);
    for (const [k, item] of itens.entries()) {
      const cotacoes = precos?.cotacoes[k];
      const valores = grupo.map(([chave]) => cotacoes?.get(chave));
      if (!valores.some(Boolean) && (inicio || cotacoes?.size)) continue;
      linhas.push(acrescentar(linhaDeItem(item, k, mostrados.has(k)), valores.map((v) => v ?? "—")));
      mostrados.add(k);
    }
  }
  if (total != null) linhas.push(acrescentar(`| | ${parcial ? "Subtotal dos itens com valor" : "Total estimado"} | | | | ${real(total)} |`));
  return linhas.join("\n");
}
const TITULO_ITENS = "## Itens solicitados";
const CAMPO_ITENS = /\[\[\s*(?:preencher:\s*)?itens(?: solicitados)?\s*\]\]/i;

function antesDaAssinatura(texto: string, trecho: string) {
  const assinatura = texto.search(/^\s*@ /m);
  const antes = assinatura < 0 ? texto.trimEnd() : texto.slice(0, assinatura).trimEnd();
  const depois = assinatura < 0 ? "" : texto.slice(assinatura).trimStart();
  return [antes, trecho, depois].filter(Boolean).join("\n\n");
}
/** Garante o quadro de itens no texto mesmo quando o modelo do órgão não tem o campo [[Itens]]: entra antes das assinaturas. */
export function inserirItens(texto: string, itens: ItemSolicitacao[], incluirPrecosCotados = false) {
  if (!texto.trim()) return texto;
  const quadro = quadroDeItens(itens, incluirPrecosCotados);
  const linhas = texto.split("\n");
  const indice = linhas.findIndex((linha) => {
    const texto = linha.trim();
    return texto === CABECALHO_ANTERIOR || texto === CABECALHO_COTACOES || texto.startsWith(CABECALHO_COTACOES + " ");
  });
  if (indice >= 0) {
    let fim = indice + 1;
    while (fim < linhas.length && linhas[fim].trimStart().startsWith("|")) fim++;
    linhas.splice(indice, fim - indice, quadro || "[[Itens]]");
    return linhas.join("\n");
  }
  if (!itens.length) return texto;
  const campo = linhas.findIndex((l) => CAMPO_ITENS.test(l));
  if (campo >= 0) {
    const [antes, depois] = linhas[campo].split(CAMPO_ITENS, 2);
    const prefixo = antes.trim();
    const comQuadro = /^#{1,2}$/.test(prefixo) && !depois.trim()
      ? `${TITULO_ITENS}\n${quadro}`
      : [prefixo, quadro, depois.trim()].filter(Boolean).join("\n\n");
    linhas.splice(campo, 1, comQuadro);
    return linhas.join("\n");
  }
  const titulo = linhas.findIndex((l) => l.trim() === TITULO_ITENS);
  if (titulo >= 0) {
    linhas.splice(titulo + 1, 0, quadro, "");
    return linhas.join("\n");
  }
  return antesDaAssinatura(texto, `${TITULO_ITENS}\n${quadro}`);
}

/** Renderiza os preços cotados no quadro da prévia e dos arquivos exportados. */
export function documentoDaSolicitacao(texto: string, itens: ItemSolicitacao[]) {
  return itens.length ? inserirItens(texto, itens, true) : texto;
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
