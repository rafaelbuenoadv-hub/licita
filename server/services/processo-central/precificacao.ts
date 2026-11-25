import { escala,arredondar,formatar } from "./decimal.js";
import { registro,chaveOrigem,type GrupoItem } from "./consolidacao.js";
export type Metodo="media"|"mediana"|"menor";
export function calcularPrecoReferencia(valores:bigint[],metodo:Metodo):bigint|null {
  if(!valores.length)return null;
  const vs=[...valores].sort((a,b)=>a<b?-1:a>b?1:0);
  if(metodo==="menor")return vs[0];
  if(metodo==="mediana"){const m=Math.floor(vs.length/2);return vs.length%2?vs[m]:arredondar(vs[m-1]+vs[m],2n);}
  return arredondar(vs.reduce((a,v)=>a+v,0n),BigInt(vs.length));
}
export function precificarGrupo(g:GrupoItem){
  const pendencias=[...g.pendencias],memoria:{origem:string;indice:number;cotacao:unknown;situacao:string}[]=[];
  const criterios=g.origens.map(o=>registro(o.dado).criterio??"media");
  const metodo=criterios[0];
  const conflito=criterios.some(c=>c!==metodo)||!(metodo==="media"||metodo==="mediana"||metodo==="menor");
  if(conflito)pendencias.push("Método divergente ou não suportado");
  const precos:bigint[]=[],vistos=new Set<string>();
  for(const o of g.origens){
    const d=registro(o.dado),cs=Array.isArray(d.cotacoes)?d.cotacoes:[];
    for(const [indice,raw] of cs.entries()){
      const c=registro(raw),v=escala(c.valor_unitario,2),fornecedor=typeof c.fornecedor==="string"?c.fornecedor.trim():"";
      let situacao="incluida";
      if(c.descarte){situacao="descartada";if(typeof registro(c.descarte).justificativa!=="string"||!String(registro(c.descarte).justificativa).trim())pendencias.push("Descarte sem justificativa");}
      else if(c.apenas_referencia)situacao="referencial";
      else if(!v||!fornecedor){situacao="invalida";pendencias.push("Cotação inválida ou sem fornecedor");}
      else {
        const chave=JSON.stringify([fornecedor.toLowerCase(),c.fonte??"fornecedor",c.orcamento_id??null,c.link??null,c.consultado_em??null,String(v)]);
        if(vistos.has(chave)){situacao="duplicada";pendencias.push("Cotação duplicada: conferir");}
        else {vistos.add(chave);precos.push(v);if(!c.consultado_em)pendencias.push("Cotação sem data");if(!c.link&&!c.orcamento_id)pendencias.push("Cotação sem referência de comprovante");}
      }
      memoria.push({origem:chaveOrigem(o),indice,cotacao:raw,situacao});
    }
  }
  let ref=conflito?null:calcularPrecoReferencia(precos,metodo as Metodo);
  if(!precos.length&&!memoria.length&&!conflito&&g.origens.length===1){
    ref=escala(registro(g.origens[0].dado).valor_unitario,2);
    if(ref!==null)pendencias.push("Preço legado sem cotação verificável");
  }
  if(ref===null)pendencias.push("Preço de referência ausente");
  if(precos.length<3)pendencias.push("Menos de três preços aproveitados: analisar justificativa e norma aplicável");
  const q=escala(g.quantidade,4),total=q!==null&&ref!==null?arredondar(q*ref,10000n):null;
  return {...g,metodo:conflito?null:metodo as Metodo,preco:ref===null?null:formatar(ref,2),total:total===null?null:formatar(total,2),memoria,pendencias:[...new Set(pendencias)]};
}
