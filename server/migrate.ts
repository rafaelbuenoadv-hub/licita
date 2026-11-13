import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { pool } from "./db.js";

const here = path.dirname(fileURLToPath(import.meta.url));

export async function migrar() {
  // schema.sql fica em server/ (dev) e é copiado para dist/server no build
  const candidatos = [path.join(here, "schema.sql"), path.join(here, "../../server/schema.sql")];
  const arq = candidatos.find((c) => { try { readFileSync(c); return true; } catch { return false; } });
  if (!arq) throw new Error("schema.sql não encontrado");
  await pool.query(readFileSync(arq, "utf8"));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  migrar().then(() => { console.log("Banco atualizado."); return pool.end(); })
    .catch((e) => { console.error(e); process.exit(1); });
}
