import {
  AlignmentType, BorderStyle, Document, ShadingType, VerticalAlign, Footer, Header, ImageRun, Packer, PageOrientation, Paragraph, Table, TableCell, TableLayoutType, TableRow, TextRun, WidthType,
} from "docx";
import { quantidadeColunasCotacoes, QUEBRA_NA_CELULA } from "../shared/solicitacao.js";

// Converte a marcação das minutas em .docx:
//   "# "  título centralizado      "## " seção em negrito
//   "| a | b |" quadro             "@ "  linha de assinatura (centralizada)
//   [[campo]] campo pendente (amarelo)   **texto** negrito
const FONTE = "Times New Roman";

function runs(t: string, extra: { bold?: boolean; size?: number } = {}): TextRun[] {
  const out: TextRun[] = [];
  const size = extra.size ?? 24;
  const re = /\[\[(.+?)\]\]|\*\*(.+?)\*\*|~~(.+?)~~/g;
  let ult = 0, m: RegExpExecArray | null;
  while ((m = re.exec(t))) {
    if (m.index > ult) out.push(new TextRun({ text: t.slice(ult, m.index), font: FONTE, ...extra, size }));
    if (m[1] !== undefined) out.push(new TextRun({ text: m[1], font: FONTE, highlight: "yellow", ...extra, size }));
    else if (m[2] !== undefined) out.push(new TextRun({ text: m[2], font: FONTE, size, bold: true }));
    else out.push(new TextRun({ text: m[3], font: FONTE, ...extra, size, strike: true }));
    ult = m.index + m[0].length;
  }
  if (ult < t.length) out.push(new TextRun({ text: t.slice(ult), font: FONTE, ...extra, size }));
  return out;
}

type Alinhamento = "left" | "center" | "right" | undefined;
const ALINHA = { left: AlignmentType.LEFT, center: AlignmentType.CENTER, right: AlignmentType.RIGHT } as const;

function tabela(linhas: string[][], larguraUtil: number, alinhamentos: Alinhamento[]) {
  const cols = Math.max(...linhas.map((l) => l.length));
  const borda = { style: BorderStyle.SINGLE, size: 4, color: "000000" };
  const quadroItens = linhas[0][0] === "Item" && linhas[0][1] === "Descrição";
  const comCotacoes = quadroItens && /^Cotação 1\s/.test(linhas[0][4] ?? "");
  // Quadro de itens: colunas estreitas fixas (item, unidade, quantidade), valores com largura suficiente
  // para "R$ 999.999,99" numa linha, e o restante para a descrição.
  const fixas = [600, 0, 650, 700];
  const valor = cols > 8 ? 1350 : 1300;
  const columnWidths = quadroItens ? (() => {
    const larguras = Array.from({ length: cols }, (_, c) => (c < 4 ? fixas[c] : valor));
    larguras[1] = Math.max(1800, larguraUtil - larguras.reduce((a, b) => a + b, 0));
    return larguras;
  })() : undefined;
  const tamanho = quadroItens ? (cols > 8 ? 17 : 19) : 22;
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    ...(columnWidths && { columnWidths, layout: TableLayoutType.FIXED }),
    borders: { top: borda, bottom: borda, left: borda, right: borda, insideHorizontal: borda, insideVertical: borda },
    rows: linhas.map((l, i) => {
      const total = i > 0 && !l[0] && /^\*\*/.test(l[1] ?? "");
      return new TableRow({
        tableHeader: i === 0,
        cantSplit: true,
        children: Array.from({ length: cols }, (_, j) => new TableCell({
          verticalAlign: VerticalAlign.CENTER,
          margins: { top: 40, bottom: 40, left: 70, right: 70 },
          shading: i === 0 ? { type: ShadingType.CLEAR, color: "auto", fill: "E7E7E7" } : total ? { type: ShadingType.CLEAR, color: "auto", fill: "F3F3F3" } : undefined,
          children: [new Paragraph({
            alignment: i === 0 ? AlignmentType.CENTER : ALINHA[alinhamentos[j] ?? "left"],
            children: (l[j] ?? "").split(QUEBRA_NA_CELULA).flatMap((trecho, indice) => [
              ...(indice ? [new TextRun({ break: 1 })] : []),
              // No cabeçalho, o nome do fornecedor sai sem negrito, abaixo de "Cotação N".
              ...runs(trecho, { ...(i === 0 && indice === 0 ? { bold: true } : {}), size: comCotacoes && i === 0 && indice > 0 ? tamanho - 2 : tamanho }),
            ]),
          })],
        })),
      });
    }),
  });
}

type ImagemTimbrado = { dados: Buffer; proporcao: number };
export type Timbrado = { cabecalho: ImagemTimbrado; rodape: ImagemTimbrado };

function imagemTimbrado(imagem: ImagemTimbrado, largura: number) {
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [new ImageRun({
      type: "png", data: imagem.dados,
      transformation: { width: largura, height: Math.round(largura / imagem.proporcao) },
    })],
  });
}

export async function minutaParaDocx(texto: string, titulo: string, timbrado?: Timbrado) {
  const colunasCotacoes = quantidadeColunasCotacoes(texto);
  // Com três cotações ou mais (mais média e valor total), o quadro só cabe sem quebrar valores em página deitada.
  const tamanhoPagina = colunasCotacoes >= 3 ? {
    orientation: PageOrientation.LANDSCAPE,
    width: 11906,
    height: Math.min(31600, Math.max(16838, 9100 + colunasCotacoes * 1400)),
  } : undefined;
  const larguraUtil = (tamanhoPagina?.height ?? 11906) - 1701 - 1134;
  const filhos: (Paragraph | Table)[] = [];
  let tab: string[][] = [];
  let alinhamentos: Alinhamento[] = [];
  let assinatura = false;
  const fechaTabela = () => {
    if (tab.length) { filhos.push(tabela(tab, larguraUtil, alinhamentos)); filhos.push(new Paragraph({ children: [] })); tab = []; alinhamentos = []; }
  };
  for (const bruta of texto.split("\n")) {
    const s = bruta.trim();
    if (s.startsWith("|")) {
      const c = s.replace(/^\||\|$/g, "").split("|").map((x) => x.trim());
      if (c.every((x) => /^:?-{2,}:?$/.test(x))) alinhamentos = c.map((x) => (x.startsWith(":") && x.endsWith(":") ? "center" : x.endsWith(":") ? "right" : undefined));
      else tab.push(c);
      continue;
    }
    fechaTabela();
    if (!s) { assinatura = false; continue; }
    if (s.startsWith("# ")) {
      filhos.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 200 }, children: runs(s.slice(2), { bold: true }) }));
    } else if (s.startsWith("## ")) {
      filhos.push(new Paragraph({ spacing: { before: 240, after: 80 }, children: runs(s.slice(3), { bold: true }) }));
    } else if (s.startsWith("@ ")) {
      filhos.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: assinatura ? 0 : 480 }, children: runs(s.slice(2)) }));
      assinatura = true;
      continue;
    } else if (s.startsWith("Preço de referência: ")) {
      filhos.push(new Paragraph({ spacing: { before: 0, after: 160 }, children: runs(s, { size: 18 }) }));
    } else {
      filhos.push(new Paragraph({ alignment: AlignmentType.JUSTIFIED, spacing: { after: 120, line: 360 }, children: runs(s) }));
    }
    assinatura = false;
  }
  fechaTabela();
  if (!filhos.length) filhos.push(new Paragraph({ children: [] }));
  const doc = new Document({
    title: titulo,
    creator: "Licita",
    styles: { default: { document: { run: { font: FONTE, size: 24 } } } },
    sections: [{
      properties: { page: { size: tamanhoPagina, margin: { top: timbrado ? 2250 : 1418, bottom: 1134, left: 1701, right: 1134, header: 520, footer: 460 } } },
      headers: timbrado ? { default: new Header({ children: [imagemTimbrado(timbrado.cabecalho, 565)] }) } : undefined,
      footers: timbrado ? { default: new Footer({ children: [imagemTimbrado(timbrado.rodape, 565)] }) } : undefined,
      children: filhos,
    }],
  });
  return Packer.toBuffer(doc);
}
