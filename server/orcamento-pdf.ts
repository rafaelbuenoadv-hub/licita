import { execFile, type ExecFileException } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ErroHttp } from "./erros.js";

function poppler(programa: string, args: string[], pdf: Buffer): Promise<string> {
  return new Promise((resolve, reject) => {
    const processo = execFile(programa, args, {
      encoding: "utf8", timeout: 20_000, maxBuffer: 4 * 1024 * 1024, env: { ...process.env, LC_ALL: "C" },
    }, (erro: ExecFileException | null, stdout, stderr) => {
      if (!erro) { resolve(stdout); return; }
      if (erro.code === "ENOENT") { reject(new ErroHttp(503, "A leitura local de PDF está indisponível no servidor.")); return; }
      if (erro.killed || erro.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") {
        reject(new ErroHttp(422, "A leitura do PDF excedeu o tamanho ou o tempo disponível. Envie só as páginas da proposta."));
        return;
      }
      const protegido = /password/i.test(stderr);
      reject(new ErroHttp(422, protegido
        ? "Este PDF exige senha. Anexe uma cópia que abra sem senha."
        : "Não foi possível ler a estrutura deste PDF. Abra o arquivo e anexe uma nova cópia da proposta."));
    });
    // O leitor pode encerrar antes de receber todo o arquivo se o PDF não abrir.
    processo.stdin?.on("error", () => {});
    processo.stdin?.end(pdf);
  });
}

export async function textoLocalDoPdf(pdf: Buffer) {
  return (await poppler("pdftotext", ["-layout", "-enc", "UTF-8", "-", "-"], pdf)).replace(/\0/g, "").trim();
}

export async function imagensLocaisDoPdf(pdf: Buffer) {
  const pasta = await mkdtemp(join(tmpdir(), "licita-orcamento-"));
  try {
    // A requisição visual usa até 100 imagens. A página extra serve apenas para detectar excesso.
    await poppler("pdftoppm", ["-jpeg", "-jpegopt", "quality=78", "-scale-to", "1800", "-l", "101", "-", join(pasta, "pagina")], pdf);
    const nomes = (await readdir(pasta)).filter((nome) => /^pagina-\d+\.jpg$/.test(nome))
      .sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
    let tamanho = 0;
    for (const nome of nomes) tamanho += (await stat(join(pasta, nome))).size;
    // Reserva margem para codificação base64 e instruções quando o provedor limita o corpo a 32 MB.
    if (nomes.length > 100 || tamanho > 22_000_000) throw new ErroHttp(422, "A versão digitalizada é muito grande para ler de uma vez. Envie só as páginas da proposta.");
    if (!nomes.length) throw new ErroHttp(422, "Nenhuma página do PDF pôde ser aberta.");
    return await Promise.all(nomes.map((nome) => readFile(join(pasta, nome))));
  } finally {
    await rm(pasta, { recursive: true, force: true });
  }
}
