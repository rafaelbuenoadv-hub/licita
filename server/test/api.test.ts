// Testes de ponta a ponta da API. Exigem um Postgres vazio em DATABASE_URL (ex.: banco licita_test).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { PDFDocument } from "pdf-lib";
import { buscarPncp } from "../routes/pncp.js";
import { destinosDoOrcamento } from "../../shared/importar-orcamento.js";
import { valorDasCotacoes } from "../../shared/solicitacao.js";
import { randomUUID } from "node:crypto";
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
  assert.deepEqual((await admin.get(caminho)).dados.lista.find((s: { id: number }) => s.id === planejamento.id), { ...editado, portaria: "", fonte_portaria: "" });
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

test("normas federais e de Ibaiti são carregadas sem alterar os regulamentos locais", async () => {
  const admin = await new Cliente().entrar("admin@ibaiti.gov.br");
  const outro = await new Cliente().entrar("admin@a.gov.br");
  const original = (await admin.get("/api/orgao")).dados;
  assert.equal((await admin.put("/api/admin/orgao", { ...original, municipio: "Ibaiti", uf: "PR", normas: "Regulamento existente." })).status, 200);
  await migrar();
  await migrar();
  const { normas, normas_oficiais: oficiais } = (await admin.get("/api/orgao")).dados;
  assert.equal(normas, "Regulamento existente.");
  assert.deepEqual(oficiais.map((n: { tipo: string; numero: number; ano: number }) => `${n.tipo} ${n.numero}/${n.ano}`), [
    "Lei 14133/2021", "Decreto 2476/2023", "Decreto 2532/2024", "Decreto 2533/2024", "Decreto 2548/2024", "Decreto 2549/2024",
    "Lei 373/2004", "Lei 892/2018", "Lei 1316/2026",
  ]);
  assert.equal(oficiais[0].esfera, "Federal");
  assert.match(oficiais[0].fonte, /^https:\/\/www2\.camara\.leg\.br\/.*normaatualizada-pl\.pdf$/);
  assert.deepEqual((await outro.get("/api/orgao")).dados.normas_oficiais, [oficiais[0]]);
});

test("solicitações de outras secretarias usam o mesmo processo e preservam o anexo", async () => {
  const req = await new Cliente().entrar("req@a.gov.br");
  const jur = await new Cliente().entrar("jur@a.gov.br");
  const outro = await new Cliente().entrar("admin@b.gov.br");
  const p = `/api/processos/${procId}`;
  const original = (await req.get(p)).dados;
  const texto = "Materiais para manutenção das unidades de saúde.";
  const dados = new FormData();
  dados.set("chave_envio", randomUUID());
  dados.set("secretaria", "Saúde");
  dados.set("referencia", "Memorando 42/2026");
  dados.set("descricao", texto);
  dados.set("arquivo", new Blob([texto]), "solicitação-saúde.txt");
  assert.equal((await jur.post(`${p}/solicitacoes`, dados)).status, 403);
  assert.equal((await outro.post(`${p}/solicitacoes`, dados)).status, 404);
  const criada = await req.post(`${p}/solicitacoes`, dados);
  assert.equal(criada.status, 201);
  const repetida = await req.post(`${p}/solicitacoes`, dados);
  assert.equal(repetida.status, 200);
  assert.deepEqual(repetida.dados, criada.dados);
  const educacao = { chave_envio: randomUUID(), secretaria: "Educação", descricao: "Materiais para manutenção de escolas." };
  assert.equal((await req.post(`${p}/solicitacoes`, educacao)).status, 201);
  const detalhe = (await req.get(p)).dados;
  assert.equal(detalhe.protocolo, original.protocolo);
  assert.equal(detalhe.requisitante, original.requisitante);
  assert.deepEqual(detalhe.solicitacoes.map((s: { secretaria: string }) => s.secretaria), ["Saúde", "Educação"]);
  assert.equal(detalhe.solicitacoes[0].referencia, "Memorando 42/2026");
  const arquivo = `${p}/solicitacoes/${criada.dados.id}/arquivo`;
  assert.equal((await req.get(arquivo)).dados.toString(), texto);
  assert.equal((await outro.get(arquivo)).status, 404);
  assert.equal((await q1("select texto_arquivo from solicitacoes_processo where id=$1", [criada.dados.id]))!.texto_arquivo, texto);
  const novo = await req.post("/api/processos", { objeto: "Processo isolado para teste", tipo: "bens", via: "licitacao", ano: 2028 });
  assert.equal((await req.get(`/api/processos/${novo.dados.id}/solicitacoes/${criada.dados.id}/arquivo`)).status, 404);
  const admin = await new Cliente().entrar("admin@a.gov.br");
  assert.equal((await admin.post(`/api/processos/${novo.dados.id}/situacao`, { situacao: "cancelado" })).status, 200);
  assert.equal((await req.post(`/api/processos/${novo.dados.id}/solicitacoes`, educacao)).status, 409);
});

test("áreas requisitantes adicionais são gravadas na abertura e podem ser editadas", async () => {
  const req = await new Cliente().entrar("req@a.gov.br");
  const dados = { objeto: "Aquisição conjunta de materiais", tipo: "bens", via: "licitacao", ano: 2029, requisitante: "Administração" };
  const criado = await req.post("/api/processos", { ...dados, areas_adicionais: ["Educação", "Saúde"] });
  assert.equal(criado.status, 201);
  const rota = `/api/processos/${criado.dados.id}`;
  assert.deepEqual((await req.get(rota)).dados.areas_adicionais, ["Educação", "Saúde"]);
  assert.equal((await req.put(rota, dados)).status, 200);
  assert.deepEqual((await req.get(rota)).dados.areas_adicionais, ["Educação", "Saúde"]);
  assert.equal((await req.put(rota, { ...dados, areas_adicionais: ["Obras"] })).status, 200);
  assert.deepEqual((await req.get(rota)).dados.areas_adicionais, ["Obras"]);
  assert.deepEqual((await req.get("/api/processos?ano=2029")).dados[0].areas_adicionais, ["Obras"]);
});

test("PCA integral de Ibaiti é acessível e o item 39 é vinculado na abertura", async () => {
  const admin = await new Cliente().entrar("admin@ibaiti.gov.br");
  const outro = await new Cliente().entrar("req@a.gov.br");
  await migrar();
  await migrar();
  const plano = (await admin.get("/api/pca?ano=2026")).dados;
  assert.equal(plano.itens.length, 120);
  assert.equal(plano.total_planejado, null);
  const pdf = await admin.get(plano.documento.url);
  assert.equal(pdf.status, 200);
  assert.equal(pdf.dados.subarray(0, 5).toString(), "%PDF-");
  assert.equal((await outro.get(plano.documento.url)).status, 404);
  const item = plano.itens.find((i: { ordem_oficial: number }) => i.ordem_oficial === 39);
  assert.equal(item.pagina_oficial, 10);
  const dados = { objeto: "Serviços de manutenção preventiva e corretiva e limpeza de aparelhos de ar condicionado nas secretarias municipais", tipo: "servicos", via: "licitacao", ano: 2026 };
  const criado = await admin.post("/api/processos", dados);
  assert.equal(criado.status, 201);
  assert.equal((await admin.get(`/api/processos/${criado.dados.id}`)).dados.pca_item_id, item.id);
  const compra = await admin.post("/api/processos", { ...dados, objeto: "Aquisição de ar-condicionado instalado", tipo: "bens" });
  assert.equal((await admin.get(`/api/processos/${compra.dados.id}`)).dados.pca_item_id, plano.itens.find((i: { ordem_oficial: number }) => i.ordem_oficial === 8).id);
  const sem = await admin.post("/api/processos", { ...dados, objeto: "Serviço de calibração de telescópio orbital" });
  assert.equal((await admin.get(`/api/processos/${sem.dados.id}`)).dados.pca_item_id, null);
  assert.equal((await admin.put(`/api/processos/${criado.dados.id}`, { ...dados, ano: 2027, pca_item_id: item.id })).status, 400);
  assert.equal((await outro.post("/api/processos", { ...dados, pca_item_id: item.id })).status, 400);
});

test("preenche portaria de nomeação pelo cadastro, sem usar ato de fiscal ou adivinhar o titular", async () => {
  const admin = await new Cliente().entrar("admin@ibaiti.gov.br");
  const { lista } = (await admin.get("/api/admin/secretarios")).dados;
  const saude = lista.find((s: { secretaria: string }) => s.secretaria === "Saúde");
  assert.equal(saude.portaria, "009/2025");
  assert.match(saude.fonte_portaria, /^https:/);
  await q1("update secretarios set portaria=null, fonte_portaria='' where id=$1", [saude.id]);
  await migrar();
  assert.equal((await admin.get("/api/admin/secretarios")).dados.lista.find((s: { id: number }) => s.id === saude.id).portaria, "009/2025");
  const { dados: { id } } = await admin.post("/api/processos", {
    objeto: "Contratação de teste com portarias", tipo: "bens", via: "licitacao",
    ano: 2028, requisitante: "SEMUSA", areas_adicionais: ["Secretaria de Educação (SEDUC)", "Obras"],
  });
  const rota = `/api/processos/${id}/minutas/dfd`;
  const texto = [
    "Portaria nº [[portaria de nomeação — Saúde]]",
    "Educação — Portaria nº [[número]]",
    "Fiscal — Portaria nº [[portaria de designação]]",
    "Portaria nº [[portaria de nomeação]]",
  ].join("\n");
  assert.equal((await admin.post(rota, { texto })).status, 200);
  const atual = (await admin.get(rota)).dados.vigente.texto;
  assert.match(atual, /Portaria nº 009\/2025/);
  assert.match(atual, /Educação — Portaria nº 008\/2025/);
  assert.ok(atual.includes("[[portaria de designação]]"));
  assert.ok(atual.includes("[[portaria de nomeação]]"));
  const minuta = (await admin.get(rota)).dados;
  assert.equal(minuta.titulares_dfd.total, 3);
  assert.deepEqual(minuta.titulares_dfd.areas_sem_cadastro, []);
  assert.deepEqual(minuta.titulares_dfd.areas_sem_portaria, ["Obras, Viação e Serviços Urbanos"]);
  assert.equal((await admin.post(`${rota}/titulares`, { versao: 0 })).status, 409);
  assert.equal((await admin.post(`${rota}/titulares`, { versao: minuta.vigente.versao })).status, 200);
  const atualizado = (await admin.get(rota)).dados;
  assert.match(atualizado.vigente.texto, /Saúde — Amabily da Silva Laverde\. Portaria de nomeação nº 009\/2025/);
  assert.match(atualizado.vigente.texto, /Educação — Denise da Silva Lima\. Portaria de nomeação nº 008\/2025/);
  assert.match(atualizado.vigente.texto, /Antônio Vincenzi.*PREENCHER: portaria de nomeação/);
  assert.ok(atualizado.vigente.texto.startsWith(atual));
  assert.equal(atualizado.titulares_dfd.pode_inserir, false);
  assert.deepEqual((await admin.post(`${rota}/titulares`, { versao: atualizado.vigente.versao })).dados,
    { versao: atualizado.vigente.versao, nova: false });
  assert.equal((await admin.put(`/api/admin/secretarios/${saude.id}`, { ...saude, nome: "Novo titular de teste" })).status, 200);
  assert.equal((await admin.get("/api/admin/secretarios")).dados.lista.find((s: { id: number }) => s.id === saude.id).portaria, "");
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

test("Ibaiti pode baixar seus 11 timbrados e aplicá-los à minuta Word", async () => {
  const admin = await new Cliente().entrar("admin@ibaiti.gov.br");
  const outro = await new Cliente().entrar("req@a.gov.br");
  const { timbrados } = (await admin.get("/api/orgao")).dados;
  assert.equal(timbrados.length, 11);
  for (const { codigo } of timbrados) {
    const modelo = await admin.get(`/api/orgao/timbrados/${codigo}`);
    assert.equal(modelo.status, 200);
    assert.ok(modelo.dados.includes(Buffer.from("word/header1.xml")));
    assert.ok(modelo.dados.includes(Buffer.from("word/footer1.xml")));
  }
  assert.equal((await outro.get("/api/orgao/timbrados/semad")).status, 404);
  const { dados: { id } } = await admin.post("/api/processos", { objeto: "Processo para teste de timbrado", tipo: "bens", via: "licitacao", ano: 2028 });
  const rota = `/api/processos/${id}/minutas/dfd`;
  assert.equal((await admin.post(rota, { texto: "# DOCUMENTO DE FORMALIZAÇÃO DA DEMANDA" })).status, 200);
  const minuta = await admin.get(`${rota}/docx?timbrado=semad&versao=1`);
  assert.equal(minuta.status, 200);
  assert.ok(minuta.dados.includes(Buffer.from("word/header1.xml")));
  assert.ok(minuta.dados.includes(Buffer.from("word/footer1.xml")));
  assert.equal((await admin.get(`${rota}/docx?timbrado=inexistente`)).status, 404);
  const solicitacoes = `/api/processos/${id}/solicitacoes`;
  const s = await admin.post(solicitacoes, { chave_envio: randomUUID(), secretaria: "Administração", descricao: "# SOLICITAÇÃO" });
  assert.equal(s.status, 201);
  const solicitacao = await admin.get(`${solicitacoes}/${s.dados.id}/docx?timbrado=semad`);
  assert.equal(solicitacao.status, 200);
  assert.ok(solicitacao.dados.includes(Buffer.from("word/header1.xml")));
  assert.ok(solicitacao.dados.includes(Buffer.from("word/footer1.xml")));
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
  // O protocolo não muda com a numeração. Nas aberturas simultâneas, qual processo recebeu qual número não é garantido.
  assert.equal(dep.dados.protocolo, rs[0].dados.protocolo);
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

test("abertura do processo: área requisitante traz o secretário e a portaria do cadastro", async () => {
  const admin = await new Cliente().entrar("admin@ibaiti.gov.br");
  const outro = await new Cliente().entrar("admin@b.gov.br");
  assert.equal((await new Cliente().get("/api/secretarios")).status, 401);
  assert.equal((await new Cliente().post("/api/secretarios/titulares", { areas: ["Saúde"] })).status, 401);
  const lista = (await admin.get("/api/secretarios")).dados;
  assert.ok(lista.some((s: any) => s.secretaria === "Educação" && s.nome === "Denise da Silva Lima" && s.portaria === "008/2025"));
  const r = await admin.post("/api/secretarios/titulares", { areas: ["Educação", "SEDUC", "Secretaria Municipal de Educação", "Finanças", "Obras", "Setor inexistente", ""] });
  assert.equal(r.status, 200, JSON.stringify(r.dados));
  assert.deepEqual(r.dados.map((x: any) => [x.area, x.titular?.nome ?? null, x.titular?.portaria ?? null]), [
    ["Educação", "Denise da Silva Lima", "008/2025"],
    ["SEDUC", "Denise da Silva Lima", "008/2025"],
    ["Secretaria Municipal de Educação", "Denise da Silva Lima", "008/2025"],
    ["Finanças", "Luiz Carlos Bernardi Gelinski", "003/2025"],
    ["Obras", "Antônio Vincenzi", ""],
    ["Setor inexistente", null, null],
    ["", null, null],
  ]);
  assert.match(r.dados[0].titular.fonte_portaria, /^https:/);
  // Outro órgão não enxerga o cadastro de Ibaiti.
  assert.ok(!(await outro.get("/api/secretarios")).dados.some((s: any) => s.nome === "Denise da Silva Lima"));
  assert.equal((await outro.post("/api/secretarios/titulares", { areas: ["Educação"] })).dados[0].titular, null);
});

test("minutas: nome do secretário e portaria entram sozinhos em qualquer peça, só quando o titular é inequívoco", async () => {
  const admin = await new Cliente().entrar("admin@ibaiti.gov.br");
  const base = { objeto: "Contratação de teste com titular único", tipo: "bens", via: "licitacao", ano: 2028 };
  const { dados: { id } } = await admin.post("/api/processos", { ...base, requisitante: "SEDUC" });
  const rota = `/api/processos/${id}/minutas/dfd`;
  const texto = [
    "# DOCUMENTO DE FORMALIZAÇÃO DA DEMANDA",
    "Titular: [[PREENCHER: nome do secretário]] — Portaria nº [[portaria de nomeação]]",
    "Fiscal: [[nome do fiscal do contrato]]",
    "Outra pasta: [[nome do secretário municipal de administração]]",
    "Autoridade: [[nome da autoridade competente]]",
    "",
    "@ [[nome do titular da área requisitante]]",
    "@ Secretário(a) Municipal de Educação",
    "@ Portaria de nomeação nº [[número]]",
  ].join("\n");
  assert.equal((await admin.post(rota, { texto })).status, 200);
  const salvo = (await admin.get(rota)).dados.vigente.texto as string;
  assert.match(salvo, /Titular: Denise da Silva Lima — Portaria nº 008\/2025/);
  assert.match(salvo, /@ Denise da Silva Lima\n@ Secretário\(a\) Municipal de Educação\n@ Portaria de nomeação nº 008\/2025/);
  // O que não é o titular da área requisitante continua pendente.
  assert.ok(salvo.includes("[[nome do fiscal do contrato]]"));
  assert.ok(salvo.includes("[[nome do secretário municipal de administração]]"));
  assert.ok(salvo.includes("[[nome da autoridade competente]]"));

  // Com duas áreas, o pedido genérico fica pendente; o que cita a secretaria é preenchido.
  const dois = (await admin.post("/api/processos", { ...base, requisitante: "SEDUC", areas_adicionais: ["Finanças"] })).dados.id;
  const rota2 = `/api/processos/${dois}/minutas/dfd`;
  assert.equal((await admin.post(rota2, { texto: "A: [[nome do secretário]]\nB: [[nome do secretário — Finanças]]\nC: [[nome da secretária de Educação]]" })).status, 200);
  const v = (await admin.get(rota2)).dados;
  assert.equal(v.vigente.texto, "A: [[nome do secretário]]\nB: Luiz Carlos Bernardi Gelinski\nC: Denise da Silva Lima");
  assert.deepEqual(v.sugestoes_cadastro, []);
});

test("concluir e avançar: confere a solicitação, aponta o que falta e abre o ETP com os dados aproveitados", async () => {
  const admin = await new Cliente().entrar("admin@ibaiti.gov.br");
  const outro = await new Cliente().entrar("admin@b.gov.br");
  const { dados: { id, protocolo } } = await admin.post("/api/processos", { objeto: "Aquisição de 30 cadeiras escolares", tipo: "bens", via: "licitacao", ano: 2028, requisitante: "Almoxarifado", pca_item_id: null });
  const rota = `/api/processos/${id}/etapas/dfd/concluir`;
  assert.equal((await outro.post(rota)).status, 404);
  assert.equal((await admin.post(`/api/processos/${id}/etapas/etp/concluir`)).status, 409);
  let r = await admin.post(rota);
  assert.equal(r.status, 200, JSON.stringify(r.dados));
  assert.equal(r.dados.concluida, false);
  const cods = () => r.dados.pendencias.map((x: any) => x.codigo);
  assert.deepEqual([...new Set(cods())], ["valor", "secretario", "pca", "minuta", "item"]);
  assert.equal(r.dados.pendencias.find((x: any) => x.codigo === "pca").bloqueia, false);
  assert.deepEqual(r.dados.pendencias.find((x: any) => x.codigo === "valor"), { codigo: "valor", texto: "Informe o valor estimado preliminar nos dados do processo.", onde: "dados", alvo: "valor", bloqueia: true });
  assert.equal((await admin.get(`/api/processos/${id}/minutas/etp`)).dados.vigente, null);

  // Corrige os dados; a secretaria sem portaria passa a ser a pendência.
  const dados = { objeto: "Aquisição de 30 cadeiras escolares", tipo: "bens", via: "licitacao", ano: 2028, requisitante: "Obras", valor_estimado: 9000, pca_item_id: null };
  assert.equal((await admin.put(`/api/processos/${id}`, dados)).status, 200);
  r = await admin.post(rota);
  assert.match(r.dados.pendencias.find((x: any) => x.codigo === "portaria").texto, /Antônio Vincenzi \(Obras, Viação e Serviços Urbanos\)/);
  assert.equal((await admin.put(`/api/processos/${id}`, { ...dados, requisitante: "SEDUC" })).status, 200);

  // Minuta com campo pendente trava; completa, só resta a conferência.
  const dfd = (extra: string) => ["# DOCUMENTO DE FORMALIZAÇÃO DA DEMANDA", "## 2. Objeto", "Cadeiras escolares.", "## 3. Justificativa da necessidade", "As cadeiras atuais estão quebradas, conforme laudo anexo.", "## 4. Quantidade e valor estimado", "30 unidades, a R$ 300,00 cada.", extra, "", "@ Denise da Silva Lima"].join("\n");
  assert.equal((await admin.post(`/api/processos/${id}/minutas/dfd`, { texto: dfd("Prazo: [[prazo de entrega]]") })).status, 200);
  r = await admin.post(rota);
  assert.match(r.dados.pendencias.find((x: any) => x.codigo === "campos").texto, /1 campo pendente/);
  assert.equal((await admin.post(`/api/processos/${id}/minutas/dfd`, { texto: dfd("## 5. Prazo\n30 dias.") })).status, 200);
  r = await admin.post(rota);
  assert.deepEqual([...new Set(cods())], ["pca", "item"]);
  for (const i of itensDe(ETAPAS[0], { tipo: "bens", via: "licitacao" })) await admin.post(`/api/processos/${id}/checagens`, { item: i.id, marcado: true });

  // Tudo certo: conclui, mantém o aviso do PCA e abre o ETP já preenchido.
  r = await admin.post(rota);
  assert.equal(r.dados.concluida, true);
  assert.deepEqual(r.dados.proxima, { id: "etp", nome: "Estudo Técnico Preliminar", rascunho: true });
  assert.deepEqual(cods(), ["pca"]);
  const etp = (await admin.get(`/api/processos/${id}/minutas/etp`)).dados.vigente;
  assert.equal(etp.origem, "aproveitado");
  assert.ok(etp.texto.includes(`Protocolo ${protocolo}`));
  assert.match(etp.texto, /## 1\. Informações básicas\nObjeto: Aquisição de 30 cadeiras escolares/);
  assert.match(etp.texto, /## 2\. Descrição da necessidade\nAs cadeiras atuais estão quebradas, conforme laudo anexo\./);
  assert.match(etp.texto, /## 3\. Área requisitante\nSEDUC\nEducação — Denise da Silva Lima\. Portaria de nomeação nº 008\/2025\./);
  assert.match(etp.texto, /## 6\. Estimativa das quantidades\n30 unidades, a R\$ 300,00 cada\./);
  assert.match(etp.texto, /## 7\. Estimativa do valor\nValor estimado preliminar informado na solicitação: R\$\s9\.000,00/);
  assert.match(etp.texto, /\[\[PREENCHER: requisitos da contratação/);
  // Repetir não sobrescreve o que já existe no ETP.
  assert.equal((await admin.post(`/api/processos/${id}/minutas/etp`, { texto: "# ETP revisado pelo servidor" })).status, 200);
  r = await admin.post(rota);
  assert.equal(r.dados.proxima.rascunho, false);
  assert.equal((await admin.get(`/api/processos/${id}/minutas/etp`)).dados.vigente.texto, "# ETP revisado pelo servidor");
});

test("revisão avulsa preserva PDFs, versões e evidências dentro do órgão", async () => {
  const jur = await new Cliente().entrar("jur@a.gov.br");
  const lic = await new Cliente().entrar("lic@a.gov.br");
  const req = await new Cliente().entrar("req@a.gov.br");
  const outro = await new Cliente().entrar("admin@b.gov.br");
  const dados = { numero: "17/2024", objeto: "Manutenção de escola", via: "dispensa" };
  assert.equal((await req.post("/api/revisoes", dados)).status, 403);
  const criada = await jur.post("/api/revisoes", dados);
  assert.equal(criada.status, 201, JSON.stringify(criada.dados));
  const caminho = `/api/revisoes/${criada.dados.id}`;
  assert.equal((await lic.get(caminho)).dados.processo_id, null);
  assert.equal((await outro.get(caminho)).status, 404);

  const pdf = await PDFDocument.create();
  pdf.addPage();
  const original = Buffer.from(await pdf.save());
  const anexar = (conteudo: BlobPart) => {
    const form = new FormData();
    form.append("tipo", "autos");
    form.append("arquivo", new Blob([conteudo], { type: "application/pdf" }), "autos.pdf");
    return jur.post(`${caminho}/arquivos`, form);
  };
  assert.equal((await anexar("Arquivo inválido")).status, 415);
  const anexo = await anexar(Uint8Array.from(original));
  assert.equal(anexo.status, 201, JSON.stringify(anexo.dados));
  assert.equal((await anexar(Uint8Array.from(original))).dados.id, anexo.dados.id);
  const arquivo = `${caminho}/arquivos/${anexo.dados.id}`;
  assert.deepEqual((await lic.get(arquivo)).dados, original);
  assert.equal((await outro.get(arquivo)).status, 404);

  const primeira = await jur.post(`${caminho}/minutas`, { tipo: "parecer", texto: "Primeira versão do parecer." });
  const segunda = await jur.post(`${caminho}/minutas`, { tipo: "parecer", texto: "Segunda versão do parecer." });
  assert.equal(primeira.status, 201);
  assert.equal(segunda.status, 201);
  assert.equal((await lic.get(`${caminho}/minutas/${primeira.dados.id}`)).dados.texto, "Primeira versão do parecer.");
  const word = await lic.get(`${caminho}/minutas/${segunda.dados.id}?formato=docx`);
  assert.match(word.tipo, /wordprocessingml/);
  assert.equal(word.dados.subarray(0, 2).toString(), "PK");

  const rec = { descricao: "Atualizar pesquisa de preços", referencia: "Parecer, item 2" };
  assert.equal((await lic.post(`${caminho}/recomendacoes`, { ...rec, situacao: "atendida" })).status, 400);
  assert.equal((await lic.post(`${caminho}/recomendacoes`, rec)).status, 201);
  const detalhe = (await jur.get(caminho)).dados;
  assert.equal(detalhe.arquivos.length, 1);
  assert.equal(detalhe.arquivos[0].paginas, 1);
  assert.deepEqual(detalhe.minutas.map((m: { id: number }) => m.id), [segunda.dados.id, primeira.dados.id]);
  const item = `${caminho}/recomendacoes/${detalhe.recomendacoes[0].id}`;
  const atendida = { ...rec, situacao: "atendida", ajuste: "Juntada pesquisa atualizada", evidencia: "Autos, p. 37" };
  assert.equal((await outro.put(item, atendida)).status, 404);
  assert.equal((await lic.put(item, atendida)).status, 200);
  assert.equal((await jur.get(caminho)).dados.recomendacoes[0].evidencia, atendida.evidencia);
});

test("nova revisão recebe o primeiro PDF no próprio cadastro", async () => {
  const lic = await new Cliente().entrar("lic@a.gov.br");
  const pdf = await PDFDocument.create();
  pdf.addPage();
  const original = Uint8Array.from(await pdf.save());
  const numero = "28/2024";
  const abrirCom = (arquivo: BlobPart) => {
    const form = new FormData();
    form.set("numero", numero);
    form.set("objeto", "Manutenção da rede de iluminação");
    form.set("via", "licitacao");
    form.set("tipo", "autos");
    form.set("arquivo", new Blob([arquivo], { type: "application/pdf" }), "autos-revisao.pdf");
    return lic.post("/api/revisoes", form);
  };
  assert.equal((await abrirCom("Arquivo inválido")).status, 415);
  assert.equal((await lic.get("/api/revisoes")).dados.some((r: { numero: string }) => r.numero === numero), false);
  const criada = await abrirCom(original);
  assert.equal(criada.status, 201, JSON.stringify(criada.dados));
  const detalhes = await lic.get(`/api/revisoes/${criada.dados.id}`);
  assert.equal(detalhes.dados.processo_id, null);
  assert.deepEqual(detalhes.dados.arquivos, [{ id: detalhes.dados.arquivos[0]?.id, tipo: "autos", nome: "autos-revisao.pdf", paginas: 1 }]);
  const anexo = await lic.get(`/api/revisoes/${criada.dados.id}/arquivos/${detalhes.dados.arquivos[0].id}`);
  assert.deepEqual(anexo.dados, Buffer.from(original));
});

test("solicitação existente entra no processo pelo arquivo, com descrição opcional", async () => {
  const lic = await new Cliente().entrar("lic@a.gov.br");
  const criada = await lic.post("/api/processos", { objeto: "Aquisição de materiais", tipo: "bens", via: "licitacao", ano: 2090 });
  assert.equal(criada.status, 201);
  const p = `/api/processos/${criada.dados.id}`;
  const caminho = `${p}/solicitacoes`;
  const dados = new FormData();
  dados.set("chave_envio", randomUUID());
  dados.set("secretaria", "Educação");
  assert.equal((await lic.post(caminho, dados)).status, 400);
  const pdf = await PDFDocument.create();
  pdf.addPage();
  const original = Uint8Array.from(await pdf.save());
  dados.set("arquivo", new Blob([original], { type: "application/pdf" }), "memorando.pdf");
  const anexo = await lic.post(caminho, dados);
  assert.equal(anexo.status, 201, JSON.stringify(anexo.dados));
  const registro = (await lic.get(p)).dados.solicitacoes[0];
  assert.equal(registro.descricao, "");
  assert.equal(registro.nome_arquivo, "memorando.pdf");
  assert.deepEqual((await lic.get(`${caminho}/${anexo.dados.id}/arquivo`)).dados, Buffer.from(original));
});

test("modelo da solicitação preenche o titular, guarda pendências e exporta a versão editada", async () => {
  const admin = await new Cliente().entrar("admin@a.gov.br");
  const req = await new Cliente().entrar("req@a.gov.br");
  const outro = await new Cliente().entrar("admin@b.gov.br");
  const secretaria = "Serviços de Teste";
  const titular = await admin.post("/api/admin/secretarios", { secretaria, nome: "Titular de Teste", portaria: "77/2026" });
  assert.equal(titular.status, 201, JSON.stringify(titular.dados));
  const modelo = "# PEDIDO\nProtocolo [[Protocolo]]\n[[Objeto]]\n[[Justificativa]]\n@ [[Nome do secretário]]\n@ Portaria de nomeação nº [[Portaria de nomeação]]";
  const modelos = await admin.get("/api/modelos");
  assert.ok(modelos.dados.some((m: { etapa: string }) => m.etapa === "solicitacao"));
  assert.equal((await admin.put("/api/admin/modelos/solicitacao", { texto: modelo })).status, 200);
  const p = await req.post("/api/processos", { objeto: "Compra de papel reciclado", tipo: "bens", via: "licitacao", ano: 2091 });
  assert.equal(p.status, 201);
  const processo = `/api/processos/${p.dados.id}`;
  const caminho = `${processo}/solicitacoes`;
  assert.deepEqual((await req.get(`${caminho}/modelo`)).dados, { texto: modelo });
  assert.equal((await outro.get(`${caminho}/modelo`)).status, 404);
  const s = await req.post(caminho, { chave_envio: randomUUID(), secretaria, descricao: modelo });
  assert.equal(s.status, 201);
  const detalhe = (await req.get(processo)).dados.solicitacoes[0];
  assert.ok(detalhe.descricao.includes(p.dados.protocolo));
  assert.match(detalhe.descricao, /Compra de papel reciclado/);
  assert.match(detalhe.descricao, /Titular de Teste/);
  assert.match(detalhe.descricao, /Portaria de nomeação nº 77\/2026/);
  assert.match(detalhe.descricao, /\[\[Justificativa\]\]/);
  const rota = `${caminho}/${s.dados.id}`;
  const descricao = detalhe.descricao.replace("[[Justificativa]]", "Reposição do estoque.");
  assert.equal((await outro.put(rota, { descricao, anterior: detalhe.descricao })).status, 404);
  assert.equal((await req.put(rota, { descricao, anterior: detalhe.descricao })).status, 200);
  assert.equal((await req.put(rota, { descricao: "Outro texto", anterior: detalhe.descricao })).status, 409);
  assert.equal((await req.get(processo)).dados.solicitacoes[0].descricao, descricao);
  const word = await req.get(`${rota}/docx`);
  assert.match(word.tipo, /wordprocessingml/);
  assert.equal(word.dados.subarray(0, 2).toString(), "PK");
  assert.equal((await outro.get(`${rota}/docx`)).status, 404);
  assert.equal((await admin.put("/api/admin/modelos/solicitacao", { texto: "" })).status, 200);
});

test("solicitação com objeto genérico, justificativa e itens com quantidade e valor", async () => {
  const admin = await new Cliente().entrar("admin@ibaiti.gov.br");
  const { dados: { id, protocolo } } = await admin.post("/api/processos", { objeto: "Aquisição de mobiliário para as escolas municipais", tipo: "bens", via: "licitacao", ano: 2028, requisitante: "SEDUC" });
  const rota = `/api/processos/${id}/solicitacoes`;
  const modelo = (await admin.get(`${rota}/modelo`)).dados.texto as string;
  assert.ok(modelo.includes("[[Itens]]"));
  const itens = [
    { descricao: "Cadeira escolar | empilhável", unidade: "un", quantidade: 30, valor_unitario: 300 },
    { descricao: "Mesa escolar individual", unidade: "un", quantidade: 30, valor_unitario: 250.5 },
    { descricao: "Armário de aço", unidade: "", quantidade: null, valor_unitario: null },
  ];
  const corpo = (extra: object) => ({ chave_envio: crypto.randomUUID(), secretaria: "SEDUC", referencia: "Memorando 7/2028", descricao: modelo, ...extra });
  const r = await admin.post(rota, corpo({ objeto_solicitacao: "Mobiliário escolar", justificativa: "As cadeiras atuais estão quebradas.", itens }));
  assert.equal(r.status, 201, JSON.stringify(r.dados));
  const s = (await admin.get(`/api/processos/${id}`)).dados.solicitacoes.find((x: any) => x.id === r.dados.id);
  assert.equal(s.objeto, "Mobiliário escolar");
  assert.equal(s.justificativa, "As cadeiras atuais estão quebradas.");
  assert.deepEqual(s.itens, itens);
  assert.ok(s.descricao.includes(`Protocolo ${protocolo}`));
  assert.match(s.descricao, /## Objeto\nMobiliário escolar\n/);
  assert.match(s.descricao, /## Justificativa da necessidade\nAs cadeiras atuais estão quebradas\.\n/);
  assert.match(s.descricao, /## Itens solicitados\n\| Item \| Descrição \| Un\. \| Qtd\. \| Valor unitário \| Valor total \|\n\|---/);
  assert.match(s.descricao, /\| 1 \| Cadeira escolar \/ empilhável \| un \| 30 \| R\$\s300,00 \| R\$\s9\.000,00 \|/);
  assert.match(s.descricao, /\| 2 \| Mesa escolar individual \| un \| 30 \| R\$\s250,50 \| R\$\s7\.515,00 \|/);
  assert.match(s.descricao, /\| 3 \| Armário de aço \| — \| — \| — \| — \|/);
  assert.match(s.descricao, /\| \| Total estimado \| \| \| \| R\$\s16\.515,00 \|/);
  assert.match(s.descricao, /@ Denise da Silva Lima/);
  assert.equal(s.descricao.match(/## Itens solicitados/g).length, 1);

  // Sem objeto próprio vale o do processo; sem itens o campo do modelo continua pendente.
  const r2 = await admin.post(rota, corpo({ secretaria: "Finanças" }));
  const s2 = (await admin.get(`/api/processos/${id}`)).dados.solicitacoes.find((x: any) => x.id === r2.dados.id);
  assert.match(s2.descricao, /## Objeto\nAquisição de mobiliário para as escolas municipais\n/);
  assert.ok(s2.descricao.includes("[[Itens]]") && s2.descricao.includes("[[Justificativa da contratação]]"));
  assert.deepEqual(s2.itens, []);

  // Texto livre, sem o campo [[Itens]]: o quadro entra antes da assinatura, uma única vez.
  const r3 = await admin.post(rota, corpo({ secretaria: "Governo", descricao: "# PEDIDO\nPrecisamos dos itens abaixo.\n\n@ Fulana", itens: itens.slice(0, 1) }));
  const s3 = (await admin.get(`/api/processos/${id}`)).dados.solicitacoes.find((x: any) => x.id === r3.dados.id);
  assert.match(s3.descricao, /^# PEDIDO\nPrecisamos dos itens abaixo\.\n\n## Itens solicitados\n\| Item [\s\S]*R\$\s9\.000,00 \|\n\n@ Fulana$/);
  // Modelo do órgão com [[Itens]] sob outro título não recebe o quadro duas vezes.
  const r4 = await admin.post(rota, corpo({ secretaria: "Administração", descricao: "## Relação\n[[Itens]]\n\n@ Beltrano", itens: itens.slice(0, 1) }));
  const s4 = (await admin.get(`/api/processos/${id}`)).dados.solicitacoes.find((x: any) => x.id === r4.dados.id);
  assert.equal(s4.descricao.match(/\| Item \| Descrição/g).length, 1);
  assert.ok(!s4.descricao.includes("## Itens solicitados"));

  // Itens inválidos são recusados.
  assert.equal((await admin.post(rota, corpo({ itens: [{ descricao: "", quantidade: 1, valor_unitario: 1 }] }))).status, 400);
  assert.equal((await admin.post(rota, corpo({ itens: [{ descricao: "X", quantidade: -1, valor_unitario: 1 }] }))).status, 400);
  assert.equal((await admin.post(rota, corpo({ itens: "isto não é uma lista" }))).status, 400);
  // Pelo formulário com arquivo, os itens chegam como texto JSON.
  const fd = new FormData();
  for (const [k, v] of Object.entries(corpo({ secretaria: "Saúde", descricao: "" }))) fd.set(k, String(v));
  fd.set("itens", JSON.stringify(itens.slice(0, 2)));
  fd.set("arquivo", new Blob(["Pedido da Saúde"]), "pedido.txt");
  const r5 = await admin.req("POST", rota, fd);
  assert.equal(r5.status, 201, JSON.stringify(r5.dados));
  assert.equal((await admin.get(`/api/processos/${id}`)).dados.solicitacoes.find((x: any) => x.id === r5.dados.id).itens.length, 2);
});

test("cotações anexadas calculam médias unitárias, subtotais e total da solicitação", async () => {
  const lic = await new Cliente().entrar("lic@a.gov.br");
  const novo = (objeto: string) => lic.post("/api/processos", { objeto, tipo: "bens", via: "licitacao", ano: 2094 });
  const p = (await novo("Aquisição de equipamentos de climatização")).dados.id;
  const outro = (await novo("Aquisição de mobiliário")).dados.id;
  const anexar = async (processo: number, nome: string) => {
    const dados = new FormData();
    dados.append("arquivo", new Blob(["Proposta de teste"]), nome);
    const r = await lic.post(`/api/processos/${processo}/orcamentos?origem=solicitacao`, dados);
    assert.equal(r.status, 201, JSON.stringify(r.dados));
    return r.dados.ids[0] as number;
  };
  const a = await anexar(p, "proposta-a.txt");
  const b = await anexar(p, "proposta-b.txt");
  const c = await anexar(outro, "proposta-c.txt");
  const cotacao = (orcamento_id: number, fornecedor: string, valor_unitario: number | null) => ({ orcamento_id, fornecedor, valor_unitario });
  const itens = [
    { descricao: "Ar-condicionado", unidade: "un", quantidade: 3, valor_unitario: 9999, cotacoes: [cotacao(a, "Fornecedor A", 100), cotacao(b, "Fornecedor B", 120)] },
    { descricao: "Suporte", unidade: "un", quantidade: 2, valor_unitario: null, cotacoes: [cotacao(a, "Fornecedor A", 50), cotacao(b, "Fornecedor B", null)] },
    { descricao: "Controle remoto", unidade: "un", quantidade: 1, valor_unitario: null, cotacoes: [] },
  ];
  const processo = `/api/processos/${p}`;
  const caminho = `${processo}/solicitacoes`;
  const salvar = (itens: unknown) => lic.post(caminho, {
    chave_envio: randomUUID(), secretaria: "Educação", descricao: "# PEDIDO\n[[Itens]]", itens,
  });
  assert.equal((await salvar([{ ...itens[0], cotacoes: [cotacao(c, "Fornecedor C", 100)] }])).status, 400);
  assert.equal((await salvar([{ ...itens[0], cotacoes: [cotacao(a, "Fornecedor A", 100), cotacao(b, " FORNECEDOR A ", 120)] }])).status, 400);
  const criada = await salvar(itens);
  assert.equal(criada.status, 201, JSON.stringify(criada.dados));
  const anterior = (await lic.get(processo)).dados.solicitacoes[0];
  assert.deepEqual(anterior.itens.map((i: { valor_unitario: number | null }) => i.valor_unitario), [110, 50, null]);
  assert.match(anterior.descricao, /Ar-condicionado .*R\$\s110,00 .*R\$\s330,00/);
  assert.match(anterior.descricao, /Subtotal dos itens com valor .*R\$\s430,00/);
  assert.equal((await lic.req("DELETE", `${processo}/orcamentos/${a}`)).status, 409);

  const completos = [itens[0], itens[1], { ...itens[2], cotacoes: [cotacao(b, "Fornecedor B", 25)] }];
  const alteracao = { anterior: anterior.descricao, descricao: anterior.descricao, itens_anteriores: anterior.itens, itens: completos };
  const alterada = await lic.put(`${caminho}/${criada.dados.id}`, alteracao);
  assert.equal(alterada.status, 200, JSON.stringify(alterada.dados));
  const final = (await lic.get(processo)).dados.solicitacoes[0];
  assert.match(final.descricao, /Total estimado .*R\$\s455,00/);
  assert.equal(final.descricao.match(/Valor unitário estimado/g).length, 1);
  assert.equal((await lic.put(`${caminho}/${criada.dados.id}`, alteracao)).status, 409);
  const criterio = await lic.put(`${caminho}/${criada.dados.id}`, {
    anterior: final.descricao, descricao: final.descricao, itens_anteriores: final.itens,
    itens: [{ ...completos[0], criterio: "menor" }, ...completos.slice(1)],
  });
  assert.equal(criterio.status, 200, JSON.stringify(criterio.dados));
  assert.match((await lic.get(processo)).dados.solicitacoes[0].descricao, /Total estimado .*R\$\s425,00/);
});

test("busca PNCP usa os filtros do Licita Ibaiti e devolve o link oficial com o valor unitário", async () => {
  assert.equal((await new Cliente().get("/api/pncp-search?q=ar+condicionado")).status, 401);
  const c = await new Cliente().entrar("req@a.gov.br");
  assert.equal((await c.get("/api/pncp-search?q=A")).status, 400);
  assert.equal((await c.get("/api/pncp-search?q=ar+condicionado&uf=XX")).status, 400);
  const chamadas: URL[] = [];
  const resposta = await buscarPncp({ q: "ar condicionado", uf: "PR", status: "encerradas" }, async (entrada) => {
    const url = new URL(String(entrada));
    chamadas.push(url);
    if (url.pathname === "/api/search/") return Response.json({ items: [{
      numero_controle_pncp: "75378844000170-1-000049/2026", orgao_nome: "Prefeitura de teste", uf: "PR",
      municipio_nome: "Município de teste", modalidade_nome: "Pregão eletrônico",
    }] });
    return Response.json([
      { numeroItem: 1, descricao: "Ar condicionado split", quantidade: 5, unidadeMedida: "un", valorUnitarioEstimado: 2750 },
      { numeroItem: 2, descricao: "Armário de aço", quantidade: 5, valorUnitarioEstimado: 1150 },
      { numeroItem: 3, descricao: "Suporte de ar condicionado" },
    ]);
  });
  assert.equal(chamadas[0].searchParams.get("ufs"), "PR");
  assert.equal(chamadas[0].searchParams.get("status"), "encerradas");
  assert.equal(chamadas[1].pathname, "/api/pncp/v1/orgaos/75378844000170/compras/2026/49/itens");
  assert.equal(resposta.resultados.length, 1);
  assert.equal(resposta.resultados[0].unitValue, 2750);
  assert.equal(resposta.resultados[0].sourceUrl, "https://pncp.gov.br/app/editais/75378844000170/2026/49");
});

test("leitura de proposta separa os itens novos e evita lançar duas linhas no mesmo item", () => {
  const lido = { descricao: "Ar condicionado", unidade: "UN", quantidade: 5, valor_unitario: 2500, valor_total: 12500 };
  const existentes = [{ descricao: "AR CONDICIONADO", unidade: "un" }, { descricao: "Suporte", unidade: "par" }];
  assert.deepEqual(destinosDoOrcamento(existentes, [lido, lido, { ...lido, descricao: "Suporte", unidade: "un" }]), [
    { indice: 0, ambigua: false }, { indice: null, ambigua: true }, { indice: null, ambigua: false },
  ]);
  const fontes = [100, 120, 900].map((valor_unitario, i) => ({ orcamento_id: i + 1, fornecedor: `Fonte ${i + 1}`, valor_unitario }));
  assert.equal(valorDasCotacoes(fontes, "media"), 373.33);
  assert.equal(valorDasCotacoes(fontes, "mediana"), 120);
  assert.equal(valorDasCotacoes(fontes, "menor"), 100);
});

test("preços digitados antes do anexo ficam salvos e entram no cálculo após o vínculo", async () => {
  const lic = await new Cliente().entrar("lic@a.gov.br");
  const criado = await lic.post("/api/processos", { objeto: "Aquisição de materiais de expediente", tipo: "bens", via: "licitacao", ano: 2095 });
  assert.equal(criado.status, 201);
  const processo = `/api/processos/${criado.dados.id}`;
  const caminho = `${processo}/solicitacoes`;
  const cotacoes = [
    { orcamento_id: null, fornecedor: "Papelaria A", valor_unitario: 12.5 },
    { orcamento_id: null, fornecedor: "Papelaria B", valor_unitario: 18 },
  ];
  const item = { descricao: "Resma de papel", unidade: "un", quantidade: 4, cotacoes };
  const salva = await lic.post(caminho, {
    chave_envio: randomUUID(), secretaria: "Administração", descricao: "# SOLICITAÇÃO\n[[Itens]]", itens: [item],
  });
  assert.equal(salva.status, 201, JSON.stringify(salva.dados));
  const antes = (await lic.get(processo)).dados.solicitacoes[0];
  assert.deepEqual(antes.itens[0].cotacoes, cotacoes);
  assert.equal(antes.itens[0].valor_unitario, null);

  const form = new FormData();
  form.set("arquivo", new Blob(["Proposta A para resmas de papel"]), "proposta-a.txt");
  const anexo = await lic.post(`${processo}/orcamentos?origem=solicitacao`, form);
  assert.equal(anexo.status, 201);
  const atualizada = await lic.put(`${caminho}/${salva.dados.id}`, {
    anterior: antes.descricao, descricao: antes.descricao, itens_anteriores: antes.itens,
    itens: [{ ...item, cotacoes: [{ ...cotacoes[0], orcamento_id: anexo.dados.ids[0] }, cotacoes[1]] }],
  });
  assert.equal(atualizada.status, 200, JSON.stringify(atualizada.dados));
  const depois = (await lic.get(processo)).dados.solicitacoes[0];
  assert.equal(depois.itens[0].valor_unitario, 12.5);
  assert.equal(depois.itens[0].cotacoes[1].valor_unitario, 18);
  assert.match(depois.descricao, /Total estimado .*R\$\s50,00/);
});
