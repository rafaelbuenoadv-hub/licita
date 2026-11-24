import { test } from "node:test";
import assert from "node:assert/strict";
import { lerRelatorioCotacao } from "../leitura-sem-ia.js";

// O detalhamento do Banco de Preços informa a unidade real. Uma precedência incorreta
// fazia qualquer unidade encontrada virar M³, impedindo relacionar itens em KG, UN etc.
for (const [detalhe, esperada] of [["Metros Cúbicos", "M³"], ["Metros Quadrados", "M²"], ["Quilogramas", "KG"], ["Toneladas", "T"], ["Unidades", "UN"]]) {
  test(`leitura do Banco de Preços preserva a unidade ${esperada}`, () => {
    const texto = [
      "Relatório de Cotação: Materiais",
      "Item 1", "Material cotado",
      "PREÇOS / QUANTIDADE PREÇO PERCENTUAL PREÇO EST. % VALOR TOTAL",
      "3/3 10 R$ 25,50 (un) - R$ 25,50 100% R$ 255,00",
      "Valor Global: R$ 255,00",
      "Item 1: Material cotado", "Quantidade Descrição", `10 ${detalhe}  Material cotado`,
      "www.bancodeprecos.com.br/CertificadoAutenticidade",
    ].join("\n");
    const lido = lerRelatorioCotacao(texto);
    assert.ok(lido);
    assert.equal(lido.fonte, "banco_precos");
    assert.equal(lido.itens.length, 1);
    assert.equal(lido.itens[0].unidade, esperada);
    assert.equal(lido.itens[0].valor_unitario, 25.5);
    assert.equal(lido.itens[0].quantidade, 10);
    assert.equal(lido.valor_total, 255);
  });
}
