import { limparNomeFornecedor, type DadosOrcamento, type ItemOrcamento } from "../shared/orcamentos.js";

const BRL = /R\$[ \t]+(\d+(?:\.\d{3})*,\d{2,4})/g;
const CODIGO = /^\s*\d{3,}\s{2,}/;
const MEDIDAS = /\s{2,}([A-ZÀ-Ü.]{1,12})\s{2,}(\d+(?:\.\d{3})*(?:,\d+)?)(?=\s|$)/;
const numero = (s: string) => Number(s.replace(/\./g, "").replace(",", "."));

export function pedidoSemPrecos(texto: string) {
  return /\bEquiplano\b/i.test(texto)
    && /^\s*Fornecedor:\s+Data:/im.test(texto)
    && /Quantidade\s+Preço Unitário\s+Preço Total/i.test(texto)
    && !/R\$[ \t]*[\d,.]/i.test(texto);
}

/** Lê o formato tabular com código, unidade, quantidade e duas colunas monetárias.
 * Quando o texto não conserva a estrutura de todos os itens, a leitura visual é usada.
 */
export function lerTabelaOrcamento(texto: string): DadosOrcamento | undefined {
  if (!/\bC[oó]digo\s{2,}Descri[cç][aã]o/i.test(texto)
    || !/\bQuantidade\b/i.test(texto) || !/\bPreço\s+total\b/i.test(texto) || !/\bunitário\b/i.test(texto)) return;
  const emissor = texto.match(/^([^\n]+?)\s+•\s+CNPJ[ :]+(\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2})\s*$/im);
  if (!emissor) return;
  const fornecedor = limparNomeFornecedor(emissor[1]);
  if (!fornecedor) return;

  const itens: ItemOrcamento[] = [];
  for (const bloco of texto.split(/\f|\n[ \t]*\n/)) {
    const linhas = bloco.split("\n");
    const codigos = linhas.filter((linha) => CODIGO.test(linha));
    if (!codigos.length) continue;
    if (codigos.length !== 1) return;
    const medidas = codigos[0].match(MEDIDAS);
    const valores = [...bloco.matchAll(BRL)].map((m) => numero(m[1]));
    if (!medidas || valores.length !== 2 || valores.some((v) => !Number.isFinite(v))) return;
    const inicio = linhas.findIndex((linha) => CODIGO.test(linha) || /R\$[ \t]+\d/.test(linha));
    const descricao = linhas.slice(inicio).map((linha) => {
      const trecho = linha.replace(MEDIDAS, "").split(/\s+R\$/)[0];
      return (CODIGO.test(linha) ? trecho.replace(/^\s*\d{3,}(?:\s{2,}|$)/, "") : trecho).trim();
    }).filter(Boolean).join(" ");
    const quantidade = numero(medidas[2]);
    if (!descricao || !Number.isFinite(quantidade)) return;
    itens.push({ descricao, unidade: medidas[1].replace(/\.$/, ""), quantidade, valor_unitario: valores[0], valor_total: valores[1] });
  }

  const total = texto.match(/\bVALOR\s+TOTAL\s*:\s*R\$\s*(\d+(?:\.\d{3})*,\d{2})/i);
  if (!itens.length || !total) return;
  const valor_total = numero(total[1]);
  const somaEmCentavos = itens.reduce((soma, item) => soma + Math.round(item.valor_total! * 100), 0);
  if (somaEmCentavos !== Math.round(valor_total * 100)) return;
  return {
    fornecedor, cnpj: emissor[2], itens, valor_total, data: null, validade: null,
    frete: "nao_informado", instalacao: "nao_informado", prazo_entrega: null, observacoes: null,
  };
}
