import sharp from "sharp";
import { ErroHttp } from "./erros.js";

// Prepara o arquivo de um orçamento para a IA. O tipo é identificado pelo conteúdo, não pelo nome:
// foto de celular salva como ".jpg" que na verdade é PNG ou HEIC era recusada pela API.
export type TipoArquivo = "pdf" | "png" | "jpeg" | "gif" | "webp" | "outro";

export function tipoPeloConteudo(buf: Buffer): TipoArquivo {
  if (buf.subarray(0, 5).toString("latin1") === "%PDF-") return "pdf";
  if (buf.length > 8 && buf[0] === 0x89 && buf.subarray(1, 4).toString("latin1") === "PNG") return "png";
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpeg";
  if (buf.subarray(0, 4).toString("latin1") === "GIF8") return "gif";
  if (buf.subarray(0, 4).toString("latin1") === "RIFF" && buf.subarray(8, 12).toString("latin1") === "WEBP") return "webp";
  return "outro";
}

const LIMITE_IMAGEM = 3_600_000; // a API aceita até 5 MB por imagem já em base64 (~3,7 MB de arquivo)
const LADO_MAXIMO = 2400;
const LIMITE_PDF = 30 * 1024 * 1024;

/** Imagem dentro dos limites da API: reduzida e convertida para JPEG quando é grande ou de formato não aceito. */
export async function imagemParaIA(buf: Buffer, tipo: TipoArquivo): Promise<{ dados: Buffer; tipo: "image/png" | "image/jpeg" | "image/gif" | "image/webp" }> {
  if (tipo !== "outro" && tipo !== "pdf" && buf.length <= LIMITE_IMAGEM) {
    // Formato aceito e tamanho dentro do limite: segue como está, salvo se as dimensões passarem do máximo da API.
    const meta = await sharp(buf).metadata().catch(() => null);
    if (!meta || ((meta.width ?? 0) <= 8000 && (meta.height ?? 0) <= 8000)) return { dados: buf, tipo: `image/${tipo}` };
  }
  try {
    const dados = await sharp(buf, { failOn: "none" }).rotate().resize({ width: LADO_MAXIMO, height: LADO_MAXIMO, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 82 }).toBuffer();
    return { dados, tipo: "image/jpeg" };
  } catch {
    throw new ErroHttp(415, "Não foi possível abrir esta imagem. Se for foto do iPhone (HEIC), salve como JPG ou PDF e anexe de novo.");
  }
}

export function conferirPdf(buf: Buffer) {
  if (buf.length > LIMITE_PDF) throw new ErroHttp(413, "O PDF passa de 30 MB. Envie só as páginas da proposta ou uma versão compactada.");
}
