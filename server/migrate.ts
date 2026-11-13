import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { ehMunicipioIbaiti } from "./municipio-ibaiti.js";
import { secretariosIbaitiComAtos } from "./secretarios-ibaiti.js";
import { pool, tx } from "./db.js";

const here = path.dirname(fileURLToPath(import.meta.url));

export async function migrar() {
  // schema.sql fica em server/ (dev) e é copiado para dist/server no build
  const candidatos = [path.join(here, "schema.sql"), path.join(here, "../../server/schema.sql")];
  const arq = candidatos.find((c) => { try { readFileSync(c); return true; } catch { return false; } });
  if (!arq) throw new Error("schema.sql não encontrado");
  await tx(async (c) => {
    await c.query(readFileSync(arq, "utf8"));
    const orgaos = await c.query<{ id: number; nome: string; cnpj: string | null }>(
      "select id, nome, cnpj from orgaos where exists (select 1 from secretarios where orgao_id=orgaos.id and portaria is null)",
    );
    const ids = orgaos.rows.filter(ehMunicipioIbaiti).map((o) => o.id);
    if (ids.length) await c.query(
      `update secretarios s set portaria = a.portaria, fonte_portaria = a.fonte_portaria
       from jsonb_to_recordset($2::jsonb) as a(codigo text, secretaria text, nome text, portaria text, fonte_portaria text)
       where s.orgao_id=any($1::int[]) and s.portaria is null and a.portaria is not null
         and (s.codigo_portal=a.codigo or lower(s.secretaria)=lower(a.secretaria))
         and lower(s.nome)=lower(a.nome)`,
      [ids, JSON.stringify(secretariosIbaitiComAtos)],
    );
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  migrar().then(() => { console.log("Banco atualizado."); return pool.end(); })
    .catch((e) => { console.error(e); process.exit(1); });
}
