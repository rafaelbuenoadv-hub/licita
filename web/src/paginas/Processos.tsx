import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, brl } from "../api";
import { ETAPAS, VIAS } from "../../../shared/etapas";
import { tem, useEu } from "../main";

const SIT: Record<string, [string, string]> = { preparacao: ["Em preparo", "cur"], publicado: ["Publicado", "ok"], contratado: ["Contratado", "ok"], cancelado: ["Cancelado", "bad"] };

export function Processos() {
  const { eu } = useEu();
  const [ano, setAno] = useState(String(new Date().getFullYear()));
  const [lista, setLista] = useState<any[] | null>(null);
  const [busca, setBusca] = useState("");
  const nav = useNavigate();
  useEffect(() => { setLista(null); api.get(`/processos${ano ? `?ano=${ano}` : ""}`).then(setLista); }, [ano]);
  const f = (lista ?? []).filter((p) => !busca || `${p.protocolo} ${p.numero} ${p.objeto} ${p.procedimento} ${p.requisitante}`.toLowerCase().includes(busca.toLowerCase()));
  return (
    <>
      <div className="row"><h1>Processos</h1>{tem(eu, "requisitante", "contratacao") && <Link className="btn pri" to="/processos/novo">Novo processo</Link>}</div>
      <div className="tools">
        <label className="campo" style={{ width: 120 }}>Exercício<select id="f-ano" value={ano} onChange={(e) => setAno(e.target.value)}>
          <option value="">Todos</option>{[0, 1, 2, 3].map((k) => { const a = new Date().getFullYear() + 1 - k; return <option key={a}>{a}</option>; })}</select></label>
        <label className="campo" style={{ flex: 1, minWidth: 220 }}>Buscar<input id="f-busca" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="protocolo, objeto, área" /></label>
      </div>
      <section className="panel">
        {lista === null ? <p className="pad muted">Carregando…</p> : f.length === 0 ? <p className="pad muted">Nenhum processo{busca ? " com essa busca" : " neste exercício"}. Use "Novo processo" para abrir o primeiro.</p> :
          <div className="tw"><table className="t">
            <thead><tr><th>Protocolo</th><th>Objeto</th><th>Forma</th><th className="r">Valor estimado</th><th>Andamento</th><th>Situação</th></tr></thead>
            <tbody>{f.map((p) => (
              <tr key={p.id} className="link" onClick={() => nav(`/processos/${p.id}`)}>
                <td className="mono">{p.protocolo}<div className="small muted">{[p.numero && `PA ${p.numero}`, p.procedimento].filter(Boolean).join(" · ")}</div></td>
                <td style={{ minWidth: 240 }}>{p.objeto}</td>
                <td className="small">{VIAS[p.via as keyof typeof VIAS]}</td>
                <td className="r">{brl(p.valor_estimado)}</td>
                <td><span className="bar" aria-hidden>{p.feitas.map((ok: boolean, i: number) => <i key={i} className={ok ? "ok" : i === p.etapa_atual && !p.concluido ? "cur" : ""} />)}</span>
                  <div className="small muted">{p.concluido ? "Etapas concluídas" : `${p.etapa_atual + 1}. ${ETAPAS[p.etapa_atual].nome}`}</div></td>
                <td><span className={"pill " + SIT[p.situacao][1]}>{SIT[p.situacao][0]}</span></td>
              </tr>))}</tbody>
          </table></div>}
      </section>
    </>
  );
}
