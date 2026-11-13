import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { api, dataHora } from "../api";

interface Msg {
  id: number; assunto: string; texto: string; criado_em: string; lida_em: string | null;
  processo_id: number | null; processo_protocolo: string | null;
  de_id: number; de_nome: string; de_cargo: string; para_id: number; para_nome: string; para_cargo: string;
}
interface Pessoa { id: number; nome: string; cargo: string }
type Caixa = "entrada" | "enviadas";
const novoRascunho = () => ({ para: [] as number[], assunto: "", texto: "" });

export function Mensagens() {
  const [caixa, setCaixa] = useState<Caixa>("entrada");
  const [lista, setLista] = useState<Msg[] | null>(null);
  const [sel, setSel] = useState<Msg | null>(null);
  const [pessoas, setPessoas] = useState<Pessoa[]>([]);
  const [rasc, setRasc] = useState<ReturnType<typeof novoRascunho> | null>(null);
  const [aviso, setAviso] = useState<{ t: string; tipo?: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const carregar = useCallback(async (c: Caixa) => {
    try { setLista(await api.get<Msg[]>(`/mensagens?caixa=${c}`)); }
    catch (e: any) { setAviso({ t: e.message, tipo: "bad" }); setLista([]); }
  }, []);
  useEffect(() => { setLista(null); setSel(null); carregar(caixa); }, [caixa, carregar]);
  useEffect(() => { api.get<Pessoa[]>("/mensagens/destinatarios").then(setPessoas).catch(() => {}); }, []);

  const abrir = async (m: Msg) => {
    setSel(m); setRasc(null);
    if (caixa === "entrada" && !m.lida_em) {
      await api.post(`/mensagens/${m.id}/lida`).catch(() => {});
      setLista((l) => l && l.map((x) => (x.id === m.id ? { ...x, lida_em: new Date().toISOString() } : x)));
      window.dispatchEvent(new Event("licita:mensagens"));
    }
  };
  const responder = (m: Msg) => {
    setRasc({ para: [m.de_id], assunto: /^re:/i.test(m.assunto) ? m.assunto : `Re: ${m.assunto}`, texto: `\n\n--- Em ${dataHora(m.criado_em)}, ${m.de_nome} escreveu ---\n${m.texto}` });
    setSel(null);
  };
  const enviar = async (ev: FormEvent) => {
    ev.preventDefault();
    if (!rasc) return;
    if (rasc.para.length === 0) return setAviso({ t: "Escolha ao menos um destinatário.", tipo: "bad" });
    setBusy(true);
    try {
      const r = await api.post("/mensagens", rasc);
      setRasc(null);
      setAviso({ t: r.enviadas === 1 ? "Mensagem enviada." : `Mensagem enviada a ${r.enviadas} pessoas.`, tipo: "ok" });
      if (caixa === "enviadas") await carregar("enviadas");
    } catch (e: any) { setAviso({ t: e.message, tipo: "bad" }); }
    finally { setBusy(false); }
  };

  const naoLidas = caixa === "entrada" ? (lista ?? []).filter((m) => !m.lida_em).length : 0;
  return (
    <>
      <div className="row"><div><span className="lbl">Comunicação interna</span><h1>Mensagens</h1></div>
        <button className="btn pri" onClick={() => { setRasc(novoRascunho()); setSel(null); }}>Nova mensagem</button></div>
      {aviso && <p className={"note " + (aviso.tipo ?? "")}>{aviso.t} <button className="lnk" onClick={() => setAviso(null)}>Fechar</button></p>}
      <div className="tools" role="tablist" aria-label="Caixas">
        <button role="tab" aria-selected={caixa === "entrada"} className={"btn" + (caixa === "entrada" ? " pri" : "")} onClick={() => setCaixa("entrada")}>Recebidas{naoLidas > 0 ? ` (${naoLidas})` : ""}</button>
        <button role="tab" aria-selected={caixa === "enviadas"} className={"btn" + (caixa === "enviadas" ? " pri" : "")} onClick={() => setCaixa("enviadas")}>Enviadas</button>
      </div>
      <div className="caixa">
        <section className="panel lista" aria-label={caixa === "entrada" ? "Mensagens recebidas" : "Mensagens enviadas"}>
          {lista === null ? <p className="pad muted">Carregando…</p> : lista.length === 0 ? <p className="pad muted">{caixa === "entrada" ? "Nenhuma mensagem recebida." : "Nenhuma mensagem enviada."}</p> :
            lista.map((m) => (
              <button key={m.id} className={`mi${sel?.id === m.id ? " sel" : ""}${caixa === "entrada" && !m.lida_em ? " nova" : ""}`} onClick={() => abrir(m)}>
                <span className="qm"><span>{caixa === "entrada" ? m.de_nome : `Para ${m.para_nome}`}</span><span className="muted">{dataHora(m.criado_em)}</span></span>
                <span className="as">{m.assunto}</span>
                {caixa === "enviadas" && <span className="small muted">{m.lida_em ? `Lida em ${dataHora(m.lida_em)}` : "Ainda não lida"}</span>}
              </button>))}
        </section>

        {rasc ? (
          <form className="panel pad stack" onSubmit={enviar}>
            <h2>Nova mensagem</h2>
            {pessoas.length === 0 ? <p className="note">Ainda não há outros usuários ativos neste órgão. O administrador cadastra os usuários em Configurações.</p> : <>
              <label className="campo">Para (segure Ctrl para escolher mais de uma pessoa)
                <select id="m-para" multiple value={rasc.para.map(String)} onChange={(e) => setRasc({ ...rasc, para: [...e.target.selectedOptions].map((o) => Number(o.value)) })}>
                  {pessoas.map((u) => <option key={u.id} value={u.id}>{u.nome}{u.cargo ? ` — ${u.cargo}` : ""}</option>)}</select></label>
              <label className="campo">Assunto<input id="m-assunto" value={rasc.assunto} onChange={(e) => setRasc({ ...rasc, assunto: e.target.value })} required maxLength={200} /></label>
              <label className="campo">Mensagem<textarea id="m-texto" value={rasc.texto} onChange={(e) => setRasc({ ...rasc, texto: e.target.value })} required maxLength={20000} style={{ minHeight: 200 }} /></label>
              <div className="tools"><button className="btn pri" disabled={busy}>{busy ? "Enviando…" : "Enviar"}</button><button type="button" className="btn" onClick={() => setRasc(null)}>Descartar</button></div>
            </>}
          </form>
        ) : sel ? (
          <article className="panel pad stack">
            <div className="row"><h2>{sel.assunto}</h2>{caixa === "entrada" && <button className="btn" onClick={() => responder(sel)}>Responder</button>}</div>
            <p className="small muted">De {sel.de_nome}{sel.de_cargo ? ` (${sel.de_cargo})` : ""} para {sel.para_nome}{sel.para_cargo ? ` (${sel.para_cargo})` : ""} · {dataHora(sel.criado_em)}
              {sel.processo_id && <> · <Link to={`/processos/${sel.processo_id}`}>Processo {sel.processo_protocolo}</Link></>}</p>
            <p className="corpo">{sel.texto}</p>
          </article>
        ) : <section className="panel pad"><p className="muted">Escolha uma mensagem na lista ou escreva uma nova.</p></section>}
      </div>
    </>
  );
}
