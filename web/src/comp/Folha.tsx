import { Fragment, type ReactNode } from "react";
import { QUEBRA_NA_CELULA } from "../../../shared/solicitacao";

// Renderiza a marcação das minutas como folha de documento oficial.
function inline(s: string, k: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\[\[(.+?)\]\]|\*\*(.+?)\*\*/g;
  let ult = 0, m: RegExpExecArray | null, i = 0;
  while ((m = re.exec(s))) {
    if (m.index > ult) out.push(s.slice(ult, m.index));
    out.push(m[1] !== undefined ? <mark key={k + i++}>{m[1]}</mark> : <b key={k + i++}>{m[2]}</b>);
    ult = m.index + m[0].length;
  }
  if (ult < s.length) out.push(s.slice(ult));
  return out;
}

type Alinhamento = "left" | "center" | "right" | undefined;
/** Alinhamento da coluna conforme a linha separadora do quadro: ":---:" centralizada, "---:" à direita. */
const alinhamentoDe = (sep: string): Alinhamento => (sep.startsWith(":") && sep.endsWith(":") ? "center" : sep.endsWith(":") ? "right" : undefined);

export function Folha({ texto, vazio }: { texto: string; vazio?: string }) {
  if (!texto.trim()) return <div className="folha"><p className="vazio">{vazio ?? "Nenhuma minuta ainda."}</p></div>;
  const el: ReactNode[] = [];
  let tab: string[][] = [], alin: Alinhamento[] = [], assin = false, n = 0;
  const fecha = () => {
    if (!tab.length) return;
    const [cab, ...corpo] = tab;
    const quadroItens = cab[0] === "Item" && cab[1] === "Descrição";
    const estilo = (j: number) => (alin[j] ? { textAlign: alin[j] } : undefined);
    el.push(<div className="tw" key={"t" + n++}><table className={quadroItens ? "quadro-itens" : undefined}><thead><tr>{cab.map((c, i) => <th key={i}>{c.split(QUEBRA_NA_CELULA).map((trecho, j) => <Fragment key={j}>{j > 0 && <br />}{j > 0 ? <span className="forn">{inline(trecho, `h${i}-${j}`)}</span> : inline(trecho, `h${i}-${j}`)}</Fragment>)}</th>)}</tr></thead>
      <tbody>{corpo.map((r, i) => <tr key={i} className={!r[0] && /^\*\*/.test(r[1] ?? "") ? "total" : undefined}>{r.map((c, j) => <td key={j} style={estilo(j)}>{inline(c, `c${i}-${j}`)}</td>)}</tr>)}</tbody></table></div>);
    tab = []; alin = [];
  };
  for (const bruta of texto.split("\n")) {
    const s = bruta.trim();
    if (s.startsWith("|")) {
      const c = s.replace(/^\||\|$/g, "").split("|").map((x) => x.trim());
      if (c.every((x) => /^:?-{2,}:?$/.test(x))) alin = c.map(alinhamentoDe);
      else tab.push(c);
      continue;
    }
    fecha();
    const k = "l" + n++;
    if (!s) { assin = false; continue; }
    if (s.startsWith("# ")) el.push(<h1 key={k}>{inline(s.slice(2), k)}</h1>);
    else if (s.startsWith("## ")) el.push(<h2 key={k}>{inline(s.slice(3), k)}</h2>);
    else if (s.startsWith("@ ")) { el.push(<p key={k} className={"as" + (assin ? "" : " first")}>{inline(s.slice(2), k)}</p>); assin = true; continue; }
    else el.push(<p key={k}>{inline(s, k)}</p>);
    assin = false;
  }
  fecha();
  return <div className="folha">{el}</div>;
}
