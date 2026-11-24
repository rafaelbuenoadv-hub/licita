import { test } from "node:test";
import assert from "node:assert/strict";
import { zipSync, strToU8 } from "fflate";
import { arquivoDoProcessoParaPdf, paginasDoPdfParaWord } from "../arquivo-processo.js";
import { minutaParaPdf } from "../pdf.js";
import { minutaParaDocx } from "../docx.js";
import { textoLocalDoPdf } from "../orcamento-pdf.js";
import { PDFDocument } from "pdf-lib";

// Planilha com duas abas e mais de mil linhas: a exportação não usa o limite do leitor de cotações.
const planilha = () => {
  const arquivos: Record<string, Uint8Array> = {};
  const colocar = (nome: string, xml: string) => { arquivos[nome] = strToU8(xml); };
  colocar('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>');
  colocar('_rels/.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>');
  colocar('xl/workbook.xml', '<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Primeira" sheetId="1" r:id="rId1"/><sheet name="Segunda" sheetId="2" r:id="rId2"/></sheets></workbook>');
  colocar('xl/_rels/workbook.xml.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/></Relationships>');
  const aba = (linhas: string[]) => '<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>'+linhas.map((texto, k) => `<row r="${k + 1}"><c r="A${k + 1}" t="inlineStr"><is><t>${texto}</t></is></c></row>`).join('')+'</sheetData></worksheet>';
  colocar('xl/worksheets/sheet1.xml', aba(Array.from({ length: 1005 }, (_, k) => `LINHA_${k + 1}`)));
  colocar('xl/worksheets/sheet2.xml', aba(['SEGUNDA_ABA_COMPLETA']));
  return Buffer.from(zipSync(arquivos));
};

test("anexos mantêm páginas originais e Word e planilhas são convertidos integralmente sem IA", async () => {
  const original = await minutaParaPdf('# ANEXO\nPDF_ORIGINAL', 'Anexo');
  assert.deepEqual(await arquivoDoProcessoParaPdf('original.pdf', original), original);
  const paginas = await paginasDoPdfParaWord(original);
  assert.equal(paginas.length, 1); assert.ok(paginas[0].width > 0);
  const word = await minutaParaDocx('# Word\nTEXTO_DO_WORD\n| Item | Valor |\n|---|---:|\n| Mesa | 123 |', 'Word');
  const wordPdf = await arquivoDoProcessoParaPdf('apoio.docx', word);
  assert.match(await textoLocalDoPdf(wordPdf), /TEXTO_DO_WORD/);
  const xlsxPdf = await arquivoDoProcessoParaPdf('dados.xlsx', planilha());
  const texto = await textoLocalDoPdf(xlsxPdf);
  assert.match(texto, /LINHA_1005/); assert.match(texto, /SEGUNDA_ABA_COMPLETA/);
  assert.ok((await PDFDocument.load(xlsxPdf)).getPageCount() > 2);
  await assert.rejects(arquivoDoProcessoParaPdf('danificado.docx', Buffer.from([0x50,0x4b,0x03,0x04,0,0,0,0,0,0])), (erro: any) => erro.status === 422 && /danificado.docx/.test(erro.message));
  await assert.rejects(arquivoDoProcessoParaPdf('danificado.pdf', Buffer.from('%PDF-invalido')), /danificado.pdf/);
});
