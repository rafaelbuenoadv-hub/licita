import { test } from "node:test";
import assert from "node:assert/strict";
import { documentoDaSolicitacao, inserirTopicosAdicionais } from "../../shared/solicitacao.js";

const texto = "# SOLICITAÇÃO\n## Objeto\nMaterial para a escola.\n\nIbaiti/PR, 24 de novembro de 2026.\n\n@ Responsável";

test("tópicos são opcionais e entram antes da data e assinatura", () => {
  assert.equal(inserirTopicosAdicionais(texto, []), texto);
  assert.equal(inserirTopicosAdicionais(texto, [{ titulo: " ", conteudo: "\n" }]), texto);
  const topicos = [{ titulo: "Entrega", conteudo: "Entregar no almoxarifado.\n\nAgendar com a secretaria." }, { titulo: "", conteudo: "Informar contato." }];
  const doc = inserirTopicosAdicionais(texto, topicos);
  assert.match(doc, /\*\*Entrega\*\*/);
  assert.match(doc, /\*\*Informações complementares\*\*/);
  assert.ok(doc.indexOf("Tópicos adicionais") < doc.indexOf("Ibaiti/PR"));
  const atualizado = inserirTopicosAdicionais(texto, [{ titulo: "Prazo", conteudo: "Entregar em 15 dias." }]);
  assert.doesNotMatch(atualizado, /almoxarifado|Informar contato/);
  assert.match(atualizado, /Entregar em 15 dias/);
  assert.equal(inserirTopicosAdicionais(texto, []), texto);
});

test("tópicos sobrevivem à mescla com itens, PAC e documentos de apoio sem duplicar", () => {
  const topicos = [{ titulo: "Entrega", conteudo: "Data sugerida: 20 de janeiro de 2027.\nConfirmar por telefone.\n## Observação\n@ Contato da unidade" }];
  const campos = { pac: { consta: "nao", justificativa_inclusao: "Demanda nova." } };
  const itens = [{ descricao: "Mesa escolar", unidade: "UN", quantidade: 2, valor_unitario: 100 }];
  const apoios = [{ nome: "memorial.pdf" }];
  const doc = documentoDaSolicitacao(texto, itens, campos, apoios, topicos);
  assert.match(doc, /Mesa escolar/); assert.match(doc, /Demanda nova/); assert.match(doc, /memorial\.pdf/);
  assert.match(doc, /Confirmar por telefone/); assert.match(doc, /\*\*Observação\*\*/);
  assert.equal(doc.match(/## Tópicos adicionais/g)?.length, 1);
  const removido = documentoDaSolicitacao(texto, itens, campos, apoios, []);
  assert.doesNotMatch(removido, /Tópicos adicionais|Confirmar por telefone|Contato da unidade/);
  assert.match(removido, /Mesa escolar/); assert.match(removido, /memorial\.pdf/); assert.match(removido, /@ Responsável/);
});

// Datas e parágrafos livres não viram parte do texto-base quando o campo é removido.
test("conteúdo terminado em data é preservado inteiro na exportação", () => {
  const base = "# Solicitação\nTexto.\n\n@ Titular";
  const topicos = [{ titulo: "Reunião", conteudo: "25 de novembro de 2026." }];
  const doc = documentoDaSolicitacao(base, [], { pac: { consta: "nao", justificativa_inclusao: "Demanda nova." } }, [{ nome: "apoio.pdf" }], topicos);
  assert.equal(doc.match(/25 de novembro de 2026/g)?.length, 1);
  assert.ok(doc.indexOf("Tópicos adicionais") > doc.indexOf("Documentos de apoio anexados"));
  assert.ok(doc.indexOf("25 de novembro") < doc.indexOf("@ Titular"));
  assert.equal(inserirTopicosAdicionais(base, []), base);
});
