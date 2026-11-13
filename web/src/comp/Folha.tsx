import type { ReactNode } from "react";

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

export function Folha({ texto, vazio }: { texto: string; vazio?: string }) {
  if (!texto.trim()) return <div className="folha"><p className="vazio">{vazio ?? "Nenhuma minuta ainda."}</p></div>;
  const el: ReactNode[] = [];
  let tab: string[][] = [], assin = false, n = 0;
  const fecha = () => {
    if (!tab.length) return;
    const [cab, ...corpo] = tab;
    el.push(<div className="tw" key={"t" + n++}><table><thead><tr>{cab.map((c, i) => <th key={i}>{inline(c, "h" + i)}</th>)}</tr></thead>
      <tbody>{corpo.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{inline(c, `c${i}-${j}`)}</td>)}</tr>)}</tbody></table></div>);
    tab = [];
  };
  for (const bruta of texto.split("\n")) {
    const s = bruta.trim();
    if (s.startsWith("|")) {
      const c = s.replace(/^\||\|$/g, "").split("|").map((x) => x.trim());
      if (!c.every((x) => /^:?-{2,}:?$/.test(x))) tab.push(c);
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
