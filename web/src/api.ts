export class ErroApi extends Error {
  constructor(public status: number, msg: string) { super(msg); }
}

async function req<T>(metodo: string, url: string, corpo?: unknown): Promise<T> {
  const h: Record<string, string> = { "x-licita": "1" };
  let body: BodyInit | undefined;
  if (corpo instanceof FormData) body = corpo;
  else if (corpo !== undefined) { h["content-type"] = "application/json"; body = JSON.stringify(corpo); }
  const r = await fetch("/api" + url, { method: metodo, headers: h, body, credentials: "same-origin" });
  const dados = r.headers.get("content-type")?.includes("json") ? await r.json() : null;
  if (!r.ok) {
    if (r.status === 401 && !url.startsWith("/auth/")) window.dispatchEvent(new Event("licita:sair"));
    throw new ErroApi(r.status, dados?.erro ?? `Erro ${r.status}`);
  }
  return dados as T;
}
export const api = {
  get: <T = any>(u: string) => req<T>("GET", u),
  post: <T = any>(u: string, c?: unknown) => req<T>("POST", u, c ?? {}),
  put: <T = any>(u: string, c?: unknown) => req<T>("PUT", u, c ?? {}),
  del: <T = any>(u: string) => req<T>("DELETE", u),
};

/** Lê uma resposta NDJSON da IA: chama onTexto com o texto acumulado; devolve a linha final. */
export async function fluxo(url: string, corpo: unknown, onTexto: (t: string) => void, sinal?: AbortSignal) {
  const r = await fetch("/api" + url, {
    method: "POST", headers: { "x-licita": "1", "content-type": "application/json" }, body: JSON.stringify(corpo), signal: sinal,
  });
  if (!r.ok || !r.body) {
    const d = await r.json().catch(() => null);
    throw new ErroApi(r.status, d?.erro ?? `Erro ${r.status}`);
  }
  const leitor = r.body.getReader();
  const dec = new TextDecoder();
  let buf = "", texto = "", fim: any = null;
  for (;;) {
    const { value, done } = await leitor.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let k: number;
    while ((k = buf.indexOf("\n")) >= 0) {
      const linha = buf.slice(0, k); buf = buf.slice(k + 1);
      if (!linha.trim()) continue;
      const o = JSON.parse(linha);
      if (o.d) { texto += o.d; onTexto(texto); } else fim = o;
    }
  }
  if (!fim) throw new ErroApi(502, "A resposta da IA foi interrompida.");
  if (fim.erro) throw Object.assign(new ErroApi(502, fim.erro), { texto });
  return { ...fim, texto };
}

export const brl = (v: number | null | undefined) => v == null ? "—" : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
export const dataBR = (s: string | null | undefined) => {
  if (!s) return "—";
  const d = s.length === 10 ? new Date(s + "T12:00:00") : new Date(s);
  return d.toLocaleDateString("pt-BR");
};
export const dataHora = (s: string) => new Date(s).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
export const numBR = (s: string) => {
  const t = s.trim(); if (!t) return null;
  const n = Number(t.replace(/[R$\s.]/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : NaN;
};
export const fmtNum = (v: number | null | undefined) => v == null ? "" : v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
