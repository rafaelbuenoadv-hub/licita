import { test } from "node:test";
import assert from "node:assert/strict";
import { documentoDaSolicitacao, inserirDocumentosDeApoio } from "../../shared/solicitacao.js";

test("relação dos documentos de apoio entra antes da assinatura sem duplicação", () => {
  const texto = "# Solicitação\nTexto revisado.\n\nIbaiti/PR, 24 de novembro de 2026.\n\n@ Responsável";
  const apoios = [{ nome: "levantamento.pdf" }, { nome: "foto.png" }];
  const doc = inserirDocumentosDeApoio(texto, apoios);
  assert.match(doc, /D1\. levantamento\.pdf/); assert.match(doc, /D2\. foto\.png/);
  assert.ok(doc.indexOf("Documentos de apoio anexados") < doc.indexOf("Ibaiti/PR"));
  assert.equal(inserirDocumentosDeApoio(doc, apoios), doc);
  const atualizado = inserirDocumentosDeApoio(doc, [{ nome: "versao-corrigida.pdf" }]);
  assert.match(atualizado, /D1\. versao-corrigida\.pdf/);
  assert.doesNotMatch(atualizado, /levantamento\.pdf|foto\.png/);
  assert.match(atualizado, /Texto revisado/); assert.match(atualizado, /@ Responsável/);
});

test("relação vazia retira o tópico gerado e mantém os demais tópicos", () => {
  const base = "# Pedido\n## Objeto\nMaterial escolar.\n\n@ Titular";
  const comAnexo = inserirDocumentosDeApoio(base, [{ nome: "apoio.txt" }]);
  const semAnexo = inserirDocumentosDeApoio(comAnexo, []);
  assert.doesNotMatch(semAnexo, /Documentos de apoio anexados|apoio\.txt/);
  assert.match(semAnexo, /Material escolar/); assert.match(semAnexo, /@ Titular/);
});

test("PAC e documentos de apoio convivem no mesmo pedido", () => {
  const campos = { pac: { consta: "nao", justificativa_inclusao: "Demanda nova." } };
  const apoios = [{ nome: "memorial.docx" }];
  const doc = documentoDaSolicitacao("# Solicitação\nTexto.\n\n@ Titular", [], campos, apoios);
  assert.match(doc, /Verificação no Plano Anual de Contratações/);
  assert.match(doc, /D1\. memorial\.docx/);
  assert.equal(documentoDaSolicitacao(doc, [], campos, apoios), doc);
});
