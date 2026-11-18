// Testa as rotas de IA contra um servidor falso que imita a API da Anthropic.
// Confere o que o sistema envia (modelo, respaldo, saída estruturada) e o tratamento das respostas.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { PDFDocument, StandardFonts } from "pdf-lib";
import http from "node:http";
import type { AddressInfo } from "node:net";

const pedidos: { headers: http.IncomingHttpHeaders; body: any }[] = [];
let respostaEstruturada: object = {};
let textoStream = "";
let pararPor = "end_turn";
// Pedidos com ferramentas de pesquisa na web: texto próprio, citações, pausas (pause_turn) e falha simulada.
let textoPesquisa = "";
let pausasDaPesquisa = 0;
let pesquisaFalha = false;
// Pedidos com PDF recusados pela API (PDF protegido ou danificado).
let documentoFalha = false;
// Conta da Anthropic sem créditos: a API recusa todo pedido com 400.
let semCreditos = false;

const falso = http.createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    const body = JSON.parse(raw);
    pedidos.push({ headers: req.headers, body });
    const msg = (content: any[], stop: string) => ({
      id: "msg_teste", type: "message", role: "assistant", model: body.model, content, stop_reason: stop, stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    });
    if (semCreditos) {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits." } }));
      return;
    }
    const comDocumento = Array.isArray(body.messages?.[0]?.content) && body.messages[0].content.some((b: any) => b.type === "document");
    if (documentoFalha && comDocumento) {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "messages.0.content.0.pdf: The PDF specified was not valid." } }));
      return;
    }
    if (!body.stream) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(msg([{ type: "text", text: JSON.stringify(respostaEstruturada) }], pararPor)));
      return;
    }
    const pesquisa = Array.isArray(body.tools) && body.tools.some((t: any) => t.type === "web_search_20260209");
    if (pesquisa && pesquisaFalha) {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "web search is not enabled for this organization" } }));
      return;
    }
    res.writeHead(200, { "content-type": "text/event-stream" });
    const ev = (t: string, d: object) => res.write(`event: ${t}\ndata: ${JSON.stringify({ type: t, ...d })}\n\n`);
    ev("message_start", { message: msg([], null as any) });
    if (pesquisa) {
      // Uma busca, o resultado dela e o texto, com uma citação; na primeira volta a resposta pode vir pausada.
      const pausa = pausasDaPesquisa > 0;
      if (pausa) pausasDaPesquisa--;
      ev("content_block_start", { index: 0, content_block: { type: "server_tool_use", id: "srvtoolu_1", name: "web_search", input: {} } });
      ev("content_block_delta", { index: 0, delta: { type: "input_json_delta", partial_json: '{"query":"edital gavetário"}' } });
      ev("content_block_stop", { index: 0 });
      ev("content_block_start", { index: 1, content_block: { type: "web_search_tool_result", tool_use_id: "srvtoolu_1", content: [
        { type: "web_search_result", url: "https://pncp.gov.br/app/editais/1", title: "Edital 12/2026 - Município X", encrypted_content: "x", page_age: null },
        { type: "web_search_result", url: "https://exemplo.com/blog", title: "Blog não citado", encrypted_content: "y", page_age: null },
      ] } });
      ev("content_block_stop", { index: 1 });
      if (!pausa) {
        ev("content_block_start", { index: 2, content_block: { type: "text", text: "", citations: [] } });
        ev("content_block_delta", { index: 2, delta: { type: "citations_delta", citation: { type: "web_search_result_location", url: "https://pncp.gov.br/app/editais/1", title: "Edital 12/2026 - Município X", cited_text: "gavetário", encrypted_index: "i" } } });
        for (const parte of textoPesquisa.match(/[\s\S]{1,40}/g) ?? []) ev("content_block_delta", { index: 2, delta: { type: "text_delta", text: parte } });
        ev("content_block_stop", { index: 2 });
      }
      ev("message_delta", { delta: { stop_reason: pausa ? "pause_turn" : "end_turn", stop_sequence: null }, usage: { output_tokens: 10 } });
      ev("message_stop", {});
      res.end();
      return;
    }
    ev("content_block_start", { index: 0, content_block: { type: "text", text: "" } });
    for (const parte of textoStream.match(/[\s\S]{1,40}/g) ?? []) ev("content_block_delta", { index: 0, delta: { type: "text_delta", text: parte } });
    ev("content_block_stop", { index: 0 });
    ev("message_delta", { delta: { stop_reason: pararPor, stop_sequence: null }, usage: { output_tokens: 10 } });
    ev("message_stop", {});
    res.end();
  });
});

let base = "";
let server: http.Server;
let mod: any;
const SENHA = "senha-de-teste-123";
let cookie = "";
const api = async (metodo: string, url: string, corpo?: object) => {
  const headers: Record<string, string> = { "x-licita": "1", cookie };
  const body = corpo instanceof FormData ? corpo : corpo && JSON.stringify(corpo);
  if (typeof body === "string") headers["content-type"] = "application/json";
  const r = await fetch(base + url, { method: metodo, headers, body });
  const sc = r.headers.get("set-cookie");
  if (sc) cookie = sc.split(";")[0];
  return r;
};

/** Conclui a etapa 1 (verificação no PAC) para liberar o DFD. */
async function concluirPac(id: number) {
  const r = await api("PUT", `/api/processos/${id}/campos/pac`, { valores: { consta: "nao", justificativa_inclusao: "Demanda de teste.", autorizacao_prefeito: "Despacho de teste" } });
  if (r.status !== 200) throw new Error(await r.text());
  const m = await api("POST", `/api/processos/${id}/checagens`, { item: "pc1", marcado: true });
  if (m.status !== 200) throw new Error(await m.text());
}

before(async () => {
  await new Promise<void>((ok) => falso.listen(0, ok));
  process.env.ANTHROPIC_API_KEY = "chave-falsa";
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${(falso.address() as AddressInfo).port}`;
  mod = {
    db: await import("../db.js"), migrate: await import("../migrate.js"), auth: await import("../auth.js"), app: await import("../app.js"),
  };
  await mod.db.pool.query("drop schema public cascade; create schema public;");
  await mod.migrate.migrar();
  const o = await mod.db.q1("insert into orgaos (nome) values ('Município de Ibaiti') returning id");
  await mod.db.q1("insert into usuarios (orgao_id, nome, email, senha_hash, papeis) values ($1,'Req','req@t.gov.br',$2,'{requisitante,contratacao}')", [o.id, await mod.auth.hashSenha(SENHA)]);
  server = mod.app.criarApp().listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  await api("POST", "/api/auth/entrar", { email: "req@t.gov.br", senha: SENHA });
});
after(async () => { server.close(); falso.close(); await mod.db.pool.end(); });

let proc = 0;

test("ajuda do campo usa o formulário e a análise retorna só referências oficiais", async () => {
  const dados = { objeto: "Manutenção de ar-condicionado", tipo: "servicos", via: "licitacao", classe: "", obs: "" };
  respostaEstruturada = {
    aplicaveis: [{ indice: 0, motivo: "Disciplina a contratação de serviços." }, { indice: 99, motivo: "Referência ausente." }],
    observacao: "Confira a modalidade.",
  };
  const normas = await api("POST", "/api/ia/regulamentos", dados);
  assert.equal(normas.status, 200);
  const analise: any = await normas.json();
  assert.match(analise.normas, /Lei Federal nº 14\.133\/2021/);
  assert.doesNotMatch(analise.normas, /Referência ausente/);
  textoStream = "Descreva a manutenção preventiva e corretiva.";
  const ajuda = await api("POST", "/api/ia/ajuda-campo", {
    campo: "objeto",
    contexto: { ...dados, ano: "2026", valor: "", requisitantes: ["Administração"], normas: "", pca: null },
    mensagens: [{ role: "user", content: "Como devo descrever este objeto?" }],
  });
  assert.equal(ajuda.status, 200);
  const resposta = (await ajuda.text()).trim().split("\n").map((linha) => JSON.parse(linha).d ?? "").join("");
  assert.match(resposta, /preventiva e corretiva/);
  assert.match(pedidos.at(-1)!.body.messages[0].content, /campo "objeto"/);
  assert.match(pedidos.at(-1)!.body.messages[0].content, /Manutenção de ar-condicionado/);
});

test("extrair dados de um memorando usa saída estruturada e respaldo", async () => {
  respostaEstruturada = { requisitante: "Secretaria de Obras", objeto: "Construção de gavetário", valor_estimado: 114969.14, classe: "obras", tipo: "obra", via: "dispensa", normas: null, obs: "60 dias" };
  const r = await api("POST", "/api/ia/extrair", { texto: "Memorando 15/2026 da Secretaria de Obras pedindo gavetário." });
  assert.equal(r.status, 200);
  const j: any = await r.json();
  assert.equal(j.dados.tipo, "obra");
  const p = pedidos.at(-1)!;
  assert.equal(p.body.model, "claude-opus-5-5");
  assert.equal(p.body.fallbacks, "default");
  assert.match(String(p.headers["anthropic-beta"]), /server-side-fallback-2026-07-01/);
  assert.equal(p.body.output_config.format.type, "json_schema");
  assert.ok(!("thinking" in p.body) || p.body.thinking.type === "adaptive");
  assert.ok(!("temperature" in p.body));
});

test("redigir minuta transmite o texto e salva nova versão", async () => {
  const c = await api("POST", "/api/processos", { objeto: "Construção de gavetário", tipo: "obra", via: "dispensa", ano: 2026, requisitante: "Obras", areas_adicionais: ["Administração"] });
  proc = ((await c.json()) as any).id;
  await concluirPac(proc);
  textoStream = "# DOCUMENTO DE FORMALIZAÇÃO DA DEMANDA\nProcesso nº [[PREENCHER: número]]\n## 1. Área requisitante\nSecretaria de Obras.";
  const r = await api("POST", `/api/processos/${proc}/ia/redigir`, { etapa: "dfd" });
  const linhas = (await r.text()).trim().split("\n").map((l) => JSON.parse(l));
  const fim = linhas.at(-1);
  assert.equal(fim.fim, true, JSON.stringify(fim));
  assert.equal(fim.versao, 1);
  assert.equal(linhas.filter((l) => l.d).map((l) => l.d).join(""), textoStream);
  const enviado = pedidos.at(-1)!.body;
  assert.equal(enviado.stream, true);
  const contexto = enviado.messages[0].content;
  assert.match(contexto, /MODELO DO DOCUMENTO/);
  assert.match(contexto, /Lei Federal nº 14\.133\/2021/);
  assert.match(contexto, /Decreto Municipal nº 2\.532\/2024, arts\. 2º e 3º/);
  assert.match(contexto, /Acórdão nº 2490\/2026/);
  assert.match(contexto, /Acórdão nº 2060\/2026/);
  const m: any = await (await api("GET", `/api/processos/${proc}/minutas/dfd`)).json();
  assert.equal(m.vigente.origem, "ia");
});

test("sugestões só valem para campos existentes; índices inválidos são descartados", async () => {
  respostaEstruturada = { sugestoes: [{ i: 0, valor: "367/2026", fonte: "Memorando", falta: "" }, { i: 7, valor: "x", fonte: "", falta: "" }] };
  const r = await api("POST", `/api/processos/${proc}/ia/sugerir`, { etapa: "dfd" });
  const j: any = await r.json();
  assert.equal(r.status, 200, JSON.stringify(j));
  assert.equal(j.sugestoes.length, 1);
  assert.match(pedidos.at(-1)!.body.messages[0].content, /JURISPRUDÊNCIA DO TCE-PR/);
  assert.equal(j.versao, 1);
});

test("recusa do modelo vira mensagem amigável", async () => {
  pararPor = "refusal";
  textoStream = "";
  const r = await api("POST", `/api/processos/${proc}/ia/chat`, { etapa: "dfd", mensagens: [{ role: "user", content: "Olá" }] });
  const fim = JSON.parse((await r.text()).trim().split("\n").at(-1)!);
  assert.match(fim.erro, /não pôde atender/);
  pararPor = "end_turn";
});

test("IA de revisão lê todas as páginas e analisa parecer no mesmo PDF dos autos", async () => {
  const criacao = await api("POST", "/api/revisoes", { numero: "19/2024", objeto: "Manutenção de escola", via: "dispensa" });
  assert.equal(criacao.status, 201);
  const caminho = `/api/revisoes/${(await criacao.json()).id}`;
  assert.equal((await api("POST", `${caminho}/ia`, { tipo: "saneamento" })).status, 400);
  const pdf = await PDFDocument.create();
  for (let p = 0; p < 41; p++) pdf.addPage();
  const form = new FormData();
  form.append("tipo", "autos");
  form.append("arquivo", new Blob([Uint8Array.from(await pdf.save())], { type: "application/pdf" }), "autos.pdf");
  assert.equal((await api("POST", `${caminho}/arquivos`, form)).status, 201);
  textoStream = "O parecer consta do PDF. Recomendação de complementar a pesquisa.";
  respostaEstruturada = {
    minuta: "Minuta de resposta para conferência",
    recomendacoes: [{ descricao: "Complementar a pesquisa", referencia: "autos.pdf, p. 41", ajuste: "Juntar pesquisa complementar" }],
  };
  const antes = pedidos.length;
  const resposta = await api("POST", `${caminho}/ia`, { tipo: "saneamento" });
  assert.equal(resposta.status, 200);
  const fim = JSON.parse((await resposta.text()).trim().split("\n").at(-1)!);
  assert.equal(fim.fim, true, JSON.stringify(fim));
  assert.deepEqual(fim.recomendacoes, (respostaEstruturada as { recomendacoes: unknown[] }).recomendacoes);
  const [primeiro, ultimo, consolidacao] = pedidos.slice(antes).map((p) => p.body.messages[0].content);
  assert.equal(pedidos.length - antes, 3);
  assert.match(primeiro[0].source.data, /^JVBER/);
  assert.match(primeiro[1].text, /páginas 1 a 40/);
  assert.match(ultimo[1].text, /páginas 41 a 41/);
  assert.match(consolidacao, /Lei Federal nº 14\.133\/2021/);
  assert.match(consolidacao, /Acórdão/);
  assert.match(consolidacao, /O parecer consta do PDF/);
  const detalhe = await (await api("GET", caminho)).json();
  assert.deepEqual(detalhe.minutas, []);
  assert.deepEqual(detalhe.recomendacoes, []);
});

test("IA redige a solicitação usando o PDF e aguarda o salvamento pelo usuário", async () => {
  const r = await api("POST", "/api/processos", { objeto: "Manutenção de climatização", tipo: "servicos", via: "licitacao", ano: 2026 });
  assert.equal(r.status, 201);
  const id = (await r.json()).id;
  const caminho = `/api/processos/${id}/solicitacoes`;
  const pdf = await PDFDocument.create();
  pdf.addPage();
  const dados = new FormData();
  dados.set("secretaria", "Secretaria de Educação");
  dados.set("descricao", "Priorizar a escola municipal.");
  dados.set("arquivo", new Blob([Uint8Array.from(await pdf.save())], { type: "application/pdf" }), "pedido.pdf");
  textoStream = "Manutenção preventiva de 8 aparelhos.";
  respostaEstruturada = { descricao: "Solicito a manutenção preventiva de 8 aparelhos de climatização da escola municipal." };
  const antes = pedidos.length;
  const gerada = await api("POST", `${caminho}/ia`, dados);
  assert.equal(gerada.status, 200);
  const rascunho = (await gerada.json()).descricao;
  assert.match(rascunho, /manutenção preventiva de 8 aparelhos/);
  assert.match(rascunho, /\[\[Nome do secretário\]\]/);
  assert.match(rascunho, /\[\[Portaria de nomeação\]\]/);
  assert.match(pedidos[antes].body.messages[0].content[0].source.data, /^JVBER/);
  assert.match(pedidos[antes + 1].body.messages[0].content, /Secretaria de Educação/);
  assert.match(pedidos[antes + 1].body.messages[0].content, /8 aparelhos/);
  assert.match(pedidos[antes + 1].body.messages[0].content, /Priorizar a escola municipal/);
  assert.match(pedidos[antes + 1].body.messages[0].content, /MODELO DA SOLICITAÇÃO/);
  assert.deepEqual((await (await api("GET", `/api/processos/${id}`)).json()).solicitacoes, []);
});

test("leitura de orçamento: envia o arquivo à IA, guarda os dados e não sobrescreve valor digitado", async () => {
  const novo = await api("POST", "/api/processos", { objeto: "Aquisição de cadeiras escolares", tipo: "bens", via: "dispensa", ano: 2026 });
  const { id } = (await novo.json()) as { id: number };
  const fd = new FormData();
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
  fd.append("arquivo", new Blob([png]), "foto do orçamento.png");
  fd.append("arquivo", new Blob(["Proposta comercial: 30 cadeiras a R$ 300,00"]), "proposta.txt");
  fd.append("arquivo", new Blob(["PK"]), "planilha.xlsx");
  const env = await api("POST", `/api/processos/${id}/orcamentos`, fd);
  assert.equal(env.status, 201);
  const [foto, txt, xlsx] = ((await env.json()) as { ids: number[] }).ids;

  const lido = { fornecedor: "Móveis Escolares Ltda", cnpj: "12.345.678/0001-90", data: "2026-11-10", validade: "10/12/2026",
    itens: [{ descricao: "Cadeira escolar", unidade: "un", quantidade: 30, valor_unitario: 300, valor_total: 9000 }],
    valor_total: 9000, frete: "incluso", instalacao: "nao_informado", prazo_entrega: "15 dias", observacoes: null };
  respostaEstruturada = lido;
  const r = await api("POST", `/api/processos/${id}/orcamentos/${foto}/ler`, {});
  assert.equal(r.status, 200);
  const j: any = await r.json();
  assert.equal(j.valor, 9000);
  assert.equal(j.dados.validade, null, "data fora do formato AAAA-MM-DD é descartada");
  // A foto vai como imagem, junto da instrução.
  const conteudo = pedidos.at(-1)!.body.messages[0].content;
  assert.deepEqual(conteudo[0].source, { type: "base64", media_type: "image/png", data: png.toString("base64") });
  assert.match(conteudo[1].text, /Não calcule nem deduza valor/);

  // Valor digitado antes prevalece sobre o lido; texto vai como texto.
  assert.equal((await api("PUT", `/api/processos/${id}/orcamentos/${txt}`, { valor: 8500 })).status, 200);
  respostaEstruturada = { ...lido, fornecedor: "Outra Empresa ME", cnpj: "98.765.432/0001-10", validade: "2026-12-10", frete: "nao_incluso" };
  const r2: any = await (await api("POST", `/api/processos/${id}/orcamentos/${txt}/ler`, {})).json();
  assert.equal(r2.valor, 8500);
  assert.match(pedidos.at(-1)!.body.messages[0].content, /TEXTO\nProposta comercial: 30 cadeiras/);
  // Planilha não é lida; orçamento de outro processo não é encontrado.
  assert.equal((await api("POST", `/api/processos/${id}/orcamentos/${xlsx}/ler`, {})).status, 415);
  assert.equal((await api("POST", `/api/processos/${id}/orcamentos/999999/ler`, {})).status, 404);

  const det: any = await (await api("GET", `/api/processos/${id}`)).json();
  const o = det.orcamentos.find((x: any) => x.id === foto);
  assert.equal(o.fornecedor, "Móveis Escolares Ltda");
  assert.equal(o.dados.itens[0].valor_total, 9000);
  assert.ok(o.lido_em);
  assert.equal(det.orcamentos.find((x: any) => x.id === xlsx).dados, null);

  // A comparação aponta o frete incluído em uma proposta e não na outra.
  const { compararOrcamentos } = await import("../../shared/orcamentos.js");
  const alertas = compararOrcamentos(det.orcamentos, "2026-11-16");
  assert.equal(alertas.length, 1);
  assert.match(alertas[0].texto, /frete está incluído em Móveis Escolares Ltda, mas não em Outra Empresa ME/);
});

test("comparação de orçamentos aponta soma divergente, validade vencida, dados ausentes e fornecedor repetido", async () => {
  const { compararOrcamentos } = await import("../../shared/orcamentos.js");
  const base = { fornecedor: "A Ltda", cnpj: "11.111.111/0001-11", data: "2026-11-01", validade: "2026-12-01", valor_total: 100, frete: "nao_informado", instalacao: "nao_informado", prazo_entrega: null, observacoes: null,
    itens: [{ descricao: "X", unidade: "un", quantidade: 2, valor_unitario: 50, valor_total: null }] };
  assert.deepEqual(compararOrcamentos([{ id: 1, nome: "a.pdf", dados: base as any }, { id: 2, nome: "sem leitura.xlsx", dados: null }], "2026-11-16"), []);
  const textos = compararOrcamentos([
    { id: 1, nome: "a.pdf", dados: { ...base, valor_total: 120, validade: "2026-11-10" } as any },
    { id: 2, nome: "b.pdf", dados: { ...base, cnpj: "11111111000111", data: null, itens: [...base.itens, ...base.itens] } as any },
    { id: 3, nome: "c.pdf", dados: { ...base, fornecedor: null, cnpj: null, instalacao: "incluso" } as any },
    { id: 4, nome: "d.pdf", dados: { ...base, fornecedor: "D ME", cnpj: "22.222.222/0001-22", instalacao: "nao_incluso" } as any },
  ], "2026-11-16").map((a: { texto: string }) => a.texto);
  assert.ok(textos.some((t: string) => /instalação ou montagem em c\.pdf, mas não em D ME/.test(t)));
  assert.ok(textos.some((t: string) => /não têm o mesmo número de itens/.test(t)));
  assert.ok(textos.some((t: string) => /A Ltda: a soma dos itens \(R\$\s100,00\) difere do total informado \(R\$\s120,00\)/.test(t)));
  assert.ok(textos.some((t: string) => /a validade da proposta venceu em 10\/11\/2026/.test(t)));
  assert.ok(textos.some((t: string) => /A Ltda: o orçamento não traz data/.test(t)));
  assert.ok(textos.some((t: string) => /c\.pdf: o orçamento não traz CNPJ/.test(t)));
  assert.ok(textos.some((t: string) => /Há 2 orçamentos do mesmo fornecedor \(A Ltda\)/.test(t)));
});

test("agente de contratação: recebe o campo, o formulário e o processo da tela, e devolve a sugestão", async () => {
  const novo = await api("POST", "/api/processos", { objeto: "Aquisição de cadeiras escolares", tipo: "bens", via: "dispensa", ano: 2026, requisitante: "Educação" });
  const { id } = (await novo.json()) as { id: number };
  textoStream = "Descreva o que a escola precisa, sem marca.\n\nSUGESTÃO PARA O CAMPO:\nSubstituir cadeiras quebradas das escolas municipais.";
  const corpo = {
    campo: { rotulo: "Justificativa", valor: "", opcoes: [], linhas: true, limite: 8000 },
    pagina: { titulo: "Aquisição de cadeiras escolares", caminho: `/processos/${id}` },
    formulario: [{ rotulo: "Secretaria", valor: "Educação" }],
    processo_id: id,
    mensagens: [{ role: "user", content: "Como devo preencher este campo?" }],
  };
  const r = await api("POST", "/api/ia/agente", corpo);
  assert.equal(r.status, 200);
  const linhas = (await r.text()).trim().split("\n").map((l) => JSON.parse(l));
  assert.equal(linhas.filter((l) => l.d).map((l) => l.d).join(""), textoStream);
  assert.equal(linhas.at(-1).fim, true);
  const enviado = pedidos.at(-1)!.body;
  const instrucao = enviado.messages[0].content as string;
  assert.match(instrucao, /agente de contratação do órgão \(Lei nº 14\.133\/2021, art\. 8º\)/);
  assert.match(instrucao, /"rotulo":"Justificativa"/);
  assert.match(instrucao, /"objeto":"Aquisição de cadeiras escolares"/);
  assert.match(instrucao, /O campo aceita texto longo\. Limite de 8000 caracteres\./);
  assert.equal(enviado.messages.at(-1).content, "Como devo preencher este campo?");

  // Campo de escolha: a instrução limita a sugestão às opções. Processo de outro órgão não entra no contexto.
  const r2 = await api("POST", "/api/ia/agente", { ...corpo, processo_id: 999999, campo: { rotulo: "Forma de contratação", valor: "", opcoes: ["Dispensa por valor", "Inexigibilidade"], linhas: false, limite: null } });
  assert.equal(r2.status, 200); await r2.text();
  const i2 = pedidos.at(-1)!.body.messages[0].content as string;
  assert.match(i2, /a sugestão deve ser exatamente uma das opções listadas/);
  assert.match(i2, /PROCESSO ABERTO: nenhum/);
  // Conversa fora de ordem e campo sem rótulo são recusados.
  assert.equal((await api("POST", "/api/ia/agente", { ...corpo, mensagens: [{ role: "assistant", content: "x" }] })).status, 400);
  assert.equal((await api("POST", "/api/ia/agente", { ...corpo, campo: { ...corpo.campo, rotulo: " " } })).status, 400);
});

test("a aba Solicitação usa o próprio modelo e o DFD aproveita o pedido registrado", async () => {
  const criada = await api("POST", "/api/processos", { objeto: "Aquisição de materiais de expediente", tipo: "bens", via: "licitacao", ano: 2026 });
  assert.equal(criada.status, 201);
  const caminho = `/api/processos/${(await criada.json()).id}`;
  const salva = await api("POST", `${caminho}/solicitacoes`, {
    chave_envio: crypto.randomUUID(), secretaria: "Educação", referencia: "Memorando de teste",
    descricao: "Reposição de 20 caixas para as escolas.",
  });
  assert.equal(salva.status, 201);
  const mensagens = [{ role: "user", content: "Confira o pedido." }];
  textoStream = "Revise a quantidade informada.";
  const pedido = await api("POST", `${caminho}/ia/chat`, { etapa: "solicitacao", mensagens });
  assert.equal(pedido.status, 200);
  assert.match(await pedido.text(), /"fim":true/);
  const ctxPedido = pedidos.at(-1)!.body.messages[0].content;
  assert.match(ctxPedido, /ABA ABERTA: Solicitação/);
  assert.match(ctxPedido, /SOLICITAÇÃO DE CONTRATAÇÃO/);
  assert.doesNotMatch(ctxPedido, /CHECKLIST DA ETAPA/);

  const dfd = await api("POST", `${caminho}/ia/chat`, { etapa: "dfd", mensagens });
  assert.equal(dfd.status, 200);
  await dfd.text();
  const ctxDfd = pedidos.at(-1)!.body.messages[0].content;
  assert.match(ctxDfd, /ETAPA ABERTA: DFD/);
  assert.match(ctxDfd, /CHECKLIST DA ETAPA/);
  assert.match(ctxDfd, /Reposição de 20 caixas para as escolas/);

  const semMinutaAvulsa = await api("POST", `${caminho}/ia/redigir`, { etapa: "solicitacao" });
  assert.equal(semMinutaAvulsa.status, 404);
});

test("a IA combina anexos salvos e novos para sugerir os campos da solicitação", async () => {
  const criada = await api("POST", "/api/processos", { objeto: "Iluminação de escolas", tipo: "bens", via: "licitacao", ano: 2026 });
  assert.equal(criada.status, 201);
  const rota = `/api/processos/${(await criada.json()).id}/solicitacoes`;
  const salva = new FormData();
  salva.set("chave_envio", crypto.randomUUID());
  salva.set("secretaria", "Educação");
  salva.set("descricao", "Reposição de iluminação");
  salva.append("apoios", new Blob(["Motivo: lâmpadas apagadas nas salas da escola."]), "justificativa.txt");
  const registrada = await api("POST", rota, salva);
  assert.equal(registrada.status, 201);
  const consulta = new FormData();
  consulta.set("solicitacao_id", String((await registrada.json()).id));
  consulta.set("secretaria", "Educação");
  consulta.append("apoios", new Blob(["Levantamento: 12 luminárias, unidade." ]), "quantidades.txt");
  consulta.append("apoios", new Blob(["Isto não é um PDF válido."]), "ilegivel.pdf");
  respostaEstruturada = { descricao: "# SOLICITAÇÃO\n[[Itens]]", objeto_solicitacao: "Aquisição de luminárias",
    justificativa: "Restabelecer a iluminação nas salas.", itens: [{ descricao: "Luminária", unidade: "un", quantidade: 12 }] };
  const resultado = await api("POST", `${rota}/ia`, consulta);
  assert.equal(resultado.status, 200);
  const r = await resultado.json();
  assert.equal(r.objeto, "Aquisição de luminárias");
  assert.equal(r.justificativa, "Restabelecer a iluminação nas salas.");
  assert.deepEqual(r.itens, [{ descricao: "Luminária", unidade: "un", quantidade: 12, valor_unitario: null, cotacoes: [] }]);
  assert.deepEqual(r.avisos, ["ilegivel.pdf"]);
  const contexto = pedidos.at(-1)!.body.messages[0].content;
  assert.match(contexto, /justificativa.txt\nMotivo: lâmpadas apagadas/);
  assert.match(contexto, /quantidades.txt\nLevantamento: 12 luminárias/);
});

test("a minuta usa os orçamentos vinculados e os preços calculados para esta solicitação", async () => {
  const processo = await api("POST", "/api/processos", { objeto: "Aquisição de luminárias", tipo: "bens", via: "licitacao", ano: 2026 });
  assert.equal(processo.status, 201);
  const caminho = `/api/processos/${(await processo.json()).id}`;
  const rota = `${caminho}/solicitacoes`;
  const enviarCotacao = async (nome: string, texto: string) => {
    const form = new FormData();
    form.append("arquivo", new Blob([texto]), nome);
    const r = await api("POST", `${caminho}/orcamentos?origem=solicitacao`, form);
    assert.equal(r.status, 201);
    return (await r.json()).ids[0] as number;
  };
  const id = await enviarCotacao("luminarias.txt", "Fornecedor: Luz do Sul. Luminárias a R$ 30,00 por unidade. Prazo de entrega de 15 dias.");
  const segunda = await enviarCotacao("segunda-proposta.txt", "Luminárias a R$ 50,00 por unidade.");
  await enviarCotacao("outra-secretaria.txt", "COTAÇÃO ÚNICA DA OUTRA SECRETARIA");
  const itens = [{ descricao: "Luminária", unidade: "un", quantidade: 12, valor_unitario: 999, cotacoes: [
    { orcamento_id: id, fornecedor: "Luz do Sul", valor_unitario: 30 },
    { orcamento_id: segunda, fornecedor: "Outra empresa", valor_unitario: 50 },
  ] }];
  const form = new FormData();
  form.set("secretaria", "Educação");
  form.set("itens", JSON.stringify(itens));
  form.append("apoios", new Blob(["Levantamento escolar de 12 luminárias."]), "levantamento.txt");

  respostaEstruturada = { descricao: "# SOLICITAÇÃO\n[[Itens]]" };
  const rascunho = await api("POST", `${rota}/ia`, form);
  assert.equal(rascunho.status, 200, await rascunho.clone().text());
  let contexto = pedidos.at(-1)!.body.messages[0].content;
  assert.match(contexto, /levantamento.txt\nLevantamento escolar de 12 luminárias/);
  assert.match(contexto, /luminarias.txt[^\n]+\nFornecedor: Luz do Sul[^\n]+Prazo de entrega de 15 dias/);
  assert.match(contexto, /"valor_unitario":40/);
  assert.match(contexto, /"total_estimado":480/);
  assert.doesNotMatch(contexto, /999|COTAÇÃO ÚNICA DA OUTRA SECRETARIA/);

  const salva = await api("POST", rota, { chave_envio: crypto.randomUUID(), secretaria: "Educação", descricao: "Reposição de iluminação", itens });
  assert.equal(salva.status, 201, await salva.clone().text());
  const gerada = await api("POST", `${rota}/ia`, { secretaria: "Educação", solicitacao_id: (await salva.json()).id });
  assert.equal(gerada.status, 200, await gerada.clone().text());
  contexto = pedidos.at(-1)!.body.messages[0].content;
  assert.match(contexto, /luminarias.txt/);
  assert.match(contexto, /"total_estimado":480/);

  const invalida = await api("POST", `${rota}/ia`, { secretaria: "Educação", itens: [{ ...itens[0], cotacoes: [
    { orcamento_id: 2147483647, fornecedor: "Fornecedor sem vínculo", valor_unitario: 12 },
  ] }] });
  assert.equal(invalida.status, 409);
});

test("uma solicitação reúne mais de cinco documentos e a IA consulta os novos e os salvos", async () => {
  const processo = await api("POST", "/api/processos", { objeto: "Aquisição de material escolar", tipo: "bens", via: "licitacao", ano: 2026 });
  assert.equal(processo.status, 201);
  const caminho = `/api/processos/${(await processo.json()).id}`;
  const rota = `${caminho}/solicitacoes`;
  const chave = crypto.randomUUID();
  const enviar = async (i: number) => {
    const fd = new FormData();
    fd.set("chave", chave);
    fd.append("apoios", new Blob([`Justificativa independente ${i}`]), `apoio-${i}.txt`);
    const r = await api("POST", `${rota}/apoios`, fd);
    assert.equal(r.status, 201, await r.clone().text());
    return (await r.json()).ids[0];
  };
  const ids: number[] = [];
  for (let i = 1; i <= 8; i++) ids.push(await enviar(i));
  assert.equal(await enviar(1), ids[0]);
  const base = { secretaria: "Educação", chave_apoios: chave, apoios_ids: ids };
  assert.equal((await api("POST", rota, { ...base, chave_envio: chave, chave_apoios: crypto.randomUUID() })).status, 409);
  assert.deepEqual((await (await api("GET", caminho)).json()).solicitacoes, []);

  respostaEstruturada = { descricao: "# SOLICITAÇÃO DE MATERIAL ESCOLAR" };
  const gerada = await api("POST", `${rota}/ia`, base);
  assert.equal(gerada.status, 200, await gerada.clone().text());
  assert.deepEqual((await gerada.json()).avisos, []);
  let contexto = pedidos.at(-1)!.body.messages[0].content;
  assert.match(contexto, /apoio-1.txt\nJustificativa independente 1/);
  assert.match(contexto, /apoio-8.txt\nJustificativa independente 8/);

  const salva = await api("POST", rota, { ...base, chave_envio: chave });
  assert.equal(salva.status, 201, await salva.clone().text());
  const id = (await salva.json()).id;
  const maisUm = await enviar(9);
  const edicao = { secretaria: "Educação", chave_apoios: chave, apoios_ids: [maisUm] };
  const revisada = await api("POST", `${rota}/ia`, { ...edicao, solicitacao_id: id });
  assert.equal(revisada.status, 200, await revisada.clone().text());
  contexto = pedidos.at(-1)!.body.messages[0].content;
  assert.match(contexto, /apoio-8.txt\nJustificativa independente 8/);
  assert.match(contexto, /apoio-9.txt\nJustificativa independente 9/);
  assert.equal((await api("PUT", `${rota}/${id}`, { ...edicao, anterior: "", descricao: "" })).status, 200);
  assert.equal((await (await api("GET", caminho)).json()).solicitacoes[0].apoios.length, 9);
});

test("redigir com pesquisa: busca editais e legislação, guarda o dossiê com as fontes e redige com a fundamentação", async () => {
  const c = await api("POST", "/api/processos", { objeto: "Construção de gavetário no cemitério municipal", tipo: "obra", via: "dispensa", ano: 2026, requisitante: "Obras" });
  const id = ((await c.json()) as any).id;
  await concluirPac(id);
  textoStream = "# DOCUMENTO DE FORMALIZAÇÃO DA DEMANDA\n## 1. Objeto\nGavetário (art. 72, I, da Lei nº 14.133/2021).";
  textoPesquisa = "Vou consultar o PNCP.\nDOSSIÊ DE PESQUISA\nA) EDITAIS E PEÇAS SEMELHANTES\n- Município X, PR, Dispensa 12/2026: exige atestado de capacidade técnica.\nB) LEGISLAÇÃO E ENTENDIMENTOS VIGENTES\n- Decreto nº 12.807/2025: atualiza os valores do art. 75.";
  pausasDaPesquisa = 1;
  const antes = pedidos.length;
  const r = await api("POST", `/api/processos/${id}/ia/redigir`, { etapa: "dfd", pesquisar: true, orientacao: "priorizar municípios do Paraná" });
  const linhas = (await r.text()).trim().split("\n").map((l) => JSON.parse(l));
  const fim = linhas.at(-1);
  assert.equal(fim.fim, true, JSON.stringify(fim));
  assert.equal(fim.aviso, "");
  // Andamento informado à tela: pesquisa, busca na web e redação.
  const status = linhas.filter((l) => l.s).map((l) => l.s);
  assert.match(status[0], /Pesquisando editais publicados/);
  assert.ok(status.includes("Pesquisando na web…"));
  assert.match(status.at(-1), /Redigindo a minuta com a fundamentação/);
  assert.equal(linhas.filter((l) => l.d).map((l) => l.d).join(""), textoStream);

  // Três pedidos: pesquisa, continuação da pesquisa pausada e redação.
  const feitos = pedidos.slice(antes).map((x) => x.body);
  assert.equal(feitos.length, 3);
  assert.deepEqual(feitos[0].tools.map((t: any) => [t.type, t.name]), [["web_search_20260209", "web_search"], ["web_fetch_20260209", "web_fetch"]]);
  assert.ok(feitos[0].tools.every((t: any) => t.max_uses > 0));
  assert.match(feitos[0].messages[0].content, /Portal Nacional de Contratações Públicas \(pncp\.gov\.br\)/);
  assert.match(feitos[0].messages[0].content, /Construção de gavetário no cemitério municipal/);
  assert.match(feitos[0].messages[0].content, /priorizar municípios do Paraná/);
  // A continuação reenvia o pedido e a resposta pausada, sem mensagem nova do usuário.
  assert.deepEqual(feitos[1].messages.map((m: any) => m.role), ["user", "assistant"]);
  assert.equal(feitos[1].messages[1].content[0].type, "server_tool_use");
  // A redação não leva ferramentas e recebe o dossiê, as fontes e a regra de fundamentação.
  assert.equal(feitos[2].tools, undefined);
  const redacao = feitos[2].messages[0].content as string;
  assert.match(redacao, /PESQUISA FEITA EM \d\d\/\d\d\/\d{4}/);
  assert.match(redacao, /Dispensa 12\/2026: exige atestado de capacidade técnica/);
  assert.match(redacao, /- Edital 12\/2026 - Município X: https:\/\/pncp\.gov\.br\/app\/editais\/1/);
  assert.match(redacao, /FUNDAMENTAÇÃO \(obrigatória em toda a minuta\)/);
  assert.ok(!redacao.includes("Vou consultar o PNCP"), "a narração das buscas não entra no dossiê");
  assert.ok(!redacao.includes('"Fontes consultadas"'), "no DFD as fontes ficam só no dossiê");

  const m: any = await (await api("GET", `/api/processos/${id}/minutas/dfd`)).json();
  assert.match(m.pesquisa.texto, /^DOSSIÊ DE PESQUISA\nA\) EDITAIS/);
  assert.deepEqual(m.pesquisa.fontes, [{ url: "https://pncp.gov.br/app/editais/1", titulo: "Edital 12/2026 - Município X" }]);
  assert.equal(m.pesquisa.autor, "Req");

  // Sem marcar a pesquisa, a redação reaproveita o dossiê guardado e não chama as ferramentas.
  const a2 = pedidos.length;
  await (await api("POST", `/api/processos/${id}/ia/redigir`, { etapa: "dfd" })).text();
  assert.equal(pedidos.length - a2, 1);
  assert.match(pedidos.at(-1)!.body.messages[0].content, /PESQUISA FEITA EM/);
});

test("redigir com pesquisa: se a pesquisa falha, a minuta sai assim mesmo e a tela é avisada", async () => {
  const c = await api("POST", "/api/processos", { objeto: "Aquisição de material de expediente", tipo: "bens", via: "dispensa", ano: 2026, requisitante: "Administração" });
  const id = ((await c.json()) as any).id;
  await concluirPac(id);
  textoStream = "# DOCUMENTO DE FORMALIZAÇÃO DA DEMANDA\n## 1. Objeto\nMaterial de expediente.";
  pesquisaFalha = true;
  try {
    const r = await api("POST", `/api/processos/${id}/ia/redigir`, { etapa: "dfd", pesquisar: true });
    const linhas = (await r.text()).trim().split("\n").map((l) => JSON.parse(l));
    const fim = linhas.at(-1);
    assert.equal(fim.fim, true, JSON.stringify(fim));
    assert.match(fim.aviso, /A pesquisa na web não pôde ser feita .* só com os dados do processo/);
    const redacao = pedidos.at(-1)!.body.messages[0].content as string;
    assert.ok(!redacao.includes("PESQUISA FEITA EM"));
    assert.match(redacao, /FUNDAMENTAÇÃO \(obrigatória em toda a minuta\)/);
    const m: any = await (await api("GET", `/api/processos/${id}/minutas/dfd`)).json();
    assert.equal(m.pesquisa, null);
    assert.equal(m.vigente.origem, "ia");
  } finally { pesquisaFalha = false; }
});

test("agente de contratação em conversa livre: tira dúvidas e redige respostas sem campo da tela", async () => {
  const novo = await api("POST", "/api/processos", { objeto: "Aquisição de mobiliário escolar", tipo: "bens", via: "licitacao", ano: 2026, requisitante: "Educação" });
  const { id } = (await novo.json()) as { id: number };
  textoStream = "Segue a minuta de resposta ao pedido de esclarecimento:\n\nPrezado(a) [[PREENCHER: nome do interessado]]...";
  const corpo = {
    campo: null,
    pagina: { titulo: "Aquisição de mobiliário escolar", caminho: `/processos/${id}` },
    formulario: [],
    processo_id: id,
    mensagens: [{ role: "user", content: "Redija a resposta a um pedido de esclarecimento sobre o prazo de entrega." }],
  };
  const r = await api("POST", "/api/ia/agente", corpo);
  assert.equal(r.status, 200);
  const linhas = (await r.text()).trim().split("\n").map((l) => JSON.parse(l));
  assert.equal(linhas.filter((l) => l.d).map((l) => l.d).join(""), textoStream);
  const instrucao = pedidos.at(-1)!.body.messages[0].content as string;
  assert.match(instrucao, /conversa com um servidor dentro do sistema Licita/);
  assert.match(instrucao, /pedidos de esclarecimento, impugnações, recursos/);
  assert.match(instrucao, /"objeto":"Aquisição de mobiliário escolar"/);
  assert.doesNotMatch(instrucao, /SUGESTÃO PARA O CAMPO|CAMPO: /);
  // Conversa mais longa que no modo de campo, ainda em ordem.
  const longa = Array.from({ length: 21 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: `mensagem ${i}` }));
  const r2 = await api("POST", "/api/ia/agente", { ...corpo, processo_id: null, mensagens: longa });
  assert.equal(r2.status, 200); await r2.text();
  assert.match(pedidos.at(-1)!.body.messages[0].content, /PROCESSO ABERTO: nenhum/);
  assert.equal((await api("POST", "/api/ia/agente", { ...corpo, mensagens: [...longa, { role: "assistant", content: "x" }] })).status, 400);
});

test("leitura de orçamento: foto com extensão trocada, foto grande e PDF recusado não travam a leitura", async () => {
  const sharp = (await import("sharp")).default;
  const novo = await api("POST", "/api/processos", { objeto: "Aquisição de cadeiras", tipo: "bens", via: "dispensa", ano: 2026 });
  const { id } = (await novo.json()) as { id: number };
  const png = await sharp({ create: { width: 40, height: 30, channels: 3, background: "#ffffff" } }).png().toBuffer();
  const grande = await sharp({ create: { width: 3000, height: 2400, channels: 3, noise: { type: "gaussian", mean: 128, sigma: 60 } } }).jpeg({ quality: 95 }).toBuffer();
  assert.ok(grande.length > 3_600_000 && grande.length < 20_000_000, `imagem de teste fora do tamanho: ${grande.length}`);
  const fd = new FormData();
  fd.append("arquivo", new Blob([png]), "foto do whatsapp.jpg");
  fd.append("arquivo", new Blob([grande]), "foto grande.jpg");
  fd.append("arquivo", new Blob([Buffer.from("%PDF-1.4 protegido")]), "proposta.pdf");
  const env = await api("POST", `/api/processos/${id}/orcamentos`, fd);
  assert.equal(env.status, 201, await env.clone().text());
  const [foto, fotoGrande, pdf] = ((await env.json()) as { ids: number[] }).ids;
  respostaEstruturada = { fornecedor: "Loja X", cnpj: null, data: null, validade: null, itens: [], valor_total: null, frete: "nao_informado", instalacao: "nao_informado", prazo_entrega: null, observacoes: null };

  // PNG salvo com nome .jpg vai como PNG.
  assert.equal((await api("POST", `/api/processos/${id}/orcamentos/${foto}/ler`, {})).status, 200);
  assert.equal(pedidos.at(-1)!.body.messages[0].content[0].source.media_type, "image/png");
  // Foto acima do limite vai reduzida, como JPEG, dentro do limite da API.
  assert.equal((await api("POST", `/api/processos/${id}/orcamentos/${fotoGrande}/ler`, {})).status, 200);
  const enviada = pedidos.at(-1)!.body.messages[0].content[0].source;
  assert.equal(enviada.media_type, "image/jpeg");
  assert.ok(Buffer.from(enviada.data, "base64").length < 3_600_000);
  const meta = await sharp(Buffer.from(enviada.data, "base64")).metadata();
  assert.ok((meta.width ?? 0) <= 2400 && (meta.height ?? 0) <= 2400);

  // PDF recusado pela API: com texto extraído, lê pelo texto; sem texto, mensagem clara (não "talvez grande demais").
  documentoFalha = true;
  try {
    const { q1 } = await import("../db.js");
    await q1("update orcamentos set texto='Proposta Loja X: cadeira R$ 100,00' where id=$1", [pdf]);
    const r = await api("POST", `/api/processos/${id}/orcamentos/${pdf}/ler`, {});
    assert.equal(r.status, 200, await r.clone().text());
    assert.match(pedidos.at(-1)!.body.messages[0].content, /TEXTO\nProposta Loja X/);
    await q1("update orcamentos set texto='' where id=$1", [pdf]);
    const r2 = await api("POST", `/api/processos/${id}/orcamentos/${pdf}/ler`, {});
    assert.equal(r2.status, 422);
    assert.match(((await r2.json()) as any).erro, /Não foi possível ler a estrutura deste PDF/);
  } finally { documentoFalha = false; }
});

test("PDFs de orçamento anexados à solicitação podem ser lidos após a recusa do provedor", async () => {
  const sharp = (await import("sharp")).default;
  const novo = await api("POST", "/api/processos", { objeto: "Aquisição de cadeiras", tipo: "bens", via: "dispensa", ano: 2026 });
  const { id } = (await novo.json()) as { id: number };

  const pesquisavel = await PDFDocument.create();
  const fonte = await pesquisavel.embedFont(StandardFonts.Helvetica);
  const pg = pesquisavel.addPage();
  pg.drawText("Fornecedor: Loja X", { x: 48, y: 740, font: fonte });
  pg.drawText("Cadeira   UN   5   R$ 100,00   R$ 500,00", { x: 48, y: 715, font: fonte });

  const digitalizado = await PDFDocument.create();
  const foto = await sharp({ create: { width: 100, height: 60, channels: 3, background: "#eeeeee" } }).jpeg().toBuffer();
  const jpg = await digitalizado.embedJpg(foto);
  for (let i = 0; i < 2; i++) digitalizado.addPage().drawImage(jpg, { x: 48, y: 680, width: 100, height: 60 });

  const fd = new FormData();
  fd.append("arquivo", new Blob([Uint8Array.from(await pesquisavel.save())], { type: "application/pdf" }), "proposta digital.pdf");
  fd.append("arquivo", new Blob([Uint8Array.from(await digitalizado.save())], { type: "application/pdf" }), "proposta digitalizada.pdf");
  const upload = await api("POST", `/api/processos/${id}/orcamentos?origem=solicitacao`, fd);
  assert.equal(upload.status, 201, await upload.clone().text());
  const { ids } = (await upload.json()) as { ids: number[] };
  const { q1 } = await import("../db.js");
  assert.equal((await q1("select texto from orcamentos where id=$1", [ids[0]]))?.texto, "");

  respostaEstruturada = { fornecedor: "Loja X", cnpj: null, data: null, validade: null,
    itens: [{ descricao: "Cadeira", unidade: "UN", quantidade: 5, valor_unitario: 100, valor_total: 500 }],
    valor_total: 500, frete: "nao_informado", instalacao: "nao_informado", prazo_entrega: null, observacoes: null };
  documentoFalha = true;
  try {
    const digital = await api("POST", `/api/processos/${id}/orcamentos/${ids[0]}/ler`, {});
    assert.equal(digital.status, 200, await digital.clone().text());
    assert.equal((await digital.json()).dados.itens[0].valor_unitario, 100);
    const texto = pedidos.at(-1)!.body.messages[0].content;
    assert.match(texto, /Fornecedor: Loja X/);
    assert.match(texto, /Cadeira +UN +5 +R\$ 100,00/);
    assert.match((await q1("select texto from orcamentos where id=$1", [ids[0]]))?.texto ?? "", /Fornecedor: Loja X/);

    const scan = await api("POST", `/api/processos/${id}/orcamentos/${ids[1]}/ler`, {});
    assert.equal(scan.status, 200, await scan.clone().text());
    assert.equal((await scan.json()).dados.itens[0].valor_total, 500);
    const visual = pedidos.at(-1)!.body.messages[0].content;
    assert.deepEqual(visual.map((bloco: any) => bloco.type), ["image", "image", "text"]);
    assert.equal(visual[0].source.media_type, "image/jpeg");
    assert.equal(visual[1].source.media_type, "image/jpeg");
  } finally { documentoFalha = false; }
});

test("o Licita lê a proposta preenchida sem chamar o provedor e distingue o pedido sem preços", async () => {
  const gerarPdf = async (texto: string[]) => {
    const pdf = await PDFDocument.create();
    const fonte = await pdf.embedFont(StandardFonts.Courier);
    const pagina = pdf.addPage([750, 500]);
    texto.forEach((linha, i) => {
      if (linha) pagina.drawText(linha, { x: 25, y: 475 - i * 16, size: 9, font: fonte });
    });
    return Uint8Array.from(await pdf.save());
  };
  const preenchido = await gerarPdf([
    "Proposta de cotação",
    "",
    "                                  Preço   Preço total",
    "Código    Descrição / Esp.  Unid.  Quantidade   unitário",
    "         LIMPEZA DE EQUIPAMENTO                     R$ 230,00    R$ 13.800,00",
    "         Higienização com desmontagem",
    "42361                       SERV       60",
    "         e lavagem completa.",
    "",
    "                           VALOR",
    "                           TOTAL:       R$ 13.800,00",
    "",
    "Empresa de Teste LTDA • CNPJ 12.345.678/0001-00",
  ]);
  const emBranco = await gerarPdf([
    "Equiplano",
    "Fornecedor:                         Data: _______",
    "Código    Descrição do Produto   Unid.  Quantidade   Preço Unitário   Preço Total",
    "42361     Limpeza de equipamento  SERV   60,00",
  ]);

  const criado = await api("POST", "/api/processos", { objeto: "Serviços para teste de orçamento", tipo: "servicos", via: "dispensa", ano: 2026 });
  const { id } = (await criado.json()) as { id: number };
  const fd = new FormData();
  fd.append("arquivo", new Blob([preenchido], { type: "application/pdf" }), "proposta.pdf");
  fd.append("arquivo", new Blob([emBranco], { type: "application/pdf" }), "pedido.pdf");
  const upload = await api("POST", `/api/processos/${id}/orcamentos?origem=solicitacao`, fd);
  assert.equal(upload.status, 201);
  const { ids } = (await upload.json()) as { ids: number[] };
  const pedidosAntes = pedidos.length;
  const resposta = await api("POST", `/api/processos/${id}/orcamentos/${ids[0]}/ler`, {});
  assert.equal(resposta.status, 200, await resposta.clone().text());
  const dados = (await resposta.json()).dados;
  assert.equal(pedidos.length, pedidosAntes);
  assert.equal(dados.fornecedor, "Empresa de Teste LTDA");
  assert.deepEqual(dados.itens, [{ descricao: "LIMPEZA DE EQUIPAMENTO Higienização com desmontagem e lavagem completa.",
    unidade: "SERV", quantidade: 60, valor_unitario: 230, valor_total: 13800 }]);

  respostaEstruturada = { fornecedor: null, cnpj: null, data: null, validade: null, itens: [],
    valor_total: null, frete: "nao_informado", instalacao: "nao_informado", prazo_entrega: null, observacoes: null };
  const pedido = await api("POST", `/api/processos/${id}/orcamentos/${ids[1]}/ler`, {});
  assert.equal(pedido.status, 422, await pedido.clone().text());
  assert.match((await pedido.json()).erro, /campos de fornecedor e preço em branco/);
});

test("conta da IA sem créditos: aviso claro, sem novas tentativas em vão", async () => {
  const novo = await api("POST", "/api/processos", { objeto: "Aquisição de cadeiras", tipo: "bens", via: "dispensa", ano: 2026 });
  const { id } = (await novo.json()) as { id: number };
  const fd = new FormData();
  fd.append("arquivo", new Blob([Buffer.from("%PDF-1.4 x")]), "proposta.pdf");
  const [oid] = ((await (await api("POST", `/api/processos/${id}/orcamentos`, fd)).json()) as { ids: number[] }).ids;
  semCreditos = true;
  try {
    const antes = pedidos.length;
    const r = await api("POST", `/api/processos/${id}/orcamentos/${oid}/ler`, {});
    assert.equal(r.status, 402);
    assert.match(((await r.json()) as any).erro, /sem créditos.*console\.anthropic\.com/);
    assert.equal(pedidos.length - antes, 1, "não tenta ler de outro jeito quando o problema é saldo");
    const chat = await api("POST", "/api/ia/agente", { campo: null, pagina: { titulo: "", caminho: "/" }, formulario: [], processo_id: null, mensagens: [{ role: "user", content: "Olá" }] });
    const fim = (await chat.text()).trim().split("\n").map((l) => JSON.parse(l)).at(-1);
    assert.match(fim.erro, /sem créditos/);
  } finally { semCreditos = false; }
});

test("IA sem créditos: planilha e PDF com texto são lidos sem a IA", async () => {
  const novo = await api("POST", "/api/processos", { objeto: "Aquisição de cadeiras", tipo: "bens", via: "dispensa", ano: 2026 });
  const { id } = (await novo.json()) as { id: number };
  const fd = new FormData();
  fd.append("arquivo", new Blob(["Descrição;Un;Qtde;Preço unitário;Total\nCadeira escolar;un;30;300,00;9.000,00\nMesa escolar;un;30;250,50;7.515,00"]), "proposta.csv");
  const [oid] = ((await (await api("POST", `/api/processos/${id}/orcamentos`, fd)).json()) as { ids: number[] }).ids;
  semCreditos = true;
  try {
    const r = await api("POST", `/api/processos/${id}/orcamentos/${oid}/ler`, {});
    assert.equal(r.status, 200, await r.clone().text());
    const j: any = await r.json();
    assert.equal(j.sem_ia, true);
    assert.deepEqual(j.dados.itens.map((i: any) => [i.descricao, i.quantidade, i.valor_unitario]), [["Cadeira escolar", 30, 300], ["Mesa escolar", 30, 250.5]]);
    assert.equal(j.dados.valor_total, 16515);
  } finally { semCreditos = false; }
});
