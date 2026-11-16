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
const CABECALHO_ITEM = "| Item | Descrição | Un. | Qtd. |";
const CABECALHO_ANTERIOR = `${CABECALHO_ITEM} Valor unitário | Valor total |`;
const CABECALHO_COTACOES = `${CABECALHO_ITEM} Valor unitário estimado | Valor total |`;
const RODAPE_DO_QUADRO = /^\*\*(?:Total estimado da solicitação|Subtotal dos itens com valor)\*\* R\$\s/;
export const QUEBRA_NA_CELULA = "\u2028";
const cabecalhoComFornecedores = (linha: string) => linha.replaceAll(QUEBRA_NA_CELULA, " ").startsWith(CABECALHO_ITEM + " Cotação 1 ");

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

export function quantidadeColunasCotacoes(texto: string) {
  const cabecalho = texto.split("\n").map((linha) => linha.trim()).find((linha) => (
    cabecalhoComFornecedores(linha) || linha.startsWith(CABECALHO_COTACOES + " Cotação 1 ")
  ));
  return cabecalho?.split("|").filter((coluna) => /^Cotação \d+(?:\s|$)/.test(coluna.trim())).length ?? 0;
}

/** Quadro de itens no formato das minutas (linhas com barras verticais). */
export function quadroDeItens(itens: ItemSolicitacao[], incluirPrecosCotados = false) {
  if (!itens.length) return "";
  const total = totalDosItens(itens);
  const temCotacoes = itens.some((i) => i.cotacoes !== undefined);
  const parcial = temCotacoes && itens.some((i) => totalDoItem(i) == null);
  const precos = incluirPrecosCotados ? cotacoesPorFornecedor(itens) : null;
  const fornecedores = precos?.fornecedores ?? [];
  const criterios = new Set(itens.filter((item) => item.valor_unitario != null || item.cotacoes?.length)
    .map((item) => item.cotacoes ? item.criterio ?? "media" : undefined));
  const criterio = criterios.size === 1 ? [...criterios][0] : undefined;
  const referencia = criterio ? CRITERIOS_PRECO[criterio] : "Valor unitário estimado";
  const acrescentar = (linha: string, colunas: string[] = []) =>
    linha + fornecedores.map((_, i) => colunas[i] ? ` ${colunas[i]} |` : " |").join("");
  const cabecalho = fornecedores.length
    ? `${acrescentar(CABECALHO_ITEM, fornecedores.map(([, nome], i) => `Cotação ${i + 1}${QUEBRA_NA_CELULA}${nome}`))} ${referencia} |`
    : temCotacoes ? CABECALHO_COTACOES : CABECALHO_ANTERIOR;
  const comparativo = fornecedores.length > 0;
  const linhas = [
    cabecalho,
    `|${"---|".repeat((comparativo ? 5 : 6) + fornecedores.length)}`,
    ...itens.map((item, k) => {
      const subtotal = totalDoItem(item);
      const qtd = item.quantidade == null ? "—" : numero(item.quantidade);
      const unitario = item.valor_unitario == null ? "—" : real(item.valor_unitario);
      const linha = `| ${k + 1} | ${celula(item.descricao)} | ${celula(item.unidade) || "—"} | ${qtd} |`;
      const cotacoes = fornecedores.map(([chave]) => precos?.cotacoes[k].get(chave) ?? "—");
      const comReferencia = `${acrescentar(linha, cotacoes)} ${unitario} |`;
      return comparativo ? comReferencia : `${comReferencia} ${subtotal == null ? "—" : real(subtotal)} |`;
    }),
  ];
  if (total != null) {
    const soma = parcial ? "Subtotal dos itens com valor" : "Total estimado";
    if (comparativo) linhas.push("", `**${parcial ? soma : "Total estimado da solicitação"}** ${real(total)}`);
    else linhas.push(`| | ${soma} | | | | ${real(total)} |`);
  }
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
function celulasDaLinha(linha: string) {
  return linha.trim().replace(/^\||\|$/g, "").split("|").map((celula) => normalizarCotacao(celula.replace(/\*\*/g, "")));
}

function quadrosDosItens(linhas: string[], itens: ItemSolicitacao[]) {
  const descricoes = new Set(itens.map((item) => normalizarCotacao(celula(item.descricao))));
  const quadros: { inicio: number; fim: number }[] = [];
  for (let inicio = 0; inicio < linhas.length;) {
    if (!linhas[inicio].trimStart().startsWith("|")) { inicio++; continue; }
    let fim = inicio + 1;
    while (fim < linhas.length && linhas[fim].trimStart().startsWith("|")) fim++;
    const cabecalho = linhas[inicio].trim();
    const rotulos = celulasDaLinha(cabecalho);
    const descricao = rotulos.findIndex((rotulo) => /^(?:descricao|especificacao|discriminacao)\b/.test(rotulo));
    const colunaDeItem = rotulos.findIndex((rotulo) => /^(?:item|numero|n[º°o.]|ordem)(?:\s|$)/.test(rotulo));
    const colunaDeCotacao = rotulos.some((rotulo) => /^(?:cotacao|orcamento|fornecedor|qtd|quantidade|valor unitario)\b/.test(rotulo));
    const linhasComItem = descricao >= 0 && colunaDeCotacao
      ? linhas.slice(inicio + 1, fim).map(celulasDaLinha).filter((linha) => {
        if (colunaDeItem >= 0) return /^\d+\.?$/.test(linha[colunaDeItem] ?? "");
        return !!linha[descricao] && !/^:?-{2,}:?$/.test(linha[descricao]) && !/^(?:sub)?total\b/.test(linha[descricao]);
      })
      : [];
    const mesmosItens = linhasComItem.length > 0 && linhasComItem.every((linha) => descricoes.has(linha[descricao]));
    if (cabecalho === CABECALHO_ANTERIOR || cabecalho === CABECALHO_COTACOES
      || cabecalho.startsWith(CABECALHO_COTACOES + " ") || cabecalhoComFornecedores(cabecalho) || mesmosItens) {
      let proxima = fim;
      while (proxima < linhas.length && !linhas[proxima].trim()) proxima++;
      if (RODAPE_DO_QUADRO.test(linhas[proxima]?.trim() ?? "")) fim = proxima + 1;
      quadros.push({ inicio, fim });
    }
    inicio = fim;
  }
  return quadros;
}

function limparMarcadoresDeItens(linhas: string[], indiceQuadro: number) {
  return linhas.flatMap((linha, i) => {
    if (linha.trim() === TITULO_ITENS) {
      let proxima = i + 1;
      while (proxima < linhas.length && !linhas[proxima].trim()) proxima++;
      const restante = linhas[proxima]?.trim().replace(CAMPO_ITENS, "").trim();
      if (proxima !== indiceQuadro && restante === "") return [];
    }
    if (i === indiceQuadro || linha.trimStart().startsWith("|") || !CAMPO_ITENS.test(linha)) return [linha];
    const semMarcador = linha.replace(new RegExp(CAMPO_ITENS.source, "gi"), "").trimEnd();
    return !semMarcador.trim() || /^#{1,2}$/.test(semMarcador.trim()) ? [] : [semMarcador];
  }).join("\n");
}

/** Atualiza um único quadro de itens e preserva as demais tabelas e seções do documento. */
export function inserirItens(texto: string, itens: ItemSolicitacao[], modo: boolean | "marcador" = false) {
  if (!texto.trim()) return texto;
  const quadro = modo === "marcador" ? "[[Itens]]" : quadroDeItens(itens, modo);
  const linhas = texto.split("\n");
  const quadros = quadrosDosItens(linhas, itens);
  if (quadros.length) {
    const primeiro = quadros[0];
    for (const duplicado of quadros.slice(1).reverse()) {
      let inicio = duplicado.inicio;
      let anterior = inicio - 1;
      while (anterior >= primeiro.fim && !linhas[anterior].trim()) anterior--;
      if (linhas[anterior]?.trim() === TITULO_ITENS) inicio = anterior;
      linhas.splice(inicio, duplicado.fim - inicio);
    }
    linhas.splice(primeiro.inicio, primeiro.fim - primeiro.inicio, quadro || "[[Itens]]");
    return quadro ? limparMarcadoresDeItens(linhas, primeiro.inicio) : linhas.join("\n");
  }
  if (!itens.length || modo === "marcador") return texto;
  const campo = linhas.findIndex((l) => CAMPO_ITENS.test(l));
  if (campo >= 0) {
    const [antes, depois] = linhas[campo].split(CAMPO_ITENS, 2);
    const prefixo = antes.trim();
    const comQuadro = /^#{1,2}$/.test(prefixo) && !depois.trim()
      ? `${TITULO_ITENS}\n${quadro}`
      : [prefixo, quadro, depois.trim()].filter(Boolean).join("\n\n");
    linhas.splice(campo, 1, comQuadro);
    return limparMarcadoresDeItens(linhas, campo);
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
