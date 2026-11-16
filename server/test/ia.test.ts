// Testa as rotas de IA contra um servidor falso que imita a API da Anthropic.
// Confere o que o sistema envia (modelo, respaldo, saída estruturada) e o tratamento das respostas.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { PDFDocument } from "pdf-lib";
import http from "node:http";
import type { AddressInfo } from "node:net";

const pedidos: { headers: http.IncomingHttpHeaders; body: any }[] = [];
let respostaEstruturada: object = {};
let textoStream = "";
let pararPor = "end_turn";

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
    if (!body.stream) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(msg([{ type: "text", text: JSON.stringify(respostaEstruturada) }], pararPor)));
      return;
    }
    res.writeHead(200, { "content-type": "text/event-stream" });
    const ev = (t: string, d: object) => res.write(`event: ${t}\ndata: ${JSON.stringify({ type: t, ...d })}\n\n`);
    ev("message_start", { message: msg([], null as any) });
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
