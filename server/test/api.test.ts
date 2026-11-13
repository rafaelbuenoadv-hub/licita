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

test("cadastro de secretários importa dados oficiais apenas para Ibaiti e preserva edições", async () => {
  const caminho = "/api/admin/secretarios";
  const orgIbaiti = (await q1("insert into orgaos (nome, cnpj) values ('Município de Ibaiti', '77.008.068/0001-41') returning id"))!.id;
  await usuario(orgIbaiti, "admin@ibaiti.gov.br", ["admin"]);
  const admin = await new Cliente().entrar("admin@ibaiti.gov.br");
  const requisitante = await new Cliente().entrar("req@a.gov.br");
  const outro = await new Cliente().entrar("admin@b.gov.br");

  assert.equal((await new Cliente().get(caminho)).status, 401);
  assert.equal((await requisitante.get(caminho)).status, 403);
  assert.equal((await outro.post(`${caminho}/importar-ibaiti`)).status, 403);
  assert.deepEqual((await admin.get(caminho)).dados, { lista: [], pode_importar_ibaiti: true });

  const importacoes = await Promise.all([
    admin.post(`${caminho}/importar-ibaiti`),
    admin.post(`${caminho}/importar-ibaiti`),
  ]);
  assert.deepEqual(importacoes.map((r) => r.status), [200, 200]);
  assert.deepEqual(importacoes.map((r) => r.dados.inseridos).sort((a, b) => a - b), [0, 13]);
  const { lista } = (await admin.get(caminho)).dados;
  assert.equal(lista.length, 13);
  const planejamento = lista.find((s: { secretaria: string }) => s.secretaria === "Planejamento e Orçamento");
  assert.equal(planejamento.nome, "Rafael Augusto Bueno de Oliveira");
  assert.equal(planejamento.email, "convenios@ibaiti.pr.gov.br");
  assert.equal((await outro.put(`${caminho}/${planejamento.id}`, planejamento)).status, 404);

  const agricultura = lista.find((s: { secretaria: string }) => s.secretaria.startsWith("Agricultura"));
  assert.equal(agricultura.nome, "Fernando de Oliveira");
  assert.equal(agricultura.telefone, "");
  const novo = { secretaria: "Unidade de teste", nome: "Titular de teste" };
  assert.equal((await admin.post(caminho, { ...novo, fonte: "javascript:alert(1)" })).status, 400);
  const criado = await admin.post(caminho, novo);
  assert.equal(criado.status, 201);
  assert.equal((await admin.post(caminho, { ...novo, secretaria: " unidade de teste " })).status, 409);
  assert.equal((await admin.put(`${caminho}/${criado.dados.id}`, planejamento)).status, 409);

  const editado = { ...planejamento, nome: "Novo titular de teste", secretaria: "Planejamento e Orçamento Municipal" };
  assert.equal((await admin.put(`${caminho}/${planejamento.id}`, editado)).status, 200);
  assert.deepEqual((await admin.post(`${caminho}/importar-ibaiti`)).dados, { inseridos: 0 });
  assert.deepEqual((await admin.get(caminho)).dados.lista.find((s: { id: number }) => s.id === planejamento.id), editado);
  assert.deepEqual((await outro.get(caminho)).dados, { lista: [], pode_importar_ibaiti: false });
});

test("cria processo e respeita ordem das etapas e papéis", async () => {
  const req = await new Cliente().entrar("req@a.gov.br");
  const r = await req.post("/api/processos", { objeto: "Construção de gavetário com 33 unidades", tipo: "obra", via: "dispensa", ano: 2026, valor_estimado: 114969.14, classe: "Obras de construção civil", numero: "367/2026" });
  assert.equal(r.status, 201, JSON.stringify(r.dados));
  procId = r.dados.id;
  // O processo nasce só com o protocolo; número enviado na abertura é ignorado.
  assert.equal(r.dados.protocolo, "2026/0001");
  const novo = await req.get(`/api/processos/${procId}`);
  assert.equal(novo.dados.numero, "");
  assert.equal(novo.dados.procedimento, "");
  assert.equal(novo.dados.numeracao.liberada, false);

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

test("protocolo sequencial por órgão; nº do processo e do procedimento só na última etapa", async () => {
  const adm = await new Cliente().entrar("admin@a.gov.br");
  const lic = await new Cliente().entrar("lic@a.gov.br");
  const req = await new Cliente().entrar("req@a.gov.br");
  const b = await new Cliente().entrar("admin@b.gov.br");
  const base = { objeto: "Aquisição de material de expediente", tipo: "bens", via: "dispensa", ano: 2026, classe: "Material de expediente" };
  // Aberturas simultâneas não repetem protocolo.
  const rs = await Promise.all([1, 2, 3].map(() => lic.post("/api/processos", base)));
  const protos = rs.map((r) => r.dados.protocolo).sort();
  assert.deepEqual(protos, ["2026/0003", "2026/0004", "2026/0005"]);
  const id = rs[0].dados.id;
  // Outro órgão começa a própria sequência; outro exercício também.
  assert.equal((await b.post("/api/processos", base)).dados.protocolo, "2026/0001");
  assert.equal((await lic.post("/api/processos", { ...base, ano: 2027 })).dados.protocolo, "2027/0001");
  assert.ok((await lic.get("/api/processos?ano=2026")).dados.every((p: any) => /^2026\/\d{4}$/.test(p.protocolo)));

  // Antes da última etapa a numeração é recusada; alterar os dados não grava número.
  const num = { numero: "500/2026", procedimento: "Dispensa nº 43/2026" };
  assert.equal((await lic.post(`/api/processos/${id}/numeracao`, num)).status, 409);
  assert.equal((await lic.put(`/api/processos/${id}`, { ...base, numero: "999/2026", procedimento: "X" })).status, 200);
  assert.equal((await lic.get(`/api/processos/${id}`)).dados.numero, "");

  // Conclui todas as etapas menos a última.
  const pb = { tipo: "bens", via: "dispensa" } as const;
  for (const e of ETAPAS.slice(0, -1)) for (const i of itensDe(e, pb)) {
    assert.equal((await adm.post(`/api/processos/${id}/checagens`, { item: i.id, marcado: true })).status, 200, i.id);
  }
  const det = await lic.get(`/api/processos/${id}`);
  assert.equal(det.dados.etapa_atual, ETAPAS.length - 1);
  assert.equal(det.dados.numeracao.liberada, true);
  assert.deepEqual(det.dados.numeracao.sugestao, { numero: "1/2026", procedimento: "Dispensa nº 1/2026" });
  // Só contratações ou autoridade gravam; o número pode ser ajustado ao oficial.
  assert.equal((await req.post(`/api/processos/${id}/numeracao`, num)).status, 403);
  assert.equal((await b.post(`/api/processos/${id}/numeracao`, num)).status, 404);
  assert.equal((await lic.post(`/api/processos/${id}/numeracao`, num)).status, 200);
  const dep = await lic.get(`/api/processos/${id}`);
  assert.equal(dep.dados.numero, "500/2026");
  assert.equal(dep.dados.procedimento, "Dispensa nº 43/2026");
  assert.equal(dep.dados.protocolo, "2026/0003");
  // A sugestão do processo seguinte continua a partir do maior número usado.
  const outro = await lic.get(`/api/processos/${rs[1].dados.id}`);
  assert.deepEqual(outro.dados.numeracao.sugestao, { numero: "501/2026", procedimento: "Dispensa nº 44/2026" });
});

test("migração dá protocolo a processos antigos sem repetir", async () => {
  const o = (await q1("insert into orgaos (nome) values ('Município C') returning id"))!.id;
  for (const ob of ["Antigo 1", "Antigo 2"]) await q1("insert into processos (orgao_id, objeto, tipo, via, ano) values ($1,$2,'bens','dispensa',2025)", [o, ob]);
  await migrar();
  await migrar();
  const rows = (await pool.query("select protocolo from processos where orgao_id=$1 order by id", [o])).rows.map((r) => r.protocolo);
  assert.deepEqual(rows, ["2025/0001", "2025/0002"]);
  await usuario(o, "lic@c.gov.br", ["contratacao"]);
  const lic = await new Cliente().entrar("lic@c.gov.br");
  assert.equal((await lic.post("/api/processos", { objeto: "Novo no órgão C", tipo: "bens", via: "dispensa", ano: 2025 })).dados.protocolo, "2025/0003");
});

test("orçamentos da solicitação: vários de uma vez, nome do arquivo, valor depois, download e remoção", async () => {
  const req = await new Cliente().entrar("req@a.gov.br");
  const jur = await new Cliente().entrar("jur@a.gov.br");
  const b = await new Cliente().entrar("admin@b.gov.br");
  const form = (...arqs: [string, string | Buffer][]) => {
    const fd = new FormData();
    for (const [nome, conteudo] of arqs) fd.append("arquivo", new Blob([conteudo]), nome);
    return fd;
  };
  const url = `/api/processos/${procId}/orcamentos`;
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
  // Dois arquivos na mesma remessa; a foto fica guardada mesmo sem texto legível.
  const r = await req.req("POST", url, form(["orçamento construtora.txt", "Proposta: R$ 110.000,00"], ["foto.png", png]));
  assert.equal(r.status, 201, JSON.stringify(r.dados));
  assert.equal(r.dados.ids.length, 2);
  const [id1, id2] = r.dados.ids;
  // Um arquivo recusado barra a remessa inteira.
  assert.equal((await req.req("POST", url, form(["ok.txt", "x"], ["virus.exe", "x"]))).status, 415);
  assert.equal((await req.req("POST", url, new FormData())).status, 400);
  assert.equal((await jur.req("POST", url, form(["a.txt", "x"]))).status, 403);
  assert.equal((await b.req("POST", url, form(["a.txt", "x"]))).status, 404);

  const linhas = async () => (await jur.get(`/api/processos/${procId}`)).dados.orcamentos.map((o: any) => [o.fornecedor, o.valor, o.nome, o.lido]);
  assert.deepEqual(await linhas(), [["orçamento construtora", null, "orçamento construtora.txt", true], ["foto", null, "foto.png", false]]);
  // Valor informado depois, por quem pode anexar.
  assert.equal((await jur.put(`${url}/${id1}`, { valor: 110000 })).status, 403);
  assert.equal((await b.put(`${url}/${id1}`, { valor: 110000 })).status, 404);
  assert.equal((await req.put(`${url}/${id1}`, { valor: -1 })).status, 400);
  assert.equal((await req.put(`${url}/${id1}`, { valor: 110000 })).status, 200);
  assert.deepEqual((await linhas())[0], ["orçamento construtora", 110000, "orçamento construtora.txt", true]);
  assert.equal((await req.put(`${url}/${id1}`, { valor: null })).status, 200);

  const arq = await jur.get(`${url}/${id2}/arquivo`);
  assert.equal(arq.status, 200);
  assert.equal(arq.tipo, "image/png");
  assert.deepEqual(arq.dados, png);
  assert.equal((await b.get(`${url}/${id2}/arquivo`)).status, 404);
  assert.equal((await jur.req("DELETE", `${url}/${id2}`)).status, 403);
  assert.equal((await req.req("DELETE", `${url}/${id2}`)).status, 200);
  assert.equal((await req.get(`/api/processos/${procId}`)).dados.orcamentos.length, 1);
});

test("mensagens entre usuários do mesmo órgão", async () => {
  const req = await new Cliente().entrar("req@a.gov.br");
  const lic = await new Cliente().entrar("lic@a.gov.br");
  const jur = await new Cliente().entrar("jur@a.gov.br");
  const b = await new Cliente().entrar("admin@b.gov.br");
  assert.equal((await new Cliente().get("/api/mensagens")).status, 401);
  const dest = (await req.get("/api/mensagens/destinatarios")).dados;
  const id = (email: string) => dest.find((u: any) => u.nome === email)?.id as number;
  assert.ok(id("lic") && id("jur"));
  assert.ok(!dest.some((u: any) => u.nome === "req"), "não lista o próprio usuário");
  const idB = (await q1("select id from usuarios where email='admin@b.gov.br'"))!.id;
  assert.ok(!dest.some((u: any) => u.id === idB), "não lista usuário de outro órgão");

  const msg = { assunto: "Orçamentos do gavetário", texto: "Anexei dois orçamentos. Pode conferir?", processo_id: procId };
  assert.equal((await req.post("/api/mensagens", { ...msg, para: [idB] })).status, 400);
  assert.equal((await req.post("/api/mensagens", { ...msg, para: [] })).status, 400);
  assert.equal((await req.post("/api/mensagens", { ...msg, para: [id("lic")], assunto: " " })).status, 400);
  const env = await req.post("/api/mensagens", { ...msg, para: [id("lic"), id("jur"), id("lic")] });
  assert.equal(env.status, 201, JSON.stringify(env.dados));
  assert.equal(env.dados.enviadas, 2);

  assert.equal((await lic.get("/api/mensagens/nao-lidas")).dados.total, 1);
  assert.equal((await req.get("/api/mensagens/nao-lidas")).dados.total, 0);
  const entrada = (await lic.get("/api/mensagens")).dados;
  assert.equal(entrada.length, 1);
  assert.equal(entrada[0].de_nome, "req");
  assert.equal(entrada[0].assunto, msg.assunto);
  assert.equal(entrada[0].processo_protocolo, "2026/0001");
  assert.equal(entrada[0].lida_em, null);
  assert.equal((await req.get("/api/mensagens?caixa=enviadas")).dados.length, 2);
  assert.equal((await b.get("/api/mensagens")).dados.length, 0);

  // Só o destinatário marca como lida.
  assert.equal((await jur.post(`/api/mensagens/${entrada[0].id}/lida`)).status, 404);
  assert.equal((await req.post(`/api/mensagens/${entrada[0].id}/lida`)).status, 404);
  assert.equal((await lic.post(`/api/mensagens/${entrada[0].id}/lida`)).status, 200);
  assert.equal((await lic.get("/api/mensagens/nao-lidas")).dados.total, 0);
  assert.ok((await req.get("/api/mensagens?caixa=enviadas")).dados.find((m: any) => m.para_nome === "lic").lida_em);
  assert.equal((await jur.get("/api/mensagens/nao-lidas")).dados.total, 1);
});
