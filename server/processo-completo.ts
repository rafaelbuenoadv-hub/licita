import { destinoDosAnexos } from "../shared/anexos-etapas.js";
import { inserirComplementosDaInstrucao, type DadosInstrucao } from "../shared/instrucao.js";
import { createHash } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import { Document, Packer, Paragraph, ImageRun, TextRun, PageOrientation, Header, Footer } from "docx";
import { q, q1 } from "./db.js";
import { ETAPAS, TIPOS, VIAS, type Valores } from "../shared/etapas.js";
import { inserirVerificacaoPac, documentoDaPesquisaDePrecos, type ItemSolicitacao, type TopicoSolicitacao } from "../shared/solicitacao.js";
import { documentoDosCampos, camposDo } from "./campos.js";
import { secaoDaMinuta, type Timbrado } from "./docx.js";
import { minutaParaPdf } from "./pdf.js";
import { arquivoDoProcessoParaPdf, paginasDoPdfParaWord, semPaginasEmBranco } from "./arquivo-processo.js";
import type { Processo } from "./routes/processos.js";

export const ORDEM_DOCUMENTOS_PROCESSO = ["protocolo", "dfd", "precos", "etp", "tr", "dot", "fiscal"] as const;

interface Peca { titulo: string; texto?: string; nome?: string; arquivo?: Buffer; referencias?: string[] }
const nomeLinha = (s: string) => s.replace(/[\r\n]/g, " ");
const temCampos = (v?: Valores) => Object.values(v ?? {}).some((x) => Array.isArray(x) ? x.length : String(x ?? "").trim());

/** Só lê registros do processo já autorizado pela rota. Não gera versões nem conclui etapas. */
export async function pecasDoProcesso(p: Processo, usuario: number) {
  const [campos, solicitacoes, apoios, orcamentos, minutas, anexos, pesquisas, orgao, autores, revisoes, arquivosRevisao, minutasRevisao] = await Promise.all([
    camposDo(p.id),
    q<DadosInstrucao & { id: number; secretaria: string; referencia: string; descricao: string; nome_arquivo: string | null; arquivo: Buffer | null; itens: ItemSolicitacao[]; topicos_adicionais: TopicoSolicitacao[] }>("select id,secretaria,referencia,descricao,nome_arquivo,arquivo,objeto,justificativa,informacoes,itens,topicos_adicionais from solicitacoes_processo where processo_id=$1 order by id", [p.id]),
    q<{ id: number; solicitacao_id: number; nome: string; arquivo: Buffer }>("select a.id,a.solicitacao_id,a.nome,a.arquivo from solicitacao_anexos a join solicitacoes_processo s on s.id=a.solicitacao_id where s.processo_id=$1 order by a.id", [p.id]),
    q<{ id: number; nome: string; arquivo: Buffer }>("select id,nome,arquivo from orcamentos where processo_id=$1 order by id", [p.id]),
    q<{ etapa: string; texto: string; versao: number }>("select distinct on (etapa) etapa,texto,versao from minutas where processo_id=$1 order by etapa,versao desc", [p.id]),
    q<{ nome: string; texto: string; etapa: string; criado_em: string; arquivo: Buffer | null }>("select nome,texto,etapa,criado_em,arquivo from anexos where processo_id=$1 order by id", [p.id]),
    q<{ etapa: string; texto: string; fontes: { titulo: string; url: string }[] }>("select distinct on (etapa) etapa,texto,fontes from pesquisas_minuta where processo_id=$1 order by etapa,id desc", [p.id]),
    q1<{ nome: string }>("select nome from orgaos where id=$1", [p.orgao_id]),
    q<{ etapa: string; nome: string; cargo: string }>("select c.etapa,u.nome,u.cargo from campos_etapa c join usuarios u on u.id=c.usuario_id where c.processo_id=$1 and u.orgao_id=$2", [p.id, p.orgao_id]),
    q<{ id: number; numero: string }>("select id,numero from revisoes where processo_id=$1 and orgao_id=$2 order by id", [p.id, p.orgao_id]),
    q<{ revisao_id: number; nome: string; arquivo: Buffer }>("select a.revisao_id,a.nome,a.arquivo from revisao_arquivos a join revisoes r on r.id=a.revisao_id where r.processo_id=$1 and r.orgao_id=$2 order by r.id,a.id", [p.id, p.orgao_id]),
    q<{ revisao_id: number; tipo: string; texto: string }>("select distinct on (r.id,m.tipo) r.id as revisao_id,m.tipo,m.texto from revisao_minutas m join revisoes r on r.id=m.revisao_id where r.processo_id=$1 and r.orgao_id=$2 order by r.id,m.tipo,m.id desc", [p.id, p.orgao_id]),
  ]);
  const documentos = new Map<string, Peca>(), grupos = new Map<string, Peca[]>(), ausentes: string[] = [];
  const grupo = (etapa: string) => {
    const destino = destinoDosAnexos(etapa);
    if (!grupos.has(destino)) grupos.set(destino, []);
    return grupos.get(destino)!;
  };
  const arquivosVistos = new Map<string, Peca>();
  const incluirArquivo = (nome: string, arquivo: Buffer, referencia: string, etapa: string) => {
    const hash = createHash("sha256").update(arquivo).digest("hex");
    const chave = hash;
    const visto = arquivosVistos.get(chave);
    if (visto) { visto.referencias!.push(`${referencia}: ${nome}`); return; }
    const peca = { titulo: `${referencia} — ${nomeLinha(nome)}`, nome, arquivo, referencias: [] };
    arquivosVistos.set(chave, peca); grupo(etapa).push(peca);
  };
  const incluirOrcamentos = () => {
    for (const o of orcamentos) incluirArquivo(o.nome, o.arquivo, "Orçamento / comprovante de pesquisa de preços", "precos");
  };
  for (const s of solicitacoes) {
    if (s.arquivo && s.nome_arquivo) incluirArquivo(s.nome_arquivo, s.arquivo, `Documento de origem — ${s.secretaria}`, "solicitacao");
    for (const a of apoios.filter((a) => a.solicitacao_id === s.id)) incluirArquivo(a.nome, a.arquivo, `Documento de apoio — ${s.secretaria}`, "solicitacao");
  }
  for (const id of ORDEM_DOCUMENTOS_PROCESSO) {
    const e = ETAPAS.find((e) => e.id === id)!;
    const minuta = minutas.find((m) => m.etapa === id);
    let texto = minuta?.texto;
    if (!texto && temCampos(campos[id])) texto = await documentoDosCampos(p, e, campos, autores.find((a) => a.etapa === id) ?? { nome: "[[Responsável pela etapa]]", cargo: "" });
    if (!texto) { ausentes.push(e.nome); continue; }
    if (id === "precos") texto = documentoDaPesquisaDePrecos(texto, solicitacoes.flatMap((s) => s.itens));
    if (id === "dfd") texto = inserirComplementosDaInstrucao(texto, solicitacoes);
    if (id === "dfd") {
      texto = inserirVerificacaoPac(texto, campos);

    }
    documentos.set(id, { titulo: `${e.doc ?? e.nome}${minuta ? ` — versão ${minuta.versao}` : " — campos salvos"}`, texto });
  }
  incluirOrcamentos();
  for (const pesquisa of pesquisas) {
    const e = ETAPAS.find((e) => e.id === pesquisa.etapa);
    if (e) grupo(e.id).push({ titulo: `Pesquisa de apoio — ${e.nome}`, texto: `# PESQUISA DE APOIO — ${e.nome}\n\n${pesquisa.texto}\n\n## Fontes\n${pesquisa.fontes.map((f) => `${f.titulo}: ${f.url}`).join("\n")}` });
  }
  for (const a of anexos) {
    const referencia = a.etapa ? ETAPAS.find((e) => e.id === a.etapa)?.nome ?? a.etapa : "Processo";
    const juntado = new Date(a.criado_em).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" });
    if (a.arquivo) incluirArquivo(a.nome, a.arquivo, `Anexo — ${referencia} (juntado em ${juntado})`, a.etapa);
    else grupo(a.etapa).push({ titulo: `Anexo do processo — ${nomeLinha(a.nome)} (registro em texto)`, texto: `# ${nomeLinha(a.nome)}\n\n${a.texto}` });
  }
  for (const r of revisoes) {
    for (const a of arquivosRevisao.filter((a) => a.revisao_id === r.id)) incluirArquivo(a.nome, a.arquivo, `Revisão ${r.numero}`, "");
    for (const m of minutasRevisao.filter((m) => m.revisao_id === r.id)) grupo("").push({ titulo: `Revisão ${r.numero} — ${m.tipo}`, texto: m.texto });
  }
  const revisoesPendentes = await q<{etapa:string;motivo:string}>("select etapa,motivo from revisoes_documentos where processo_id=$1",[p.id]);
  const capa = [`# PROCESSO COMPLETO`, orgao?.nome ?? "", `Protocolo: ${p.protocolo}`, p.numero && `Processo administrativo: ${p.numero}`, p.procedimento && `Procedimento: ${p.procedimento}`, `Objeto: ${p.objeto}`, `Área requisitante: ${[p.requisitante, ...p.areas_adicionais].filter(Boolean).join("; ")}`, `Tipo: ${TIPOS[p.tipo]} · Forma: ${VIAS[p.via]}`, `Situação: ${p.situacao}`, p.obs && `Observações: ${p.obs}`, `Exportado em ${new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}.`, "Reúne as últimas versões salvas. Os anexos acompanham cada peça; documentos da Instrução e do PAC acompanham o DFD, e os do planejamento acompanham o ETP. Arquivos sem etapa definida ficam ao final.", revisoesPendentes.length && `REVISÃO NECESSÁRIA: ${revisoesPendentes.map((r)=>`${ETAPAS.find((e)=>e.id===r.etapa)?.nome??r.etapa}: ${r.motivo}`).join("; ")}` , ausentes.length && `Etapas internas sem documento salvo ou campos preenchidos: ${ausentes.join("; ")}.`].filter(Boolean).join("\n\n");
  const pecas: Peca[] = [];
  for (const id of ORDEM_DOCUMENTOS_PROCESSO) {
    const documento = documentos.get(id), anexosDaEtapa = grupos.get(id) ?? [];
    if (documento) pecas.push(documento);
    else if (anexosDaEtapa.length) {
      const nome = ETAPAS.find((e) => e.id === id)!.nome;
      pecas.push({ titulo: `Anexos da etapa — ${nome}`, texto: `# ANEXOS DA ETAPA — ${nome}\n\nO documento principal desta etapa ainda não foi montado. Os arquivos de apoio disponíveis seguem reunidos nesta seção.` });
    }
    pecas.push(...anexosDaEtapa);
  }
  pecas.push(...(grupos.get("gerais") ?? []));
  return { capa, pecas };
}

export async function montarProcessoCompleto(p: Processo, formato: "pdf" | "docx", usuario: number, timbrado?: Timbrado) {
  const { capa, pecas } = await pecasDoProcesso(p, usuario);
  const partes = [];
  for (const peca of pecas) {
    const arquivo = peca.arquivo ? await semPaginasEmBranco(await arquivoDoProcessoParaPdf(peca.nome!, peca.arquivo)) : await minutaParaPdf(peca.texto!, peca.titulo, timbrado);
    const pdf = await PDFDocument.load(arquivo);
    partes.push({ ...peca, pdf, arquivoPdf: arquivo, paginas: pdf.getPageCount() });
  }
  if (formato === "pdf") {
    const pdf = await PDFDocument.create();
    const capaPdf = await PDFDocument.load(await minutaParaPdf(capa, "Processo completo", timbrado));
    let tamanhoIndice = 1, indicePdf = capaPdf;
    for (let tentativa = 0; tentativa < 5; tentativa++) {
      let pagina = capaPdf.getPageCount() + tamanhoIndice + 1;
      const linhas = partes.map((x, i) => { const inicio = pagina; pagina += x.paginas; return `${i + 1}. ${x.titulo} — páginas ${inicio} a ${pagina - 1}`; });
      indicePdf = await PDFDocument.load(await minutaParaPdf(`# ÍNDICE DO PROCESSO\n\n${linhas.join("\n\n") || "Nenhum documento ou anexo disponível."}`, "Índice do processo"));
      if (tamanhoIndice === indicePdf.getPageCount()) break;
      tamanhoIndice = indicePdf.getPageCount();
    }
    for (const origem of [capaPdf, indicePdf, ...partes.map((x) => x.pdf)]) for (const pg of await pdf.copyPages(origem, origem.getPageIndices())) pdf.addPage(pg);
    const originaisIncorporados = new Set<string>();
    for (const [i, x] of partes.entries()) if (x.arquivo) {
      const hash = createHash("sha256").update(x.arquivo).digest("hex");
      if (!originaisIncorporados.has(hash)) {
        await pdf.attach(x.arquivo, `${i + 1}-${x.nome}`, { description: x.titulo });
        originaisIncorporados.add(hash);
      }
    }
    return Buffer.from(await pdf.save());
  }
  const indice = `# ÍNDICE DO PROCESSO\n\n${partes.map((x, i) => `${i + 1}. ${x.titulo}`).join("\n\n") || "Nenhum documento ou anexo disponível."}`;
  const sections = [secaoDaMinuta(capa, timbrado), secaoDaMinuta(indice)];
  for (const [i, x] of partes.entries()) {
    if (!x.arquivo) { sections.push(secaoDaMinuta(x.texto!, timbrado)); continue; }
    const paginas = await paginasDoPdfParaWord(x.arquivoPdf);
    for (const [j, imagem] of paginas.entries()) {
      const largura = 690, altura = 960;
      const escala = Math.min(largura / imagem.width, altura / imagem.height);
      sections.push({
        properties: { page: { size: { width: 11906, height: 16838, orientation: PageOrientation.PORTRAIT }, margin: { top: 720, bottom: 720, left: 720, right: 720 } } },
        headers: undefined, footers: undefined,
        children: [new Paragraph({ spacing: { after: 100 }, children: [new TextRun({ text: `${i + 1}. ${x.titulo.slice(0, 120)} — folha ${j + 1}/${paginas.length}`, size: 16 })] }), new Paragraph({ spacing: { after: 0 }, children: [new ImageRun({ type: "jpg", data: imagem.data, transformation: { width: Math.round(imagem.width * escala), height: Math.round(imagem.height * escala) } })] })],
      });
    }
  }
  return Packer.toBuffer(new Document({ title: `Processo completo — ${p.protocolo}`, creator: "Licita", styles: { default: { document: { run: { font: "Times New Roman", size: 24 } } } }, sections: sections.map((s) => ({ ...s, headers: s.headers ?? { default: new Header({ children: [new Paragraph("")] }) }, footers: s.footers ?? { default: new Footer({ children: [new Paragraph("")] }) } })) }));
}
