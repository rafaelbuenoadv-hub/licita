// Cadastra um órgão e seu primeiro administrador.
// Uso: npm run novo-orgao -- --nome "Município de X" --admin-nome "Fulana" --admin-email f@x.gov.br --senha "..." [--cnpj ...] [--municipio ...] [--uf PR]
import { parseArgs } from "node:util";
import { pool, q1 } from "./db.js";
import { hashSenha, senhaValida } from "./auth.js";
import { migrar } from "./migrate.js";

const { values: a } = parseArgs({
  options: {
    nome: { type: "string" }, cnpj: { type: "string" }, municipio: { type: "string" }, uf: { type: "string" },
    "admin-nome": { type: "string" }, "admin-email": { type: "string" }, senha: { type: "string" },
  },
});
if (!a.nome || !a["admin-nome"] || !a["admin-email"] || !senhaValida(a.senha)) {
  console.error('Informe --nome, --admin-nome, --admin-email e --senha (mínimo 10 caracteres).');
  process.exit(1);
}
await migrar();
const o = await q1<{ id: number }>(
  "insert into orgaos (nome, cnpj, municipio, uf) values ($1,$2,$3,$4) returning id",
  [a.nome, a.cnpj ?? null, a.municipio ?? null, a.uf ?? null],
);
await q1(
  "insert into usuarios (orgao_id, nome, email, senha_hash, papeis) values ($1,$2,lower($3),$4,$5)",
  [o!.id, a["admin-nome"], a["admin-email"], await hashSenha(a.senha!), ["admin", "contratacao"]],
);
console.log(`Órgão ${o!.id} criado. Administrador: ${a["admin-email"]}`);
await pool.end();
