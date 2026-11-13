import {
  AlignmentType, BorderStyle, Document, Packer, Paragraph, Table, TableCell, TableRow, TextRun, WidthType,
} from "docx";

// Converte a marcação das minutas em .docx:
//   "# "  título centralizado      "## " seção em negrito
//   "| a | b |" quadro             "@ "  linha de assinatura (centralizada)
//   [[campo]] campo pendente (amarelo)   **texto** negrito
const FONTE = "Times New Roman";

function runs(t: string, extra: { bold?: boolean } = {}): TextRun[] {
  const out: TextRun[] = [];
  const re = /\[\[(.+?)\]\]|\*\*(.+?)\*\*/g;
  let ult = 0, m: RegExpExecArray | null;
  while ((m = re.exec(t))) {
    if (m.index > ult) out.push(new TextRun({ text: t.slice(ult, m.index), font: FONTE, size: 24, ...extra }));
    if (m[1] !== undefined) out.push(new TextRun({ text: m[1], font: FONTE, size: 24, highlight: "yellow", ...extra }));
    else out.push(new TextRun({ text: m[2], font: FONTE, size: 24, bold: true }));
    ult = m.index + m[0].length;
  }
  if (ult < t.length) out.push(new TextRun({ text: t.slice(ult), font: FONTE, size: 24, ...extra }));
  return out;
}

function tabela(linhas: string[][]) {
  const cols = Math.max(...linhas.map((l) => l.length));
  const borda = { style: BorderStyle.SINGLE, size: 4, color: "000000" };
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: { top: borda, bottom: borda, left: borda, right: borda, insideHorizontal: borda, insideVertical: borda },
    rows: linhas.map((l, i) => new TableRow({
      tableHeader: i === 0,
      children: Array.from({ length: cols }, (_, j) => new TableCell({
        children: [new Paragraph({ children: runs(l[j] ?? "", i === 0 ? { bold: true } : {}) })],
      })),
    })),
  });
}

export async function minutaParaDocx(texto: string, titulo: string) {
  const filhos: (Paragraph | Table)[] = [];
  let tab: string[][] = [];
  let assinatura = false;
  const fechaTabela = () => {
    if (tab.length) { filhos.push(tabela(tab)); filhos.push(new Paragraph({ children: [] })); tab = []; }
  };
  for (const bruta of texto.split("\n")) {
    const s = bruta.trim();
    if (s.startsWith("|")) {
      const c = s.replace(/^\||\|$/g, "").split("|").map((x) => x.trim());
      if (!c.every((x) => /^:?-{2,}:?$/.test(x))) tab.push(c);
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
    } else {
      filhos.push(new Paragraph({ alignment: AlignmentType.JUSTIFIED, spacing: { after: 120, line: 360 }, children: runs(s) }));
    }
    assinatura = false;
  }
  fechaTabela();
  const doc = new Document({
    title: titulo,
    creator: "Licita",
    styles: { default: { document: { run: { font: FONTE, size: 24 } } } },
    sections: [{ properties: { page: { margin: { top: 1418, bottom: 1134, left: 1701, right: 1134 } } }, children: filhos }],
  });
  return Packer.toBuffer(doc);
}
