import { PDFDocument } from "pdf-lib";
import { ErroHttp } from "./erros.js";

export async function lerPdf(arquivo: Buffer) {
  if (!arquivo.subarray(0, 1024).includes(Buffer.from("%PDF-"))) throw new ErroHttp(415, "Envie um arquivo PDF.");
  try {
    const pdf = await PDFDocument.load(arquivo, { updateMetadata: false, throwOnInvalidObject: true });
    if (pdf.getPageCount() > 0) return pdf;
  } catch {
    throw new ErroHttp(422, "O PDF está protegido ou não pôde ser lido. Envie uma cópia PDF legível e sem senha.");
  }
  throw new ErroHttp(422, "O PDF não contém páginas.");
}

export async function* trechosPdf(arquivo: Buffer) {
  const original = await lerPdf(arquivo);
  const total = original.getPageCount();
  const paginasPorTrecho = 40;
  for (let inicio = 0; inicio < total; inicio += paginasPorTrecho) {
    const fim = Math.min(total, inicio + paginasPorTrecho);
    if (inicio === 0 && fim === total) {
      yield { arquivo, inicio: 1, fim };
      return;
    }
    const parte = await PDFDocument.create();
    const paginas = await parte.copyPages(original, Array.from({ length: fim - inicio }, (_, i) => inicio + i));
    for (const pagina of paginas) parte.addPage(pagina);
    yield { arquivo: Buffer.from(await parte.save()), inicio: inicio + 1, fim };
  }
}
