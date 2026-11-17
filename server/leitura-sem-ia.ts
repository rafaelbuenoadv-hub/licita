import { normalizarCotacao } from "../shared/solicitacao.js";
import type { DadosOrcamento, ItemOrcamento } from "../shared/orcamentos.js";

/**
 * Leitura de orçamento sem IA, para quando a IA está indisponível ou sem créditos.
 * Funciona com texto em forma de tabela: planilha (.xlsx, .csv), quadro do Word e PDF com texto selecionável.
 * Só aceita uma linha quando a quantidade vezes o preço unitário confere com o total, para não lançar número errado.
 * Foto e PDF digitalizado não têm texto: dependem da IA.
 */
const DINHEIRO = /^(?:R\$\s*)?-?\d{1,3}(?:\.\d{3})*(?:,\d{1,4})$|^(?:R\$\s*)?-?\d+(?:,\d{1,4})$|^(?:R\$\s*)?-?\d+\.\d{2}$/;
const QUANTIDADE = /^\d{1,3}(?:\.\d{3})*(?:,\d+)?$|^\d+(?:[.,]\d+)?$/;
const UNIDADES = /^(?:un|und|unid|unidade|pc|pç|peca|peça|cx|caixa|kg|g|l|lt|litro|ml|m|m2|m²|m3|m³|km|h|hr|hora|serv|sv|svc|servico|serviço|mes|mês|dia|diaria|diária|par|jg|jogo|kit|pct|pacote|rl|rolo|fr|frasco|gl|galao|galão|resma|sc|saco|tb|tubo|vb|verba|ano|lote|conj|conjunto|cj|un\.|und\.)$/i;

/** Número em formato brasileiro (1.234,56) ou internacional simples (1234.56). */
function valorDe(texto: string) {
  const t = texto.replace(/R\$\s*/i, "").trim();
  if (!t) return null;
  const n = /,\d+$/.test(t) ? Number(t.replace(/\./g, "").replace(",", ".")) : /^\d{1,3}(\.\d{3})+$/.test(t) ? Number(t.replace(/\./g, "")) : Number(t);
  return Number.isFinite(n) ? n : null;
}
const confere = (q: number, u: number, t: number) => Math.abs(q * u - t) <= Math.max(0.05, t * 0.005);

/** Quadro com colunas nomeadas: linhas "| a | b |" do Word e da planilha, ou CSV com ";" ou tab. */
function lerQuadro(linhas: string[][]): ItemOrcamento[] {
  const itens: ItemOrcamento[] = [];
  let mapa: Record<string, number> | null = null;
  for (const celulas of linhas) {
    const rotulos = celulas.map((c) => normalizarCotacao(c));
    const achar = (re: RegExp) => rotulos.findIndex((r) => re.test(r));
    const cab = {
      descricao: achar(/^(descri|especifica|produto|servi[cç]o|material|objeto|discrimina|item\b.*descri)/),
      unidade: achar(/^(un\.?|und\.?|unid|unidade)\b/),
      quantidade: achar(/^(qtd|qtde|quant)/),
      unitario: achar(/(unit|pre[cç]o un|valor un|vl\.? ?un|v\.? ?unit)/),
      total: achar(/(total|vl\.? ?tot|subtotal)/),
    };
    if (cab.descricao >= 0 && (cab.unitario >= 0 || cab.total >= 0) && (cab.quantidade >= 0 || cab.unitario >= 0)) { mapa = cab; continue; }
    if (!mapa || cab.descricao >= 0) continue;
    const pega = (k: string) => (mapa![k] >= 0 ? celulas[mapa![k]] ?? "" : "");
    const descricao = pega("descricao").trim();
    const quantidade = valorDe(pega("quantidade"));
    let unitario = valorDe(pega("unitario"));
    const total = valorDe(pega("total"));
    if (!descricao || /^(sub)?total\b/i.test(normalizarCotacao(descricao))) continue;
    if (unitario == null && quantidade && total != null) unitario = Math.round((total / quantidade) * 100) / 100;
    if (unitario == null || unitario <= 0) continue;
    if (quantidade != null && total != null && !confere(quantidade, unitario, total)) continue;
    itens.push({ descricao, unidade: pega("unidade").trim() || null, quantidade, valor_unitario: unitario, valor_total: total ?? (quantidade != null ? Math.round(quantidade * unitario * 100) / 100 : null) });
  }
  return itens;
}

/** Texto em colunas (PDF com texto, lido em layout): descrição, unidade, quantidade, unitário e total na mesma linha. */
function lerColunas(texto: string): ItemOrcamento[] {
  const itens: ItemOrcamento[] = [];
  let anterior: ItemOrcamento | null = null;
  for (const linha of texto.split("\n")) {
    const partes = linha.trim().split(/\s{2,}|\t/).map((p) => p.trim()).filter(Boolean);
    // Junta "R$" separado do número.
    const pedacos = partes.flatMap((p, i) => (p === "R$" ? [] : partes[i - 1] === "R$" ? [`R$ ${p}`] : [p]));
    if (pedacos.length < 4) {
      // Continuação da descrição do item anterior (linha só de texto, logo abaixo).
      if (anterior && pedacos.length && pedacos.every((p) => !/\d{2,}/.test(p) || !DINHEIRO.test(p)) && linha.trim().length < 120 && !/total|subtotal|validade|prazo|pagamento|cnpj|assinatura/i.test(linha)) {
        anterior.descricao = `${anterior.descricao} ${pedacos.join(" ")}`.trim();
      } else anterior = null;
      continue;
    }
    const n = pedacos.length;
    const total = DINHEIRO.test(pedacos[n - 1]) ? valorDe(pedacos[n - 1]) : null;
    const unitario = DINHEIRO.test(pedacos[n - 2]) ? valorDe(pedacos[n - 2]) : null;
    // Quantidade e unidade antes dos preços, em qualquer ordem ("SERV 60" ou "60 SERV").
    let quantidade: number | null = null, unidade: string | null = null, fim = n - 2;
    for (let k = n - 3; k >= Math.max(1, n - 5) && (quantidade == null || unidade == null); k--) {
      if (quantidade == null && QUANTIDADE.test(pedacos[k])) { quantidade = valorDe(pedacos[k]); fim = k; }
      else if (unidade == null && UNIDADES.test(pedacos[k].replace(/\.$/, ""))) { unidade = pedacos[k]; fim = k; }
      else break;
    }
    if (total == null || unitario == null || quantidade == null || !confere(quantidade, unitario, total)) { anterior = null; continue; }
    const inicio = /^\d{1,5}[.)]?$/.test(pedacos[0]) && fim > 1 ? 1 : 0; // número do item ou código no começo
    const descricao = pedacos.slice(inicio, fim).join(" ").trim();
    if (!descricao || !/[a-zà-ü]{3,}/i.test(descricao)) { anterior = null; continue; }
    anterior = { descricao, unidade, quantidade, valor_unitario: unitario, valor_total: total };
    itens.push(anterior);
  }
  return itens;
}

export function lerOrcamentoSemIA(texto: string): DadosOrcamento | null {
  if (!texto.trim()) return null;
  const linhasDeQuadro = texto.split("\n").filter((l) => l.trim().startsWith("|")).map((l) => l.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim()));
  const csv = !linhasDeQuadro.length && /[;\t]/.test(texto)
    ? texto.split("\n").filter((l) => /[;\t]/.test(l)).map((l) => l.split(/[;\t]/).map((c) => c.trim().replace(/^"|"$/g, "")))
    : [];
  const itens = linhasDeQuadro.length ? lerQuadro(linhasDeQuadro) : csv.length ? lerQuadro(csv) : lerColunas(texto);
  if (!itens.length) return null;
  const cnpj = texto.match(/\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/)?.[0] ?? null;
  const totalDoTexto = [...texto.matchAll(/(?:valor\s+)?total(?:\s+geral|\s+da\s+proposta)?\s*[:=]?\s*(?:R\$)?\s*(\d{1,3}(?:\.\d{3})*,\d{2})/gi)].map((m) => valorDe(m[1])).filter((v): v is number => v != null);
  const soma = Math.round(itens.reduce((s, i) => s + (i.valor_total ?? 0), 0) * 100) / 100;
  const valor_total = totalDoTexto.find((v) => Math.abs(v - soma) <= 0.05) ?? soma;
  return { fornecedor: null, cnpj, data: null, validade: null, itens: itens.slice(0, 300), valor_total, frete: "nao_informado", instalacao: "nao_informado", prazo_entrega: null, observacoes: null };
}
