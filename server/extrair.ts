import mammoth from "mammoth";
import readXlsxFile from "read-excel-file/node";
import { ErroHttp } from "./erros.js";
import { iaDisponivel, textoDePdf } from "./ia.js";
import { textoLocalDoPdf } from "./orcamento-pdf.js";

/** Extrai texto de .docx, .pdf, .txt, .md ou .csv. Tabelas do Word viram linhas "| a | b |". */
export async function extrairTexto(nome: string, buf: Buffer) {
  const n = nome.toLowerCase();
  let texto: string;
  if (n.endsWith(".docx")) {
    const { value: html } = await mammoth.convertToHtml({ buffer: buf });
    texto = htmlParaTexto(html);
  } else if (n.endsWith(".xlsx")) {
    const planilhas = await readXlsxFile(buf);
    let restantes = 1000;
    texto = planilhas.flatMap((aba) => {
      if (!restantes) return [];
      const linhas = aba.data.slice(0, restantes);
      restantes -= linhas.length;
      return [`Planilha ${aba.sheet}`, ...linhas.map((linha) =>
        "| " + linha.slice(0, 60).map((v) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? "")).replace(/[|\r\n]+/g, " ").slice(0, 1000)).join(" | ") + " |",
      )];
    }).join("\n");
  } else if (n.endsWith(".pdf")) {
    // PDF com texto: lido no servidor. Só o PDF digitalizado (sem texto) pede a IA, e a falha dela não vira erro interno.
    texto = await textoLocalDoPdf(buf).catch(() => "");
    if (!texto.trim()) {
      if (!iaDisponivel()) throw new ErroHttp(422, "Este PDF não tem texto selecionável (é digitalizado). Anexe a versão em PDF com texto, Word ou planilha.");
      texto = await textoDePdf(buf).catch(() => {
        throw new ErroHttp(422, "Este PDF não tem texto selecionável (é digitalizado) e a leitura por IA não está disponível. Anexe a versão em PDF com texto, Word ou planilha.");
      });
    }
  } else if (/\.(txt|md|csv)$/.test(n)) {
    texto = buf.toString("utf8");
  } else {
    throw new ErroHttp(415, "Formato não aceito. Envie .docx, .pdf, .txt, .md ou .csv.");
  }
  texto = texto.replace(/\r/g, "").replace(/\n{3,}/g, "\n\n").trim();
  if (!texto) throw new ErroHttp(422, "Não foi possível ler texto nesse arquivo.");
  return texto;
}

function htmlParaTexto(html: string) {
  const ent = (s: string) => s.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
  return html
    .replace(/<table[\s\S]*?<\/table>/g, (t) => "\n" + [...t.matchAll(/<tr[\s\S]*?<\/tr>/g)].map((tr) =>
      "| " + [...tr[0].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map((c) => ent(c[1].replace(/<\/p>/g, " ")).replace(/\|/g, "/")).join(" | ") + " |").join("\n") + "\n")
    .replace(/<\/(p|h\d|li)>/g, "\n")
    .replace(/<br\s*\/?>/g, "\n")
    .split("\n").map((l) => (l.startsWith("| ") ? l : ent(l))).join("\n");
}
