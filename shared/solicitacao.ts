import { pendencias } from "./etapas.js";
import { reaisPorExtenso } from "./extenso.js";

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const dataLocal = (local?: string) => { const d = new Date(); return `${local ? `${local}, ` : ""}${d.getDate()} de ${MESES[d.getMonth()]} de ${d.getFullYear()}.`; };

export const ASSINATURA_SOLICITACAO = [
  "@ [[Nome do secretário]]",
  "@ Secretário(a) Municipal de [[Secretaria]]",
  "@ Portaria de nomeação nº [[Portaria de nomeação]]",
].join("\n");

export const MODELO_SOLICITACAO = {
  id: "solicitacao",
  nome: "Solicitação",
  doc: "Solicitação da secretaria",
  modelo: [
    "# SOLICITAÇÃO DE CONTRATAÇÃO",
    "Protocolo [[Protocolo]]",
    "Ao Departamento de Licitações e Contratos",
    "",
    "## 1. Unidade requisitante",
    "[[Secretaria]]",
    "",
    "## 2. Objeto",
    "[[Objeto]]",
    "",
    "## 3. Justificativa da necessidade",
    "[[Justificativa da contratação]]",
    "",
    "## 4. Itens solicitados",
    "[[Itens]]",
    "",
    "## 5. Quantidades e prazo de atendimento",
    "[[Quantidades e prazo de atendimento]]",
    "",
    "## 6. Estimativa de valor",
    "Valor total estimado: [[Valor total por extenso]], apurado a partir das cotações e referências do quadro de itens, sem prejuízo da pesquisa de preços formal, com memória de cálculo (Lei nº 14.133/2021, art. 23).",
    "",
    "## 7. Verificação no Plano Anual de Contratações (PAC)",
    "[[Previsão no PAC]]",
    "",
    "## 8. Pedido",
    "Diante do exposto, solicita-se a adoção das providências para a contratação, com a formalização da demanda, o Estudo Técnico Preliminar e os demais atos da fase preparatória (Lei nº 14.133/2021, art. 18). A Secretaria declara que a especificação não indica marca, que a demanda não foi fracionada e que as informações prestadas são verdadeiras.",
    "",
    "[[Local e data]]",
    "",
    ASSINATURA_SOLICITACAO,
  ].join("\n"),
};

export const CRITERIOS_PRECO = { media: "Média", mediana: "Mediana", menor: "Menor valor" };
export type CriterioPreco = keyof typeof CRITERIOS_PRECO;
export const FONTES_COTACAO = { fornecedor: "Orçamento de fornecedor", banco_precos: "Banco de Preços", loja: "Loja na internet", pncp: "Valor do PNCP", outra: "Outras fontes" };
export type FonteCotacao = keyof typeof FONTES_COTACAO;
export interface CotacaoItem {
  orcamento_id: number | null;
  fornecedor: string;
  valor_unitario: number | null;
  fonte?: FonteCotacao;
  link?: string;
  consultado_em?: string;
  /** Validade da proposta, condições ou outras informações. */
  obs?: string;
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
  const valores = cotacoes.flatMap((c) => c.fornecedor.trim() && c.valor_unitario != null && c.valor_unitario > 0
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
// Linha logo abaixo do quadro que faz parte dele: o total antigo (fora da tabela) ou a nota do preço de referência.
const RODAPE_DO_QUADRO = /^(?:\*\*(?:Total estimado da solicitação|Subtotal dos itens com valor)\*\* R\$\s|Preço de referência: )/;
const DESCRICAO_CRITERIO: Record<CriterioPreco, string> = { media: "média", mediana: "mediana", menor: "menor valor" };
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
      precos.set(chave, real(cotacao.valor_unitario));
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

/**
 * Quadro de itens no formato das minutas (linhas com barras verticais). A linha separadora leva o alinhamento
 * de cada coluna (":---:" centralizada, "---:" à direita), que a tela, o Word e o PDF respeitam.
 */
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
  const comparativo = fornecedores.length > 0;
  const cabecalho = comparativo
    ? `${CABECALHO_ITEM}${fornecedores.map(([, nome], i) => ` Cotação ${i + 1}${QUEBRA_NA_CELULA}${nome} |`).join("")} ${referencia} | Valor total |`
    : temCotacoes ? CABECALHO_COTACOES : CABECALHO_ANTERIOR;
  const separador = `|:---:|---|:---:|---:|${"---:|".repeat(fornecedores.length + 2)}`;
  const linhas = [
    cabecalho,
    separador,
    ...itens.map((item, k) => {
      const subtotal = totalDoItem(item);
      const qtd = item.quantidade == null ? "—" : numero(item.quantidade);
      const unitario = item.valor_unitario == null ? "—" : real(item.valor_unitario);
      const cotacoes = fornecedores.map(([chave]) => ` ${precos?.cotacoes[k].get(chave) ?? "—"} |`).join("");
      return `| ${k + 1} | ${celula(item.descricao)} | ${celula(item.unidade) || "—"} | ${qtd} |${cotacoes} ${unitario} | ${subtotal == null ? "—" : real(subtotal)} |`;
    }),
  ];
  if (total != null) {
    const rotulo = parcial ? "Subtotal dos itens com valor" : comparativo ? "Total estimado da solicitação" : "Total estimado";
    linhas.push(`| | **${rotulo}** |${" |".repeat(fornecedores.length + 3)} **${real(total)}** |`);
  }
  if (comparativo) {
    const base = criterio ? `${DESCRICAO_CRITERIO[criterio]} das cotações` : "conforme o critério indicado para cada item";
    linhas.push("", `Preço de referência: ${base}.`);
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
export function documentoDaSolicitacao(texto: string, itens: ItemSolicitacao[], campos?: Record<string, Record<string, unknown>>) {
  const documento = itens.length ? inserirItens(texto, itens, true) : texto;
  return campos ? inserirVerificacaoPac(documento, campos) : documento;
}

/** Registro completo do PAC, reutilizado no corpo da Solicitação sem alterar a etapa no sistema. */
export function verificacaoPacDoProcesso(campos?: Record<string, Record<string, unknown>>) {
  const v = (id: string) => { const valor = campos?.pac?.[id]; return typeof valor === "string" ? valor.trim() : ""; };
  const pendente = (rotulo: string) => `[[PREENCHER: ${rotulo}]]`;
  if (v("consta") === "nao") return [
    "O objeto não consta do Plano Anual de Contratações (PAC) vigente.",
    `**Justificativa da inclusão extraordinária:** ${v("justificativa_inclusao") || pendente("Justificativa da inclusão extraordinária na etapa Verificar no PAC")}`,
  ].join("\n\n");
  if (v("consta") !== "sim") return "";
  const linhas = [
    "O objeto consta do Plano Anual de Contratações (PAC) vigente.",
    `**Item do PAC:** ${v("item_pac") || pendente("Item do PAC")}`,
    `**Mês previsto para o início:** ${v("mes_planejado") || pendente("Mês previsto no PAC")}`,
    `**Início no mês planejado:** ${v("no_prazo") === "sim" ? "Sim." : v("no_prazo") === "nao" ? "Não." : pendente("Conferir o mês de início na etapa Verificar no PAC")}`,
  ];
  if (v("no_prazo") === "nao") linhas.push(`**Motivo da alteração do cronograma:** ${v("motivo_prazo") || pendente("Motivo da alteração do cronograma")}`);
  return linhas.join("\n\n");
}

/** Incorpora o PAC em um único tópico e preserva o texto, as demais seções e a assinatura. */
export function inserirVerificacaoPac(texto: string, campos: Record<string, Record<string, unknown>>) {
  const registro = verificacaoPacDoProcesso(campos);
  if (!texto.trim() || !registro) return texto;
  const titulo = "Verificação no Plano Anual de Contratações (PAC)";
  const titulosPac = new Set([
    "alinhamento com o planejamento", "previsao no pac", "verificacao no pac", "verificacao do pac",
    "verificacao no plano anual de contratacoes", "verificacao no plano anual de contratacoes pac",
    "registro de verificacao no plano anual de contratacoes",
  ]);
  const assinaturaOuData = /^[ \t]*(?:@ |\[\[(?:PREENCHER:[ \t]*)?Local e data\]\][ \t]*$|(?:[^\n]*,[ \t]*)?\d{1,2} de [\p{L}]+ de \d{4}\.?[ \t]*$)/imu;
  const cabecalhos = [...texto.matchAll(/^#{1,2}\s+([^\n]+)\n?/gm)];
  const secoes = cabecalhos.flatMap((m, i) => {
    if (!m[0].startsWith("## ")) return [];
    const nome = normalizarCotacao(m[1].replace(/^\d+[.)]\s*/, "")).replace(/[^a-z0-9]+/g, " ").trim();
    if (!titulosPac.has(nome)) return [];
    const inicio = m.index!;
    let fim = cabecalhos[i + 1]?.index ?? texto.length;
    const marco = texto.slice(inicio + m[0].length, fim).search(assinaturaOuData);
    if (marco >= 0) fim = inicio + m[0].length + marco;
    const numero = /^(\d+[.)]\s*)/.exec(m[1])?.[1] ?? "";
    return [{ inicio, fim, numero }];
  });
  if (secoes.length) {
    let resultado = texto;
    for (let i = secoes.length - 1; i >= 0; i--) {
      const s = secoes[i];
      resultado = resultado.slice(0, s.inicio) + (i === 0 ? `## ${s.numero}${titulo}\n\n${registro}\n\n` : "") + resultado.slice(s.fim);
    }
    return resultado.trimEnd();
  }
  const marco = texto.search(assinaturaOuData);
  const antes = (marco < 0 ? texto : texto.slice(0, marco)).trimEnd();
  const depois = marco < 0 ? "" : texto.slice(marco).trimStart();
  return [antes, `## ${titulo}\n\n${registro}`, depois].filter(Boolean).join("\n\n");
}

/** Texto da verificação no PAC (etapa 1), para os documentos. */
export function planejamentoDoProcesso(campos?: Record<string, Record<string, unknown>>) {
  const v = (k: string) => { const x = campos?.pac?.[k]; return typeof x === "string" ? x.trim() : ""; };
  if (v("consta") === "sim") {
    return `A contratação está prevista no Plano Anual de Contratações${v("item_pac") ? ` (${v("item_pac")})` : ""}${v("mes_planejado") ? `, com início previsto para ${v("mes_planejado")}` : ""}.`
      + (v("no_prazo") === "nao" && v("motivo_prazo") ? ` Alteração do cronograma: ${v("motivo_prazo")}` : "");
  }
  if (v("consta") === "nao") return `A contratação não consta do Plano Anual de Contratações e é incluída de forma extraordinária. Justificativa: ${v("justificativa_inclusao") || "a informar"}`;
  return "";
}

/** Prazo que o processo já registra: data pretendida do DFD ou mês de início previsto no PAC. */
export function prazoDoProcesso(campos?: Record<string, Record<string, unknown>>) {
  const dfd = campos?.dfd?.data_pretendida, mes = campos?.pac?.mes_planejado;
  if (typeof dfd === "string" && dfd.trim()) return dfd.trim();
  return typeof mes === "string" && mes.trim() ? `conforme o PAC, início previsto para ${mes.trim()}` : "";
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
  /** Prazo já informado no processo (DFD ou mês previsto no PAC). */
  prazo?: string;
  /** Texto da verificação no PAC. */
  planejamento?: string;
  /** Cidade/UF do órgão, para a linha de local e data. */
  local?: string;
}) {
  const itens = dados.itens ?? [];
  const prazo = dados.prazo?.trim() ?? "";
  const quantidades = itens.filter((i) => i.descricao.trim() && i.quantidade != null)
    .map((i) => `${i.descricao.trim()}: ${numero(i.quantidade!)} ${i.unidade || ""}`.trim()).join("; ");
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
    "valor total por extenso": total == null ? "" : `${real(total)} (${reaisPorExtenso(total)})`,
    "previsao no pac": dados.planejamento ?? "",
    "alinhamento com o planejamento": dados.planejamento ?? "",
    "local e data": dataLocal(dados.local),
    "valor estimado": total == null ? "" : real(total),
    referencia: dados.referencia,
    quantidades,
    "quantidades e prazo de atendimento": quantidades && prazo ? `${quantidades}. Prazo: ${prazo}` : quantidades ? `Conforme o quadro de itens: ${quantidades}.` : prazo ? `Prazo: ${prazo}` : "",
    prazo,
    "prazo de atendimento": prazo,
    "prazo de entrega": prazo,
    "nome do secretario": dados.titular?.nome ?? "",
    "portaria de nomeacao": dados.titular?.portaria ?? "",
  };
  return Object.fromEntries(pendencias(texto).flatMap(({ i, rotulo }) => {
    const chave = rotulo.replace(/^preencher:\s*/i, "").normalize("NFD").replace(/\p{M}/gu, "").trim().toLowerCase();
    return Object.hasOwn(valores, chave) && valores[chave] ? [[i, valores[chave]]] : [];
  }));
}
