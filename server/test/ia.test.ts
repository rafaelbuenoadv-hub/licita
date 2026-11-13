// Testa as rotas de IA contra um servidor falso que imita a API da Anthropic.
// Confere o que o sistema envia (modelo, respaldo, saída estruturada) e o tratamento das respostas.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
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
  const r = await fetch(base + url, { method: metodo, headers: { "x-licita": "1", "content-type": "application/json", cookie }, body: corpo ? JSON.stringify(corpo) : undefined });
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
  const o = await mod.db.q1("insert into orgaos (nome) values ('Município Teste') returning id");
  await mod.db.q1("insert into usuarios (orgao_id, nome, email, senha_hash, papeis) values ($1,'Req','req@t.gov.br',$2,'{requisitante,contratacao}')", [o.id, await mod.auth.hashSenha(SENHA)]);
  server = mod.app.criarApp().listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  await api("POST", "/api/auth/entrar", { email: "req@t.gov.br", senha: SENHA });
});
after(async () => { server.close(); falso.close(); await mod.db.pool.end(); });

let proc = 0;

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
  const c = await api("POST", "/api/processos", { objeto: "Construção de gavetário", tipo: "obra", via: "dispensa", ano: 2026 });
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
  assert.match(enviado.messages[0].content, /MODELO DO DOCUMENTO/);
  const m: any = await (await api("GET", `/api/processos/${proc}/minutas/dfd`)).json();
  assert.equal(m.vigente.origem, "ia");
});

test("sugestões só valem para campos existentes; índices inválidos são descartados", async () => {
  respostaEstruturada = { sugestoes: [{ i: 0, valor: "367/2026", fonte: "Memorando", falta: "" }, { i: 7, valor: "x", fonte: "", falta: "" }] };
  const r = await api("POST", `/api/processos/${proc}/ia/sugerir`, { etapa: "dfd" });
  const j: any = await r.json();
  assert.equal(r.status, 200, JSON.stringify(j));
  assert.equal(j.sugestoes.length, 1);
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
