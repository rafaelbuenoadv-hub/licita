import { useEffect, useRef, useState } from "react";
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
  const [exclusao, confirmarExclusao] = useState<{ id: number; protocolo: string; objeto: string } | null>(null);
  const [excluindo, setExcluindo] = useState(false);
  const painelExclusao = useRef<HTMLHeadingElement>(null);
  const [aviso, setAviso] = useState<{ mensagem: string; erro?: boolean }>();
  const podeEditar = tem(eu, "requisitante", "contratacao");
  const podeExcluir = tem(eu, "contratacao");
  const excluir = async () => {
    if (!exclusao || excluindo) return;
    setExcluindo(true);
    setAviso(undefined);
    try {
      await api.del(`/processos/${exclusao.id}`);
      setLista((lista) => lista?.filter((p) => p.id !== exclusao.id) ?? null);
      confirmarExclusao(null);
      setAviso({ mensagem: "Processo excluído da lista." });
    } catch (e) {
      setAviso({ mensagem: e instanceof Error ? e.message : "Não foi possível excluir o processo.", erro: true });
    } finally { setExcluindo(false); }
  };
  const nav = useNavigate();
  useEffect(() => {
    if (!exclusao) return;
    painelExclusao.current?.scrollIntoView({ block: "center" });
    painelExclusao.current?.focus({ preventScroll: true });
  }, [exclusao]);
  useEffect(() => { setLista(null); api.get(`/processos${ano ? `?ano=${ano}` : ""}`).then(setLista); }, [ano]);
  const f = (lista ?? []).filter((p) => !busca || `${p.protocolo} ${p.numero} ${p.objeto} ${p.procedimento} ${p.requisitante} ${p.areas_adicionais?.join(" ") ?? ""}`.toLowerCase().includes(busca.toLowerCase()));
  return (
    <>
      <div className="row"><h1>Processos</h1>{podeEditar && <Link className="btn pri" to="/processos/novo">Novo processo</Link>}</div>
      <div className="tools">
        <label className="campo" style={{ width: 120 }}>Exercício<select id="f-ano" value={ano} onChange={(e) => setAno(e.target.value)}>
          <option value="">Todos</option>{[0, 1, 2, 3].map((k) => { const a = new Date().getFullYear() + 1 - k; return <option key={a}>{a}</option>; })}</select></label>
        <label className="campo" style={{ flex: 1, minWidth: 220 }}>Buscar<input id="f-busca" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="protocolo, objeto, área" /></label>
      </div>
      {aviso && <p className={`note ${aviso.erro ? "bad" : "ok"}`} role={aviso.erro ? "alert" : "status"}>{aviso.mensagem}</p>}
      {exclusao && <section className="panel pad stack" aria-labelledby="confirmar-exclusao">
        <h2 ref={painelExclusao} id="confirmar-exclusao" tabIndex={-1}>Excluir processo {exclusao.protocolo}</h2>
        <p>{exclusao.objeto}. O processo sairá da lista. O registro será preservado no histórico.</p>
        <div className="tools">
          <button type="button" className="btn danger" disabled={excluindo} onClick={excluir}>{excluindo ? "Excluindo…" : "Confirmar exclusão"}</button>
          <button type="button" className="btn" disabled={excluindo} onClick={() => confirmarExclusao(null)}>Cancelar</button>
        </div>
      </section>}
      <section className="panel">
        {lista === null ? <p className="pad muted">Carregando…</p> : f.length === 0 ? <p className="pad muted">Nenhum processo{busca ? " com essa busca" : " neste exercício"}. Use "Novo processo" para abrir o primeiro.</p> :
          <div className="tw"><table className="t">
            <thead><tr><th>Protocolo</th><th>Objeto</th><th>Forma</th><th className="r">Valor estimado</th><th>Andamento</th><th>Situação</th>{podeEditar && <th>Ações</th>}</tr></thead>
            <tbody>{f.map((p) => (
              <tr key={p.id} className="link" onClick={() => nav(`/processos/${p.id}`)}>
                <td className="mono">{p.protocolo}<div className="small muted">{[p.numero && `PA ${p.numero}`, p.procedimento].filter(Boolean).join(" · ")}</div></td>
                <td style={{ minWidth: 240 }}>{p.objeto}</td>
                <td className="small">{VIAS[p.via as keyof typeof VIAS]}</td>
                <td className="r">{brl(p.valor_estimado)}</td>
                <td><span className="bar" aria-hidden>{p.feitas.map((ok: boolean, i: number) => <i key={i} className={ok ? "ok" : i === p.etapa_atual && !p.concluido ? "cur" : ""} />)}</span>
                  <div className="small muted">{p.concluido ? "Etapas concluídas" : `${p.etapa_atual + 2}. ${ETAPAS[p.etapa_atual].nome}`}</div></td>
                <td><span className={"pill " + SIT[p.situacao][1]}>{SIT[p.situacao][0]}</span></td>
                {podeEditar && <td onClick={(e) => e.stopPropagation()}><div className="tools">
                  <Link className="btn sm" to={`/processos/${p.id}?editar=1`} aria-label={`Editar processo ${p.protocolo}`}>Editar</Link>
                  {podeExcluir && <button type="button" className="btn sm danger" disabled={excluindo}
                    aria-label={`Excluir processo ${p.protocolo}`} onClick={() => { confirmarExclusao(p); setAviso(undefined); }}>Excluir</button>}
                </div></td>}
              </tr>))}</tbody>
          </table></div>}
      </section>
    </>
  );
}
