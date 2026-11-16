import PDFDocument from "pdfkit";
import { quantidadeColunasCotacoes } from "../shared/solicitacao.js";
import type { Timbrado } from "./docx.js";

type Trecho = { texto: string; negrito: boolean; pendente: boolean; largura: number };
const MARGEM = 54;
const NORMAL = "Times-Roman";
const NEGRITO = "Times-Bold";

export async function minutaParaPdf(texto: string, titulo: string, timbrado?: Timbrado) {
  const colunasCotacoes = quantidadeColunasCotacoes(texto);
  // Mantém uma única linha por item mesmo nos quadros com muitas cotações.
  const size: [number, number] | "A4" = colunasCotacoes > 3
    ? [Math.min(14_000, Math.max(842, 455 + colunasCotacoes * 70)), 595.28]
    : "A4";
  const doc = new PDFDocument({ size, margin: MARGEM, bufferPages: true, info: { Title: titulo, Creator: "Licita" } });
  const blocos: Buffer[] = [];
  const resultado = new Promise<Buffer>((resolve, reject) => {
    doc.on("data", (bloco: Buffer) => blocos.push(bloco));
    doc.on("error", reject);
    doc.on("end", () => resolve(Buffer.concat(blocos)));
  });

  const largura = doc.page.width - 2 * MARGEM;
  const alturaImagem = (imagem: Timbrado["cabecalho"], max: number) => Math.min(largura / imagem.proporcao, max);
  const alturaCabecalho = timbrado ? alturaImagem(timbrado.cabecalho, 104) : 0;
  const alturaRodape = timbrado ? alturaImagem(timbrado.rodape, 68) : 0;
  const topo = alturaCabecalho ? 30 + alturaCabecalho + 18 : MARGEM;
  const fim = doc.page.height - (alturaRodape ? 48 + alturaRodape : MARGEM);
  let y = topo;

  function novaPagina() {
    doc.addPage();
    y = topo;
  }

  function quebrar(valor: string, max: number, tamanho: number, negrito = false): Trecho[][] {
    const linhas: Trecho[][] = [[]];
    let soma = 0;
    const novaLinha = () => { linhas.push([]); soma = 0; };
    const partes = valor.split(/(\[\[.+?\]\]|\*\*.+?\*\*)/g);
    for (const parte of partes) {
      const pendente = parte.startsWith("[[") && parte.endsWith("]]");
      const forte = parte.startsWith("**") && parte.endsWith("**");
      const conteudo = pendente || forte ? parte.slice(2, -2) : parte;
      const bold = negrito || forte;
      doc.font(bold ? NEGRITO : NORMAL).fontSize(tamanho);
      const inserir = (palavra: string, medida: number) => {
        if (soma + medida > max && soma > 0) novaLinha();
        if (soma === 0 && !palavra.trim()) return;
        linhas.at(-1)!.push({ texto: palavra, negrito: bold, pendente, largura: medida });
        soma += medida;
      };
      for (const palavra of conteudo.match(/\S+|\s+/g) ?? []) {
        const token = palavra.trim() ? palavra : " ";
        const medida = doc.widthOfString(token);
        if (medida <= max) inserir(token, medida);
        else for (const letra of token) inserir(letra, doc.widthOfString(letra));
      }
    }
    return linhas.map((linha) => {
      if (linha.at(-1)?.texto === " ") linha.pop();
      const trechos: Trecho[] = [];
      for (const trecho of linha) {
        const anterior = trechos.at(-1);
        if (anterior && anterior.negrito === trecho.negrito && anterior.pendente === trecho.pendente) {
          anterior.texto += trecho.texto;
          anterior.largura += trecho.largura;
        } else trechos.push(trecho);
      }
      return trechos;
    });
  }

  function escrever(linha: Trecho[], x: number, yy: number, tamanho: number) {
    for (const trecho of linha) {
      if (trecho.pendente && trecho.largura > 0) doc.rect(x, yy, trecho.largura, tamanho + 2).fill("#fff176");
      doc.fillColor("#171717").font(trecho.negrito ? NEGRITO : NORMAL).fontSize(tamanho)
        .text(trecho.texto, x, yy, { lineBreak: false });
      x += trecho.largura;
    }
  }

  function quadro(linhas: string[][]) {
    const colunas = Math.max(...linhas.map((linha) => linha.length));
    const tamanho = 10;
    const altura = 13;
    const espaco = 4;
    const quadroComCotacoes = colunas > 6 && linhas[0][0] === "Item" && linhas[0][1] === "Descrição";
    const pesos = Array.from({ length: colunas }, (_, c) => {
      const minimo = quadroComCotacoes && c >= 4 ? 15 : 6;
      const maximo = linhas.reduce((max, linha) => Math.max(max, linha[c]?.replace(/\*\*/g, "").length ?? 0), 0);
      return Math.sqrt(Math.max(minimo, Math.min(150, maximo)));
    });
    const totalPesos = pesos.reduce((soma, peso) => soma + peso, 0);
    let colunaX = MARGEM;
    const posicoes = pesos.map((peso) => {
      const larguraColuna = largura * peso / totalPesos;
      const posicao = { x: colunaX, largura: larguraColuna };
      colunaX += larguraColuna;
      return posicao;
    });
    for (const [i, linha] of linhas.entries()) {
      const celulas = Array.from({ length: colunas }, (_, c) =>
        quebrar(linha[c] ?? "", Math.max(1, posicoes[c].largura - 2 * espaco), tamanho, i === 0));
      const total = Math.max(...celulas.map((celula) => celula.length));
      // Preserve a linha inteira quando couber em uma página. Linhas maiores seguem na página seguinte.
      const alturaLinha = total * altura + 2 * espaco;
      if (alturaLinha <= fim - topo && y + alturaLinha > fim) novaPagina();
      for (let inicio = 0; inicio < total;) {
        if (y + altura + 2 * espaco > fim) novaPagina();
        const quantidade = Math.min(total - inicio, Math.floor((fim - y - 2 * espaco) / altura));
        const bloco = quantidade * altura + 2 * espaco;
        celulas.forEach((celula, c) => {
          const { x, largura: larguraColuna } = posicoes[c];
          doc.rect(x, y, larguraColuna, bloco).lineWidth(0.5).stroke("#8a8a8a");
          celula.slice(inicio, inicio + quantidade).forEach((conteudo, j) =>
            escrever(conteudo, x + espaco, y + espaco + j * altura, tamanho));
        });
        y += bloco;
        inicio += quantidade;
      }
    }
    y += 8;
  }

  let tabela: string[][] = [];
  let assinatura = false;
  for (const bruta of texto.split(/\r?\n/)) {
    const s = bruta.trim();
    if (s.startsWith("|")) {
      const celulas = s.replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
      if (!celulas.every((c) => /^:?-{2,}:?$/.test(c))) tabela.push(celulas);
      continue;
    }
    if (tabela.length) { quadro(tabela); tabela = []; }
    if (!s) { assinatura = false; continue; }
    const principal = s.startsWith("# ");
    const secao = s.startsWith("## ");
    const assina = s.startsWith("@ ");
    const tamanho = principal ? 15 : 12;
    const altura = principal ? 20 : 16;
    const espaco = secao ? 10 : assina && !assinatura ? 16 : 0;
    const corpo = s.slice(secao ? 3 : principal || assina ? 2 : 0);
    if (y + espaco + altura * (secao ? 2 : 1) > fim) novaPagina();
    y += espaco;
    for (const linha of quebrar(corpo, largura, tamanho, principal || secao)) {
      if (y + altura > fim) novaPagina();
      const x = principal || assina
        ? MARGEM + (largura - linha.reduce((total, t) => total + t.largura, 0)) / 2
        : MARGEM;
      escrever(linha, x, y, tamanho);
      y += altura;
    }
    y += principal ? 10 : assina ? 0 : 5;
    assinatura = assina;
  }
  if (tabela.length) quadro(tabela);

  const imagemDaPagina = (imagem: Timbrado["cabecalho"], altura: number, posicao: number) => {
    const medida = altura * imagem.proporcao;
    const fonte = `data:image/png;base64,${imagem.dados.toString("base64")}`;
    return () => doc.image(fonte, (doc.page.width - medida) / 2, posicao, { width: medida, height: altura });
  };
  const aplicarTimbrado = timbrado && [
    imagemDaPagina(timbrado.cabecalho, alturaCabecalho, 30),
    imagemDaPagina(timbrado.rodape, alturaRodape, doc.page.height - 37 - alturaRodape),
  ];
  const paginas = doc.bufferedPageRange();
  for (let i = 0; i < paginas.count; i++) {
    doc.switchToPage(paginas.start + i);
    aplicarTimbrado?.forEach((aplicar) => aplicar());
    const numero = `${i + 1} / ${paginas.count}`;
    doc.fillColor("#444444").font(NORMAL).fontSize(9);
    doc.text(numero, (doc.page.width - doc.widthOfString(numero)) / 2, doc.page.height - 29, { lineBreak: false });
  }
  doc.end();
  return resultado;
}
