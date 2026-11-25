import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { unzipSync, strFromU8 } from 'fflate';
import { PDFDocument, StandardFonts, degrees } from 'pdf-lib';
import sharp from 'sharp';
import { minutaParaPdf } from '../pdf.js';
import { minutaParaDocx } from '../docx.js';
import { arquivoDoProcessoParaPdf } from '../arquivo-processo.js';
import { textoLocalDoPdf } from '../orcamento-pdf.js';
import { partesDaTabela } from '../../shared/tabelas-retrato.js';

const paragrafo='A contratação atende às necessidades das secretarias municipais, com especificações e quantidades definidas no planejamento. Os preços pesquisados serão analisados conforme a memória de cálculo e os documentos de apoio, preservando os registros da pesquisa e as justificativas dos responsáveis. ';
const cabecalho=['Item','Descrição','Unidade','Quantidade',...Array.from({length:12},(_,i)=>`Cotação ${i+1}\u2028Fornecedor ${i+1}`),'Média','Total'];
const valores=Array.from({length:12},(_,i)=>`R$ ${100+i},00`);
const linhas=[cabecalho,['1','Serviço de manutenção preventiva com fornecimento de materiais e mão de obra, conforme especificações técnicas.','UN','10',...valores,'R$ 105,50','R$ 1.055,00']];
const texto=`# PESQUISA DE PREÇOS\n\n${paragrafo.repeat(2)}\n\n## Mapa comparativo\n\n${[cabecalho,cabecalho.map(()=> '---'),linhas[1]].map(l=>'| '+l.join(' | ')+' |').join('\n')}\n\nValores descartados: ~~R$ 999,00~~ — justificativa registrada.\n\n@ Responsável pela pesquisa\n@ Secretaria Municipal`;

test('documentos justificados e tabelas largas preservam cotações em A4 retrato',async()=>{
  const partes=partesDaTabela(linhas);assert.equal(partes.length,3);
  assert.ok(partes.every(p=>p.linhas[0].length<=11 && p.linhas[0][0]==='Item'));
  for(let i=1;i<=12;i++)assert.ok(partes.some(p=>p.linhas[0].some(c=>c.startsWith(`Cotação ${i}\u2028`))));
  const pdf=await minutaParaPdf(texto,'Pesquisa'),docx=await minutaParaDocx(texto,'Pesquisa');
  for(const pg of (await PDFDocument.load(pdf)).getPages()){assert.ok(pg.getWidth()<pg.getHeight());assert.ok(Math.abs(pg.getWidth()-595.28)<.1);}
  const extraido=await textoLocalDoPdf(pdf);
  for(let i=0;i<12;i++)assert.ok(extraido.includes(`R$ ${100+i},00`));
  assert.match(extraido,/parte 3 de 3/);
  const xml=strFromU8(unzipSync(docx)['word/document.xml']);
  assert.match(xml,/<w:jc w:val="both"/);assert.doesNotMatch(xml,/landscape/);assert.match(xml,/w:orient="portrait"/);
  for(const grid of xml.matchAll(/<w:tblGrid>(.*?)<\/w:tblGrid>/g)) assert.equal([...grid[1].matchAll(/w:w="(\d+)"/g)].reduce((s,m)=>s+Number(m[1]),0),9071);
  for(const v of valores)assert.ok(xml.includes(v));
  if(process.env.LICITA_QA_DIR){writeFileSync(`${process.env.LICITA_QA_DIR}/retrato-qa.pdf`,pdf);writeFileSync(`${process.env.LICITA_QA_DIR}/retrato-qa.docx`,docx);}
});

test('cópias para impressão ajustam anexos em paisagem e imagens à folha em retrato',async()=>{
  const origem=await PDFDocument.create(),f=await origem.embedFont(StandardFonts.Helvetica);
  origem.addPage([842,595]).drawText('QUADRO COMPLETO',{x:30,y:300,font:f});
  origem.addPage([595,842]).setRotation(degrees(90));
  origem.addPage([595,842]).drawText('PAGINA EM RETRATO',{x:30,y:700,font:f});
  const convertido=await arquivoDoProcessoParaPdf('paisagem.pdf',Buffer.from(await origem.save()));
  const paginas=(await PDFDocument.load(convertido)).getPages();assert.equal(paginas.length,3);
  assert.ok(paginas.every(p=>p.getWidth()<p.getHeight() && p.getRotation().angle===0));
  assert.match(await textoLocalDoPdf(convertido),/PAGINA EM RETRATO/);
  const png=await sharp({create:{width:1600,height:700,channels:3,background:'#cee'}}).png().toBuffer();
  const foto=await PDFDocument.load(await arquivoDoProcessoParaPdf('foto.png',png));
  assert.ok(foto.getPage(0).getWidth()<foto.getPage(0).getHeight());
  if(process.env.LICITA_QA_DIR)writeFileSync(`${process.env.LICITA_QA_DIR}/anexo-retrato-qa.pdf`,convertido);
});
