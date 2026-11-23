// Testes de ponta a ponta da API. Exigem um Postgres vazio em DATABASE_URL (ex.: banco licita_test).
import { lerOrcamentoSemIA } from "../leitura-sem-ia.js";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { PDFDocument } from "pdf-lib";
import { buscarPncp } from "../routes/pncp.js";
import { destinosDoOrcamento, itensRepetidos } from "../../shared/importar-orcamento.js";
import { documentoDaSolicitacao, inserirItens, quantidadeColunasCotacoes, valorDasCotacoes } from "../../shared/solicitacao.js";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { pool, q1 } from "../db.js";
import { migrar } from "../migrate.js";
import { hashSenha } from "../auth.js";
import { criarApp } from "../app.js";
import { extrairTexto } from "../extrair.js";
import { ETAPAS, itensDe, type Etapa } from "../../shared/etapas.js";

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

/** Preenche todos os campos da etapa com valores válidos (primeira opção, todas as marcas, texto de teste). */
async function preencherCampos(c: Cliente, id: number, e: Etapa) {
  if (e.id === "solicitacao") return registrarSolicitacao(c, id);
  if (!e.campos.length) return;
  const valores = Object.fromEntries(e.campos.map((x) => [x.id,
    x.tipo === "marcas" ? x.opcoes!.map(([k]) => k) : x.tipo === "opcao" ? x.opcoes![0][0] : x.tipo === "valor" ? "1.000,00" : "Texto de teste"]));
  const r = await c.put(`/api/processos/${id}/campos/${e.id}`, { valores });
  assert.equal(r.status, 200, JSON.stringify(r.dados));
}
/** Registra uma solicitação na secretaria requisitante do processo (etapa 2). */
async function registrarSolicitacao(c: Cliente, id: number) {
  const p = (await c.get(`/api/processos/${id}`)).dados;
  const r = await c.post(`/api/processos/${id}/solicitacoes`, { chave_envio: randomUUID(), secretaria: p.requisitante || "Secretaria de teste", descricao: "Pedido de teste." });
  assert.equal(r.status, 201, JSON.stringify(r.dados));
}
/** Conclui as etapas 1 (verificação no PAC) e 2 (Solicitação) para liberar o DFD. */
async function concluirPac(c: Cliente, id: number) {
  assert.equal((await c.put(`/api/processos/${id}/campos/pac`, { valores: { consta: "nao", justificativa_inclusao: "Demanda de teste." } })).status, 200);
  assert.equal((await c.post(`/api/processos/${id}/checagens`, { item: "pc1", marcado: true })).status, 200);
  await registrarSolicitacao(c, id);
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

  // Item do ETP antes de concluir a verificação no PAC: bloqueado.
  assert.equal((await req.post(`/api/processos/${procId}/checagens`, { item: "e14", marcado: true })).status, 409);
  // Item que não se aplica (p1 é só para bens/serviços).
  assert.equal((await req.post(`/api/processos/${procId}/checagens`, { item: "p1", marcado: true })).status, 400);
  // O item dos campos é do sistema: não se marca à mão.
  assert.equal((await req.post(`/api/processos/${procId}/checagens`, { item: "pac.campos", marcado: true })).status, 400);
  // Conclui a verificação no PAC: campos (fora do PAC, com autorização) e conferência.
  assert.equal((await req.put(`/api/processos/${procId}/campos/pac`, { valores: { consta: "nao", justificativa_inclusao: "Demanda surgida após a aprovação do PAC." } })).status, 200);
  for (const i of itensDe(ETAPAS[0], { tipo: "obra", via: "dispensa" }).filter((x) => !x.auto)) {
    assert.equal((await req.post(`/api/processos/${procId}/checagens`, { item: i.id, marcado: true })).status, 200);
  }
  // A etapa 2 (Solicitação) não trava: o processo segue direto para o DFD.
  assert.equal((await req.get(`/api/processos/${procId}`)).dados.etapa_atual, 2);
  // Conclui o DFD: campos e conferência.
  await preencherCampos(req, procId, ETAPAS[2]);
  for (const i of itensDe(ETAPAS[2], { tipo: "obra", via: "dispensa" }).filter((x) => !x.auto)) {
    assert.equal((await req.post(`/api/processos/${procId}/checagens`, { item: i.id, marcado: true })).status, 200);
  }
  const det = await req.get(`/api/processos/${procId}`);
  assert.equal(det.dados.etapa_atual, 3);
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
  // PAC 2027 da capacitação: 69 itens com prioridade, início previsto e modalidade.
  const pac2027 = (await admin.get("/api/pca?ano=2027")).dados.itens;
  assert.equal(pac2027.length, 69);
  assert.deepEqual(((x) => [x.descricao, x.requisitante, x.prioridade, x.periodo_oficial, x.modalidade_prevista])(pac2027.find((i: { ordem_oficial: number }) => i.ordem_oficial === 38)),
    ["Alimentação escolar / gêneros alimentícios", "Secretaria Municipal de Educação", "P1 Crítica", "Outubro/2026", "Pregão"]);
  assert.equal((await outro.get("/api/pca?ano=2027")).dados.itens.length, 0);
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
  await concluirPac(admin, id);
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

test("minuta versionada, campos pendentes e exportação Word e PDF", async () => {
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
  const pdfV1 = await req.get(`/api/processos/${procId}/minutas/etp/pdf?versao=1`);
  const pdfV2 = await req.get(`/api/processos/${procId}/minutas/etp/pdf`);
  for (const pdf of [pdfV1, pdfV2]) {
    assert.equal(pdf.status, 200);
    assert.equal(pdf.tipo, "application/pdf");
    assert.equal((await PDFDocument.load(pdf.dados)).getPageCount(), 1);
  }
  assert.notDeepEqual(pdfV1.dados, pdfV2.dados);
  assert.equal((await req.get(`/api/processos/${procId}/minutas/etp/pdf?versao=999`)).status, 404);
  // Minuta de etapa ainda bloqueada.
  assert.equal((await req.post(`/api/processos/${procId}/minutas/tr`, { texto: "x" })).status, 409);
});

test("Ibaiti pode baixar seus 11 timbrados e usá-los nas exportações Word e PDF", async () => {
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
  await concluirPac(admin, id);
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
  for (const url of [`${rota}/pdf?timbrado=semad&versao=1`, `${solicitacoes}/${s.dados.id}/pdf?timbrado=semad`]) {
    const pdf = await admin.get(url);
    assert.equal(pdf.status, 200);
    assert.equal(pdf.tipo, "application/pdf");
    assert.equal((await PDFDocument.load(pdf.dados)).getPageCount(), 1);
    assert.ok(pdf.dados.includes(Buffer.from("/Subtype /Image")));
    assert.equal((await outro.get(url)).status, 404);
  }
  assert.equal((await admin.get(`${rota}/pdf?timbrado=inexistente`)).status, 404);
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
  if (process.env.ANTHROPIC_API_KEY || process.env.GEMINI_API_KEY) return;
  const req = await new Cliente().entrar("req@a.gov.br");
  assert.equal((await req.get("/api/ia/status")).dados.disponivel, false);
  const r = await req.post(`/api/processos/${procId}/ia/sugerir`, { etapa: "etp" });
  assert.equal(r.status, 503);
  assert.match(r.dados.erro, /GEMINI_API_KEY/);
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
  for (const e of ETAPAS.slice(0, -1)) {
    await preencherCampos(adm, id, e);
    for (const i of itensDe(e, pb).filter((x) => !x.auto)) {
      assert.equal((await adm.post(`/api/processos/${id}/checagens`, { item: i.id, marcado: true })).status, 200, i.id);
    }
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
  await concluirPac(admin, id);
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
  await concluirPac(admin, dois);
  assert.equal((await admin.post(rota2, { texto: "A: [[nome do secretário]]\nB: [[nome do secretário — Finanças]]\nC: [[nome da secretária de Educação]]" })).status, 200);
  const v = (await admin.get(rota2)).dados;
  assert.equal(v.vigente.texto, "A: [[nome do secretário]]\nB: Luiz Carlos Bernardi Gelinski\nC: Denise da Silva Lima");
  assert.deepEqual(v.sugestoes_cadastro, []);
});

test("concluir e avançar: PAC e DFD cobram os campos, sugerem dados do processo e montam o documento sem IA", async () => {
  const admin = await new Cliente().entrar("admin@ibaiti.gov.br");
  const outro = await new Cliente().entrar("admin@b.gov.br");
  const { dados: { id, protocolo } } = await admin.post("/api/processos", { objeto: "Aquisição de 30 cadeiras escolares", tipo: "bens", via: "licitacao", ano: 2028, requisitante: "Almoxarifado", pca_item_id: null });
  const pac = `/api/processos/${id}/etapas/pac/concluir`;
  const rota = `/api/processos/${id}/etapas/dfd/concluir`;
  assert.equal((await outro.post(pac)).status, 404);
  assert.equal((await admin.post(rota)).status, 409);
  let r = await admin.post(pac);
  assert.equal(r.status, 200, JSON.stringify(r.dados));
  assert.equal(r.dados.concluida, false);
  const cods = () => r.dados.pendencias.map((x: any) => x.codigo);
  assert.deepEqual([...new Set(cods())], ["campo", "item"]);
  assert.deepEqual(r.dados.pendencias[0], { codigo: "campo", texto: "Preencha o campo \"O objeto consta do PAC vigente?\".", onde: "campos", alvo: "consta", bloqueia: true });

  // Diz que consta do PAC sem vincular o item: falta o item e os dados do cronograma.
  assert.equal((await admin.put(`/api/processos/${id}/campos/pac`, { valores: { consta: "sim", campo_inexistente: "x" } })).status, 200);
  r = await admin.post(pac);
  assert.deepEqual([...new Set(cods())], ["campo", "pca", "item"]);
  assert.deepEqual(r.dados.pendencias.filter((x: any) => x.codigo === "campo").map((x: any) => x.alvo), ["item_pac", "mes_planejado", "no_prazo"]);
  assert.equal(r.dados.pendencias.find((x: any) => x.codigo === "pca").bloqueia, true);

  // Fora do PAC: justificativa e autorização do Prefeito; o sistema marca o item dos campos.
  assert.equal((await admin.put(`/api/processos/${id}/campos/pac`, { valores: { consta: "nao", justificativa_inclusao: "Cadeiras quebradas após o início do ano letivo." } })).status, 200);
  let det = (await admin.get(`/api/processos/${id}`)).dados;
  assert.deepEqual(det.campos.pac, { consta: "nao", justificativa_inclusao: "Cadeiras quebradas após o início do ano letivo." });
  assert.ok(det.checagens.some((c: any) => c.item === "pac.campos"));
  await admin.post(`/api/processos/${id}/checagens`, { item: "pc1", marcado: true });
  r = await admin.post(pac);
  assert.equal(r.dados.concluida, true);
  assert.deepEqual(r.dados.proxima, { id: "solicitacao", nome: "Solicitação" });
  // Etapa 2: a solicitação não é obrigatória para avançar.
  const sol = await admin.post(`/api/processos/${id}/etapas/solicitacao/concluir`);
  assert.deepEqual([sol.dados.concluida, sol.dados.pendencias], [true, []]);
  assert.equal((await admin.post(`/api/processos/${id}/solicitacoes`, { chave_envio: randomUUID(), secretaria: "SEDUC", descricao: "Cadeiras para a escola." })).status, 201);
  assert.equal((await admin.post(`/api/processos/${id}/etapas/solicitacao/concluir`)).dados.concluida, true);
  det = (await admin.get(`/api/processos/${id}`)).dados;
  assert.equal(det.trilha.atual.id, "dfd");
  assert.equal(det.trilha.etapas[0].estado, "concluida");

  // DFD: dados do processo, cadastro de secretários, campos, documento e conferência.
  r = await admin.post(rota);
  assert.deepEqual([...new Set(cods())], ["campo", "valor", "secretario", "minuta", "item"]);
  assert.deepEqual(r.dados.pendencias.find((x: any) => x.codigo === "valor"), { codigo: "valor", texto: "Informe o valor estimado preliminar nos dados do processo.", onde: "dados", alvo: "valor", bloqueia: true });
  const dados = { objeto: "Aquisição de 30 cadeiras escolares", tipo: "bens", via: "licitacao", ano: 2028, requisitante: "Obras", valor_estimado: 9000, pca_item_id: null };
  assert.equal((await admin.put(`/api/processos/${id}`, dados)).status, 200);
  r = await admin.post(rota);
  assert.match(r.dados.pendencias.find((x: any) => x.codigo === "portaria").texto, /Antônio Vincenzi \(Obras, Viação e Serviços Urbanos\)/);
  assert.equal((await admin.put(`/api/processos/${id}`, { ...dados, requisitante: "SEDUC" })).status, 200);

  // O responsável vem do cadastro de secretários; o objeto, do processo.
  det = (await admin.get(`/api/processos/${id}`)).dados;
  assert.match(det.sugestoes_campos.dfd.responsavel, /^Denise da Silva Lima — Secretário\(a\) Municipal de Educação \(Portaria nº 008\/2025\)$/);
  assert.equal(det.sugestoes_campos.dfd.objeto, "Aquisição de 30 cadeiras escolares");
  assert.equal((await admin.post(`/api/processos/${id}/minutas/dfd/dos-campos`)).status, 400);
  const dfd = {
    responsavel: det.sugestoes_campos.dfd.responsavel, contato: "(43) 3546-0000", objeto: "Cadeiras escolares, sem marca.",
    justificativa: "As cadeiras atuais estão quebradas, conforme laudo anexo.", quantidade: "30 unidades: uma por aluno da turma ampliada.",
    data_pretendida: "Até o início do segundo semestre.",
  };
  assert.equal((await admin.put(`/api/processos/${id}/campos/dfd`, { valores: dfd })).status, 200);
  const montado = await admin.post(`/api/processos/${id}/minutas/dfd/dos-campos`);
  assert.equal(montado.status, 200, JSON.stringify(montado.dados));
  const doc = (await admin.get(`/api/processos/${id}/minutas/dfd`)).dados.vigente;
  assert.equal(doc.origem, "campos");
  assert.ok(doc.texto.startsWith("# DOCUMENTO DE FORMALIZAÇÃO DA DEMANDA — DFD\n\n"));
  assert.ok(doc.texto.includes(`Protocolo ${protocolo} · Exercício 2028`));
  assert.match(doc.texto, /## 1\. Identificação da área requisitante\n\n\| Informação \| Dados \|[\s\S]*\| Ato de nomeação \| Portaria nº 008\/2025 \|/);
  assert.match(doc.texto, /## 3\. Justificativa da necessidade\n\nAs cadeiras atuais estão quebradas, conforme laudo anexo\./);
  assert.match(doc.texto, /## 7\. Alinhamento com o Plano Anual de Contratações\n\nA contratação não consta do Plano Anual de Contratações e é incluída de forma extraordinária\. Justificativa: Cadeiras quebradas/);
  assert.match(doc.texto, /## 9\. Declarações da área requisitante\n\na\) As informações/);
  assert.match(doc.texto, /@ Denise da Silva Lima\n@ Secretário\(a\) Municipal de Educação\n@ Portaria de nomeação nº 008\/2025$/);
  // O ETP já recebe a justificativa e as quantidades do DFD.
  det = (await admin.get(`/api/processos/${id}`)).dados;
  assert.equal(det.sugestoes_campos.etp.i, dfd.justificativa);
  assert.equal(det.sugestoes_campos.etp.iv, dfd.quantidade);
  assert.match(det.sugestoes_campos.etp.ii, /fora do PAC.*Cadeiras quebradas/);

  r = await admin.post(rota);
  assert.deepEqual([...new Set(cods())], ["item"]);
  for (const i of itensDe(ETAPAS[2], { tipo: "bens", via: "licitacao" }).filter((x) => !x.auto)) await admin.post(`/api/processos/${id}/checagens`, { item: i.id, marcado: true });
  r = await admin.post(rota);
  assert.equal(r.dados.concluida, true);
  assert.deepEqual(r.dados.proxima, { id: "etp", nome: "Estudo Técnico Preliminar" });

  // Apagar um campo obrigatório desmarca o item do sistema e a etapa volta a ficar pendente.
  assert.equal((await admin.put(`/api/processos/${id}/campos/dfd`, { valores: { ...dfd, contato: " " } })).status, 200);
  det = (await admin.get(`/api/processos/${id}`)).dados;
  assert.equal(det.trilha.atual.id, "dfd");
});

test("fiscal e protocolo: substituto diferente; protocolo exige a dotação indicada", async () => {
  const lic = await new Cliente().entrar("lic@a.gov.br");
  const adm = await new Cliente().entrar("admin@a.gov.br");
  const pb = { tipo: "servicos", via: "dispensa" } as const;
  const { dados: { id } } = await lic.post("/api/processos", { objeto: "Serviço de dedetização dos prédios públicos", ...pb, ano: 2031, requisitante: "Administração", valor_estimado: 10000 });
  const fiscal = ETAPAS.findIndex((e) => e.id === "fiscal");
  for (const e of ETAPAS.slice(0, fiscal)) {
    await preencherCampos(adm, id, e);
    for (const i of itensDe(e, pb).filter((x) => !x.auto)) await adm.post(`/api/processos/${id}/checagens`, { item: i.id, marcado: true });
  }
  assert.equal((await lic.get(`/api/processos/${id}`)).dados.trilha.atual.id, "fiscal");
  await preencherCampos(adm, id, ETAPAS[fiscal]);
  // O preenchimento genérico deixou a dotação (opcional na etapa 6) com texto: apaga para conferir o bloqueio no protocolo.
  const det = (await lic.get(`/api/processos/${id}`)).dados;
  assert.equal((await adm.put(`/api/processos/${id}/campos/dot`, { valores: { ...det.campos.dot, dotacao: "" } })).status, 200);
  let r = await adm.post(`/api/processos/${id}/etapas/fiscal/concluir`);
  let cods = r.dados.pendencias.map((x: any) => x.codigo);
  assert.ok(cods.includes("substituto") && cods.includes("minuta") && !cods.includes("dotacao"), cods.join());
  // ETP, pesquisa de preços e Termo de Referência montados com os campos, no modelo completo.
  for (const [etapa, inicio, trecho] of [
    ["etp", "# ESTUDO TÉCNICO PRELIMINAR — ETP", /## 14\. Posicionamento conclusivo \(art\. 18, § 1º, XIII\)\n\nTexto de teste/],
    ["precos", "# RELATÓRIO DE PESQUISA DE PREÇOS E MEMÓRIA DE CÁLCULO", /## 3\. Parâmetros utilizados \(art\. 23, § 1º\)\n\n- I — Painel de preços/],
    ["tr", "# TERMO DE REFERÊNCIA", /## 1\. Definição do objeto \(art\. 6º, XXIII, alínea "a"\)[\s\S]*## 11\. Análise de riscos \(art\. 18, X\)[\s\S]*Aprovo o presente Termo de Referência\./],
  ] as const) {
    assert.equal((await adm.post(`/api/processos/${id}/minutas/${etapa}/dos-campos`)).status, 200, etapa);
    const doc = (await adm.get(`/api/processos/${id}/minutas/${etapa}`)).dados.vigente.texto as string;
    assert.ok(doc.startsWith(inicio), doc.slice(0, 80));
    assert.match(doc, trecho);
  }
  assert.match((await adm.post(`/api/processos/${id}/minutas/fiscal/dos-campos`)).status === 200 ? (await adm.get(`/api/processos/${id}/minutas/fiscal`)).dados.vigente.texto : "", /^# INDICAÇÃO DO FISCAL DO CONTRATO\n/);
  assert.equal((await adm.put(`/api/processos/${id}/campos/fiscal`, { valores: { ...(await lic.get(`/api/processos/${id}`)).dados.campos.fiscal, substituto_nome: "Outra pessoa" } })).status, 200);
  for (const i of itensDe(ETAPAS[fiscal], pb).filter((x) => !x.auto)) await adm.post(`/api/processos/${id}/checagens`, { item: i.id, marcado: true });
  r = await adm.post(`/api/processos/${id}/etapas/fiscal/concluir`);
  assert.deepEqual([r.dados.concluida, r.dados.protocolado, r.dados.proxima], [true, false, { id: "protocolo", nome: "Protocolo" }]);

  // Etapa 8: sem dotação indicada e sem Solicitação, não protocola.
  await preencherCampos(adm, id, ETAPAS[fiscal + 1]);
  r = await adm.post(`/api/processos/${id}/etapas/protocolo/concluir`);
  cods = r.dados.pendencias.map((x: any) => x.codigo);
  assert.equal(r.dados.concluida, false);
  assert.ok(cods.includes("dotacao") && !cods.includes("solicitacao") && cods.includes("minuta"), cods.join());
  assert.equal((await adm.post(`/api/processos/${id}/minutas/protocolo/dos-campos`)).status, 200);
  const texto = (await adm.get(`/api/processos/${id}/minutas/protocolo`)).dados.vigente.texto as string;
  assert.match(texto, /^# ENCAMINHAMENTO AO DEPARTAMENTO DE LICITAÇÕES E CONTRATOS/);
  assert.match(texto, /## \d+\. Encaminhamento\n\nEncaminha-se o processo.*solicitação das secretarias, DFD/);
  assert.equal((await adm.put(`/api/processos/${id}/campos/dot`, { valores: { ...det.campos.dot, dotacao: "02.001 3.3.90.39" } })).status, 200);
  for (const i of itensDe(ETAPAS[fiscal + 1], pb).filter((x) => !x.auto)) await adm.post(`/api/processos/${id}/checagens`, { item: i.id, marcado: true });
  r = await adm.post(`/api/processos/${id}/etapas/protocolo/concluir`);
  assert.equal(r.dados.concluida, true, JSON.stringify(r.dados.pendencias));
  assert.equal(r.dados.protocolado, true);
  assert.equal(r.dados.proxima.id, "edital");
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

  const urlPdf = `${caminho}/minutas/${primeira.dados.id}?formato=pdf`;
  const parecerPdf = await lic.get(urlPdf);
  assert.equal(parecerPdf.status, 200);
  assert.equal(parecerPdf.tipo, "application/pdf");
  assert.equal((await PDFDocument.load(parecerPdf.dados)).getPageCount(), 1);
  assert.equal((await outro.get(urlPdf)).status, 404);

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
  assert.match(s.descricao, /## 2\. Objeto\nMobiliário escolar\n/);
  assert.match(s.descricao, /## 3\. Justificativa da necessidade\nAs cadeiras atuais estão quebradas\.\n/);
  assert.match(s.descricao, /## 4\. Itens solicitados\n\| Item \| Descrição \| Un\. \| Qtd\. \| Valor unitário \| Valor total \|\n\|:---:\|---\|:---:\|---:\|---:\|---:\|\n/);
  assert.match(s.descricao, /\| 1 \| Cadeira escolar \/ empilhável \| un \| 30 \| R\$\s300,00 \| R\$\s9\.000,00 \|/);
  assert.match(s.descricao, /\| 2 \| Mesa escolar individual \| un \| 30 \| R\$\s250,50 \| R\$\s7\.515,00 \|/);
  assert.match(s.descricao, /\| 3 \| Armário de aço \| — \| — \| — \| — \|/);
  assert.match(s.descricao, /\| \| \*\*Total estimado\*\* \| \| \| \| \*\*R\$\s16\.515,00\*\* \|/);
  assert.match(s.descricao, /@ Denise da Silva Lima/);
  assert.equal(s.descricao.match(/Itens solicitados/g).length, 1);

  // Sem objeto próprio vale o do processo; sem itens o campo do modelo continua pendente.
  const r2 = await admin.post(rota, corpo({ secretaria: "Finanças" }));
  const s2 = (await admin.get(`/api/processos/${id}`)).dados.solicitacoes.find((x: any) => x.id === r2.dados.id);
  assert.match(s2.descricao, /## 2\. Objeto\nAquisição de mobiliário para as escolas municipais\n/);
  assert.ok(s2.descricao.includes("[[Itens]]") && s2.descricao.includes("[[Justificativa da contratação]]"));
  assert.deepEqual(s2.itens, []);

  // Texto livre, sem o campo [[Itens]]: o quadro entra antes da assinatura, uma única vez.
  const r3 = await admin.post(rota, corpo({ secretaria: "Governo", descricao: "# PEDIDO\nPrecisamos dos itens abaixo.\n\n@ Fulana", itens: itens.slice(0, 1) }));
  const s3 = (await admin.get(`/api/processos/${id}`)).dados.solicitacoes.find((x: any) => x.id === r3.dados.id);
  assert.match(s3.descricao, /^# PEDIDO\nPrecisamos dos itens abaixo\.\n\n## Itens solicitados\n\| Item [\s\S]*R\$\s9\.000,00\*\* \|\n\n@ Fulana$/);
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
  assert.match(anterior.descricao, /Subtotal dos itens com valor\*{0,2} .*R\$\s430,00/);
  assert.equal((await lic.req("DELETE", `${processo}/orcamentos/${a}`)).status, 409);

  const completos = [itens[0], itens[1], { ...itens[2], cotacoes: [cotacao(b, "Fornecedor B", 25)] }];
  const alteracao = { anterior: anterior.descricao, descricao: anterior.descricao, itens_anteriores: anterior.itens, itens: completos };
  const alterada = await lic.put(`${caminho}/${criada.dados.id}`, alteracao);
  assert.equal(alterada.status, 200, JSON.stringify(alterada.dados));
  const final = (await lic.get(processo)).dados.solicitacoes[0];
  assert.match(final.descricao, /Total estimado\*{0,2} .*R\$\s455,00/);
  assert.equal(final.descricao.match(/\| Item \| Descrição/g)?.length, 1);
  assert.match(final.descricao, /Cotação 1[\s\S]*Fornecedor A[\s\S]*Cotação 2[\s\S]*Fornecedor B/);
  assert.equal((await lic.put(`${caminho}/${criada.dados.id}`, alteracao)).status, 409);
  const criterio = await lic.put(`${caminho}/${criada.dados.id}`, {
    anterior: final.descricao, descricao: final.descricao, itens_anteriores: final.itens,
    itens: [{ ...completos[0], criterio: "menor" }, ...completos.slice(1)],
  });
  assert.equal(criterio.status, 200, JSON.stringify(criterio.dados));
  assert.match((await lic.get(processo)).dados.solicitacoes[0].descricao, /Total estimado\*{0,2} .*R\$\s425,00/);
  // A edição só do texto reaproveita o orçamento persistido mesmo sem o marcador [[Itens]].
  const existente = (await lic.get(processo)).dados.solicitacoes[0];
  const textoManual = "# SOLICITAÇÃO REVISADA\nTexto alterado manualmente.\n\n@ Titular";
  const manual = await lic.put(`${caminho}/${criada.dados.id}`, { anterior: existente.descricao, descricao: textoManual });
  assert.equal(manual.status, 200, JSON.stringify(manual.dados));
  const mesclada = (await lic.get(processo)).dados.solicitacoes[0];
  assert.deepEqual(mesclada.itens, existente.itens);
  assert.match(mesclada.descricao, /Texto alterado manualmente/);
  assert.match(mesclada.descricao, /Cotação 1[\s\S]*Fornecedor A[\s\S]*Cotação 2[\s\S]*Fornecedor B/);
  assert.equal(mesclada.descricao.match(/\| Item \| Descrição/g)?.length, 1);
  assert.match(mesclada.descricao, /Total estimado\*{0,2} .*R\$\s425,00/);
  const wordManual = await lic.get(`${caminho}/${criada.dados.id}/docx`);
  assert.equal(wordManual.status, 200);
  const wordTexto = await extrairTexto("solicitacao.docx", wordManual.dados);
  assert.match(wordTexto, /Texto alterado manualmente/);
  assert.match(wordTexto, /Fornecedor A[\s\S]*Fornecedor B/);
  assert.equal(wordTexto.match(/\| Item \| Descrição/g)?.length, 1);

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

test("preços lançados entram na estimativa mesmo sem orçamento anexado; o anexo é opcional", async () => {
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
  assert.equal(antes.itens[0].valor_unitario, 15.25);
  const rota = `${caminho}/${salva.dados.id}`;
  const previa = documentoDaSolicitacao("# SOLICITAÇÃO\nRelação: [[Itens]]", antes.itens);
  assert.match(previa, /^# SOLICITAÇÃO\nRelação:\n\n\| Item \| Descrição .*Cotação 1\u2028Papelaria A \| Cotação 2\u2028Papelaria B \| Média \|/);
  assert.match(previa, /Resma de papel .*R\$\s12,50 \| R\$\s18,00 \| R\$\s15,25 \| R\$\s61,00 \|/);
  assert.doesNotMatch(previa, /\[\[Itens\]\]|Orçamentos por item|\*\) Cotação sem orçamento/);
  assert.equal(documentoDaSolicitacao(previa, antes.itens), previa);

  const wordAntes = await lic.get(`${rota}/docx`);
  assert.equal(wordAntes.status, 200);
  const textoAntes = await extrairTexto("solicitacao.docx", wordAntes.dados);
  assert.match(textoAntes, /Cotação 1\s*Papelaria A \| Cotação 2\s*Papelaria B \| Média/);
  assert.match(textoAntes, /Resma de papel .*R\$\s12,50 \| R\$\s18,00 \| R\$\s15,25/);
  assert.doesNotMatch(textoAntes, /Orçamentos por item/);

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
  assert.equal(depois.itens[0].valor_unitario, 15.25);
  assert.equal(depois.itens[0].cotacoes[1].valor_unitario, 18);
  assert.match(depois.descricao, /Total estimado\*{0,2} .*R\$\s61,00/);
  // Uma solicitação antiga com texto anterior ao quadro também mostra o orçamento salvo.
  await pool.query("update solicitacoes_processo set descricao=$1 where id=$2", ["# SOLICITAÇÃO\nCotação no anexo.\n\n@ Titular", salva.dados.id]);
  const wordDepois = await lic.get(`${rota}/docx`);
  assert.equal(wordDepois.status, 200);
  const textoDepois = await extrairTexto("solicitacao.docx", wordDepois.dados);
  assert.match(textoDepois, /Resma de papel .*R\$\s12,50 \| R\$\s18,00 \| R\$\s15,25 \| R\$\s61,00 \|/);
  assert.match(textoDepois, /## Itens solicitados|Itens solicitados/);
  assert.match(textoDepois, /Total estimado\*{0,2} .*R\$\s61,00[\s\S]+Titular/);
  assert.doesNotMatch(textoDepois, /Orçamentos por item/);
  const pdf = await lic.get(`${rota}/pdf`);
  assert.equal(pdf.status, 200);
  assert.equal(pdf.tipo, "application/pdf");
  assert.equal((await PDFDocument.load(pdf.dados)).getPageCount(), 1);

});

test("as cotações ficam lado a lado no quadro e os fornecedores comuns aparecem uma vez", () => {
  const cotacao = (fornecedor: string, valor: number) => ({ fornecedor, valor_unitario: valor, orcamento_id: valor });
  const a = cotacao("Loja Alfa", 10);
  const b = cotacao("Loja Beta", 20);
  const item = { descricao: "Material escolar", unidade: "un", quantidade: 1, valor_unitario: 15, cotacoes: [a, b] };
  const texto = "# PEDIDO\n## Itens solicitados\n[[Itens]]";
  const comum = documentoDaSolicitacao(texto, [item, {
    ...item, descricao: "Resma", cotacoes: [cotacao("Loja Beta", 21), cotacao("LOJA ALFA", 11)],
  }, { ...item, descricao: "Caneta", cotacoes: [cotacao("Loja Beta", 22)] }]);
  const linhas = comum.split("\n");
  assert.match(linhas[2], /Qtd\. \| Cotação 1\u2028Loja Alfa \| Cotação 2\u2028Loja Beta \| Média \| Valor total \|$/);
  assert.match(linhas[4], /\| R\$\s10,00 \| R\$\s20,00 \| R\$\s15,00 \| R\$\s15,00 \|$/);
  assert.match(linhas[5], /\| R\$\s11,00 \| R\$\s21,00 \| R\$\s15,00 \| R\$\s15,00 \|$/);
  assert.match(linhas[6], /\| — \| R\$\s22,00 \| R\$\s15,00 \| R\$\s15,00 \|$/);
  assert.match(documentoDaSolicitacao(texto, [{ ...item, criterio: "mediana" }]), /\| Mediana \| Valor total \|\n/);
  assert.match(documentoDaSolicitacao(texto, [item, { ...item, criterio: "menor" }]), /\| Valor unitário estimado \| Valor total \|\n/);
  assert.equal(comum.match(/Loja Alfa/gi)?.length, 1);
  assert.equal(documentoDaSolicitacao(comum, [item]).match(/\| Item \|/g)?.length, 1);
  const muitos = documentoDaSolicitacao(texto, [{ ...item, cotacoes: [
    a, b, cotacao("Loja Gama", 30), cotacao("Loja Delta", 40), cotacao("Loja Épsilon", 50),
  ] }]);
  assert.match(muitos, /\| Cotação 1\u2028Loja Alfa \| Cotação 2\u2028Loja Beta \| Cotação 3\u2028Loja Gama \| Cotação 4\u2028Loja Delta \| Cotação 5\u2028Loja Épsilon \| Média/);
  assert.equal(quantidadeColunasCotacoes(muitos), 5);
  assert.match(muitos, /\| 1 \| Material escolar .*R\$\s40,00 \| R\$\s50,00 \|/);
  assert.equal(muitos.match(/Material escolar/g)?.length, 1);
  assert.equal(muitos.match(/Loja Alfa/g)?.length, 1);
  assert.equal(muitos.match(/Total estimado/g)?.length, 1);
  assert.match(muitos, /\n\| \| \*\*Total estimado da solicitação\*\* \|( \|)+ \*\*R\$\s15,00\*\* \|\n\nPreço de referência: média das cotações\.$/);
  assert.equal(documentoDaSolicitacao(muitos, [{ ...item, cotacoes: [a, b, cotacao("Loja Gama", 30), cotacao("Loja Delta", 40), cotacao("Loja Épsilon", 50)] }]), muitos);
  const distintos = documentoDaSolicitacao(texto, ["Alfa", "Beta", "Gama", "Delta"].map((nome, k) => ({
    ...item, descricao: `Item de ${k + 1}`, cotacoes: [cotacao(nome, (k + 1) * 10)],
  })));
  assert.match(distintos, /\| 4 \| Item de 4 \| un \| 1 .*\| — \| — \| — \| R\$\s40,00 \|/);
  assert.equal(distintos.match(/Delta/g)?.length, 1);
});

test("o documento reúne quadros repetidos dos mesmos itens e preserva as outras tabelas", () => {
  const item = { descricao: "Limpeza de ar condicionado", unidade: "SERV", quantidade: 60, valor_unitario: 350,
    cotacoes: [{ fornecedor: "HS Serviços LTDA", valor_unitario: 350, orcamento_id: 1 }] };
  const texto = [
    "# Solicitação", "## Itens solicitados",
    "| Nº | Especificação do serviço | Quantidade |",
    "|---|---|---|", "| 1 | Limpeza de ar condicionado | 60 |",
    "", "## Itens solicitados",
    "| Item | Descrição | Un. | Qtd. | Valor unitário estimado | Valor total |",
    "|---|---|---|---|---|---|", "| 1 | Limpeza de ar condicionado | SERV | 60 | R$ 350,00 | R$ 21.000,00 |",
    "", "## Itens solicitados",
    "| Descrição | Quantidade | Cotação 1 |", "|---|---|---|", "| Limpeza de ar condicionado | 60 | R$ 350,00 |",
    "", "## Itens solicitados", "[[Itens]]", "## Cronograma", "| Etapa | Prazo |", "|---|---|", "| Execução | 30 dias |",
  ].join("\n");
  const documento = documentoDaSolicitacao(texto, [item]);
  assert.equal(documento.match(/Limpeza de ar condicionado/g)?.length, 1);
  assert.equal(documento.match(/## Itens solicitados/g)?.length, 1);
  assert.match(documento, /Cotação 1\u2028HS Serviços LTDA \| Média \| Valor total \|\n[^\n]+\n\| 1 \| Limpeza de ar condicionado/);
  assert.doesNotMatch(documento, /\[\[Itens\]\]/);
  const paraEditar = inserirItens(texto, [item], "marcador");
  assert.equal(paraEditar.match(/\[\[Itens\]\]/g)?.length, 1);
  assert.doesNotMatch(paraEditar, /Limpeza de ar condicionado/);
  assert.match(paraEditar, /\| Execução \| 30 dias \|/);
  const marcadores = documentoDaSolicitacao("# Pedido\n[[Itens]]\n\n[[Itens]]", [item]);
  assert.equal(marcadores.match(/Limpeza de ar condicionado/g)?.length, 1);
  assert.doesNotMatch(marcadores, /\[\[Itens\]\]/);
  assert.match(documento, /## Cronograma\n\| Etapa \| Prazo \|/);
  assert.equal(documentoDaSolicitacao(documento, [item]), documento);
});

test("o orçamento recupera o fornecedor do documento e permite identificá-lo manualmente", async () => {
  const { nomeFornecedorOrcamento } = await import("../../shared/orcamentos.js");
  const lic = await new Cliente().entrar("lic@a.gov.br");
  const outro = await new Cliente().entrar("admin@b.gov.br");
  const novo = await lic.post("/api/processos", { objeto: "Aquisição de papel", tipo: "bens", via: "licitacao", ano: 2097 });
  const processo = `/api/processos/${novo.dados.id}`;
  const enviar = async (nome: string, texto: string) => {
    const form = new FormData();
    form.append("arquivo", new Blob([texto]), nome);
    const r = await lic.post(`${processo}/orcamentos?origem=solicitacao`, form);
    assert.equal(r.status, 201, JSON.stringify(r.dados));
    return r.dados;
  };
  const identificado = await enviar("proposta-01.txt", "Comprador: Município de Teste\nFornecedor: Papelaria Boa - CNPJ: 123");
  assert.equal(identificado.orcamentos[0].fornecedor, "Papelaria Boa");
  const avulso = await enviar("proposta-02.txt", "Cliente: Município de Teste\nTotal: R$ 25,00");
  assert.equal(avulso.orcamentos[0].fornecedor, "");
  const rota = `${processo}/orcamentos/${avulso.ids[0]}`;
  assert.equal((await outro.put(rota, { fornecedor: "Outro órgão" })).status, 404);
  assert.equal((await lic.put(rota, { fornecedor: "Papelaria Nova" })).dados.fornecedor, "Papelaria Nova");
  assert.equal((await lic.put(rota, { valor: 25 })).dados.fornecedor, "Papelaria Nova");
  const dados = (await lic.get(processo)).dados.orcamentos;
  assert.deepEqual(dados.map(nomeFornecedorOrcamento), ["Papelaria Boa", "Papelaria Nova"]);

  const cotado = await enviar("proposta-03.txt", "Total: R$ 15,00");
  const s = await lic.post(`${processo}/solicitacoes`, { chave_envio: randomUUID(), secretaria: "Educação", descricao: "# PEDIDO",
    itens: [{ descricao: "Papel", quantidade: 1, cotacoes: [{ orcamento_id: cotado.ids[0], fornecedor: "Papelaria Escolar", valor_unitario: 15 }] }],
  });
  assert.equal(s.status, 201, JSON.stringify(s.dados));
  const r = (await lic.get(processo)).dados.orcamentos.find((o: { id: number }) => o.id === cotado.ids[0]);
  assert.equal(nomeFornecedorOrcamento(r), "Papelaria Escolar");
});

test("documentos de apoio ficam na solicitação e podem ser acrescentados após salvar", async () => {
  const lic = await new Cliente().entrar("lic@a.gov.br");
  const outro = await new Cliente().entrar("admin@b.gov.br");
  const novo = await lic.post("/api/processos", { objeto: "Aquisição de luminárias", tipo: "bens", via: "licitacao", ano: 2098 });
  assert.equal(novo.status, 201);
  const processo = `/api/processos/${novo.dados.id}`;
  const dados = new FormData();
  dados.set("chave_envio", randomUUID());
  dados.set("secretaria", "Obras");
  dados.set("descricao", "Pedido de iluminação");
  dados.append("apoios", new Blob(["10 luminárias"]), "levantamento.txt");
  dados.append("apoios", new Blob(["Prazo de 30 dias"]), "prazo.txt");
  const criada = await lic.post(`${processo}/solicitacoes`, dados);
  assert.equal(criada.status, 201, JSON.stringify(criada.dados));
  assert.equal((await lic.post(`${processo}/solicitacoes`, dados)).status, 200);
  const detalhe = (await lic.get(processo)).dados.solicitacoes[0];
  assert.deepEqual(detalhe.apoios.map((a: { nome: string }) => a.nome), ["levantamento.txt", "prazo.txt"]);
  const link = `${processo}/solicitacoes/${detalhe.id}/apoios/${detalhe.apoios[0].id}`;
  assert.equal((await lic.get(link)).dados.toString(), "10 luminárias");
  assert.equal((await outro.get(link)).status, 404);
  const complemento = new FormData();
  complemento.set("anterior", detalhe.descricao);
  complemento.set("descricao", detalhe.descricao);
  complemento.set("itens", "[]");
  complemento.set("itens_anteriores", "[]");
  complemento.append("apoios", new Blob(["Prazo de 30 dias"]), "copia-prazo.txt");
  complemento.append("apoios", new Blob(["Rua do posto"]), "local.txt");
  const atualizada = await lic.put(`${processo}/solicitacoes/${detalhe.id}`, complemento);
  assert.equal(atualizada.status, 200, JSON.stringify(atualizada.dados));
  assert.deepEqual((await lic.get(processo)).dados.solicitacoes[0].apoios.map((a: { nome: string }) => a.nome), ["levantamento.txt", "prazo.txt", "local.txt"]);
});

test("exclusão retira o processo das consultas e conserva o protocolo e a auditoria", async () => {
  const lic = await new Cliente().entrar("lic@a.gov.br");
  const req = await new Cliente().entrar("req@a.gov.br");
  const outro = await new Cliente().entrar("admin@b.gov.br");
  const dados = { objeto: "Aquisição de tintas", tipo: "bens", via: "licitacao", ano: 2099 };
  const r = await lic.post("/api/processos", dados);
  assert.equal(r.status, 201);
  const caminho = `/api/processos/${r.dados.id}`;
  assert.equal((await req.put(caminho, { ...dados, objeto: "Compra de tintas para a escola" })).status, 200);
  assert.equal((await req.req("DELETE", caminho)).status, 403);
  assert.equal((await outro.req("DELETE", caminho)).status, 404);
  assert.equal((await lic.req("DELETE", caminho)).status, 200);
  assert.equal((await lic.get(caminho)).status, 404);
  assert.equal((await lic.req("DELETE", caminho)).status, 404);
  assert.deepEqual((await lic.get("/api/processos?ano=2099")).dados, []);
  const salvo = await q1("select protocolo,excluido_em from processos where id=$1", [r.dados.id]);
  assert.equal(salvo?.protocolo, r.dados.protocolo);
  assert.ok(salvo?.excluido_em);
  assert.ok(await q1("select id from auditoria where processo_id=$1 and acao='processo.excluido'", [r.dados.id]));
  const posterior = await lic.post("/api/processos", dados);
  assert.notEqual(posterior.dados.protocolo, r.dados.protocolo);
});

test("trilha: fase interna (PAC, Solicitação, documentos e protocolo) antes da fase externa", async () => {
  const lic = await new Cliente().entrar("lic@a.gov.br");
  const painel = async () => (await lic.get("/api/painel")).dados.processos.por_etapa as { id: string; numero: number; etapa: string; total: number }[];
  const antes = await painel();
  assert.deepEqual(antes.map(({ id, numero }) => [id, numero]), [["pac", 1], ["solicitacao", 2], ["dfd", 3], ["etp", 4], ["precos", 5], ["tr", 6], ["dot", 7], ["fiscal", 8], ["protocolo", 9], ["edital", 10], ["parecer", 11], ["pub", 12]]);
  assert.deepEqual(ETAPAS.map((e) => e.fase), ["interna", "interna", "interna", "interna", "interna", "interna", "interna", "interna", "interna", "externa", "externa", "externa"]);
  const r = await lic.post("/api/processos", { objeto: "Compra de materiais para a educação", tipo: "bens", via: "licitacao", ano: 2099 });
  assert.equal(r.status, 201);
  const caminho = `/api/processos/${r.dados.id}`;
  const lista = async () => (await lic.get("/api/processos?ano=2099")).dados.find((p: { id: number }) => p.id === r.dados.id);
  assert.equal((await lista()).trilha.atual.id, "pac");
  const inicio = (await lic.get(caminho)).dados;
  assert.equal(inicio.trilha.atual.id, "pac");
  assert.equal(inicio.trilha.etapas[1].estado, "bloqueada");
  assert.equal((await painel())[0].total, antes[0].total + 1);

  const pedido = await lic.post(`${caminho}/solicitacoes`, {
    chave_envio: randomUUID(), secretaria: "Educação", descricao: "Reposição de material de ensino.",
  });
  assert.equal(pedido.status, 201);
  const seguir = (await lic.get(caminho)).dados;
  assert.equal(seguir.trilha.atual.id, "pac");
  assert.equal(seguir.etapa_atual, 0);
});

test("conciliação: a mesma linha escrita de outro jeito pelo fornecedor cai no item certo, sem duplicar", () => {
  const nossos = [
    ["Limpeza de ar condicionado - higienização com desmonte e lavagem completo - 36.000 btus a 60.000 btus", "SERV", "60"],
    ["Limpeza de ar condicionado - higienização com desmonte e lavagem completo - 24.000 btus e 30.000 btus", "SERV", "350"],
    ["Instalação de ar condicionado completo - 36.000 btus a 60.000 btus", "SERV", "20"],
    ["Desinstalação (remoção) de ar condicionado piso teto 30.000 btus e 60.000 btus", "SERV", "10"],
    ["Desinstalação (remoção) de ar condicionado piso teto 36.000 btus e 60.000 btus", "SERV", "40"],
    ["Tubo de cobre para ar condicionado (obs.: bitola 3/8)", "M", "1.250"],
    ["Material para isolamento térmico (obs.: bitola 3/8)", "M", "1.250"],
  ].map(([descricao, unidade, quantidade]) => ({ descricao, unidade, quantidade }));
  const proposta = [
    ["MATERIAL PARA ISOLAMENTO TÉRMICO (cód. 42366)", "M", 1250],
    ["DESINSTALAÇÃO DE AR CONDICIONADO — Remoção tipo piso teto 36.000 e 60.000 BTUs (cód. 42364)", "SERV", 40],
    ["LIMPEZA DE AR CONDICIONADO — Higienização com desmonte e lavagem completa — 24.000 e 30.000 BTUs (cód. 42361)", "SERV", 350],
    ["INSTALAÇÃO DE AR CONDICIONADO — Instalação completa — 36.000 a 60.000 BTUs (cód. 42362)", "SERV", 20],
    ["LIMPEZA DE AR CONDICIONADO — Higienização com desmonte e lavagem completa — 36.000 a 60.000 BTUs (cód. 42361)", "SERV", 60],
    ["DESINSTALAÇÃO DE AR CONDICIONADO — Remoção tipo piso teto 30.000 e 60.000 BTUs (cód. 42364)", "SERV", 10],
    ["TUBO DE COBRE para ar-condicionado (cód. 42365) — observação do fornecedor: \"BITOLA\", sem indicar qual", "M", 1250],
    ["Caixa de som amplificada", "UN", 2],
  ].map(([descricao, unidade, quantidade]) => ({ descricao: String(descricao), unidade: String(unidade), quantidade: Number(quantidade), valor_unitario: 1, valor_total: 1 }));
  assert.deepEqual(destinosDoOrcamento(nossos, proposta).map((d) => d.indice), [6, 4, 1, 2, 0, 3, 5, null]);

  // Itens já duplicados na solicitação: cada repetido junta-se ao original de outro fornecedor.
  const lista = [
    ...nossos.map((i) => ({ ...i, fornecedores: ["HS Serviços LTDA"] })),
    ...proposta.slice(0, 7).map((i) => ({ ...i, fornecedores: ["FH CONSTRUÇÕES CIVIS LTDA"] })),
  ];
  assert.deepEqual(itensRepetidos(lista).map((r) => [r.item, r.juntarEm]), [[7, 6], [8, 4], [9, 1], [10, 2], [11, 0], [12, 3], [13, 5]]);
  // Do mesmo fornecedor, ou com unidade diferente, não junta.
  assert.deepEqual(itensRepetidos([{ ...lista[0] }, { ...lista[11], fornecedores: ["HS Serviços LTDA"] }]), []);
  assert.deepEqual(itensRepetidos([{ ...lista[0] }, { ...lista[11], unidade: "UN" }]), []);
});

test("editar solicitação pelo formulário com arquivos (quebras de linha \\r\\n) não acusa alteração de outra pessoa", async () => {
  const lic = await new Cliente().entrar("lic@a.gov.br");
  const { dados: { id } } = await lic.post("/api/processos", { objeto: "Aquisição de material de limpeza", tipo: "bens", via: "licitacao", ano: 2026 });
  const caminho = `/api/processos/${id}/solicitacoes`;
  const itens = [{ descricao: "Detergente", unidade: "un", quantidade: 10, cotacoes: [{ orcamento_id: null, fornecedor: "Loja A", valor_unitario: 3 }] }];
  const criada = await lic.post(caminho, { chave_envio: randomUUID(), secretaria: "Educação", descricao: "# PEDIDO\nLinha 1\nLinha 2\n[[Itens]]", itens });
  assert.equal(criada.status, 201, JSON.stringify(criada.dados));
  const s = (await lic.get(`/api/processos/${id}`)).dados.solicitacoes[0];
  const enviar = (texto: string, novos: unknown) => {
    const fd = new FormData();
    fd.set("anterior", s.descricao.replace(/\n/g, "\r\n"));
    fd.set("descricao", texto.replace(/\n/g, "\r\n"));
    fd.set("itens_anteriores", JSON.stringify(s.itens));
    fd.set("itens", JSON.stringify(novos));
    return lic.req("PUT", `${caminho}/${s.id}`, fd);
  };
  const r = await enviar("# PEDIDO\nLinha 1\nLinha 2 revisada\n[[Itens]]", [{ ...itens[0], cotacoes: [...itens[0].cotacoes, { orcamento_id: null, fornecedor: "Loja B", valor_unitario: 4 }] }]);
  assert.equal(r.status, 200, JSON.stringify(r.dados));
  const depois = (await lic.get(`/api/processos/${id}`)).dados.solicitacoes[0];
  assert.ok(!depois.descricao.includes("\r"));
  assert.match(depois.descricao, /Linha 2 revisada/);
  assert.equal(depois.itens[0].cotacoes.length, 2);
});

test("leitura sem IA: PDF em colunas, planilha e Word; texto solto não vira item", async () => {
  const pdf = [
    "                    CLIMATIZA SERVIÇOS ME   CNPJ 11.222.333/0001-44",
    " Item   Descrição                                              Unid.   Qtd.     Valor Unit.     Valor Total",
    " 1      Limpeza de ar condicionado 36.000 a 60.000 BTUs        SERV    60       R$ 230,00       R$ 13.800,00",
    "        com desmonte e lavagem completa",
    " 2      Instalação de ar condicionado 9.000 BTUs               SERV    220      R$ 632,50       R$ 139.150,00",
    " 3      Tubo de cobre 3/8                                      M       1.250    R$ 10,93        R$ 13.662,50",
    " 4      Item com conta errada                                  UN      2        R$ 10,00        R$ 99,00",
    "                                                                         VALOR TOTAL:   R$ 166.612,50",
  ].join("\n");
  const lido = lerOrcamentoSemIA(pdf)!;
  assert.deepEqual(lido.itens.map((i) => [i.descricao, i.unidade, i.quantidade, i.valor_unitario, i.valor_total]), [
    ["Limpeza de ar condicionado 36.000 a 60.000 BTUs com desmonte e lavagem completa", "SERV", 60, 230, 13800],
    ["Instalação de ar condicionado 9.000 BTUs", "SERV", 220, 632.5, 139150],
    ["Tubo de cobre 3/8", "M", 1250, 10.93, 13662.5],
  ]);
  assert.equal(lido.cnpj, "11.222.333/0001-44");
  assert.equal(lido.valor_total, 166612.5);
  const planilha = "Planilha Plan1\n| Item | Descrição do serviço | Unidade | Quantidade | Valor unitário | Valor total |\n| 1 | Limpeza | SERV | 60 | 230 | 13800 |\n| | Total | | | | 13800 |";
  assert.deepEqual(lerOrcamentoSemIA(planilha)!.itens.map((i) => [i.descricao, i.valor_unitario]), [["Limpeza", 230]]);
  const word = "PROPOSTA\n| Especificação | Und | Qtde | Preço unitário | Preço total |\n| Resma de papel A4 | cx | 10 | R$ 25,90 | R$ 259,00 |";
  assert.deepEqual(lerOrcamentoSemIA(word)!.itens.map((i) => [i.descricao, i.unidade, i.quantidade, i.valor_unitario]), [["Resma de papel A4", "cx", 10, 25.9]]);
  assert.equal(lerOrcamentoSemIA("Prezados, segue nossa proposta. Valor total R$ 1.000,00."), null);

  // Sem a IA configurada (este conjunto de testes roda sem chave), a leitura do orçamento usa a leitura sem IA.
  const req = await new Cliente().entrar("req@a.gov.br");
  const { dados: { id } } = await req.post("/api/processos", { objeto: "Aquisição de papel", tipo: "bens", via: "dispensa", ano: 2026 });
  const fd = new FormData();
  fd.append("arquivo", new Blob(["Descrição;Un;Qtde;Preço unitário;Total\nResma de papel;cx;10;25,90;259,00"]), "proposta.csv");
  const env = await req.req("POST", `/api/processos/${id}/orcamentos`, fd);
  assert.equal(env.status, 201, JSON.stringify(env.dados));
  const r = await req.post(`/api/processos/${id}/orcamentos/${env.dados.ids[0]}/ler`);
  assert.equal(r.status, 200, JSON.stringify(r.dados));
  assert.equal(r.dados.sem_ia, true);
  assert.equal(r.dados.dados.itens[0].valor_unitario, 25.9);
  const foto = new FormData();
  foto.append("arquivo", new Blob([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1])]), "foto.png");
  const f = await req.req("POST", `/api/processos/${id}/orcamentos`, foto);
  const rf = await req.post(`/api/processos/${id}/orcamentos/${f.dados.ids[0]}/ler`);
  assert.equal(rf.status, 422);
  assert.match(rf.dados.erro, /foto e PDF digitalizado não são lidos/);
});

test("etapa 1: escolher o item na busca do PAC vincula o processo e preenche os campos", async () => {
  const admin = await new Cliente().entrar("admin@ibaiti.gov.br");
  const outro = await new Cliente().entrar("admin@b.gov.br");
  const pac = (await admin.get("/api/pca?ano=2027")).dados.itens;
  const merenda = pac.find((i: { ordem_oficial: number }) => i.ordem_oficial === 38);
  const { dados: { id } } = await admin.post("/api/processos", { objeto: "Gêneros alimentícios para a merenda escolar", tipo: "bens", via: "licitacao", ano: 2026, pca_item_id: null });
  const rota = `/api/processos/${id}/pac`;
  assert.equal((await outro.post(rota, { pca_item_id: merenda.id })).status, 404);
  // Item do PAC do exercício seguinte é aceito (o PAC 2027 começa em 2026).
  assert.equal((await admin.post(rota, { pca_item_id: merenda.id })).status, 200);
  let det = (await admin.get(`/api/processos/${id}`)).dados;
  assert.equal(det.pca_item_id, merenda.id);
  assert.equal(det.pca_item.ano, 2027);
  assert.deepEqual(det.campos.pac, { consta: "sim", item_pac: "PAC 2027, item 38 — Alimentação escolar / gêneros alimentícios", mes_planejado: "Outubro/2026" });
  // Respondida a última pergunta, o sistema marca a etapa como preenchida.
  assert.equal((await admin.put(`/api/processos/${id}/campos/pac`, { valores: { ...det.campos.pac, no_prazo: "sim" } })).status, 200);
  det = (await admin.get(`/api/processos/${id}`)).dados;
  assert.ok(det.checagens.some((c: { item: string }) => c.item === "pac.campos"));
  assert.equal((await admin.post(rota, { pca_item_id: null })).status, 200);
  det = (await admin.get(`/api/processos/${id}`)).dados;
  assert.equal(det.pca_item_id, null);
  assert.equal(det.campos.pac.item_pac, "");
  assert.ok(!det.checagens.some((c: { item: string }) => c.item === "pac.campos"));
  // Item de dois exercícios adiante não vale.
  const outroAno = await admin.post("/api/processos", { objeto: "Teste de exercício", tipo: "bens", via: "licitacao", ano: 2025, pca_item_id: null });
  assert.equal((await admin.post(`/api/processos/${outroAno.dados.id}/pac`, { pca_item_id: merenda.id })).status, 400);
});

test("pronto pagamento: pedido, limite do art. 95, § 2º, autorização, recebimento, pagamento e documento", async () => {
  const req = await new Cliente().entrar("req@a.gov.br");
  const lic = await new Cliente().entrar("lic@a.gov.br");
  const jur = await new Cliente().entrar("jur@a.gov.br");
  const fis = await new Cliente().entrar("fiscal@a.gov.br");
  const b = await new Cliente().entrar("admin@b.gov.br");
  assert.equal((await jur.post("/api/pronto", { ano: 2026 })).status, 403);
  const novo = await req.post("/api/pronto", { ano: 2026 });
  assert.equal(novo.status, 201, JSON.stringify(novo.dados));
  assert.equal(novo.dados.protocolo, "PP 2026/0001");
  const id = novo.dados.id, rota = `/api/pronto/${id}`;
  assert.equal((await b.get(rota)).status, 404);
  let p = (await req.get(rota)).dados;
  assert.deepEqual(p.limite, { valor: 13098.41, fonte: "Decreto nº 12.807/2025", ano: 2026, exato: true });
  assert.ok(p.pendencias.pedido.length > 0);

  // Requisitante não autoriza; com o pedido incompleto, a autorização aponta o que falta.
  assert.equal((await req.post(`${rota}/avancar`)).status, 403);
  let r = await lic.post(`${rota}/avancar`);
  assert.equal(r.dados.avancou, false);
  assert.ok(r.dados.pendencias.some((x: { campo: string }) => x.campo === "objeto"));

  const pedido = {
    secretaria: "Educação", responsavel: "Fulana — Diretora", tipo: "compra", objeto: "Lâmpadas LED para a escola", justificativa: "Lâmpadas queimadas; compra imediata.",
    itens: [{ descricao: "Lâmpada LED 9W", unidade: "un", quantidade: 1000, valor_unitario: 14 }],
    fornecedor: "Elétrica Central", fornecedor_doc: "12.345.678/0001-90", fornecedor_contato: "", pesquisa_preco: "Três orçamentos anexados.", dotacao: "",
  };
  assert.equal((await req.put(rota, { dados: pedido })).status, 200);
  r = await lic.post(`${rota}/avancar`);
  assert.equal(r.dados.avancou, false);
  assert.match(r.dados.pendencias[0].texto, /passa do limite do pronto pagamento \(R\$\s13\.098,41/);
  assert.equal((await req.put(rota, { dados: { itens: [{ descricao: "Lâmpada LED 9W", unidade: "un", quantidade: 100, valor_unitario: 14 }] } })).status, 200);
  // Campo de outra etapa não entra no pedido.
  assert.equal((await req.put(rota, { dados: { nota_numero: "1" } })).status, 409);
  r = await lic.post(`${rota}/avancar`);
  assert.deepEqual(r.dados, { avancou: true, situacao: "autorizado" });
  p = (await req.get(rota)).dados;
  assert.equal(p.valor_total, 1400);
  assert.equal(p.autorizado_por_nome, "lic");
  // Depois de autorizado, o pedido fica travado.
  assert.equal((await req.put(rota, { dados: { objeto: "Outro objeto" } })).status, 409);

  // Recebimento: a nota não pode passar do autorizado.
  assert.equal((await fis.put(rota, { dados: { nota_numero: "552", nota_data: "2026-11-10", nota_valor: 1500, recebido_por: "Fiscal", recebido_em: "2026-11-11" } })).status, 200);
  r = await fis.post(`${rota}/avancar`);
  assert.equal(r.dados.avancou, false);
  assert.match(r.dados.pendencias[0].texto, /maior que o valor autorizado/);
  assert.equal((await fis.put(rota, { dados: { nota_valor: 1400 } })).status, 200);
  assert.deepEqual((await fis.post(`${rota}/avancar`)).dados, { avancou: true, situacao: "recebido" });

  // Pagamento pelo setor de contratações; empenho é exigido quando a forma é empenho.
  assert.equal((await fis.post(`${rota}/avancar`)).status, 403);
  assert.equal((await lic.put(rota, { dados: { forma_pagamento: "empenho", pago_em: "2026-11-12" } })).status, 200);
  assert.deepEqual((await lic.post(`${rota}/avancar`)).dados.pendencias.map((x: { campo: string }) => x.campo), ["empenho"]);
  assert.equal((await lic.put(rota, { dados: { empenho: "3456/2026" } })).status, 200);
  assert.deepEqual((await lic.post(`${rota}/avancar`)).dados, { avancou: true, situacao: "pago" });
  assert.equal((await lic.put(rota, { dados: { empenho: "x" } })).status, 409);
  assert.equal((await lic.post(`${rota}/cancelar`, { cancelar: true })).status, 409);

  // Anexo e documentos.
  const fd = new FormData();
  fd.append("tipo", "nota");
  fd.append("arquivo", new Blob([Buffer.from("%PDF-1.4 nota")]), "nota-552.pdf");
  assert.equal((await fis.req("POST", `${rota}/anexos`, fd)).status, 201);
  p = (await req.get(rota)).dados;
  assert.deepEqual(p.anexos.map((a: { nome: string; tipo: string }) => [a.nome, a.tipo]), [["nota-552.pdf", "nota"]]);
  const pdf = await req.get(`${rota}/documento.pdf?tipo=completo`);
  assert.equal(pdf.status, 200);
  assert.equal(pdf.dados.subarray(0, 5).toString(), "%PDF-");
  assert.equal((await req.get(`${rota}/documento.docx`)).status, 200);
  assert.deepEqual(p.historico.map((h: { acao: string }) => h.acao), ["pronto.criado", "pronto.autorizado", "pronto.recebido", "pronto.pago", "pronto.anexo"]);

  // Segundo pedido ao mesmo fornecedor: aviso de possível fracionamento.
  const outro = (await req.post("/api/pronto", { ano: 2026 })).dados;
  assert.equal(outro.protocolo, "PP 2026/0002");
  assert.equal((await req.put(`/api/pronto/${outro.id}`, { dados: { ...pedido, fornecedor: "Elétrica Central Ltda", itens: [{ descricao: "Reator", unidade: "un", quantidade: 1, valor_unitario: 12000 }] } })).status, 200);
  const alerta = (await req.get(`/api/pronto/${outro.id}`)).dados.alertas.join(" ");
  assert.match(alerta, /PP 2026\/0001.*passa do limite/);
  const lista = (await req.get("/api/pronto?ano=2026")).dados;
  assert.equal(lista.lista.length, 2);
  assert.equal(lista.pagos, 1);
});

test("pronto pagamento: documento de autorização traz itens em quadro, limite e assinaturas", async () => {
  const { documentoPP } = await import("../../shared/pronto-pagamento.js");
  const texto = documentoPP({
    protocolo: "PP 2026/0007", ano: 2026, situacao: "autorizado", orgao: "Município Teste", municipio: "Ibaiti/PR", autorizado_por: "Prefeito Teste", autorizado_em: "2026-11-19T10:00:00Z",
    dados: { secretaria: "Saúde", responsavel: "Beltrano — Secretário", tipo: "servico", objeto: "Conserto de geladeira de vacinas", justificativa: "Urgente.", itens: [{ descricao: "Troca do compressor", unidade: "serv", quantidade: 1, valor_unitario: 1800 }],
      fornecedor: "Refrigeração X", fornecedor_doc: "11.111.111/0001-11", fornecedor_contato: "", pesquisa_preco: "Dois orçamentos.", dotacao: "", nota_numero: "", nota_data: "", nota_valor: null,
      recebido_por: "", recebido_em: "", recebimento_obs: "", forma_pagamento: "", empenho: "", pago_em: "", pagamento_obs: "" },
  }, "autorizacao");
  assert.match(texto, /^# SOLICITAÇÃO E AUTORIZAÇÃO DE PRONTO PAGAMENTO/);
  assert.match(texto, /\| Item \| Descrição \| Un\. \| Qtd\. \| Valor unitário \| Valor total \|\n\|:---:\|/);
  assert.match(texto, /\| 1 \| Troca do compressor \| serv \| 1 \| R\$\s1\.800,00 \| R\$\s1\.800,00 \|/);
  assert.match(texto, /R\$\s13\.098,41 \(Decreto nº 12\.807\/2025\)/);
  assert.match(texto, /Autorizado em 19\/11\/2026\.\n\n@ Prefeito Teste\n@ Ordenador da despesa/);
  assert.ok(!texto.includes("Recebimento e atesto"));
});

test("pronto pagamento: o responsável e a assinatura vêm do cadastro de secretários", async () => {
  const admin = await new Cliente().entrar("admin@ibaiti.gov.br");
  const t = (await admin.get(`/api/pronto/titular?secretaria=${encodeURIComponent("SEDUC")}`)).dados.titular;
  assert.deepEqual(t, { nome: "Denise da Silva Lima", secretaria: "Educação", portaria: "008/2025", texto: "Denise da Silva Lima — Secretário(a) Municipal de Educação (Portaria nº 008/2025)" });
  assert.equal((await admin.get("/api/pronto/titular?secretaria=Inexistente")).dados.titular, null);
  const novo = (await admin.post("/api/pronto", { ano: 2026, secretaria: "SEDUC" })).dados;
  const rota = `/api/pronto/${novo.id}`;
  assert.equal((await admin.get(rota)).dados.dados.responsavel, t.texto);
  // Responsável apagado e Secretaria trocada: o sistema põe o titular da nova Secretaria.
  assert.equal((await admin.put(rota, { dados: { secretaria: "Obras", responsavel: "" } })).status, 200);
  assert.match((await admin.get(rota)).dados.dados.responsavel, /^Antônio Vincenzi — Secretário\(a\) Municipal de Obras/);
  assert.equal((await admin.put(rota, { dados: { secretaria: "SEDUC", responsavel: t.texto } })).status, 200);
  const { documentoPP, VAZIO_PP } = await import("../../shared/pronto-pagamento.js");
  const texto = documentoPP({ protocolo: "PP 2026/0009", ano: 2026, situacao: "pedido", orgao: "Município", municipio: "", autorizado_por: null, autorizado_em: null, dados: { ...VAZIO_PP, secretaria: "SEDUC", responsavel: t.texto } }, "autorizacao");
  assert.match(texto, /@ Denise da Silva Lima\n@ Secretário\(a\) Municipal de Educação\n@ Portaria de nomeação nº 008\/2025/);
});

test("o que já foi informado no PAC e na Solicitação preenche os campos que pedem a mesma informação", async () => {
  const lic = await new Cliente().entrar("lic@a.gov.br");
  const { dados: { id } } = await lic.post("/api/processos", { objeto: "Aquisição de cadeiras escolares", tipo: "bens", via: "licitacao", ano: 2032, requisitante: "Educação" });
  const rota = `/api/processos/${id}`;
  assert.equal((await lic.put(`${rota}/campos/pac`, { valores: { consta: "sim", item_pac: "Item 9", mes_planejado: "Março/2032", no_prazo: "sim" } })).status, 200);
  assert.equal((await lic.post(`${rota}/checagens`, { item: "pc1", marcado: true })).status, 200);
  const r = await lic.post(`${rota}/solicitacoes`, {
    chave_envio: randomUUID(), secretaria: "Educação", justificativa: "Cadeiras quebradas.",
    descricao: "## Quantidades e prazo\n[[Quantidades e prazo de atendimento]]",
    itens: [{ descricao: "Cadeira escolar", unidade: "un", quantidade: 30, valor_unitario: 300 }],
  });
  assert.equal(r.status, 201, JSON.stringify(r.dados));
  const det = (await lic.get(rota)).dados;
  assert.match(det.solicitacoes[0].descricao, /Cadeira escolar: 30 un\. Prazo: conforme o PAC, início previsto para Março\/2032/);
  // DFD já sabe a justificativa, a quantidade e o prazo; o ETP, a justificativa.
  assert.equal(det.sugestoes_campos.dfd.justificativa, "Cadeiras quebradas.");
  assert.equal(det.sugestoes_campos.dfd.quantidade, "- Cadeira escolar: 30 un");
  assert.equal(det.sugestoes_campos.dfd.data_pretendida, "Início previsto no PAC: Março/2032.");
  // Campo salvo em branco continua recebendo a sugestão.
  assert.equal((await lic.put(`${rota}/campos/dfd`, { valores: { justificativa: "", objeto: "Cadeiras" } })).status, 200);
  const depois = (await lic.get(rota)).dados;
  assert.equal(depois.sugestoes_campos.dfd.justificativa, "Cadeiras quebradas.");
  assert.equal(depois.sugestoes_campos.dfd.objeto, undefined);
});

test("PNCP: o índice local é alimentado pela API oficial e a busca usa o índice, sem o portal", async () => {
  const { sincronizarDia, buscarNoIndice } = await import("../pncp-indice.js");
  process.env.PNCP_PAUSA_MS = "0";
  const chamadas: string[] = [];
  let pediuCalma = false;
  const falso = (async (entrada: string | URL) => {
    const url = new URL(String(entrada));
    chamadas.push(url.pathname + url.search);
    if (url.pathname === "/api/consulta/v1/contratacoes/publicacao") {
      if (!pediuCalma) { pediuCalma = true; return new Response("", { status: 429, headers: { "retry-after": "0" } }); }
      return Response.json({ totalPaginas: 1, data: [
        { numeroControlePNCP: "11111111000111-1-000007/2031", objetoCompra: "Aquisição de PEDRA BRITA e pó de pedra", modalidadeNome: "Pregão - Eletrônico",
          situacaoCompraNome: "Divulgada no PNCP", dataPublicacaoPncp: "2031-03-10T09:00:00", valorTotalEstimado: 5000,
          orgaoEntidade: { razaoSocial: "MUNICIPIO X" }, unidadeOrgao: { ufSigla: "PR", municipioNome: "Cidade X" } },
        { numeroControlePNCP: "22222222000122-1-000008/2031", objetoCompra: "Papel higiênico", modalidadeNome: "Dispensa",
          orgaoEntidade: { razaoSocial: "MUNICIPIO Y" }, unidadeOrgao: { ufSigla: "PR", municipioNome: "Cidade Y" } },
      ] });
    }
    if (url.pathname === "/api/search/") throw new Error("o portal não deve ser usado");
    return Response.json([{ numeroItem: 1, descricao: "Pó de pedra", quantidade: 10, unidadeMedida: "m3", valorUnitarioEstimado: 95.5 }]);
  }) as typeof fetch;
  assert.equal(await sincronizarDia("PR", 6, new Date(Date.UTC(2031, 2, 10)), falso), 2);
  assert.ok(chamadas[0].includes("dataInicial=20310310") && chamadas[0].includes("uf=PR"));
  assert.equal(chamadas.length, 2, "repetiu a consulta depois do 429");
  const achados = await buscarNoIndice("PÓ DE PEDRA", "PR", "todos");
  assert.deepEqual(achados?.map((x) => x.controle), ["11111111000111-1-000007/2031"]);
  assert.equal(await buscarNoIndice("pedra", "SC", "todos"), null);
  const r = await buscarPncp({ q: "pó de pedra", uf: "PR", status: "todos" }, falso);
  assert.equal(r.fonte, "indice");
  assert.equal(r.resultados[0].unitValue, 95.5);
  assert.equal(r.resultados[0].municipality, "Cidade X");
  assert.ok(chamadas.at(-1)!.startsWith("/api/pncp/v1/orgaos/11111111000111/compras/2031/7/itens"));
  await pool.query("delete from pncp_editais; delete from pncp_dias_sincronizados;");
});
