// Cria um órgão de demonstração com um usuário por perfil.
// Uso: npm run seed -- [--senha "senha-com-10+"]   (sem --senha, gera uma e mostra no terminal)
import { parseArgs } from "node:util";
import { randomBytes } from "node:crypto";
import { pool, q1 } from "./db.js";
import { hashSenha, senhaValida } from "./auth.js";
import { migrar } from "./migrate.js";

const { values } = parseArgs({ options: { senha: { type: "string" } } });
const senha = values.senha ?? randomBytes(9).toString("base64url");
if (!senhaValida(senha)) { console.error("A senha precisa ter ao menos 10 caracteres."); process.exit(1); }

await migrar();
const existe = await q1("select id from orgaos where nome = 'Prefeitura de Demonstração'");
if (existe) { console.log("O órgão de demonstração já existe."); await pool.end(); process.exit(0); }
const o = await q1<{ id: number }>(
  "insert into orgaos (nome, municipio, uf, normas) values ($1,$2,$3,$4) returning id",
  ["Prefeitura de Demonstração", "Demonstração", "PR", "Cadastre aqui os decretos municipais que regulamentam a Lei nº 14.133/2021 no órgão."]);
const h = await hashSenha(senha);
const usuarios: [string, string, string, string[]][] = [
  ["Administração", "admin@demo.gov.br", "Administrador do sistema", ["admin", "contratacao"]],
  ["Ana Requisitante", "requisitante@demo.gov.br", "Secretaria de Obras", ["requisitante"]],
  ["Bruno Licitações", "licitacoes@demo.gov.br", "Agente de contratação", ["contratacao"]],
  ["Carla Jurídico", "juridico@demo.gov.br", "Procuradoria", ["juridico"]],
  ["Diego Prefeito", "autoridade@demo.gov.br", "Prefeito", ["autoridade"]],
  ["Elisa Fiscal", "fiscal@demo.gov.br", "Fiscal de contratos", ["fiscal"]],
];
for (const [nome, email, cargo, papeis] of usuarios) {
  await q1("insert into usuarios (orgao_id, nome, email, cargo, papeis, senha_hash) values ($1,$2,$3,$4,$5,$6)", [o!.id, nome, email, cargo, papeis, h]);
}
console.log("Órgão de demonstração criado. Usuários (todos com a mesma senha):");
for (const [, email, cargo] of usuarios) console.log(`  ${email.padEnd(28)} ${cargo}`);
console.log(`Senha: ${senha}`);
await pool.end();
