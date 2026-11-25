import test from "node:test";
import assert from "node:assert/strict";
import { projetarProcessoCentral } from "../services/processo-central/projecao.js";
import type { RegistrosCentrais } from "../../shared/processo-central.js";

function exemplo():RegistrosCentrais {
  return {
    identificacao:{id:1,orgao_id:2,protocolo:"P1",numero:"",procedimento:"",
      objeto:"Serviços",tipo:"servicos",via:"licitacao",requisitante:"Saúde",
      areas_adicionais:["Educação"],ano:2026,situacao:"preparacao",pca_item_id:null,
      valor_estimado:null,classe:"",normas:"",obs:"",atualizado_em:"2026-11-25"},
    demandas:[
      {id:10,secretaria:"Saúde",referencia:"",objeto:"",justificativa:"",informacoes:"",
        itens:[{descricao:"Higienização",quantidade:2,valor_unitario:null}],topicos_adicionais:[],orcamentos_ocultos:[]},
      {id:11,secretaria:"Educação",referencia:"",objeto:"",justificativa:"",informacoes:"",
        itens:[{descricao:"Higienização",quantidade:3,valor_unitario:150}],topicos_adicionais:[],orcamentos_ocultos:[]}
    ],campos:[],orcamentos:[],pca:null,documentos:[],anexos:[],revisoes:[],checagens:[]
  };
}
test("projeção mantém origem, dados ausentes e itens separados",()=>{
  const entrada=exemplo(); const antes=JSON.stringify(entrada);
  const p=projetarProcessoCentral(entrada);
  assert.deepEqual(p.secretarias,["Saúde","Educação"]);
  assert.deepEqual(p.itens.map(x=>x.solicitacao_id),[10,11]);
  assert.equal(p.itens.length,2);
  assert.equal(p.identificacao.valor_estimado,null);
  assert.equal(p.modo,"leitura_legado");
  assert.equal(JSON.stringify(entrada),antes);
});
test("versão é determinística e muda quando dado de origem muda",()=>{
  const a=exemplo(),b=exemplo();
  b.demandas[0].itens=[{valor_unitario:null,quantidade:2,descricao:"Higienização"}];
  assert.equal(projetarProcessoCentral(a).versaoDados,projetarProcessoCentral(b).versaoDados);
  b.identificacao.objeto="Outro objeto";
  assert.notEqual(projetarProcessoCentral(a).versaoDados,projetarProcessoCentral(b).versaoDados);
});
test("processo sem demanda ou PCA permanece consultável",()=>{
  const a=exemplo(); a.demandas=[]; a.identificacao.areas_adicionais=[];
  const p=projetarProcessoCentral(a);
  assert.deepEqual(p.itens,[]);
  assert.equal(p.pca,null);
  assert.deepEqual(p.secretarias,["Saúde"]);
});
