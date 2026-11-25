import { partesDaTabela } from "../shared/tabelas-retrato.js";
import PDFDocument from "pdfkit";
import { existsSync } from "node:fs";
import { QUEBRA_NA_CELULA } from "../shared/solicitacao.js";
import type { Timbrado } from "./docx.js";

type Trecho = { texto: string; negrito: boolean; pendente: boolean; riscado: boolean; largura: number };
const MARGEM = 54;
// Incorpora a fonte para manter a mesma aparência em qualquer computador/impressora.
const pastaFonte=["/usr/share/fonts/truetype/liberation", "/usr/share/fonts/truetype/liberation2"].find((p)=>existsSync(`${p}/LiberationSerif-Regular.ttf`) && existsSync(`${p}/LiberationSerif-Bold.ttf`));
const NORMAL = pastaFonte ? `${pastaFonte}/LiberationSerif-Regular.ttf` : "Times-Roman";
const NEGRITO = pastaFonte ? `${pastaFonte}/LiberationSerif-Bold.ttf` : "Times-Bold";

export async function minutaParaPdf(texto: string, titulo: string, timbrado?: Timbrado) {
  const doc = new PDFDocument({ size: "A4", margin: MARGEM, bufferPages: true, info: { Title: titulo, Creator: "Licita" } });
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
    const partes = valor.split(/(\[\[.+?\]\]|\*\*.+?\*\*|~~.+?~~)/g);
    for (const parte of partes) {
      const pendente = parte.startsWith("[[") && parte.endsWith("]]");
      const forte = parte.startsWith("**") && parte.endsWith("**");
      const riscado = parte.startsWith("~~") && parte.endsWith("~~");
      const conteudo = pendente || forte || riscado ? parte.slice(2, -2) : parte;
      const bold = negrito || forte;
      doc.font(bold ? NEGRITO : NORMAL).fontSize(tamanho);
      const inserir = (palavra: string, medida: number) => {
        if (soma + medida > max && soma > 0) novaLinha();
        if (soma === 0 && !palavra.trim()) return;
        linhas.at(-1)!.push({ texto: palavra, negrito: bold, pendente, riscado, largura: medida });
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
        if (anterior && anterior.negrito === trecho.negrito && anterior.pendente === trecho.pendente && anterior.riscado === trecho.riscado) {
          anterior.texto += trecho.texto;
          anterior.largura += trecho.largura;
        } else trechos.push(trecho);
      }
      return trechos;
    });
  }

  function escrever(linha: Trecho[], x: number, yy: number, tamanho: number, justificar = 0) {
    const ocupado=linha.reduce((n,t)=>n+t.largura,0);
    const espacos=linha.reduce((n,t)=>n+(t.texto.match(/ /g)?.length??0),0);
    const adicional=justificar && espacos ? Math.max(0,justificar-ocupado)/espacos : 0;
    for (const trecho of linha) {
      const inicio=x;
      const largura=trecho.largura+(trecho.texto.match(/ /g)?.length??0)*adicional;
      if (trecho.pendente && largura>0) doc.rect(x,yy,largura,tamanho+2).fill("#fff176");
      doc.fillColor("#171717").font(trecho.negrito ? NEGRITO : NORMAL).fontSize(tamanho);
      for(const token of trecho.texto.match(/\S+|\s+/g)??[]){
        if(token.trim()) doc.text(token,x,yy,{lineBreak:false});
        x+=doc.widthOfString(token)+(token.match(/ /g)?.length??0)*adicional;
      }
      if(trecho.riscado) doc.moveTo(inicio,yy+tamanho*.52).lineTo(x,yy+tamanho*.52).lineWidth(.5).stroke("#171717");
    }
  }

  function quadro(linhas:string[][],alinhamentos:string[]=[]){
    const partes=partesDaTabela(linhas,alinhamentos);
    for(const [i,parte] of partes.entries()){
      if(partes.length>1){
        if(y+30>fim) novaPagina();
        escrever(quebrar(`Quadro — parte ${i+1} de ${partes.length}`,largura,9,true)[0],MARGEM,y,9);y+=18;
      }
      quadroUnico(parte.linhas,parte.alinhamentos.map((x)=>x??"left"));
    }
  }

  function quadroUnico(linhas: string[][], alinhamentos: string[] = []) {
    const colunas = Math.max(...linhas.map((linha) => linha.length));
    const quadroItens = linhas[0][0] === "Item" && linhas[0][1] === "Descrição";
    const tamanho = colunas > 9 ? 7.5 : quadroItens ? 9.5 : 10;
    const altura = tamanho + 3.5;
    const espaco = colunas > 9 ? 2 : 4;
    // Quadro de itens: item, unidade e quantidade estreitos; valores com largura para uma linha; descrição com o resto.
    const larguras = quadroItens ? (() => {
      const fixas = [30, 0, 38, 42];
      doc.font(NEGRITO).fontSize(tamanho);
      const valor = Math.max(62, doc.widthOfString("R$ 999.999,99") + 10);
      const l = Array.from({ length: colunas }, (_, c) => (c < 4 ? fixas[c] : valor));
      l[1] = Math.max(110, largura - l.reduce((a, b) => a + b, 0));
      const soma = l.reduce((a, b) => a + b, 0);
      return l.map((x) => x * largura / soma);
    })() : (() => {
      const pesos = Array.from({ length: colunas }, (_, c) => {
        const maximo = linhas.reduce((max, linha) => Math.max(max, linha[c]?.replace(/\*\*/g, "").length ?? 0), 0);
        return Math.sqrt(Math.max(6, Math.min(150, maximo)));
      });
      const totalPesos = pesos.reduce((soma, peso) => soma + peso, 0);
      return pesos.map((peso) => largura * peso / totalPesos);
    })();
    let colunaX = MARGEM;
    const posicoes = larguras.map((larguraColuna) => {
      const posicao = { x: colunaX, largura: larguraColuna };
      colunaX += larguraColuna;
      return posicao;
    });
    for (const [i, linha] of linhas.entries()) {
      // No cabeçalho, "Cotação N" em negrito e o nome do fornecedor em texto normal, logo abaixo.
      const celulas = Array.from({ length: colunas }, (_, c) =>
        (linha[c] ?? "").split(QUEBRA_NA_CELULA).flatMap((trecho, k) =>
          quebrar(trecho, Math.max(1, posicoes[c].largura - 2 * espaco), tamanho, i === 0 && k === 0)));
      const total = Math.max(...celulas.map((celula) => celula.length));
      // Preserve a linha inteira quando couber em uma página. Linhas maiores seguem na página seguinte.
      const alturaLinha = total * altura + 2 * espaco;
      if (alturaLinha <= fim - topo && y + alturaLinha > fim) novaPagina();
      for (let inicio = 0; inicio < total;) {
        if (y + altura + 2 * espaco > fim) novaPagina();
        const quantidade = Math.min(total - inicio, Math.floor((fim - y - 2 * espaco) / altura));
        const bloco = quantidade * altura + 2 * espaco;
        const linhaTotal = i > 0 && !linha[0] && /^\*\*/.test(linha[1] ?? "");
        celulas.forEach((celula, c) => {
          const { x, largura: larguraColuna } = posicoes[c];
          if (i === 0 || linhaTotal) doc.rect(x, y, larguraColuna, bloco).fill(i === 0 ? "#e7e7e7" : "#f3f3f3");
          doc.rect(x, y, larguraColuna, bloco).lineWidth(0.5).stroke("#8a8a8a");
          const alinhar = i === 0 ? "center" : alinhamentos[c];
          const trechos = celula.slice(inicio, inicio + quantidade);
          const meio = ((quantidade - trechos.length) * altura) / 2;
          trechos.forEach((conteudo, j) => {
            const ocupado = conteudo.reduce((t, trecho) => t + trecho.largura, 0);
            const livre = larguraColuna - 2 * espaco - ocupado;
            const desloca = alinhar === "right" ? livre : alinhar === "center" ? livre / 2 : 0;
            escrever(conteudo, x + espaco + Math.max(0, desloca), y + espaco + meio + j * altura, tamanho);
          });
        });
        y += bloco;
        inicio += quantidade;
      }
    }
    y += 8;
  }

  let tabela: string[][] = [];
  let alinhamentos: string[] = [];
  let assinatura = false;
  for (const bruta of texto.split(/\r?\n/)) {
    const s = bruta.trim();
    if (s.startsWith("|")) {
      const celulas = s.replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
      if (celulas.every((c) => /^:?-{2,}:?$/.test(c))) alinhamentos = celulas.map((c) => (c.startsWith(":") && c.endsWith(":") ? "center" : c.endsWith(":") ? "right" : "left"));
      else tabela.push(celulas);
      continue;
    }
    if (tabela.length) { quadro(tabela, alinhamentos); tabela = []; alinhamentos = []; }
    if (!s) { assinatura = false; continue; }
    const principal = s.startsWith("# ");
    const secao = s.startsWith("## ");
    const assina = s.startsWith("@ ");
    const nota = s.startsWith("Preço de referência: ");
    const tamanho = principal ? 15 : nota ? 9 : 12;
    const altura = principal ? 20 : nota ? 12 : 16;
    const espaco = secao ? 10 : assina && !assinatura ? 16 : 0;
    const corpo = s.slice(secao ? 3 : principal || assina ? 2 : 0);
    if (y + espaco + altura * (secao ? 2 : 1) > fim) novaPagina();
    y += espaco;
    const linhasDoParagrafo=quebrar(corpo,largura,tamanho,principal||secao);
    for (const [indice,linha] of linhasDoParagrafo.entries()) {
      if (y + altura > fim) novaPagina();
      const x = principal || assina
        ? MARGEM + (largura - linha.reduce((total, t) => total + t.largura, 0)) / 2
        : MARGEM;
      escrever(linha,x,y,tamanho,!principal && !secao && !assina && indice<linhasDoParagrafo.length-1 ? largura : 0);
      y += altura;
    }
    y += principal ? 10 : assina ? 0 : 5;
    assinatura = assina;
  }
  if (tabela.length) quadro(tabela, alinhamentos);

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
