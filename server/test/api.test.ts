// Testes de ponta a ponta da API. Exigem um Postgres vazio em DATABASE_URL (ex.: banco licita_test).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { pool, q1 } from "../db.js";
import { migrar } from "../migrate.js";
import { hashSenha } from "../auth.js";
import { criarApp } from "../app.js";
import { ETAPAS, itensDe } from "../../shared/etapas.js";

let base = "";
let server: ReturnType<ReturnType<typeof criarApp>["listen"]>;
const SENHA = "senha-de-teste-123";

class Cliente {
  cookie = "";
  async req(metodo: string, url: string, corpo?: unknown, extra: Record<string, string> = {}) {
    const h: Record<string, string> = { "x-licita": "1", ...extra };
    if (this.cookie) h.cookie = this.cookie;
    let body: any;
    if (corpo instanceof FormData) body = corpo;
    else if (corpo !== undefined) { h["content-type"] = "application/json"; body = JSON.stringify(corpo); }
    const r = await fetch(base + url, { method: metodo, headers: h, body });
    const sc = r.headers.get("set-cookie");
    if (sc) this.cookie = sc.split(";")[0];
    const tipo = r.headers.get("content-type") ?? "";
    const dados = tipo.includes("json") ? await r.json() : Buffer.from(await r.arrayBuffer());
    return { status: r.status, dados: dados as any, tipo };
  }
  get = (u: string) => this.req("GET", u);
  post = (u: string, c?: unknown) => this.req("POST", u, c ?? {});
  put = (u: string, c?: unknown) => this.req("PUT", u, c ?? {});
  async entrar(email: string) {
    const r = await this.post("/api/auth/entrar", { email, senha: SENHA });
    assert.equal(r.status, 200, JSON.stringify(r.dados));
    return this;
  }
}

async function usuario(orgao: number, email: string, papeis: string[]) {
  await q1("insert into usuarios (orgao_id, nome, email, senha_hash, papeis) values ($1,$2,$3,$4,$5)", [orgao, email.split("@")[0], email, await hashSenha(SENHA), papeis]);
}

let orgA = 0, orgB = 0;
before(async () => {
  await pool.query("drop schema public cascade; create schema public;");
  await migrar();
  orgA = (await q1("insert into orgaos (nome, normas) values ('Município A', 'Decreto Municipal nº 1/2024') returning id"))!.id;
  orgB = (await q1("insert into orgaos (nome) values ('Município B') returning id"))!.id;
  await usuario(orgA, "admin@a.gov.br", ["admin"]);
  await usuario(orgA, "req@a.gov.br", ["requisitante"]);
  await usuario(orgA, "lic@a.gov.br", ["contratacao"]);
  await usuario(orgA, "jur@a.gov.br", ["juridico"]);
  await usuario(orgA, "fiscal@a.gov.br", ["fiscal"]);
  await usuario(orgB, "admin@b.gov.br", ["admin"]);
  server = criarApp().listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(async () => { server.close(); await pool.end(); });

let procId = 0;

test("login, sessão e senha errada", async () => {
  const c = new Cliente();
  assert.equal((await c.get("/api/auth/eu")).status, 401);
  assert.equal((await c.post("/api/auth/entrar", { email: "req@a.gov.br", senha: "errada" })).status, 401);
  await c.entrar("req@a.gov.br");
  const eu = await c.get("/api/auth/eu");
  assert.equal(eu.dados.email, "req@a.gov.br");
  assert.deepEqual(eu.dados.papeis, ["requisitante"]);
});

test("alteração sem cabeçalho da aplicação é recusada (CSRF)", async () => {
  const c = await new Cliente().entrar("req@a.gov.br");
  const r = await fetch(base + "/api/processos", { method: "POST", headers: { cookie: c.cookie, "content-type": "application/json" }, body: "{}" });
  assert.equal(r.status, 403);
});

test("cria processo e respeita ordem das etapas e papéis", async () => {
  const req = await new Cliente().entrar("req@a.gov.br");
  const r = await req.post("/api/processos", { objeto: "Construção de gavetário com 33 unidades", tipo: "obra", via: "dispensa", ano: 2026, valor_estimado: 114969.14, classe: "Obras de construção civil", numero: "367/2026" });
  assert.equal(r.status, 201, JSON.stringify(r.dados));
  procId = r.dados.id;

  // Item do ETP antes de concluir a solicitação: bloqueado.
  assert.equal((await req.post(`/api/processos/${procId}/checagens`, { item: "e1", marcado: true })).status, 409);
  // Item que não se aplica (p1 é só para bens/serviços).
  assert.equal((await req.post(`/api/processos/${procId}/checagens`, { item: "p1", marcado: true })).status, 400);
  // Conclui a solicitação.
  for (const i of itensDe(ETAPAS[0], { tipo: "obra", via: "dispensa" })) {
    assert.equal((await req.post(`/api/processos/${procId}/checagens`, { item: i.id, marcado: true })).status, 200);
  }
  const det = await req.get(`/api/processos/${procId}`);
  assert.equal(det.dados.etapa_atual, 1);
  assert.equal(det.dados.checagens[0].usuario, "req");
  // Jurídico não atua na solicitação.
  const jur = await new Cliente().entrar("jur@a.gov.br");
  assert.equal((await jur.post(`/api/processos/${procId}/checagens`, { item: "d1", marcado: false })).status, 403);
});

test("outro órgão não enxerga o processo", async () => {
  const b = await new Cliente().entrar("admin@b.gov.br");
  assert.equal((await b.get(`/api/processos/${procId}`)).status, 404);
  assert.equal((await b.get("/api/processos")).dados.length, 0);
});

test("minuta versionada, campos pendentes e exportação .docx", async () => {
  const req = await new Cliente().entrar("req@a.gov.br");
  const texto = "# ESTUDO TÉCNICO PRELIMINAR\nProcesso nº 367/2026\n## 2. Necessidade\n| Indicador | Dado |\n|---|---|\n| Sepultamentos 2024 | [[nº]] |\n| Sepultamentos 2025 | [[nº]] |\nIbaiti, [[dia]] de novembro de 2026.\n\n@ FULANA DE TAL\n@ Arquiteta";
  const s1 = await req.post(`/api/processos/${procId}/minutas/etp`, { texto });
  assert.deepEqual(s1.dados, { versao: 1, nova: true });
  assert.equal((await req.post(`/api/processos/${procId}/minutas/etp`, { texto })).dados.nova, false);
  // Versão desatualizada é recusada.
  assert.equal((await req.post(`/api/processos/${procId}/minutas/etp/pendencias`, { versao: 99, valores: { 0: "1" } })).status, 409);
  const ap = await req.post(`/api/processos/${procId}/minutas/etp/pendencias`, { versao: 1, valores: { 0: "312", 1: "298" } });
  assert.equal(ap.dados.aplicados, 2);
  const m = await req.get(`/api/processos/${procId}/minutas/etp`);
  assert.equal(m.dados.vigente.versao, 2);
  assert.match(m.dados.vigente.texto, /\| Sepultamentos 2024 \| 312 \|/);
  assert.match(m.dados.vigente.texto, /\[\[dia\]\]/);
  assert.equal(m.dados.versoes.length, 2);
  const d = await req.get(`/api/processos/${procId}/minutas/etp/docx`);
  assert.equal(d.status, 200);
  assert.equal(d.dados.subarray(0, 2).toString(), "PK");
  // Minuta de etapa ainda bloqueada.
  assert.equal((await req.post(`/api/processos/${procId}/minutas/tr`, { texto: "x" })).status, 409);
});

test("anexo .docx tem o texto extraído (inclusive quadros)", async () => {
  const pasta = "/root/.claude/uploads/1db35ded-44a9-5a72-a9ec-3f429e7bb52c";
  const arq = existsSync(pasta) ? readdirSync(pasta).find((n) => n.includes("ETP")) : undefined;
  if (!arq) return; // arquivo de exemplo disponível só no ambiente de desenvolvimento
  const req = await new Cliente().entrar("req@a.gov.br");
  const fd = new FormData();
  fd.append("arquivo", new Blob([readFileSync(`${pasta}/${arq}`)]), "ETP.docx");
  const r = await req.req("POST", `/api/processos/${procId}/anexos`, fd);
  assert.equal(r.status, 201, JSON.stringify(r.dados));
  const a = await req.get(`/api/processos/${procId}/anexos/${r.dados.id}`);
  assert.match(a.dados.texto, /ESTUDO TÉCNICO PRELIMINAR/);
  assert.match(a.dados.texto, /\| .*Alternativa.* \|/);
});

test("IA sem chave responde 503 com mensagem clara", async () => {
  if (process.env.ANTHROPIC_API_KEY) return;
  const req = await new Cliente().entrar("req@a.gov.br");
  assert.equal((await req.get("/api/ia/status")).dados.disponivel, false);
  const r = await req.post(`/api/processos/${procId}/ia/sugerir`, { etapa: "etp" });
  assert.equal(r.status, 503);
  assert.match(r.dados.erro, /ANTHROPIC_API_KEY/);
});

test("PCA aponta fracionamento quando dispensas da mesma natureza passam do limite", async () => {
  const lic = await new Cliente().entrar("lic@a.gov.br");
  assert.equal((await lic.post("/api/pca", { ano: 2026, descricao: "Gavetário", classe: "Obras de construção civil", tipo: "obra", valor_estimado: 114969.14, trimestre: 4 })).status, 201);
  let pca = await lic.get("/api/pca?ano=2026");
  const linha = () => pca.dados.resumo.find((x: any) => x.classe === "Obras de construção civil");
  assert.equal(linha().inciso, "I");
  assert.equal(linha().limite, 130984.2);
  assert.equal(linha().alerta, null);
  assert.equal(pca.dados.fora_do_plano.length, 1);
  await lic.post("/api/processos", { objeto: "Reforma do muro do cemitério", tipo: "obra", via: "dispensa", ano: 2026, valor_estimado: 30000, classe: "obras de construção civil " });
  pca = await lic.get("/api/pca?ano=2026");
  assert.equal(linha().dispensas, 144969.14);
  assert.equal(linha().alerta, "excede");
  const painel = await lic.get("/api/painel");
  assert.ok(painel.dados.fracionamento.some((x: any) => x.alerta === "excede"));
});

test("contrato: limite de acréscimo do art. 125 e papéis na medição", async () => {
  const lic = await new Cliente().entrar("lic@a.gov.br");
  const c = await lic.post("/api/contratos", { processo_id: procId, numero: "12/2026", objeto: "Gavetário", contratada: "Construtora X", tipo_objeto: "obra", valor_inicial: 100000, inicio: "2026-11-01", fim: "2027-10-31", fiscal: "Fiscal" });
  assert.equal(c.status, 201, JSON.stringify(c.dados));
  const id = c.dados.id;
  assert.equal((await lic.post(`/api/contratos/${id}/aditivos`, { numero: "1", tipo: "acrescimo", valor: 20000, justificativa: "Acréscimo de 2 gavetas por ajuste de projeto" })).status, 201);
  const exc = await lic.post(`/api/contratos/${id}/aditivos`, { numero: "2", tipo: "acrescimo", valor: 6000, justificativa: "Novo acréscimo que passaria do limite" });
  assert.equal(exc.status, 409);
  assert.match(exc.dados.erro, /26,00%/);
  const fiscal = await new Cliente().entrar("fiscal@a.gov.br");
  const med = await fiscal.post(`/api/contratos/${id}/medicoes`, { referencia: "1ª medição", valor: 50000 });
  assert.equal(med.status, 201);
  assert.equal((await fiscal.post(`/api/contratos/${id}/medicoes/${med.dados.id}/situacao`, { situacao: "paga" })).status, 403);
  assert.equal((await fiscal.post(`/api/contratos/${id}/medicoes/${med.dados.id}/situacao`, { situacao: "atestada" })).status, 200);
  const det = await lic.get(`/api/contratos/${id}`);
  assert.equal(det.dados.valor_atual, 120000);
  assert.equal(det.dados.saldo, 70000);
  assert.ok(det.dados.alertas.some((a: any) => /20,0%/.test(a.texto)));
  assert.equal((await lic.get(`/api/processos/${procId}`)).dados.situacao, "contratado");
});

test("admin gerencia usuários e limites do próprio órgão", async () => {
  const adm = await new Cliente().entrar("admin@a.gov.br");
  assert.equal((await adm.post("/api/admin/usuarios", { nome: "Nova", email: "nova@a.gov.br", papeis: ["fiscal"], senha: "curta" })).status, 400);
  assert.equal((await adm.post("/api/admin/usuarios", { nome: "Nova", email: "nova@a.gov.br", papeis: ["fiscal"], senha: SENHA })).status, 201);
  const req = await new Cliente().entrar("req@a.gov.br");
  assert.equal((await req.get("/api/admin/usuarios")).status, 403);
  assert.equal((await adm.put("/api/admin/limites", { ano: 2026, inciso: "II", valor: 65000, fonte: "Teste" })).status, 200);
  const b = await new Cliente().entrar("admin@b.gov.br");
  const limB = (await b.get("/api/limites")).dados;
  assert.ok(!limB.some((l: any) => l.inciso === "II"), "limite do órgão A não pode aparecer para o órgão B");
});
