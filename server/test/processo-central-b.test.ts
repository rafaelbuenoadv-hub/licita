import test from "node:test";
import assert from "node:assert/strict";
import { consolidarItens, type OrigemItem } from "../services/processo-central/consolidacao.js";
import { calcularPrecoReferencia, precificarGrupo } from "../services/processo-central/precificacao.js";
import { escala, arredondar } from "../services/processo-central/decimal.js";
import { validarCalculo } from "../services/processo-central/validacao.js";

const cotacao=(fornecedor:string,valor_unitario:number)=>({fornecedor,valor_unitario,consultado_em:"2026-11-25",link:"https://example.com/"+fornecedor});
function item(id:number,quantidade:unknown,descricao="Higienização 12000 BTU",unidade="UN",cotacoes:unknown[]=[cotacao("A",140),cotacao("B",150),cotacao("C",160)]):OrigemItem{
 return {solicitacao_id:id,indice:0,secretaria:"Secretaria "+id,dado:{descricao,unidade,quantidade,criterio:"media",valor_unitario:null,cotacoes}};
}
test("itens iguais apenas sugerem agrupamento",()=>{
 const r=consolidarItens([item(1,80),item(2,60)]);
 assert.equal(r.grupos.length,2);assert.deepEqual(r.candidatos,[["1:0","2:0"]]);
});
test("confirmação preserva as duas demandas e soma quantidades",()=>{
 const r=consolidarItens([item(1,80),item(2,60)],[{origens:["1:0","2:0"],justificativa:"Equivalência técnica conferida"}]);
 assert.equal(r.grupos.length,1);assert.equal(r.grupos[0].quantidade,"140.0000");
 assert.equal(r.grupos[0].origens.length,2);
 const p=precificarGrupo(r.grupos[0]);assert.equal(p.preco,"150.00");assert.equal(p.total,"21000.00");
 assert.equal(p.memoria.length,6);assert.equal(p.memoria.filter(c=>c.situacao==="duplicada").length,3);
});
test("especificações e unidades distintas não podem ser agrupadas",()=>{
 const c=[{origens:["1:0","2:0"],justificativa:"teste"}];
 assert.throws(()=>consolidarItens([item(1,1),item(2,1,"Higienização 18000 BTU")],c));
 assert.throws(()=>consolidarItens([item(1,1),item(2,1,undefined,"HORA")],c));
});
test("média, mediana par e ímpar, mínimo e ausência",()=>{
 assert.equal(calcularPrecoReferencia([14000n,15000n,38000n],"media"),22333n);
 assert.equal(calcularPrecoReferencia([14000n,15000n,38000n],"mediana"),15000n);
 assert.equal(calcularPrecoReferencia([100n,101n],"mediana"),101n);
 assert.equal(calcularPrecoReferencia([14000n,15000n,38000n],"menor"),14000n);
 assert.equal(calcularPrecoReferencia([],"media"),null);
});
test("decimal rejeita entradas inválidas e arredonda meio centavo",()=>{
 assert.equal(escala("1.005",2),null);assert.equal(escala(-1,2),null);
 assert.equal(escala(null,2),null);assert.equal(escala("0.10",2),10n);
 assert.equal(arredondar(1005n,10n),101n);
});
test("descarte e cotação referencial permanecem na memória",()=>{
 const g=consolidarItens([item(1,2,undefined,undefined,[cotacao("A",150),{...cotacao("B",380),descarte:{motivo:"elevado",justificativa:"Análise registrada"}},{...cotacao("C",100),apenas_referencia:true}])]).grupos[0];
 const p=precificarGrupo(g);assert.equal(p.preco,"150.00");assert.equal(p.total,"300.00");
 assert.deepEqual(p.memoria.map(c=>c.situacao),["incluida","descartada","referencial"]);
});
test("pesquisa incompleta apresenta subtotal, nunca total definitivo",()=>{
 const gs=consolidarItens([item(1,2),item(2,3,undefined,undefined,[])]).grupos;
 const r=validarCalculo(gs.map(precificarGrupo));assert.equal(r.subtotal,"300.00");
 assert.equal(r.valorCalculado,null);assert.equal(r.situacao,"subtotal");assert.equal(r.validado,false);
});
test("quantidade ausente não é convertida em zero",()=>{
 const p=precificarGrupo(consolidarItens([item(1,null)]).grupos[0]);
 assert.equal(p.total,null);assert.ok(p.pendencias.includes("Quantidade ausente ou inválida"));
});
test("cálculo completo não implica validação administrativa",()=>{
 const r=validarCalculo(consolidarItens([item(1,2)]).grupos.map(precificarGrupo));
 assert.equal(r.valorCalculado,"300.00");assert.equal(r.situacao,"aguardando_validacao");assert.equal(r.validado,false);
});
