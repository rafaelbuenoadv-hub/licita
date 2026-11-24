import { test } from "node:test";
import assert from "node:assert/strict";
import { documentoDaSolicitacao, inserirVerificacaoPac, verificacaoPacDoProcesso, MODELO_SOLICITACAO } from "../../shared/solicitacao.js";

const campos = { pac: { consta: "sim", item_pac: "Item 9 — Cadeiras", mes_planejado: "Março/2027", no_prazo: "nao", motivo_prazo: "Entrega antecipada para abertura das aulas." } };

test("Solicitação incorpora o registro completo do PAC no tópico do planejamento", () => {
  const doc = documentoDaSolicitacao(MODELO_SOLICITACAO.modelo, [], campos);
  assert.match(doc, /## 7\. Verificação no Plano Anual de Contratações \(PAC\)/);
  assert.match(doc, /Item 9 — Cadeiras/); assert.match(doc, /Março\/2027/);
  assert.match(doc, /Início no mês planejado:\*\* Não\./);
  assert.match(doc, /Entrega antecipada para abertura das aulas/);
  assert.match(doc, /## 8\. Pedido/); assert.match(doc, /@ \[\[Nome do secretário\]\]/);
  assert.doesNotMatch(doc, /\[\[Previsão no PAC\]\]/);
  assert.equal(inserirVerificacaoPac(doc, campos), doc);
});

test("tópico do PAC entra antes da data e assinatura em uma solicitação personalizada", () => {
  const original = "# Solicitação\nTexto editado pela Secretaria.\n\nIbaiti/PR, 24 de novembro de 2026.\n\n@ Responsável\n@ Secretário";
  const doc = inserirVerificacaoPac(original, campos);
  assert.match(doc, /Texto editado pela Secretaria/);
  assert.ok(doc.indexOf("## Verificação") < doc.indexOf("Ibaiti/PR"));
  assert.ok(doc.indexOf("## Verificação") < doc.indexOf("@ Responsável"));
  assert.equal(inserirVerificacaoPac(doc, campos), doc);
});

test("atualização do PAC substitui o resumo antigo e não duplica tópicos", () => {
  const original = "# Solicitação\n## 7. Alinhamento com o planejamento\nResumo anterior.\n\n## Previsão no PAC\nOutro resumo.\n\n## 8. Pedido\nPedido e nota manual.\n\n@ Titular";
  const doc = inserirVerificacaoPac(original, campos);
  assert.equal(doc.match(/## .*Verificação no Plano/g)?.length, 1);
  assert.doesNotMatch(doc, /Resumo anterior|Outro resumo/);
  assert.match(doc, /Pedido e nota manual/);
  const atualizado = inserirVerificacaoPac(doc, { pac: { consta: "nao", justificativa_inclusao: "Demanda surgida após o planejamento." } });
  assert.match(atualizado, /não consta/); assert.match(atualizado, /Demanda surgida após o planejamento/);
  assert.doesNotMatch(atualizado, /Item 9|Março\/2027|Entrega antecipada/);
  assert.equal(inserirVerificacaoPac(atualizado, { pac: { consta: "nao", justificativa_inclusao: "Demanda surgida após o planejamento." } }), atualizado);
});

test("verificação do PAC não inventa dados ausentes", () => {
  assert.equal(verificacaoPacDoProcesso({}), "");
  assert.equal(inserirVerificacaoPac("Pedido sem verificação", {}), "Pedido sem verificação");
  const incompleto = verificacaoPacDoProcesso({ pac: { consta: "sim" } });
  assert.match(incompleto, /\[\[PREENCHER: Item do PAC\]\]/);
  assert.match(incompleto, /\[\[PREENCHER: Mês previsto no PAC\]\]/);
  assert.doesNotMatch(incompleto, /Início no mês planejado:\*\* Sim/);
});
