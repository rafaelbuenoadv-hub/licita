import { escala,formatar } from "./decimal.js";
import type { precificarGrupo } from "./precificacao.js";
export function validarCalculo(itens:ReturnType<typeof precificarGrupo>[]){
  const totais=itens.map(i=>i.total===null?null:BigInt(i.total.replace(".","")));
  const presentes=totais.filter((n):n is bigint=>n!==null);
  const subtotal=presentes.length?formatar(presentes.reduce((a,b)=>a+b,0n),2):null;
  const completo=itens.length>0&&presentes.length===itens.length;
  return {subtotal,valorCalculado:completo?subtotal:null,
    situacao:!presentes.length?"sem_valor":completo?"aguardando_validacao":"subtotal",
    validado:false as const,pendencias:itens.flatMap(i=>i.pendencias.map(mensagem=>({item:i.id,mensagem})))};
}
