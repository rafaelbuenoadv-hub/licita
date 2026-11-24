import { test } from "node:test";
import assert from "node:assert/strict";
import { valorDasCotacoes, totalDoItem, totalDosItens, quadroDeItens, documentoDaSolicitacao, analiseCriticaDosPrecos, SEM_DESCARTES, type CotacaoItem } from "../../shared/solicitacao.js";

const cotacoes: CotacaoItem[] = [
  { fornecedor: "Fonte baixa", orcamento_id: null, valor_unitario: 10, descarte: { motivo: "inexequivel", justificativa: "Não cobre os insumos necessários." } },
  { fornecedor: "Fonte A", orcamento_id: null, valor_unitario: 100 },
  { fornecedor: "Fonte B", orcamento_id: null, valor_unitario: 120 },
  { fornecedor: "Fonte alta", orcamento_id: null, valor_unitario: 1000, descarte: { motivo: "elevado", justificativa: "Muito acima das referências equivalentes pesquisadas." } },
];
const item = { descricao: "Material escolar", unidade: "UN", quantidade: 2, valor_unitario: 99999, cotacoes };

test("descartes saem da média, mediana, menor preço e totais, sem apagar a cotação", () => {
  assert.equal(valorDasCotacoes(cotacoes), 110);
  assert.equal(valorDasCotacoes(cotacoes, "mediana"), 110);
  assert.equal(valorDasCotacoes(cotacoes, "menor"), 100);
  assert.equal(totalDoItem(item), 220);
  assert.equal(totalDosItens([item]), 220);
  assert.equal(cotacoes[0].valor_unitario, 10);
  assert.equal(cotacoes[3].valor_unitario, 1000);
  const restauradas = cotacoes.map(({ descarte, ...c }) => c);
  assert.equal(valorDasCotacoes(restauradas), 307.5);
  const todos = cotacoes.map((c) => ({ ...c, descarte: cotacoes[0].descarte }));
  assert.equal(valorDasCotacoes(todos), null);
  assert.equal(totalDoItem({ ...item, cotacoes: todos }), null);
});

test("quadro preserva os preços riscados e a justificativa sem duplicar após a mescla", () => {
  const base = "# Solicitação\n[[Itens]]\n\n## Prazo\nEntregar em 15 dias.\n\n@ Titular";
  const doc = documentoDaSolicitacao(base, [item]);
  assert.match(doc, /~~R\$\s10,00~~/); assert.match(doc, /~~R\$\s1\.000,00~~/);
  assert.match(doc, /R\$\s110,00/); assert.match(doc, /R\$\s220,00/);
  assert.match(doc, /Não cobre os insumos/); assert.match(doc, /Preço excessivamente elevado/);
  assert.doesNotMatch(doc, /99\.999,00/);
  assert.equal(documentoDaSolicitacao(doc, [item]), doc);
  const atualizado = documentoDaSolicitacao(doc, [{ ...item, valor_unitario: 307.5, cotacoes: cotacoes.map(({ descarte, ...c }) => c) }]);
  assert.doesNotMatch(atualizado, /~~|Preço descartado — item|Não cobre os insumos/);
  assert.match(atualizado, /Nenhum preço foi descartado/);
  assert.match(atualizado, /Entregar em 15 dias/); assert.match(atualizado, /@ Titular/);
  assert.equal(analiseCriticaDosPrecos([]), SEM_DESCARTES);
});

test("descartar uma cotação afeta apenas o preço daquele item", () => {
  const outroItem = { ...item, descricao: "Outro material", valor_unitario: 55, cotacoes: [{ ...cotacoes[0], descarte: undefined, valor_unitario: 55 }] };
  assert.equal(totalDosItens([item, outroItem]), 330);
  const quadro = quadroDeItens([item, outroItem], true);
  assert.equal(quadro.match(/~~R\$\s10,00~~/g)?.length, 1);
  assert.match(quadro, /R\$\s55,00/);
});
