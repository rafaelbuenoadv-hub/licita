import type { ProcessoCentral } from "../../../shared/processo-central.js";
import { escala,formatar } from "./decimal.js";
export type OrigemItem=ProcessoCentral["itens"][number];
export interface GrupoItem { id:string; descricao:string; unidade:string; origens:OrigemItem[]; quantidade:string|null; pendencias:string[] }
export interface ConfirmacaoGrupo { origens:string[]; justificativa:string }
export const chaveOrigem=(o:OrigemItem)=>o.solicitacao_id+":"+o.indice;
export const registro=(v:unknown):Record<string,unknown>=>v!==null&&typeof v==="object"&&!Array.isArray(v)?v as Record<string,unknown>:{};
const texto=(v:unknown)=>typeof v==="string"?v.trim():"";
const normalizar=(s:string)=>s.normalize("NFC").toLowerCase().replace(/\s+/g," ").trim();
function chave(o:OrigemItem):string|null {
  const d=registro(o.dado), a=normalizar(texto(d.descricao)), b=normalizar(texto(d.unidade));
  return a&&b?JSON.stringify([a,b]):null;
}
/** Igualdade textual apenas sugere equivalência; nunca agrupa sem confirmação explícita. */
export function consolidarItens(itens:OrigemItem[],confirmacoes:ConfirmacaoGrupo[]=[]){
  const candidatos=new Map<string,string[]>(), porId=new Map<string,OrigemItem>();
  for(const o of itens){
    const id=chaveOrigem(o); if(porId.has(id))throw new Error("Origem de item duplicada");
    porId.set(id,o);const k=chave(o);if(k)candidatos.set(k,[...(candidatos.get(k)??[]),id]);
  }
  const usados=new Set<string>(),grupos:GrupoItem[]=[];
  function criar(origens:OrigemItem[]):GrupoItem{
    const d=registro(origens[0].dado),pendencias:string[]=[];
    if(!chave(origens[0]))pendencias.push("Descrição ou unidade ausente");
    const qs=origens.map(o=>escala(registro(o.dado).quantidade,4));
    if(qs.some(q=>q===null))pendencias.push("Quantidade ausente ou inválida");
    return {id:origens.map(chaveOrigem).sort().join("+"),descricao:texto(d.descricao),unidade:texto(d.unidade),origens,quantidade:qs.some(q=>q===null)?null:formatar(qs.reduce<bigint>((a,q)=>a+(q??0n),0n),4),pendencias};
  }
  for(const c of confirmacoes){
    if(c.origens.length<2||!c.justificativa.trim()||new Set(c.origens).size!==c.origens.length)throw new Error("Confirmação inválida");
    const os=c.origens.map(id=>{const o=porId.get(id);if(!o||usados.has(id))throw new Error("Origem inexistente ou já agrupada");return o;});
    const k=chave(os[0]);if(!k||os.some(o=>chave(o)!==k))throw new Error("Especificação ou unidade divergente");
    for(const id of c.origens)usados.add(id);grupos.push(criar(os));
  }
  for(const o of itens)if(!usados.has(chaveOrigem(o)))grupos.push(criar([o]));
  return {grupos,candidatos:[...candidatos.values()].filter(ids=>ids.length>1)};
}
