// Motor da pesquisa de preços: leitura dos preços individuais do Banco de Preços, inciso pela fonte,
// estatística, data-base e alertas (caso da grama do parecer da Procuradoria).
import { test } from "node:test";
import assert from "node:assert/strict";
import { precosDoItem, lerRelatorioCotacao } from "../leitura-sem-ia.js";
import { alertasDosPrecos, analiseDosPrecos, dataBaseDosPrecos, estatisticaDoItem, incisoDaCotacao, incisosUsados, quadroDasFontes } from "../../shared/analise-precos.js";
import type { ItemSolicitacao } from "../../shared/solicitacao.js";

test("relatório do Banco de Preços: cada preço individual com órgão, data e identificação", () => {
  const linhas = [
    "     Preço Compras                                                     Data",
    "                     Órgão Público                       Identificação",
    "     Governamentais                                                    Licitação",
    "     1                     76.309.806/0001-28 - MUNICIPIO DE CIANORTE / 1 - Unidade        76309806000128-      07/08/2026       R$ 7,80",
    "                           administrativa                                                   1-000220/2026",
    "     2                     MUNICIPIO DE IPAUSSU / 10.2026 - SECRETARIA DE OBRAS             44563583000134-      05/08/2026       R$ 13,00",
    "                                                                                            1-000248/2026",
    "     Valor Unitário                                                                                         R$ 10,40",
    "     Preço                                                              Data",
    "     Público",
    "     1             44.518.405/0001-91 - PREFEITURA MUNICIPAL DE CARLÓPOLIS            00005126         24/06/2026       R$ 17,00",
  ];
  const p = precosDoItem(linhas);
  assert.equal(p.length, 3);
  assert.deepEqual(p[0], { orgao: "MUNICIPIO DE CIANORTE / 1 - Unidade administrativa", cnpj: "76.309.806/0001-28", data: "2026-08-07", valor: 7.8, identificacao: "76309806000128-1-000220/2026", tipo: "compras" });
  assert.equal(p[1].identificacao, "44563583000134-1-000248/2026", "o código na linha de baixo completa a identificação, não o nome");
  assert.equal(p[1].orgao, "MUNICIPIO DE IPAUSSU / 10.2026 - SECRETARIA DE OBRAS");
  assert.equal(p[2].tipo, "publico");
  const relatorio = lerRelatorioCotacao(["Relatório de Cotação: GRAMA", "Relatório gerado no dia 17/11/2026 09:47:23", "", " Item 1", "", "GRAMA MATO GROSSO 4000 M²", "",
    "      PREÇOS /   QUANTIDADE   PREÇO EST.", "          3/3     4.000     R$ 12,60 (un)    -    R$ 12,60    100%    R$ 50.400,00", ...linhas].join("\n"));
  assert.equal(relatorio?.data, "2026-11-17", "a data da consulta é a de geração do relatório");
  assert.equal(relatorio?.itens[0].precos?.length, 3);
});

/** Os seis preços do Anexo A do parecer: três contratações (Banco de Preços) e três orçamentos, um deles de outro produto. */
const grama = (): ItemSolicitacao => ({
  descricao: "Grama Mato Grosso em placas", unidade: "M²", quantidade: 4000, valor_unitario: null, criterio: "media",
  cotacoes: [
    { orcamento_id: 1, fornecedor: "MUNICIPIO DE CIANORTE", valor_unitario: 7.8, fonte: "banco_precos", data_preco: "2026-08-07", consultado_em: "2026-11-17" },
    { orcamento_id: 1, fornecedor: "MUNICIPIO DE CARLOPOLIS", valor_unitario: 17, fonte: "banco_precos", data_preco: "2026-06-24", consultado_em: "2026-11-17" },
    { orcamento_id: 1, fornecedor: "MUNICIPIO DE LENCOIS PAULISTA", valor_unitario: 13, fonte: "banco_precos", data_preco: "2026-06-15", consultado_em: "2026-11-17" },
    { orcamento_id: 2, fornecedor: "Eco Plantem Brasil", valor_unitario: 8.5, fonte: "fornecedor", data_preco: "2026-11-11", frete: "nao_informado", produto: "Grama Mato Grosso" },
    { orcamento_id: 3, fornecedor: "Fabiano Siqueira Negri de Faria", valor_unitario: 12, fonte: "fornecedor", data_preco: "2026-11-13", frete: "incluso", produto: "Grama Mato Grosso" },
    { orcamento_id: 4, fornecedor: "Profeta Gomes da Silva Neto", valor_unitario: 6, fonte: "fornecedor", data_preco: "2026-11-24", frete: "incluso", produto: "Grama Batatais" },
  ],
});

test("estatística sobre os preços individuais, inciso pela fonte e data-base pelas datas dos preços", () => {
  const item = grama();
  const e = estatisticaDoItem(item)!;
  assert.equal(e.n, 6);
  assert.equal(Math.round(e.media * 100) / 100, 10.72);
  assert.equal(e.mediana, 10.25);
  assert.equal(Math.round(e.desvio! * 100) / 100, 4.05, "desvio-padrão amostral");
  assert.equal(Math.round(e.cv!), 38);
  assert.equal(incisoDaCotacao(item.cotacoes![0]), "II", "Banco de Preços = contratações similares, não mídia especializada");
  assert.equal(incisoDaCotacao(item.cotacoes![3]), "IV");
  assert.equal(incisoDaCotacao({ orcamento_id: 1, fornecedor: "Tabela de referência (PR) — SINAPI", valor_unitario: 1, fonte: "banco_precos" }), "III");
  assert.deepEqual(incisosUsados([item]), [["II", 3], ["IV", 3]]);
  assert.equal(dataBaseDosPrecos([item]), "15/06/2026 a 24/11/2026");
});

test("alertas: produto diferente, frete, dispersão; sem justificativa vira pendência", () => {
  const item = grama();
  const alertas = alertasDosPrecos([item], "2026-11-25").map((a) => `${a.fornecedor ?? "item"}: ${a.texto}`);
  assert.ok(alertas.some((a) => a.startsWith("Profeta") && /Grama Batatais.*não corresponder/.test(a)), alertas.join("\n"));
  assert.ok(alertas.some((a) => a.startsWith("Eco Plantem") && /frete não informado/.test(a)));
  assert.ok(alertas.some((a) => /dispersão elevada: coeficiente de variação de 37,8%/.test(a)), alertas.join("\n"));
  assert.ok(!alertas.some((a) => a.startsWith("Fabiano")), "proposta completa e do mesmo produto não gera alerta");
  const texto = analiseDosPrecos([item], "2026-11-25", "");
  assert.match(texto, /Não houve preço descartado/);
  assert.match(texto, /6 preços considerados, de R\$\s6,00 a R\$\s17,00; média de R\$\s10,72 e mediana de R\$\s10,25; coeficiente de variação de 37,8%/);
  assert.match(texto, /\[\[JUSTIFICAR: há pontos de atenção/);
  // Descartar o produto diferente e justificar o restante resolve a pendência.
  item.cotacoes![5].descarte = { motivo: "inexequivel", justificativa: "Grama Batatais, produto diverso do especificado." };
  const resolvido = analiseDosPrecos([item], "2026-11-25", "Frete confirmado por telefone em 25/11; dispersão decorre de quantidades distintas.");
  assert.doesNotMatch(resolvido, /\[\[JUSTIFICAR/);
  assert.match(resolvido, /Foram descartados 1 preço|Foram descartados 1 preços|Foram descartados/);
  assert.match(quadroDasFontes([item]), /\| 1 \| MUNICIPIO DE CIANORTE \| II \| 07\/08\/2026 \| 17\/11\/2026 \|/);
  assert.match(quadroDasFontes([item]), /Profeta Gomes da Silva Neto \(descartado\)/);
});

test("produto diferente do item é apontado; descrição mais detalhada do mesmo produto não", async () => {
  const { produtoDiverge } = await import("../../shared/analise-precos.js");
  assert.ok(produtoDiverge("Grama Batatais", "Grama Mato Grosso em placas"));
  assert.ok(produtoDiverge("USINAGEM DE BRITA GRADUADA TRATADA COM CIMENTO. AF_09/2025", "BRITA GRADUADA"));
  assert.ok(!produtoDiverge("Grama Mato Grosso", "Grama Mato Grosso em placas"));
  assert.ok(!produtoDiverge("Grama mato grosso em placas de primeira qualidade, entrega no local", "Grama Mato Grosso em placas"));
  assert.ok(!produtoDiverge("PEDRA BRITA N. 01", "Pedra brita nº 1"));
});

test("orçamento antigo e contratação com mais de um ano geram alerta", () => {
  const item: ItemSolicitacao = { descricao: "Cimento", unidade: "SC", quantidade: 10, valor_unitario: null, cotacoes: [
    { orcamento_id: null, fornecedor: "Loja A", valor_unitario: 30, fonte: "fornecedor", data_preco: "2026-01-10", frete: "incluso" },
    { orcamento_id: null, fornecedor: "Município X", valor_unitario: 31, fonte: "banco_precos", data_preco: "2025-09-01" },
    { orcamento_id: null, fornecedor: "Loja B", valor_unitario: 32, fonte: "fornecedor", data_preco: "2026-11-01", frete: "incluso" },
  ] };
  const alertas = alertasDosPrecos([item], "2026-11-25").map((a) => a.texto);
  assert.ok(alertas.includes("orçamento de 10/01/2026, com mais de 6 meses"), alertas.join("\n"));
  assert.ok(alertas.includes("contratação de 01/09/2025, com mais de 1 ano"));
});

test("conferência cruzada: SRP no DFD/ETP × contrato no TR, valores e modalidade", async () => {
  const { divergenciasEntrePecas, instrumentoSugerido, riscosSugeridos, tabelaDeRiscos } = await import("../../shared/coerencia-pecas.js");
  const itens: ItemSolicitacao[] = [{ descricao: "Grama", unidade: "M²", quantidade: 4000, valor_unitario: 10, cotacoes: [{ orcamento_id: null, fornecedor: "A", valor_unitario: 10 }] }];
  const campos = { dfd: { solucoes: "Pregão eletrônico pelo Sistema de Registro de Preços.", modalidade: "Pregão Eletrônico" }, etp: { vii: "Registro de preços com entregas parceladas." }, tr: { instrumento: "contrato" }, precos: { valor_total: "40.000,00" }, dot: { valor_total: "39.120,00" } };
  const d = divergenciasEntrePecas(campos, itens, "licitacao");
  assert.ok(d.some((x) => /DFD e o ETP tratam de Sistema de Registro de Preços, mas o Termo de Referência adota contrato/.test(x)), d.join("\n"));
  assert.ok(d.some((x) => /valor estimado difere.*R\$\s39\.120,00/.test(x)));
  assert.equal(instrumentoSugerido(campos, "bens", "licitacao"), "ata");
  assert.equal(instrumentoSugerido({}, "bens", "dispensa"), "empenho");
  assert.deepEqual(divergenciasEntrePecas({ ...campos, tr: { instrumento: "ata" }, dot: {} }, itens, "licitacao"), []);
  assert.ok(divergenciasEntrePecas({ dfd: { modalidade: "Dispensa de Licitação" } }, [], "licitacao")[0].includes("contratação direta"));
  const riscos = riscosSugeridos("bens", "perecivel", "licitacao");
  assert.ok(riscos.includes("perecimento") && riscos.includes("deserta"));
  assert.match(tabelaDeRiscos(riscos), /\| Perecimento ou perda de qualidade.*\| Alta \| Alto \|/);
});
