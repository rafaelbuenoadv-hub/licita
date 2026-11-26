// Consulta de fornecedor: validação do CNPJ, cadastro da Receita (BrasilAPI) e certidão consolidada do TCU.
import { test } from "node:test";
import assert from "node:assert/strict";
import { consultarCnpj, lerCertidoesTcu, soDigitosCnpj, certidaoTcuPdf } from "../cnpj.js";
import { resumoDaConsulta } from "../../shared/cnpj.js";
import { alertasDosPrecos } from "../../shared/analise-precos.js";

const CNPJ = "76.169.879/0001-61";
const cadastro = { cnpj: "76169879000161", razao_social: "MUNICIPIO DE RESERVA", nome_fantasia: "", descricao_situacao_cadastral: "ATIVA", data_situacao_cadastral: "2005-11-03",
  porte: "DEMAIS", opcao_pelo_simples: false, cnae_fiscal: 8411600, cnae_fiscal_descricao: "Administração pública em geral", municipio: "RESERVA", uf: "PR", data_inicio_atividade: "1966-01-01" };
const tcu = (consta = false) => ({ cnpj: "76169879000161", codigoControle: "ABC123", certidoes: [
  { emissor: "TCU", tipo: "Licitantes Inidôneos", situacao: "NADA_CONSTA" },
  { emissor: "CNJ", tipo: "CNIA - Cadastro Nacional de Condenações Cíveis por Ato de Improbidade Administrativa", situacao: "NADA_CONSTA" },
  { emissor: "Portal da Transparência", tipo: "CEIS", situacao: consta ? "CONSTA" : "NADA_CONSTA", observacao: consta ? "Impedimento até 2027" : null },
  { emissor: "Portal da Transparência", tipo: "CNEP", situacao: "NADA_CONSTA" },
], certidaoPDF: Buffer.from("%PDF-1.4 certidao").toString("base64") });
const falso = (respostas: Record<string, { status: number; corpo?: unknown }>): typeof fetch => (async (url: string | URL) => {
  const u = String(url);
  const chave = Object.keys(respostas).find((k) => u.includes(k));
  if (!chave) throw new Error("fora do ar");
  const r = respostas[chave];
  return new Response(r.corpo === undefined ? null : JSON.stringify(r.corpo), { status: r.status, headers: { "content-type": "application/json" } });
}) as typeof fetch;

test("CNPJ: dígitos verificadores conferidos", () => {
  assert.equal(soDigitosCnpj(CNPJ), "76169879000161");
  assert.throws(() => soDigitosCnpj("76.169.879/0001-62"), /dígito verificador/);
  assert.throws(() => soDigitosCnpj("11111111111111"), /14 dígitos/);
});

test("consulta junta cadastro e sanções; uma fonte fora do ar não derruba a outra", async () => {
  const r = await consultarCnpj(CNPJ, falso({ "brasilapi": { status: 200, corpo: cadastro }, "certidoes-apf": { status: 200, corpo: tcu(true) } }));
  assert.equal(r.cadastro?.situacao, "ATIVA");
  assert.equal(r.cadastro?.cnae, "8411600 — Administração pública em geral");
  assert.equal(r.certidoes?.length, 4);
  const resumo = resumoDaConsulta(r);
  assert.deepEqual(resumo.sancoes, ["Portal da Transparência — CEIS"]);
  const so = await consultarCnpj(CNPJ, falso({ "brasilapi": { status: 200, corpo: { ...cadastro, descricao_situacao_cadastral: "BAIXADA" } } }));
  assert.equal(so.certidoes, null);
  assert.match(so.falhas.join(), /TCU indisponível/);
  assert.equal(resumoDaConsulta(so).sancoes_consultadas, false);
  const inexistente = await consultarCnpj(CNPJ, falso({ "brasilapi": { status: 404 }, "certidoes-apf": { status: 200, corpo: tcu() } }));
  assert.match(inexistente.falhas.join(), /não encontrado/);
  // Na pesquisa de preços: CNPJ baixado e sanção viram pontos de atenção.
  const alertas = alertasDosPrecos([{ descricao: "Pedra", unidade: "M3", quantidade: 1, valor_unitario: null, cotacoes: [
    { orcamento_id: null, fornecedor: "Empresa X", valor_unitario: 10, fonte: "fornecedor", verificacao: { ...resumo, situacao: "BAIXADA" } },
  ] }], "2026-11-26").map((a) => a.texto);
  assert.ok(alertas.some((a) => /situação cadastral “BAIXADA”/.test(a)), alertas.join("\n"));
  assert.ok(alertas.some((a) => /consta registro em Portal da Transparência — CEIS/.test(a)));
});

test("certidão do TCU em PDF para juntar", async () => {
  const r = await certidaoTcuPdf(CNPJ, falso({ "certidoes-apf": { status: 200, corpo: tcu() } }));
  assert.equal(r.pdf.toString(), "%PDF-1.4 certidao");
  assert.equal(r.codigo, "ABC123");
  await assert.rejects(certidaoTcuPdf(CNPJ, falso({ "certidoes-apf": { status: 200, corpo: { certidoes: [] } } })), /não devolveu o PDF/);
  assert.equal(lerCertidoesTcu({ certidoes: [{ tipo: "CEIS", situacao: "Nada consta" }] }).certidoes[0].situacao, "nada_consta");
});
