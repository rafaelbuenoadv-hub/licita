import type { ProcessoCentral } from "../../../shared/processo-central.js";
import { registro } from "./consolidacao.js";
import { escala,formatar } from "./decimal.js";
import { totalDosItens,type ItemSolicitacao } from "../../../shared/solicitacao.js";
/** Não altera o cálculo legado; compara apenas quando os dados permitem executar a função existente. */
export function compararLegado(p:ProcessoCentral,novo:string|null){
  const itens=p.itens.map(o=>registro(o.dado));
  const seguro=itens.every(i=>typeof i.descricao==="string"&&typeof i.unidade==="string"&&(i.quantidade===null||typeof i.quantidade==="number")&&(i.valor_unitario===null||typeof i.valor_unitario==="number")&&(i.cotacoes===undefined||Array.isArray(i.cotacoes)&&i.cotacoes.every(c=>typeof registro(c).fornecedor==="string")));
  if(!seguro)return {legado:null,novo,diferenca:null,situacao:"dados_legados_invalidos"};
  const valor=totalDosItens(itens as unknown as ItemSolicitacao[]);
  const a=valor===null?null:escala(valor.toFixed(2),2),b=escala(novo,2);
  const dif=a!==null&&b!==null?b-a:null;
  return {legado:valor===null?null:valor.toFixed(2),novo,diferenca:dif===null?null:(dif<0n?"-":"")+formatar(dif<0n?-dif:dif,2),situacao:dif===null?"incomparavel":dif===0n?"igual":"divergente"};
}
