// PDF completo da Solicitação: o documento, seguido dos orçamentos dos fornecedores e, na sequência,
// dos comprovantes das consultas ao PNCP (na ordem em que aparecem nos itens).
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import sharp from "sharp";
import { extrairTexto } from "./extrair.js";
import { tipoPeloConteudo } from "./arquivo-para-ia.js";
import type { ItemSolicitacao } from "../shared/solicitacao.js";

export interface AnexoSolicitacao { id: number; nome: string; arquivo: Buffer }
interface Entrada { codigo: string; grupo: "apoio" | "orcamento" | "pncp"; fornecedor: string; nome: string; arquivo: Buffer }

/** Orçamentos vinculados às cotações dos itens: primeiro os de fornecedores e outras fontes, depois os do PNCP. */
export function ordemDosAnexos(itens: ItemSolicitacao[], arquivos: AnexoSolicitacao[], apoios: AnexoSolicitacao[] = []) {
  const porId = new Map(arquivos.map((a) => [a.id, a]));
  const vistos = new Set<number>();
  const orcamentos: Omit<Entrada, "codigo">[] = [], pncp: Omit<Entrada, "codigo">[] = [];
  for (const item of itens) for (const c of item.cotacoes ?? []) {
    if (c.orcamento_id == null || vistos.has(c.orcamento_id)) continue;
    const a = porId.get(c.orcamento_id);
    if (!a) continue;
    vistos.add(c.orcamento_id);
    (c.fonte === "pncp" ? pncp : orcamentos).push({ grupo: c.fonte === "pncp" ? "pncp" : "orcamento", fornecedor: c.fornecedor, nome: a.nome, arquivo: a.arquivo });
  }
  return [...apoios.map((a, i) => ({ ...a, grupo: "apoio" as const, fornecedor: a.nome, codigo: `D${i + 1}` })), ...orcamentos.map((a, i) => ({ ...a, codigo: `A${i + 1}` })), ...pncp.map((a, i) => ({ ...a, codigo: `B${i + 1}` }))] as Entrada[];
}

// As fontes padrão do PDF só escrevem WinAnsi: troca o que não cabe nela.
const seguro = (t: string) => t.replace(/[‐‑‒―]/g, "-").replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/…/g, "...").replace(/[^\x20-\x7E\xA0-\xFF—–·•]/g, "");

function quebrar(texto: string, fonte: PDFFont, tamanho: number, largura: number) {
  const linhas: string[] = [];
  let linha = "";
  for (const palavra of seguro(texto).split(/\s+/)) {
    const tentativa = linha ? `${linha} ${palavra}` : palavra;
    if (fonte.widthOfTextAtSize(tentativa, tamanho) > largura && linha) { linhas.push(linha); linha = palavra; }
    else linha = tentativa;
  }
  if (linha) linhas.push(linha);
  return linhas;
}

function escrever(pagina: PDFPage, fonte: PDFFont, texto: string, x: number, y: number, tamanho: number, largura: number) {
  for (const l of quebrar(texto, fonte, tamanho, largura)) { pagina.drawText(l, { x, y, size: tamanho, font: fonte }); y -= tamanho * 1.35; }
  return y;
}

/** Faixa no alto da primeira página de cada anexo, para identificá-lo nos autos. */
function rotular(pagina: PDFPage, fonte: PDFFont, texto: string) {
  const { width, height } = pagina.getSize();
  const tamanho = 9;
  const t = quebrar(texto, fonte, tamanho, width - 40)[0] ?? "";
  pagina.drawRectangle({ x: 0, y: height - 22, width, height: 22, color: rgb(1, 1, 0.85), opacity: 0.92 });
  pagina.drawText(t, { x: 20, y: height - 15, size: tamanho, font: fonte, color: rgb(0.1, 0.1, 0.1) });
}

export async function solicitacaoCompleta(documento: Buffer, entradas: Entrada[]) {
  const pdf = await PDFDocument.load(documento);
  if (!entradas.length) return Buffer.from(await pdf.save());
  const normal = await pdf.embedFont(StandardFonts.Helvetica), negrito = await pdf.embedFont(StandardFonts.HelveticaBold);
  const A4: [number, number] = [595.28, 841.89];
  const titulo = (e: Entrada) => `Anexo ${e.codigo} — ${e.grupo === "apoio" ? "Documento de apoio" : e.grupo === "pncp" ? "Consulta ao PNCP" : "Orçamento"}: ${e.fornecedor || e.nome}`;

  // Índice dos anexos.
  let pagina = pdf.addPage(A4);
  let y = A4[1] - 70;
  pagina.drawText(seguro("ANEXOS DA SOLICITAÇÃO"), { x: 60, y, size: 15, font: negrito }); y -= 30;
  for (const [grupo, nome] of [["apoio", "D — Documentos de apoio"], ["orcamento", "A — Orçamentos de fornecedores e outras fontes"], ["pncp", "B — Consultas ao PNCP"]] as const) {
    const lista = entradas.filter((e) => e.grupo === grupo);
    if (!lista.length) continue;
    y = escrever(pagina, negrito, nome, 60, y, 11, A4[0] - 120) - 4;
    for (const e of lista) {
      if (y < 80) { pagina = pdf.addPage(A4); y = A4[1] - 70; }
      y = escrever(pagina, normal, `${e.codigo}. ${e.fornecedor || "—"} (arquivo: ${e.nome})`, 72, y, 10, A4[0] - 140) - 3;
    }
    y -= 12;
  }

  for (const e of entradas) {
    const tipo = tipoPeloConteudo(e.arquivo);
    // O original acompanha o PDF, inclusive quando seu formato não permite copiar as páginas.
    if (e.grupo === "apoio") await pdf.attach(e.arquivo, `${e.codigo}-${e.nome}`, { description: `Documento de apoio original: ${e.nome}` });
    try {
      if (tipo === "pdf") {
        const origem = await PDFDocument.load(e.arquivo, { ignoreEncryption: true });
        const paginas = await pdf.copyPages(origem, origem.getPageIndices());
        paginas.forEach((pg, i) => { pdf.addPage(pg); if (i === 0 && e.grupo !== "apoio") rotular(pg, negrito, titulo(e)); });
        continue;
      }
      if (tipo !== "outro") {
        const png = tipo === "png" ? e.arquivo : await sharp(e.arquivo).rotate().png().toBuffer();
        const imagem = await pdf.embedPng(png);
        const escala = Math.min((A4[0] - 60) / imagem.width, (A4[1] - 90) / imagem.height, 1);
        const pg = pdf.addPage(A4);
        const w = imagem.width * escala, h = imagem.height * escala;
        pg.drawImage(imagem, { x: (A4[0] - w) / 2, y: A4[1] - 40 - h, width: w, height: h });
        rotular(pg, negrito, titulo(e));
        continue;
      }
    } catch { /* cai no aviso abaixo */ }
    if (e.grupo === "apoio" && /\.(docx|xlsx|txt|md|csv)$/i.test(e.nome)) {
      try {
        const texto = await extrairTexto(e.nome, e.arquivo);
        let pg = pdf.addPage(A4), yTexto = A4[1] - 65;
        rotular(pg, negrito, titulo(e));
        yTexto = escrever(pg, normal, "Versão em texto. O arquivo original está incluído nos anexos deste PDF.", 60, yTexto, 10, A4[0] - 120) - 15;
        for (const linha of texto.split("\n")) {
          const linhas = quebrar(linha, normal, 10, A4[0] - 120);
          if (!linhas.length) yTexto -= 7;
          for (const trecho of linhas) {
            if (yTexto < 55) { pg = pdf.addPage(A4); rotular(pg, negrito, titulo(e)); yTexto = A4[1] - 65; }
            pg.drawText(trecho, { x: 60, y: yTexto, size: 10, font: normal }); yTexto -= 14;
          }
        }
        continue;
      } catch { /* O original continua incorporado e será identificado na página de aviso. */ }
    }
    // Word, planilha, texto ou arquivo ilegível: página de aviso, com o arquivo disponível no sistema.
    const pg = pdf.addPage(A4);
    rotular(pg, negrito, titulo(e));
    escrever(pg, normal, e.grupo === "apoio" ? `Não foi possível exibir as páginas de "${e.nome}". O arquivo original está incorporado nos anexos deste PDF e permanece disponível nos documentos de apoio da solicitação.` : `O arquivo "${e.nome}" não pode ser incorporado a este PDF (formato não suportado ou arquivo protegido). O original está guardado no processo, junto aos orçamentos.`, 60, A4[1] - 80, 11, A4[0] - 120);
  }
  return Buffer.from(await pdf.save());
}
