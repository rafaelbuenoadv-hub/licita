// Testa o provedor Google Gemini contra um servidor falso que imita a API REST do Gemini.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";

const pedidos: { url: string; headers: http.IncomingHttpHeaders; body: any }[] = [];
let estruturado: object = {};
let textoStream = "";
let semEsquema = false;
let limite = false;
let pesquisa = { texto: "", fontes: [] as { uri: string; title: string }[] };

const falso = http.createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    const body = JSON.parse(raw);
    pedidos.push({ url: req.url!, headers: req.headers, body });
    const erro = (status: number, message: string, st = "INVALID_ARGUMENT") => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { code: status, message, status: st } }));
    };
    if (limite) return erro(429, "You exceeded your current quota.", "RESOURCE_EXHAUSTED");
    if (semEsquema && body.generationConfig?.responseJsonSchema) return erro(400, 'Invalid JSON payload received. Unknown name "responseJsonSchema" at \'generation_config\'.');
    const candidato = (texto: string, extra = {}) => ({ candidates: [{ content: { role: "model", parts: [{ text: "pensando…", thought: true }, { text: texto }] }, finishReason: "STOP", ...extra }] });
    if (req.url!.includes(":streamGenerateContent")) {
      res.writeHead(200, { "content-type": "text/event-stream" });
      for (const parte of textoStream.match(/[\s\S]{1,25}/g) ?? []) res.write(`data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: parte }] } }] })}\r\n\r\n`);
      res.end(`data: ${JSON.stringify({ candidates: [{ content: { parts: [] }, finishReason: "STOP" }] })}\r\n\r\n`);
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    if (body.tools?.some((t: any) => "google_search" in t)) {
      res.end(JSON.stringify(candidato(pesquisa.texto, { groundingMetadata: { groundingChunks: pesquisa.fontes.map((f) => ({ web: f })) } })));
      return;
    }
    res.end(JSON.stringify(candidato("```json\n" + JSON.stringify(estruturado) + "\n```")));
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
  const r = await api("PUT", `/api/processos/${id}/campos/pac`, { valores: { consta: "nao", justificativa_inclusao: "Demanda de teste." } });
  if (r.status !== 200) throw new Error(await r.text());
  const m = await api("POST", `/api/processos/${id}/checagens`, { item: "pc1", marcado: true });
  if (m.status !== 200) throw new Error(await m.text());
}
const linhas = async (r: Response) => (await r.text()).trim().split("\n").map((l) => JSON.parse(l));

before(async () => {
  await new Promise<void>((ok) => falso.listen(0, ok));
  delete process.env.ANTHROPIC_API_KEY;
  process.env.GEMINI_API_KEY = "chave-gemini-falsa";
  process.env.GEMINI_BASE_URL = `http://127.0.0.1:${(falso.address() as AddressInfo).port}`;
  mod = { db: await import("../db.js"), migrate: await import("../migrate.js"), auth: await import("../auth.js"), app: await import("../app.js") };
  await mod.db.pool.query("drop schema public cascade; create schema public;");
  await mod.migrate.migrar();
  const o = await mod.db.q1("insert into orgaos (nome) values ('Município Teste') returning id");
  await mod.db.q1("insert into usuarios (orgao_id, nome, email, senha_hash, papeis) values ($1,'Req','req@g.gov.br',$2,'{requisitante,contratacao}')", [o.id, await mod.auth.hashSenha(SENHA)]);
  server = mod.app.criarApp().listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  await api("POST", "/api/auth/entrar", { email: "req@g.gov.br", senha: SENHA });
});
after(async () => { server.close(); falso.close(); await mod.db.pool.end(); });

test("Gemini: status, agente em conversa e texto em fluxo", async () => {
  const st: any = await (await api("GET", "/api/ia/status")).json();
  assert.deepEqual(st, { disponivel: true, modelo: "gemini-flash-latest" });
  textoStream = "A dispensa por valor segue o art. 75 da Lei nº 14.133/2021.";
  const r = await api("POST", "/api/ia/agente", { campo: null, pagina: { titulo: "", caminho: "/" }, formulario: [], processo_id: null, mensagens: [{ role: "user", content: "O que é dispensa?" }] });
  assert.equal(r.status, 200);
  const l = await linhas(r);
  assert.equal(l.filter((x) => x.d).map((x) => x.d).join(""), textoStream);
  assert.equal(l.at(-1).fim, true);
  const p = pedidos.at(-1)!;
  assert.match(p.url, /^\/v1beta\/models\/gemini-flash-latest:streamGenerateContent\?alt=sse$/);
  assert.equal(p.headers["x-goog-api-key"], "chave-gemini-falsa");
  assert.match(p.body.systemInstruction.parts[0].text, /assistente de licitações/);
  assert.equal(p.body.contents[0].role, "user");
  assert.match(p.body.contents[0].parts[0].text, /agente de contratação/);
  assert.equal(p.body.contents.at(-1).parts[0].text, "O que é dispensa?");
});

test("Gemini: leitura de orçamento em PDF com resposta estruturada, e sem o esquema quando a API não aceita", async () => {
  const novo = await api("POST", "/api/processos", { objeto: "Aquisição de cadeiras", tipo: "bens", via: "dispensa", ano: 2026 });
  const { id } = (await novo.json()) as { id: number };
  const fd = new FormData();
  fd.append("arquivo", new Blob([Buffer.from("%PDF-1.4 proposta")]), "proposta.pdf");
  fd.append("arquivo", new Blob([Buffer.from("%PDF-1.4 outra")]), "outra.pdf");
  const [a, b] = ((await (await api("POST", `/api/processos/${id}/orcamentos`, fd)).json()) as { ids: number[] }).ids;
  estruturado = { fornecedor: "Móveis Escolares Ltda", cnpj: "12.345.678/0001-90", data: "2026-11-10", validade: null,
    itens: [{ descricao: "Cadeira escolar", unidade: "un", quantidade: 30, valor_unitario: 300, valor_total: 9000 }],
    valor_total: 9000, frete: "incluso", instalacao: "nao_informado", prazo_entrega: null, observacoes: null };
  const r = await api("POST", `/api/processos/${id}/orcamentos/${a}/ler`, {});
  assert.equal(r.status, 200, await r.clone().text());
  const j: any = await r.json();
  assert.equal(j.dados.itens[0].valor_unitario, 300);
  const p = pedidos.at(-1)!;
  assert.match(p.url, /:generateContent$/);
  assert.equal(p.body.contents[0].parts[0].inlineData.mimeType, "application/pdf");
  assert.equal(p.body.generationConfig.responseMimeType, "application/json");
  assert.equal(p.body.generationConfig.responseJsonSchema.type, "object");
  assert.equal(p.body.generationConfig.responseJsonSchema.$schema, undefined);

  semEsquema = true;
  try {
    const antes = pedidos.length;
    const r2 = await api("POST", `/api/processos/${id}/orcamentos/${b}/ler`, {});
    assert.equal(r2.status, 200, await r2.clone().text());
    const repetido = pedidos.slice(antes).at(-1)!.body;
    assert.equal(repetido.generationConfig.responseJsonSchema, undefined);
    assert.match(repetido.contents[0].parts.at(-1).text, /Responda somente com um JSON válido/);
  } finally { semEsquema = false; }
});

test("Gemini: cota esgotada vira aviso claro e a planilha é lida sem IA", async () => {
  const novo = await api("POST", "/api/processos", { objeto: "Aquisição de mesas", tipo: "bens", via: "dispensa", ano: 2026 });
  const { id } = (await novo.json()) as { id: number };
  const fd = new FormData();
  fd.append("arquivo", new Blob(["Descrição;Un;Qtde;Preço unitário;Total\nMesa escolar;un;30;250,50;7.515,00"]), "proposta.csv");
  const [oid] = ((await (await api("POST", `/api/processos/${id}/orcamentos`, fd)).json()) as { ids: number[] }).ids;
  limite = true;
  try {
    const r = await api("POST", `/api/processos/${id}/orcamentos/${oid}/ler`, {});
    assert.equal(r.status, 200, await r.clone().text());
    assert.equal(((await r.json()) as any).sem_ia, true);
    const chat = await api("POST", "/api/ia/agente", { campo: null, pagina: { titulo: "", caminho: "/" }, formulario: [], processo_id: null, mensagens: [{ role: "user", content: "Olá" }] });
    assert.match((await linhas(chat)).at(-1).erro, /limite de uso da IA \(Google Gemini\)/);
  } finally { limite = false; }
});

test("Gemini: redigir com pesquisa usa a busca do Google e guarda as fontes", async () => {
  const c = await api("POST", "/api/processos", { objeto: "Construção de gavetário", tipo: "obra", via: "dispensa", ano: 2026, requisitante: "Obras" });
  const id = ((await c.json()) as any).id;
  await concluirPac(id);
  pesquisa = {
    texto: "Pesquisei.\nDOSSIÊ DE PESQUISA\nA) EDITAIS E PEÇAS SEMELHANTES\n- Município X/PR, Dispensa 12/2026.",
    fontes: [{ uri: "https://pncp.gov.br/app/editais/1", title: "pncp.gov.br" }, { uri: "https://www.planalto.gov.br/l14133.htm", title: "planalto.gov.br" }],
  };
  textoStream = "# DOCUMENTO DE FORMALIZAÇÃO DA DEMANDA\n## 1. Objeto\nGavetário.";
  const antes = pedidos.length;
  const r = await api("POST", `/api/processos/${id}/ia/redigir`, { etapa: "dfd", pesquisar: true });
  const l = await linhas(r);
  assert.equal(l.at(-1).fim, true, JSON.stringify(l.at(-1)));
  const feitos = pedidos.slice(antes);
  assert.deepEqual(feitos[0].body.tools, [{ google_search: {} }]);
  assert.match(feitos.at(-1)!.body.contents[0].parts[0].text, /PESQUISA FEITA EM[\s\S]*Dispensa 12\/2026[\s\S]*https:\/\/pncp\.gov\.br\/app\/editais\/1/);
  const m: any = await (await api("GET", `/api/processos/${id}/minutas/dfd`)).json();
  assert.match(m.pesquisa.texto, /^DOSSIÊ DE PESQUISA/);
  assert.equal(m.pesquisa.fontes.length, 2);
  assert.equal(m.vigente.texto.split("\n")[0], "# DOCUMENTO DE FORMALIZAÇÃO DA DEMANDA");
});
