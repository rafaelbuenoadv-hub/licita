import { q } from "./db.js";
import { conferirEtapa } from "./conferencia.js";
import { ETAPAS, type Checks, type Valores } from "../shared/etapas.js";
import { totalDosItens, valorDasCotacoes, type ItemSolicitacao } from "../shared/solicitacao.js";
import type { ConferenciaCompleta, PendenciaProcesso } from "../shared/conferencia-processo.js";
import type { Processo } from "./routes/processos.js";

const dinheiro = (v: unknown) => {
  if (typeof v !== "string" || !v.trim()) return null;
  const n = Number(v.replace(/[R$\s.]/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
};
const brl = (n: number) => n.toLocaleString("pt-BR", {style:"currency",currency:"BRL"});
interface Arquivo { origem:string; id:number; nome:string; etapa:string; bytes:number|null; caracteres:number|null }

/** Conferência estrutural, sem IA, conversão de arquivos ou alteração dos registros. */
export async function conferirProcessoCompleto(p: Processo, checks: Checks, campos: Record<string, Valores>): Promise<ConferenciaCompleta> {
  const [minutas, instrucoes, arquivos, verificacoes] = await Promise.all([
    q<{etapa:string;versao:number;criado_em:string}>("select distinct on (etapa) etapa,versao,criado_em from minutas where processo_id=$1 order by etapa,versao desc",[p.id]),
    q<{id:number;itens:ItemSolicitacao[]}>("select id,itens from solicitacoes_processo where processo_id=$1 order by id",[p.id]),
    q<Arquivo>(`select 'anexo' as origem,id,nome,etapa,octet_length(arquivo) as bytes,length(texto) as caracteres from anexos where processo_id=$1
      union all select 'orcamento',id,nome,'precos',octet_length(arquivo),length(texto) from orcamentos where processo_id=$1
      union all select 'instrucao',id,nome_arquivo,'solicitacao',octet_length(arquivo),length(texto_arquivo) from solicitacoes_processo where processo_id=$1 and nome_arquivo is not null
      union all select 'apoio',a.id,a.nome,'solicitacao',octet_length(a.arquivo),length(a.texto) from solicitacao_anexos a join solicitacoes_processo s on s.id=a.solicitacao_id where s.processo_id=$1`,[p.id]),
    Promise.all(ETAPAS.map(async(e)=>({e,lista:await conferirEtapa(p,e,checks,campos)}))),
  ]);
  const pendencias: PendenciaProcesso[] = [];
  const adicionar = (x:PendenciaProcesso) => {
    if (!pendencias.some((a)=>a.etapa===x.etapa && a.codigo===x.codigo && a.onde===x.onde && a.alvo===x.alvo && a.texto===x.texto)) pendencias.push(x);
  };
  for (const {e,lista} of verificacoes) for (const x of lista) {
    // O protocolo também lê todos os alertas; cada um já aparece na sua própria etapa.
    if(e.id==="protocolo" && x.codigo==="revisao") continue;
    adicionar({...x,etapa:e.id, ...(x.codigo==="dotacao" ? {etapa:"dot"} : {})});
  }
  if(p.situacao==="cancelado") adicionar({etapa:"protocolo",codigo:"cancelado",texto:"O processo está cancelado. A reabertura deve ser registrada nos dados do processo antes do encaminhamento.",onde:"dados",bloqueia:true});
  const orcamentos = new Set(arquivos.filter((a)=>a.origem==="orcamento" && (a.bytes??0)>0).map((a)=>a.id));
  const itens = instrucoes.flatMap((s)=>s.itens ?? []);
  for(const [indice,item] of itens.entries()) {
    const rotulo=`Item ${indice+1} (${item.descricao})`;
    if(item.quantidade==null || item.quantidade<=0 || !(item.unidade ?? "").trim()) adicionar({etapa:"solicitacao",codigo:"quantidade",texto:`${rotulo}: confira a unidade e a quantidade, que deve ser maior que zero.`,onde:"campos",alvo:"solicitacao",bloqueia:true});
    if(!item.cotacoes?.length && (item.valor_unitario==null || item.valor_unitario<=0)) adicionar({etapa:"solicitacao",codigo:"preco_item",texto:`${rotulo}: informe o preço unitário ou as cotações para formar a estimativa.`,onde:"campos",alvo:"solicitacao",bloqueia:true});
    if(item.cotacoes?.length && valorDasCotacoes(item.cotacoes,item.criterio)!=null && item.valor_unitario!==valorDasCotacoes(item.cotacoes,item.criterio)) adicionar({etapa:"precos",codigo:"calculo",texto:`${rotulo}: o preço unitário salvo difere do resultado das cotações. Salve novamente a análise dos preços.`,onde:"campos",bloqueia:true});
    for(const cotacao of item.cotacoes ?? []) if(cotacao.orcamento_id!=null && !orcamentos.has(cotacao.orcamento_id)) adicionar({etapa:"solicitacao",codigo:"anexo_cotacao",texto:`${rotulo}: o arquivo do orçamento de ${cotacao.fornecedor || "um fornecedor"} não está disponível. Reanexe ou corrija o vínculo.`,onde:"campos",alvo:"solicitacao",bloqueia:true});
  }
  const total=totalDosItens(itens), pesquisa=dinheiro(campos.precos?.valor_total), dotacao=dinheiro(campos.dot?.valor_total);
  if(total!=null && pesquisa!=null && Math.abs(total-pesquisa)>0.01) adicionar({etapa:"precos",codigo:"total",texto:`O total dos itens (${brl(total)}) difere do valor salvo na pesquisa de preços (${brl(pesquisa)}). Atualize a estimativa e a memória de cálculo.`,onde:"campos",alvo:"valor_total",bloqueia:true});
  if(pesquisa!=null && dotacao!=null && Math.abs(pesquisa-dotacao)>0.01) adicionar({etapa:"dot",codigo:"valor_dotacao",texto:`A pesquisa registra ${brl(pesquisa)} e a dotação registra ${brl(dotacao)}. Confira a diferença e o período coberto pela dotação.`,onde:"campos",alvo:"valor_total",bloqueia:false});
  for(const a of arquivos) {
    const etapa=ETAPAS.some((e)=>e.id===a.etapa) ? a.etapa : "protocolo";
    const alvo=a.origem==="anexo" ? (a.etapa ? `anexos-${a.etapa}` : "anexos-gerais") : a.origem==="orcamento" ? "orcamentos-processo" : "pedidos-secretarias";
    if(!(a.bytes??0) && !(a.caracteres??0)) adicionar({etapa,codigo:"anexo_vazio",texto:`O anexo “${a.nome}” não tem arquivo nem conteúdo em texto disponível. Reanexe uma cópia válida.`,onde:"anexos",alvo,bloqueia:true});
    else if(!(a.bytes??0)) adicionar({etapa,codigo:"anexo_texto",texto:`O anexo “${a.nome}” foi preservado somente em texto. Confira se é necessário juntar também o original.`,onde:"anexos",alvo,bloqueia:false});
    if((a.bytes??0)>0 && !/\.(pdf|docx|xlsx|xls|jpg|jpeg|png|txt|md|csv)$/i.test(a.nome)) adicionar({etapa,codigo:"anexo_formato",texto:`O formato de “${a.nome}” não pode ser juntado ao PDF e Word completos. Anexe uma versão em PDF ou em outro formato aceito.`,onde:"anexos",alvo,bloqueia:true});
    if(a.etapa && !ETAPAS.some((e)=>e.id===a.etapa)) adicionar({etapa:"protocolo",codigo:"anexo_etapa",texto:`O anexo “${a.nome}” está vinculado a uma etapa que não está mais disponível. Confira sua organização nos anexos gerais.`,onde:"anexos",alvo:"anexos-gerais",bloqueia:false});
  }
  const impeditivas=pendencias.filter((x)=>x.bloqueia).length;
  const documentos=ETAPAS.filter((e)=>e.modelo && !e.docOpcional);
  return {
    verificado_em:new Date().toISOString(), pronto:impeditivas===0,
    resumo:{impeditivas,avisos:pendencias.length-impeditivas,documentos_previstos:documentos.length,documentos_gerados:documentos.filter((e)=>minutas.some((m)=>m.etapa===e.id)).length,arquivos:arquivos.length,arquivos_gerais:arquivos.filter((a)=>a.origem==="anexo" && !a.etapa).length},
    etapas:ETAPAS.map((e)=>({id:e.id,nome:e.nome,documento:e.doc,versao:e.modelo ? minutas.find((m)=>m.etapa===e.id)?.versao??null : null,pendencias:pendencias.filter((x)=>x.etapa===e.id)})),
    pendencias,
  };
}
