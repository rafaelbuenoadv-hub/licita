import { partesDaTabela } from "../shared/tabelas-retrato.js";
import {
  type ISectionOptions, AlignmentType, BorderStyle, Document, ShadingType, VerticalAlign, Footer, Header, ImageRun, Packer, PageOrientation, Paragraph, Table, TableCell, TableLayoutType, TableRow, TextRun, WidthType,
} from "docx";
import { QUEBRA_NA_CELULA } from "../shared/solicitacao.js";

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
  const comCotacoes = quadroItens && linhas[0].some((c)=>/^Cotação \d+(?:\s|$)/.test(c));
  // Quadro de itens: colunas estreitas fixas (item, unidade, quantidade), valores com largura suficiente
  // para "R$ 999.999,99" numa linha, e o restante para a descrição.
  const fixas = [650, 0, 820, 850];
  const pesos = quadroItens ? (()=>{
    const larguras=Array.from({length:cols},(_,c)=>c<4 ? fixas[c] : 1240);
    larguras[1]=Math.max(2200,larguraUtil-larguras.reduce((a,b)=>a+b,0));return larguras;
  })() : Array.from({length:cols},(_,c)=>Math.sqrt(Math.max(6,Math.min(150,Math.max(...linhas.map((l)=>(l[c]??"").length))))));
  const soma=pesos.reduce((a,b)=>a+b,0);
  const columnWidths=pesos.map((p)=>Math.floor(p/soma*larguraUtil));
  columnWidths[columnWidths.length-1]+=larguraUtil-columnWidths.reduce((a,b)=>a+b,0);
  const tamanho=cols>9 ? 15 : quadroItens ? 19 : 22;
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    columnWidths, layout: TableLayoutType.FIXED,
    borders: { top: borda, bottom: borda, left: borda, right: borda, insideHorizontal: borda, insideVertical: borda },
    rows: linhas.map((l, i) => {
      const total = i > 0 && !l[0] && /^\*\*/.test(l[1] ?? "");
      return new TableRow({
        tableHeader: i === 0,
        cantSplit: i === 0,
        children: Array.from({ length: cols }, (_, j) => new TableCell({
          width: {size:columnWidths[j],type:WidthType.DXA},
          verticalAlign: VerticalAlign.CENTER,
          margins: { top: 40, bottom: 40, left: cols>9 ? 40 : 70, right: cols>9 ? 40 : 70 },
          shading: i === 0 ? { type: ShadingType.CLEAR, color: "auto", fill: "E7E7E7" } : total ? { type: ShadingType.CLEAR, color: "auto", fill: "F3F3F3" } : undefined,
          children: [new Paragraph({
            wordWrap: true,
            alignment: i === 0 ? AlignmentType.CENTER : ALINHA[alinhamentos[j] ?? "left"],
            children: (l[j] ?? "").split(QUEBRA_NA_CELULA).flatMap((trecho, indice) => [
              ...(indice ? [new TextRun({ break: 1 })] : []),
              // No cabeçalho, o nome do fornecedor sai sem negrito, abaixo de "Cotação N".
              ...runs(trecho, { ...(i === 0 && indice === 0 ? { bold: true } : {}), size: comCotacoes && i === 0 && indice > 0 ? Math.max(15,tamanho-2) : tamanho }),
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

export function secaoDaMinuta(texto: string, timbrado?: Timbrado): ISectionOptions {
  const tamanhoPagina={width:11906,height:16838,orientation:PageOrientation.PORTRAIT};
  const larguraUtil=11906-1701-1134;
  const filhos: (Paragraph | Table)[] = [];
  let tab: string[][] = [];
  let alinhamentos: Alinhamento[] = [];
  let assinatura = false;
  const fechaTabela = () => {
    if (tab.length) {
      const partes=partesDaTabela(tab,alinhamentos);
      for(const [i,parte] of partes.entries()){
        if(partes.length>1) filhos.push(new Paragraph({keepNext:true,children:runs(`Quadro — parte ${i+1} de ${partes.length}`,{bold:true,size:18})}));
        filhos.push(tabela(parte.linhas,larguraUtil,parte.alinhamentos as Alinhamento[]));
        filhos.push(new Paragraph({children:[]}));
      }
      tab=[];alinhamentos=[];
    }
  };
  const linhas = texto.split("\n");
  for (const [indice, bruta] of linhas.entries()) {
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
      filhos.push(new Paragraph({ alignment: AlignmentType.CENTER, keepNext: true, spacing: { after: 200 }, children: runs(s.slice(2), { bold: true }) }));
    } else if (s.startsWith("## ")) {
      filhos.push(new Paragraph({ keepNext: true, spacing: { before: 240, after: 80 }, children: runs(s.slice(3), { bold: true }) }));
    } else if (s.startsWith("@ ")) {
      filhos.push(new Paragraph({ alignment: AlignmentType.CENTER, keepNext: linhas[indice + 1]?.trim().startsWith("@ ") ?? false, spacing: { before: assinatura ? 0 : 480 }, children: runs(s.slice(2)) }));
      assinatura = true;
      continue;
    } else if (s.startsWith("Preço de referência: ")) {
      filhos.push(new Paragraph({ alignment: AlignmentType.JUSTIFIED, spacing: { before: 0, after: 160 }, children: runs(s, { size: 18 }) }));
    } else {
      filhos.push(new Paragraph({ alignment: AlignmentType.JUSTIFIED, spacing: { after: 120, line: 360 }, children: runs(s) }));
    }
    assinatura = false;
  }
  fechaTabela();
  if (!filhos.length) filhos.push(new Paragraph({ children: [] }));
  return {
    properties: { page: { size: tamanhoPagina, margin: { top: timbrado ? 2250 : 1418, bottom: 1134, left: 1701, right: 1134, header: 520, footer: 460 } } },
    headers: timbrado ? { default: new Header({ children: [imagemTimbrado(timbrado.cabecalho, 565)] }) } : undefined,
    footers: timbrado ? { default: new Footer({ children: [imagemTimbrado(timbrado.rodape, 565)] }) } : undefined,
    children: filhos,
  };
}

export async function minutaParaDocx(texto: string, titulo: string, timbrado?: Timbrado) {
  return Packer.toBuffer(new Document({
    title: titulo, creator: "Licita",
    styles: { default: { document: { run: { font: FONTE, size: 24 } } } },
    sections: [secaoDaMinuta(texto, timbrado)],
  }));
}
