// Índice local de editais do PNCP, alimentado pela API oficial de consulta (que aceita o sistema normalmente).
// A busca do portal do PNCP (/api/search) recusa a maior parte das conexões de programas; por isso a busca de preços
// procura primeiro nesta cópia local e só busca os itens de cada edital na API oficial.
import { pool, q, q1 } from "./db.js";

export const CABECALHOS_PNCP = { Accept: "application/json", "User-Agent": "Licita/1.0 (sistema de compras municipal)" };
/** Pregão eletrônico, dispensa, concorrência eletrônica e pregão presencial: as modalidades úteis para pesquisa de preços. */
export const MODALIDADES_INDICE = [6, 8, 4, 7];
/** Estados mantidos no índice (variável PNCP_UFS, separados por vírgula). Padrão: PR. */
export const ufsDoIndice = () => (process.env.PNCP_UFS ?? "PR").split(",").map((x) => x.trim().toUpperCase()).filter(Boolean);
const DIAS_DE_HISTORICO = Number(process.env.PNCP_DIAS ?? 180);

export const normalizarTexto = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const aaaammdd = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, "");
const obj = (v: unknown): Record<string, any> => (v && typeof v === "object" ? (v as Record<string, any>) : {});

const espera = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
/** Intervalo entre consultas à API oficial, para não passar do limite de uso (o PNCP responde 429). */
const PAUSA_MS = Number(process.env.PNCP_PAUSA_MS ?? 1500);
/** Repete a consulta quando o PNCP pede calma (429) ou a conexão cai, esperando cada vez mais. */
async function comPaciencia(consulta: () => Promise<Response>) {
  for (let tentativa = 1; ; tentativa++) {
    let r: Response | undefined;
    try { r = await consulta(); } catch (e) { if (tentativa >= 4) throw e; }
    if (r && r.status !== 429 && r.status < 500) { await espera(PAUSA_MS); return r; }
    if (tentativa >= 4) return r!;
    const pedido = Number(r?.headers.get("retry-after"));
    await espera(Number.isFinite(pedido) && pedido > 0 ? pedido * 1000 : 5000 * tentativa);
  }
}

/** Baixa as publicações de um dia (todas as páginas) e grava no índice. Devolve quantos editais gravou. */
export async function sincronizarDia(uf: string, modalidade: number, dia: Date, carregar: typeof fetch = fetch) {
  let pagina = 1, total = 0, paginas = 1;
  do {
    const url = `https://pncp.gov.br/api/consulta/v1/contratacoes/publicacao?dataInicial=${aaaammdd(dia)}&dataFinal=${aaaammdd(dia)}&codigoModalidadeContratacao=${modalidade}&uf=${uf}&pagina=${pagina}&tamanhoPagina=50`;
    const r = await comPaciencia(() => carregar(url, { headers: CABECALHOS_PNCP, signal: AbortSignal.timeout(60000) }));
    if (r.status === 204) break;
    if (!r.ok) throw new Error(`PNCP respondeu ${r.status} em ${url}`);
    const corpo = obj(await r.json());
    paginas = Number(corpo.totalPaginas) || 1;
    const lista = Array.isArray(corpo.data) ? corpo.data.map(obj) : [];
    for (const c of lista) {
      const m = /^(\d{14})-\d-(\d+)\/(\d{4})$/.exec(String(c.numeroControlePNCP ?? "").replace(/\s/g, ""));
      if (!m) continue;
      const objeto = String(c.objetoCompra ?? "");
      await pool.query(
        `insert into pncp_editais (controle, cnpj, ano, sequencial, objeto, objeto_norm, orgao, uf, municipio, modalidade, situacao, numero_compra, processo, publicado_em, abertura_em, encerramento_em, valor, atualizado_em)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,now())
         on conflict (controle) do update set objeto=excluded.objeto, objeto_norm=excluded.objeto_norm, situacao=excluded.situacao,
           abertura_em=excluded.abertura_em, encerramento_em=excluded.encerramento_em, valor=excluded.valor, atualizado_em=now()`,
        [c.numeroControlePNCP, m[1], Number(m[3]), Number(m[2]), objeto, normalizarTexto(objeto), String(obj(c.orgaoEntidade).razaoSocial ?? ""),
          String(obj(c.unidadeOrgao).ufSigla ?? uf), String(obj(c.unidadeOrgao).municipioNome ?? ""), String(c.modalidadeNome ?? ""),
          String(c.situacaoCompraNome ?? ""), String(c.numeroCompra ?? ""), String(c.processo ?? ""),
          c.dataPublicacaoPncp || null, c.dataAberturaProposta || null, c.dataEncerramentoProposta || null,
          Number.isFinite(Number(c.valorTotalEstimado)) ? Number(c.valorTotalEstimado) : null]);
      total++;
    }
    pagina++;
  } while (pagina <= paginas);
  await q(`insert into pncp_dias_sincronizados (uf, modalidade, dia, registros) values ($1,$2,$3,$4)
    on conflict (uf, modalidade, dia) do update set registros=excluded.registros, em=now()`, [uf, modalidade, dia.toISOString().slice(0, 10), total]);
  return total;
}

/**
 * Uma rodada: atualiza os 3 últimos dias e avança o histórico (até `diasPorRodada` dias ainda não baixados por modalidade),
 * até cobrir os últimos DIAS_DE_HISTORICO dias. Usa trava no banco para não rodar duas vezes ao mesmo tempo.
 */
export async function rodadaDoIndice(carregar: typeof fetch = fetch, diasPorRodada = 6, hoje = new Date()) {
  const c = await pool.connect();
  try {
    const { rows: [trava] } = await c.query("select pg_try_advisory_lock(771001) as ok");
    if (!trava.ok) return { rodou: false, gravados: 0 };
    let gravados = 0;
    const dia = (n: number) => new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth(), hoje.getUTCDate() - n));
    for (const uf of ufsDoIndice()) {
      for (const modalidade of MODALIDADES_INDICE) {
        const feitos = new Set((await q<{ dia: string }>("select dia::text as dia from pncp_dias_sincronizados where uf=$1 and modalidade=$2", [uf, modalidade])).map((x) => x.dia));
        const recentes = [0, 1, 2].map(dia);
        const antigos: Date[] = [];
        for (let n = 3; n <= DIAS_DE_HISTORICO && antigos.length < diasPorRodada; n++) {
          if (!feitos.has(dia(n).toISOString().slice(0, 10))) antigos.push(dia(n));
        }
        for (const d of [...recentes, ...antigos]) {
          try { gravados += await sincronizarDia(uf, modalidade, d, carregar); }
          catch (e) { console.warn("PNCP: falha ao atualizar o índice", { uf, modalidade, dia: d.toISOString().slice(0, 10), erro: e instanceof Error ? e.message : String(e) }); }
        }
      }
    }
    return { rodou: true, gravados };
  } finally {
    await c.query("select pg_advisory_unlock(771001)").catch(() => {});
    c.release();
  }
}

/** Inicia a atualização periódica do índice (a cada 15 minutos), sem travar a subida do servidor. */
export function iniciarIndicePncp() {
  if (process.env.PNCP_INDICE === "0") return;
  const rodar = () => rodadaDoIndice().then((r) => { if (r.gravados) console.log(`PNCP: índice atualizado (${r.gravados} registros).`); })
    .catch((e) => console.warn("PNCP: rodada do índice falhou", e instanceof Error ? e.message : e));
  setTimeout(rodar, 15_000);
  setInterval(rodar, 15 * 60_000).unref();
}

export interface EditalIndice {
  controle: string; orgao: string; uf: string; municipio: string; modalidade: string; situacao: string;
  numero_compra: string; processo: string; publicado_em: string | null; abertura_em: string | null;
}
/** Procura editais no índice pelas palavras do objeto. Devolve null quando o estado não está no índice ou ele está vazio. */
export async function buscarNoIndice(texto: string, uf: string, status: string, limite = 10): Promise<EditalIndice[] | null> {
  if (!uf || !ufsDoIndice().includes(uf)) return null;
  const tem = await q1<{ n: number }>("select count(*)::int as n from pncp_editais where uf=$1", [uf]);
  if (!tem?.n) return null;
  const palavras = [...new Set(normalizarTexto(texto).split(/[^a-z0-9]+/).filter((t) => t.length >= 3).map((t) => t.replace(/s$/, "")))];
  if (!palavras.length) return [];
  const filtroStatus = status === "recebendo_proposta" ? "and encerramento_em > now()"
    : status === "propostas_encerradas" || status === "encerradas" ? "and (encerramento_em is null or encerramento_em <= now())" : "";
  // Todas as palavras no objeto; se nenhum edital tiver todas, aceita a maioria delas.
  const busca = async (minimo: number) => q<EditalIndice & { acertos: number }>(
    `select controle, orgao, uf, municipio, modalidade, situacao, numero_compra, processo, publicado_em::text, abertura_em::text, acertos
       from (select *, (${palavras.map((_, i) => `(objeto_norm like $${i + 2})::int`).join(" + ")}) as acertos from pncp_editais where uf=$1 ${filtroStatus}) x
      where acertos >= ${minimo} order by acertos desc, publicado_em desc nulls last limit ${limite}`,
    [uf, ...palavras.map((p) => `%${p}%`)]);
  let achados = await busca(palavras.length);
  if (!achados.length && palavras.length > 2) achados = await busca(Math.ceil(palavras.length / 2));
  return achados;
}

export async function situacaoDoIndice(uf: string) {
  return q1<{ editais: number; atualizado: string | null; dias: number }>(
    `select (select count(*)::int from pncp_editais where uf=$1) as editais,
            (select max(em)::text from pncp_dias_sincronizados where uf=$1) as atualizado,
            (select count(distinct dia)::int from pncp_dias_sincronizados where uf=$1) as dias`, [uf]);
}
