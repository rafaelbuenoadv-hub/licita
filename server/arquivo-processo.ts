// Conversão local dos anexos: sem IA e sem enviar os arquivos para outro serviço.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, extname } from "node:path";
import { pathToFileURL } from "node:url";
import { PDFDocument } from "pdf-lib";
import sharp from "sharp";
import { tipoPeloConteudo } from "./arquivo-para-ia.js";
import { minutaParaPdf } from "./pdf.js";
import { ErroHttp } from "./erros.js";

const executar = promisify(execFile);
const opcoes = { timeout: 120_000, maxBuffer: 8 * 1024 * 1024 };

export async function arquivoDoProcessoParaPdf(nome: string, arquivo: Buffer): Promise<Buffer> {
  try {
    const tipo = tipoPeloConteudo(arquivo);
    if (tipo === "pdf") return await pdfEmRetrato(arquivo);
    if (tipo !== "outro") {
      const png = await sharp(arquivo).rotate().png().toBuffer();
      const pdf = await PDFDocument.create(), imagem = await pdf.embedPng(png);
      const pg = pdf.addPage([595.28, 841.89]);
      const escala = Math.min((pg.getWidth() - 50) / imagem.width, (pg.getHeight() - 50) / imagem.height);
      const width = imagem.width * escala, height = imagem.height * escala;
      pg.drawImage(imagem, { x: (pg.getWidth() - width) / 2, y: (pg.getHeight() - height) / 2, width, height });
      return Buffer.from(await pdf.save());
    }
    if (/\.(txt|md|csv)$/i.test(nome)) return minutaParaPdf(`# ${nome.replace(/[\r\n]/g, " ")}\n\n${arquivo.toString("utf8")}`, nome);
    if (/\.(docx|xlsx|xls)$/i.test(nome)) {
      const pasta = await mkdtemp(join(tmpdir(), "licita-conversao-"));
      try {
        const perfil = join(pasta, "perfil"); await mkdir(perfil);
        await writeFile(join(perfil, "registrymodifications.xcu"), '<?xml version="1.0"?><oor:items xmlns:oor="http://openoffice.org/2001/registry"><item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="MacroSecurityLevel" oor:op="fuse"><value>3</value></prop></item></oor:items>');
        const entrada = join(pasta, `anexo${extname(nome).toLowerCase()}`);
        await writeFile(entrada, arquivo);
        await executar("soffice", [`-env:UserInstallation=${pathToFileURL(perfil).href}`, "--headless", "--nologo", "--nodefault", "--norestore", "--convert-to", "pdf", "--outdir", pasta, entrada], opcoes);
        const pdf = await readFile(join(pasta, "anexo.pdf"));
        return await pdfEmRetrato(pdf);
      } finally { await rm(pasta, { recursive: true, force: true }); }
    }
  } catch (erro) {
    if ((erro as NodeJS.ErrnoException).code === "ENOENT" && (erro as NodeJS.ErrnoException).syscall?.startsWith("spawn")) throw new ErroHttp(503, "A conversão de Word e planilhas está indisponível no servidor. Tente novamente após a atualização.");
    throw new ErroHttp(422, `Não foi possível juntar o anexo “${nome}”. Confira se o arquivo abre sem senha e anexe uma cópia válida. Nenhum arquivo foi omitido da exportação.`);
  }
  throw new ErroHttp(422, `O formato de “${nome}” não pode ser exibido no processo completo. Converta esse arquivo para PDF e anexe novamente.`);
}

export async function paginasDoPdfParaWord(arquivo: Buffer) {
  const pasta = await mkdtemp(join(tmpdir(), "licita-paginas-"));
  try {
    const entrada = join(pasta, "anexo.pdf"); await writeFile(entrada, arquivo);
    await executar("pdftoppm", ["-jpeg", "-jpegopt", "quality=86", "-scale-to", "1800", entrada, join(pasta, "pagina")], opcoes);
    const nomes = (await readdir(pasta)).filter((n) => /^pagina-\d+\.jpg$/.test(n)).sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
    if (!nomes.length) throw new Error("PDF sem páginas");
    const paginas = [];
    for (const nome of nomes) {
      const data = await readFile(join(pasta, nome));
      const { width, height } = await sharp(data).metadata();
      paginas.push({ data, width: width!, height: height! });
    }
    return paginas;
  } catch { throw new ErroHttp(422, "Não foi possível preparar todas as páginas dos anexos para Word. Tente o PDF completo ou confira os anexos."); }
  finally { await rm(pasta, { recursive: true, force: true }); }
}

/** Cópia de impressão em retrato. O original permanece incorporado ao processo completo. */
export async function pdfEmRetrato(arquivo: Buffer): Promise<Buffer> {
  const origem=await PDFDocument.load(arquivo);
  const paisagem=origem.getPages().map((pg)=>{
    const girada=Math.abs(pg.getRotation().angle)%180===90;
    return girada ? pg.getHeight()>pg.getWidth() : pg.getWidth()>pg.getHeight();
  });
  if(!paisagem.some(Boolean)) return arquivo;
  // Renderiza a aparência completa, inclusive anotações, somente nas folhas que precisam de ajuste.
  const imagens=await paginasDoPdfParaWord(arquivo), pdf=await PDFDocument.create();
  for(const [i,larga] of paisagem.entries()){
    if(!larga){ pdf.addPage((await pdf.copyPages(origem,[i]))[0]);continue; }
    const imagem=await pdf.embedJpg(imagens[i].data), pg=pdf.addPage([595.28,841.89]);
    const escala=Math.min(545.28/imagem.width,791.89/imagem.height);
    const width=imagem.width*escala,height=imagem.height*escala;
    pg.drawImage(imagem,{x:(pg.getWidth()-width)/2,y:(pg.getHeight()-height)/2,width,height});
  }
  return Buffer.from(await pdf.save());
}
