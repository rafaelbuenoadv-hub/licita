import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api, brl } from "../api";
import { TRILHA_PROCESSO, VIAS, type EtapaNaTrilha } from "../../../shared/etapas";
import { tem, useEu } from "../main";

const SIT: Record<string, [string, string]> = { preparacao: ["Em preparo", "cur"], concluido: ["Preparação pela secretaria concluída", "ok"], cancelado: ["Cancelado", "bad"] };

const situacaoInterna = (p: { situacao: string; concluido: boolean }) => p.situacao === "cancelado" ? "cancelado" : p.concluido ? "concluido" : "preparacao";

export function Processos() {
  const { eu } = useEu();
  const [params, setParams] = useSearchParams();
  const ano = params.get("ano") ?? String(new Date().getFullYear());
  const etapa = TRILHA_PROCESSO.some((e) => e.id === params.get("etapa")) ? params.get("etapa")! : "";
  const situacao = Object.hasOwn(SIT, params.get("situacao") ?? "") ? params.get("situacao")! : "";
  const filtrar = (chave: "ano" | "etapa" | "situacao", valor: string) => {
    const proximos = new URLSearchParams(params);
    proximos.set(chave, valor);
    setParams(proximos, { replace: true });
  };
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
  useEffect(() => {
    let ativo = true;
    setLista(null);
    api.get<any[]>(`/processos${ano ? `?${new URLSearchParams({ ano })}` : ""}`)
      .then((dados) => { if (ativo) setLista(dados); })
      .catch((erro) => {
        if (ativo) {
          setLista([]);
          setAviso({ mensagem: erro.message, erro: true });
        }
      });
    return () => { ativo = false; };
  }, [ano]);
  const f = (lista ?? []).filter((p) => !situacao || situacaoInterna(p) === situacao).filter((p) => !etapa || p.trilha.atual.id === etapa).filter((p) => !busca || `${p.protocolo} ${p.numero} ${p.objeto} ${p.procedimento} ${p.requisitante} ${p.areas_adicionais?.join(" ") ?? ""}`.toLowerCase().includes(busca.toLowerCase()));
  return (
    <>
      <div className="row"><h1>Processos</h1>{podeEditar && <Link className="btn pri" to="/processos/novo">Novo processo</Link>}</div>
      <div className="tools">
        <label className="campo" style={{ width: 120 }}>Exercício<select id="f-ano" value={ano} onChange={(e) => filtrar("ano", e.target.value)}>
          <option value="">Todos</option>{[0, 1, 2, 3].map((k) => { const a = new Date().getFullYear() + 1 - k; return <option key={a}>{a}</option>; })}</select></label>
        <label className="campo">Etapa atual<select value={etapa} onChange={(e) => filtrar("etapa", e.target.value)}>
          <option value="">Todas</option>
          {TRILHA_PROCESSO.map((e) => <option key={e.id} value={e.id}>{e.numero}. {e.nome}</option>)}
        </select></label>
        <label className="campo">Situação<select value={situacao} onChange={(e) => filtrar("situacao", e.target.value)}>
          <option value="">Todas</option>
          {Object.entries(SIT).map(([chave, [rotulo]]) => <option key={chave} value={chave}>{rotulo}</option>)}
        </select></label>
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
        {lista === null ? <p className="pad muted">Carregando…</p> : f.length === 0 ? <p className="pad muted">Nenhum processo{busca || etapa || situacao ? " com esses filtros" : " neste exercício"}.</p> :
          <div className="tw"><table className="t">
            <thead><tr><th>Protocolo</th><th>Objeto</th><th>Forma</th><th className="r">Valor estimado</th><th>Andamento</th><th>Situação</th>{podeEditar && <th>Ações</th>}</tr></thead>
            <tbody>{f.map((p) => (
              <tr key={p.id} className="link" onClick={() => nav(`/processos/${p.id}`)}>
                <td className="mono">{p.protocolo}<div className="small muted">{[p.numero && `PA ${p.numero}`, p.procedimento].filter(Boolean).join(" · ")}</div></td>
                <td style={{ minWidth: 240 }}>{p.objeto}</td>
                <td className="small">{VIAS[p.via as keyof typeof VIAS]}</td>
                <td className="r">{brl(p.valor_estimado)}</td>
                <td><span className="bar" aria-hidden>{p.trilha.etapas.map((e: EtapaNaTrilha) => <i key={e.id} className={e.estado === "concluida" ? "ok" : e.estado === "atual" && !p.concluido ? "cur" : ""} />)}</span>
                  <div className="small muted">{p.concluido ? "Etapas concluídas" : `${p.trilha.atual.numero}. ${p.trilha.atual.nome}`}</div></td>
                <td><span className={"pill " + SIT[situacaoInterna(p)][1]}>{SIT[situacaoInterna(p)][0]}</span></td>
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
