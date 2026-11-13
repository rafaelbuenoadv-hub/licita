import pg from "pg";

// numeric -> number (valores monetários cabem com folga em double para este uso)
pg.types.setTypeParser(1700, (v) => (v === null ? null : Number(v)));
// date -> string 'YYYY-MM-DD' (sem fuso)
pg.types.setTypeParser(1082, (v) => v);

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL ?? "postgres://postgres@localhost:5432/licita",
  max: Number(process.env.DB_POOL ?? 10),
});

export async function q<T extends pg.QueryResultRow = any>(sql: string, params: unknown[] = []) {
  const r = await pool.query<T>(sql, params);
  return r.rows;
}
export async function q1<T extends pg.QueryResultRow = any>(sql: string, params: unknown[] = []) {
  const r = await pool.query<T>(sql, params);
  return r.rows[0] as T | undefined;
}
export async function tx<T>(fn: (c: pg.PoolClient) => Promise<T>) {
  const c = await pool.connect();
  try {
    await c.query("begin");
    const out = await fn(c);
    await c.query("commit");
    return out;
  } catch (e) {
    await c.query("rollback");
    throw e;
  } finally {
    c.release();
  }
}

export async function auditar(a: {
  orgao: number; usuario?: number | null; processo?: number | null; contrato?: number | null; acao: string; detalhe?: object;
}, conexao: pg.Pool | pg.PoolClient = pool) {
  await conexao.query(
    "insert into auditoria (orgao_id, usuario_id, processo_id, contrato_id, acao, detalhe) values ($1,$2,$3,$4,$5,$6)",
    [a.orgao, a.usuario ?? null, a.processo ?? null, a.contrato ?? null, a.acao, JSON.stringify(a.detalhe ?? {})],
  );
}
