import mammoth from "mammoth";
import { ErroHttp } from "./erros.js";
import { textoDePdf } from "./ia.js";

/** Extrai texto de .docx, .pdf, .txt, .md ou .csv. Tabelas do Word viram linhas "| a | b |". */
export async function extrairTexto(nome: string, buf: Buffer) {
  const n = nome.toLowerCase();
  let texto: string;
  if (n.endsWith(".docx")) {
    const { value: html } = await mammoth.convertToHtml({ buffer: buf });
    texto = htmlParaTexto(html);
  } else if (n.endsWith(".pdf")) {
    texto = await textoDePdf(buf);
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
