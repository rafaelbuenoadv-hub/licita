import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { api, brl, dataBR, dataHora, fluxo, fmtNum } from "../api";
import { Folha } from "../comp/Folha";
import { ETAPAS, TIPOS, VIAS, feita, feitos, itensDe, liberada, pendencias, podeMarcar, type Checks } from "../../../shared/etapas";
import { tem, useEu } from "../main";
import { CamposProcesso, paraApi, type DadosProc } from "./NovoProcesso";

const ACOES: Record<string, string> = {
  "processo.criado": "abriu o processo", "processo.alterado": "alterou os dados", "processo.situacao": "mudou a situação",
  "item.marcado": "conferiu item", "item.desmarcado": "desmarcou item", "minuta.salva": "salvou minuta", "minuta.ia": "gerou minuta com IA",
  "minuta.pendencias": "preencheu campos pendentes", "anexo.incluido": "anexou documento", "anexo.removido": "removeu documento",
  "ia.sugestoes": "pediu sugestões à IA", "contrato.criado": "registrou contrato",
};

export function ProcessoPg() {
  const { id } = useParams();
  const { eu, ia } = useEu();
  const [p, setP] = useState<any>(null);
  const [erro, setErro] = useState("");
  const [et, setEt] = useState<string | null>(null);
  const [aviso, setAviso] = useState<{ t: string; tipo?: string } | null>(null);

  const carregar = useCallback(async () => {
    try { const r = await api.get(`/processos/${id}`); setP(r); return r; }
    catch (e: any) { setErro(e.message); }
  }, [id]);
  useEffect(() => { carregar().then((r) => r && setEt((x) => x ?? ETAPAS[r.etapa_atual].id)); }, [carregar]);

  if (erro) return <p className="note bad">{erro}</p>;
  if (!p || !et) return <p className="muted">Carregando processo…</p>;
  const checks: Checks = Object.fromEntries(p.checagens.map((c: any) => [c.item, true]));
  const ix = ETAPAS.findIndex((e) => e.id === et);
  const e = ETAPAS[ix];

  return (
    <>
      <div className="row">
        <div className="stack" style={{ gap: 2 }}>
          <span className="lbl mono">{[p.numero && `PA ${p.numero}`, p.procedimento].filter(Boolean).join(" · ") || "Processo"}</span>
          <h1>{p.objeto}</h1>
          <span className="small muted">{[TIPOS[p.tipo as keyof typeof TIPOS], VIAS[p.via as keyof typeof VIAS], brl(p.valor_estimado), `Exercício ${p.ano}`].join(" · ")}</span>
        </div>
        <div className="tools">
          {p.situacao !== "preparacao" && <span className={"pill " + (p.situacao === "cancelado" ? "bad" : "ok")}>{{ publicado: "Publicado", contratado: "Contratado", cancelado: "Cancelado" }[p.situacao as string]}</span>}
          <Link className="btn" to="/processos">Todos os processos</Link>
        </div>
      </div>
      {aviso && <p className={"note " + (aviso.tipo ?? "")}>{aviso.t} <button className="lnk" onClick={() => setAviso(null)}>Fechar</button></p>}
      <Dados p={p} recarregar={carregar} setAviso={setAviso} />

      <div className="mesa">
        <nav className="panel trilha" aria-label="Etapas">
          {ETAPAS.map((x, i) => {
            const f = feita(x, p, checks), l = liberada(i, p, checks);
            const c = f ? "ok" : i === p.etapa_atual ? "cur" : l ? "" : "lock";
            return (
              <button key={x.id} className={`et ${c}${i === ix ? " sel" : ""}`} onClick={() => setEt(x.id)} title={x.nome} aria-current={i === ix ? "step" : undefined}>
                <span className="n">{f ? "✓" : i + 1}</span>
                <span className="tx"><span className="nm">{x.nome}</span><br /><span className="st">{f ? "Concluída" : l ? `${feitos(x, p, checks)} de ${itensDe(x, p).length} itens` : "Bloqueada"}</span></span>
              </button>);
          })}
        </nav>
        <Etapa key={e.id} p={p} e={e} ix={ix} checks={checks} recarregar={carregar} setAviso={setAviso} irPara={setEt} />
        <Assistente key={"c" + p.id} p={p} etapa={e.id} disponivel={ia.disponivel} />
      </div>

      <Anexos p={p} recarregar={carregar} podeIncluir={tem(eu, "requisitante", "contratacao", "juridico")} />
      <Historico id={p.id} versao={p.checagens.length + (p.minutas?.length ?? 0)} />
    </>
  );
}

/* ---------- dados do processo ---------- */
function Dados({ p, recarregar, setAviso }: { p: any; recarregar: () => Promise<any>; setAviso: (a: any) => void }) {
  const { eu } = useEu();
  const [d, setD] = useState<DadosProc>(() => ({
    numero: p.numero, procedimento: p.procedimento, requisitante: p.requisitante, objeto: p.objeto, tipo: p.tipo, via: p.via,
    valor: fmtNum(p.valor_estimado), classe: p.classe, ano: String(p.ano), pca_item_id: p.pca_item_id ? String(p.pca_item_id) : "", normas: p.normas, obs: p.obs,
  }));
  const [pca, setPca] = useState<any[]>([]);
  const [confirma, setConfirma] = useState(false);
  useEffect(() => { api.get(`/pca?ano=${d.ano}`).then((r) => setPca(r.itens)).catch(() => {}); }, [d.ano]);
  const salvar = async (ev: FormEvent) => {
    ev.preventDefault();
    try { await api.put(`/processos/${p.id}`, paraApi(d)); await recarregar(); setAviso({ t: "Dados do processo salvos.", tipo: "ok" }); }
    catch (e: any) { setAviso({ t: e.message, tipo: "bad" }); }
  };
  const situacao = async (s: string) => {
    try { await api.post(`/processos/${p.id}/situacao`, { situacao: s }); setConfirma(false); await recarregar(); }
    catch (e: any) { setAviso({ t: e.message, tipo: "bad" }); }
  };
  const pode = tem(eu, "requisitante", "contratacao");
  return (
    <details className="panel box">
      <summary>Dados do processo</summary>
      <form className="pad stack" onSubmit={salvar}>
        <fieldset disabled={!pode} style={{ border: 0, padding: 0, margin: 0 }}><CamposProcesso d={d} set={setD} pca={pca} /></fieldset>
        <p className="small muted">Mudar o tipo de objeto ou a forma de contratação altera os itens de conferência; marcações que deixarem de existir são removidas.</p>
        <div className="tools">
          {pode && <button className="btn pri">Salvar dados</button>}
          {tem(eu, "contratacao", "autoridade") && p.concluido && p.situacao === "preparacao" && <button type="button" className="btn" onClick={() => situacao("publicado")}>Marcar como publicado</button>}
          {tem(eu, "contratacao", "autoridade") && p.situacao !== "cancelado" && (confirma
            ? <><button type="button" className="btn danger" onClick={() => situacao("cancelado")}>Confirmar cancelamento</button><button type="button" className="btn" onClick={() => setConfirma(false)}>Voltar</button></>
            : <button type="button" className="btn danger sm" onClick={() => setConfirma(true)}>Cancelar processo</button>)}
          {tem(eu, "contratacao", "autoridade") && p.situacao === "cancelado" && <button type="button" className="btn" onClick={() => situacao("preparacao")}>Reabrir processo</button>}
        </div>
      </form>
    </details>
  );
}

/* ---------- etapa aberta ---------- */
function Etapa({ p, e, ix, checks, recarregar, setAviso, irPara }: any) {
  const { eu } = useEu();
  const lib = liberada(ix, p, checks), ok = feita(e, p, checks), its = itensDe(e, p), nf = feitos(e, p, checks);
  const atua = podeMarcar(eu.papeis, e);
  const quem = Object.fromEntries(p.checagens.map((c: any) => [c.item, c]));
  const [salvando, setSalvando] = useState<string | null>(null);
  const marcar = async (item: string, marcado: boolean) => {
    setSalvando(item);
    try { await api.post(`/processos/${p.id}/checagens`, { item, marcado }); await recarregar(); }
    catch (er: any) { setAviso({ t: er.message, tipo: "bad" }); }
    finally { setSalvando(null); }
  };
  const prox = ETAPAS[ix + 1];
  return (
    <section className="panel" style={{ minWidth: 0 }}>
      <div className="sec">
        <div className="row"><div><span className="lbl">Etapa {ix + 1} de {ETAPAS.length}</span><h2>{e.nome}</h2></div>
          <span className={"pill " + (ok ? "ok" : lib ? "cur" : "")}>{ok ? "Concluída" : lib ? `${nf} de ${its.length} itens` : "Bloqueada"}</span></div>
        {e.doc && <p className="small muted">Documento da etapa: {e.doc}</p>}
        <p style={{ maxWidth: "72ch" }}>{e.oque}</p>
        <div className="base">{e.base.map((b: any) => b.url ? <a key={b.rotulo} href={b.url} target="_blank" rel="noopener">{b.rotulo}</a> : <span key={b.rotulo}>{b.rotulo}</span>)}</div>
        {!lib && <p className="note">Conclua a etapa "{ETAPAS[p.etapa_atual].nome}" para liberar esta.</p>}
        {lib && !atua && <p className="note">Seu perfil acompanha esta etapa, mas quem marca os itens é: {e.papeis.join(", ")}.</p>}
      </div>
      <div className="sec"><span className="lbl">Conferência obrigatória</span>
        <ul className="chk">{its.map((i: any) => {
          const q = quem[i.id];
          return (
            <li key={i.id} className={q ? "done" : ""}>
              <input type="checkbox" id={"c-" + i.id} checked={!!q} disabled={!lib || !atua || salvando !== null || p.situacao === "cancelado"} onChange={(ev) => marcar(i.id, ev.target.checked)} />
              <label htmlFor={"c-" + i.id}><span>{i.texto}</span>
                <span className="b">{[i.base, q && `conferido por ${q.usuario ?? "—"} em ${dataHora(q.em)}`].filter(Boolean).join(" · ")}</span></label>
            </li>);
        })}</ul>
      </div>
      {e.id === "precos" && p.via === "dispensa" && <Fracionamento id={p.id} />}
      <div className="sec"><span className="lbl">Erros que costumam voltar do jurídico</span>
        <ul className="aten">{e.atencao.map((a: string) => <li key={a}>{a}</li>)}</ul></div>
      {e.modelo && <Minuta p={p} e={e} editavel={lib && atua && p.situacao !== "cancelado"} setAviso={setAviso} />}
      <div className="sec row">
        {ix > 0 ? <button className="btn" onClick={() => irPara(ETAPAS[ix - 1].id)}>← {ETAPAS[ix - 1].nome}</button> : <span />}
        {prox ? <button className="btn pri" disabled={!ok} onClick={() => irPara(prox.id)}>{ok ? "" : `Faltam ${its.length - nf} · `}{prox.nome} →</button>
          : <span className={"pill " + (ok ? "ok" : "")}>{ok ? "Fase preparatória concluída" : "Última etapa"}</span>}
      </div>
    </section>
  );
}

function Fracionamento({ id }: { id: number }) {
  const [d, setD] = useState<any>(null);
  useEffect(() => { api.get(`/processos/${id}/fracionamento`).then(setD).catch(() => {}); }, [id]);
  if (!d?.classe) return null;
  const c = d.classe;
  return (
    <div className="sec"><span className="lbl">Somatório do exercício (art. 75, § 1º)</span>
      <p>Dispensas por valor de "{c.classe}" no exercício: <b className="num">{brl(c.dispensas)}</b>
        {c.limite != null ? <> · limite do inciso {c.inciso}: <b className="num">{brl(c.limite)}</b> <span className="small muted">({c.limite_fonte})</span></> : <> · limite do inciso {c.inciso} não cadastrado para o exercício</>}</p>
      {c.alerta === "excede" && <p className="note bad">O somatório passa do limite: há risco de fracionamento. Reavalie a forma de contratação.</p>}
      {c.alerta === "planejado_excede" && <p className="note">O planejado no PCA para esta natureza passa do limite. Justifique por que esta contratação não fraciona a despesa.</p>}
      {d.outros.length > 0 && <p className="small muted">Outras dispensas da mesma natureza: {d.outros.map((o: any) => `${o.numero || "s/nº"} (${brl(o.valor_estimado)})`).join("; ")}.</p>}
    </div>
  );
}

/* ---------- minuta ---------- */
function Minuta({ p, e, editavel, setAviso }: { p: any; e: any; editavel: boolean; setAviso: (a: any) => void }) {
  const { ia } = useEu();
  const [m, setM] = useState<{ vigente: any; versoes: any[] } | null>(null);
  const [modo, setModo] = useState<"ver" | "editar">("ver");
  const [rascunho, setRascunho] = useState("");
  const [vendo, setVendo] = useState<any>(null); // versão antiga em exibição
  const [gerando, setGerando] = useState("");
  const [busy, setBusy] = useState<"" | "redigir" | "salvar" | "sugerir" | "aplicar">("");
  const [confirma, setConfirma] = useState(false);
  const [orient, setOrient] = useState("");
  const [vals, setVals] = useState<Record<string, string>>({});
  const [sug, setSug] = useState<Record<string, any>>({});
  const ctl = useRef<AbortController | null>(null);

  const carregar = useCallback(async () => {
    const r = await api.get(`/processos/${p.id}/minutas/${e.id}`);
    setM(r); setRascunho(r.vigente?.texto ?? ""); setVendo(null); setVals({}); setSug({});
  }, [p.id, e.id]);
  useEffect(() => { carregar(); return () => ctl.current?.abort(); }, [carregar]);
  if (!m) return <div className="sec"><p className="muted">Carregando minuta…</p></div>;

  const texto = m.vigente?.texto ?? "";
  const pend = pendencias(texto);
  const redigir = async () => {
    setConfirma(false); setBusy("redigir"); setGerando(""); setModo("ver");
    ctl.current = new AbortController();
    try {
      const r = await fluxo(`/processos/${p.id}/ia/redigir`, { etapa: e.id, orientacao: orient }, setGerando, ctl.current.signal);
      await carregar();
      setAviso(r.truncado ? { t: "A minuta foi cortada pelo limite de tamanho. Peça ao assistente a continuação das seções finais." } : { t: `Minuta redigida pela IA e salva como versão ${r.versao}. Revise antes de usar.`, tipo: "ok" });
    } catch (er: any) { if (er.name !== "AbortError") setAviso({ t: er.message, tipo: "bad" }); }
    finally { setBusy(""); setGerando(""); }
  };
  const salvar = async (t: string, msg: string) => {
    setBusy("salvar");
    try { const r = await api.post(`/processos/${p.id}/minutas/${e.id}`, { texto: t }); await carregar(); setModo("ver"); setAviso({ t: r.nova ? `${msg} (versão ${r.versao}).` : "Nada mudou desde a última versão.", tipo: "ok" }); }
    catch (er: any) { setAviso({ t: er.message, tipo: "bad" }); }
    finally { setBusy(""); }
  };
  const sugerir = async () => {
    setBusy("sugerir");
    try {
      const r = await api.post(`/processos/${p.id}/ia/sugerir`, { etapa: e.id });
      if (r.versao !== m.vigente.versao) { await carregar(); throw new Error("A minuta mudou enquanto a IA trabalhava. Peça as sugestões de novo."); }
      const s: Record<string, any> = {}, v = { ...vals };
      let n = 0;
      for (const x of r.sugestoes) { s[x.i] = x; if (x.valor) { n++; if (!v[x.i]?.trim()) v[x.i] = x.valor; } }
      setSug(s); setVals(v);
      setAviso({ t: `A IA sugeriu ${n} de ${pend.length} campos. Confira cada sugestão e clique em "Aplicar na minuta".`, tipo: "ok" });
    } catch (er: any) { setAviso({ t: er.message, tipo: "bad" }); }
    finally { setBusy(""); }
  };
  const aplicar = async () => {
    setBusy("aplicar");
    try { const r = await api.post(`/processos/${p.id}/minutas/${e.id}/pendencias`, { versao: m.vigente.versao, valores: vals }); await carregar(); setAviso({ t: `${r.aplicados} ${r.aplicados > 1 ? "campos aplicados" : "campo aplicado"} (versão ${r.versao}).`, tipo: "ok" }); }
    catch (er: any) { setAviso({ t: er.message, tipo: "bad" }); }
    finally { setBusy(""); }
  };
  const verVersao = async (v: string) => {
    if (!v || Number(v) === m.vigente?.versao) return setVendo(null);
    setVendo(await api.get(`/processos/${p.id}/minutas/${e.id}/versoes/${v}`));
  };

  const exibido = busy === "redigir" ? gerando : vendo ? vendo.texto : texto;
  return (
    <div className="sec">
      <div className="row"><span className="lbl">Minuta · {e.doc}</span>
        {m.vigente && <span className="small muted">Versão {m.vigente.versao} · {m.vigente.origem === "ia" ? "redigida pela IA" : m.vigente.origem === "pendencias" ? "campos preenchidos" : "edição manual"} · {m.vigente.autor ?? "—"} · {dataHora(m.vigente.criado_em)}</span>}</div>
      <div className="tools">
        {busy === "redigir" ? <><span className="small muted">Redigindo no layout do órgão…</span><button className="btn" onClick={() => ctl.current?.abort()}>Parar</button></>
          : confirma ? <><button className="btn pri" onClick={redigir}>Confirmar: gerar nova versão</button><button className="btn" onClick={() => setConfirma(false)}>Cancelar</button></>
          : <button className="btn pri" disabled={!editavel || !ia.disponivel || busy !== ""} onClick={() => (texto ? setConfirma(true) : redigir())}>{texto ? "Redigir de novo com IA" : "Redigir minuta com IA"}</button>}
        {busy !== "redigir" && <>
          <button className="btn" disabled={!editavel || !!vendo} onClick={() => { setModo(modo === "ver" ? "editar" : "ver"); setRascunho(texto); }}>{modo === "ver" ? "Editar texto" : "Ver na folha"}</button>
          {texto && <a className="btn" href={`/api/processos/${p.id}/minutas/${e.id}/docx${vendo ? `?versao=${vendo.versao}` : ""}`}>Baixar Word</a>}
          {m.versoes.length > 1 && <label className="campo" style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>Versão
            <select id="versao" value={vendo?.versao ?? m.vigente?.versao} onChange={(ev) => verVersao(ev.target.value)} style={{ width: "auto" }}>
              {m.versoes.map((v: any) => <option key={v.versao} value={v.versao}>{v.versao} · {dataBR(v.criado_em)}</option>)}</select></label>}
        </>}
      </div>
      {confirma && <label className="campo">Orientação para a IA (opcional)<input id="orient" value={orient} onChange={(ev) => setOrient(ev.target.value)} placeholder="ex.: incluir quadro de alternativas com pré-moldado" /></label>}
      {vendo && <p className="note">Você está vendo a versão {vendo.versao}. {editavel && <button className="lnk" onClick={() => salvar(vendo.texto, "Versão restaurada")}>Restaurar como versão atual</button>}</p>}
      {modo === "editar" && busy !== "redigir" ? <>
        <textarea className="edit" id="minuta-edit" value={rascunho} onChange={(ev) => setRascunho(ev.target.value)} spellCheck aria-label="Texto da minuta" />
        <p className="small muted">Marcação: "# " título, "## " seção, "| a | b |" quadro, "@ " assinatura, [[texto]] campo pendente.</p>
        <div className="tools"><button className="btn pri" disabled={busy !== ""} onClick={() => salvar(rascunho, "Minuta salva")}>Salvar nova versão</button>
          <button className="btn" onClick={() => { setModo("ver"); setRascunho(texto); }}>Descartar alterações</button></div>
      </> : <Folha texto={exibido} vazio={busy === "redigir" ? "Redigindo a minuta…" : "Nenhuma minuta ainda. Peça à IA para redigir ou escreva em \"Editar texto\"."} />}

      {!vendo && busy !== "redigir" && modo === "ver" && (pend.length > 0 ? (
        <div className="pend">
          <div className="row"><div><span className="lbl">Preencher com IA</span><h3>{pend.length} {pend.length > 1 ? "campos pendentes" : "campo pendente"}</h3></div>
            <div className="tools">
              <button className="btn sm" disabled={!editavel || !ia.disponivel || busy !== ""} onClick={sugerir}>{busy === "sugerir" ? "Procurando nas peças…" : "Sugerir com IA"}</button>
              <button className="btn sm pri" disabled={!editavel || busy !== ""} onClick={aplicar}>Aplicar na minuta</button></div></div>
          <p className="small muted">A IA procura os valores nas outras peças e nos documentos anexados ao processo. O que não constar fica vazio, com o setor que deve informar.</p>
          {pend.map((x) => {
            const s = sug[x.i];
            const [a, b] = x.trecho.split("▮");
            return (
              <div className="pf" key={x.i}>
                <label htmlFor={"pend-" + x.i}>{a}<mark>{x.rotulo}</mark>{b}</label>
                <input id={"pend-" + x.i} value={vals[x.i] ?? ""} onChange={(ev) => setVals({ ...vals, [x.i]: ev.target.value })} placeholder="Texto que substitui o campo" disabled={!editavel} autoComplete="off" />
                {s && (s.valor ? <span className="b sg">Sugestão da IA · {s.fonte || "dados do processo"}</span> : <span className="b falta">Não consta nos documentos · {s.falta || "informar"}</span>)}
              </div>);
          })}
        </div>) : texto ? <p className="small" style={{ color: "var(--accent)" }}>Nenhum campo pendente nesta minuta.</p> : null)}
    </div>
  );
}

/* ---------- assistente ---------- */
function Assistente({ p, etapa, disponivel }: { p: any; etapa: string; disponivel: boolean }) {
  const [msgs, setMsgs] = useState<{ role: "user" | "assistant"; content: string; err?: boolean }[]>([]);
  const [rasc, setRasc] = useState("");
  const [busy, setBusy] = useState(false);
  const ctl = useRef<AbortController | null>(null);
  const caixa = useRef<HTMLDivElement>(null);
  useEffect(() => { caixa.current?.scrollTo(0, caixa.current.scrollHeight); }, [msgs]);
  useEffect(() => () => ctl.current?.abort(), []);
  const enviar = async (texto: string) => {
    if (!texto.trim() || busy) return;
    const hist = [...msgs.filter((m) => !m.err), { role: "user" as const, content: texto.trim() }].slice(-20);
    setMsgs([...msgs, { role: "user", content: texto.trim() }, { role: "assistant", content: "" }]);
    setRasc(""); setBusy(true);
    ctl.current = new AbortController();
    const atualiza = (t: string, err = false) => setMsgs((ms) => [...ms.slice(0, -1), { role: "assistant", content: t, err }]);
    try {
      const r = await fluxo(`/processos/${p.id}/ia/chat`, { etapa, mensagens: hist }, (t) => atualiza(t), ctl.current.signal);
      atualiza(r.texto + (r.truncado ? "\n\n(Resposta cortada pelo limite de tamanho. Peça a continuação.)" : ""));
    } catch (er: any) {
      if (er.name === "AbortError") setMsgs((ms) => (ms.at(-1)?.content ? ms : ms.slice(0, -1)));
      else atualiza((er.texto ? er.texto + "\n\n" : "") + er.message, true);
    } finally { setBusy(false); }
  };
  const sub = (ev: FormEvent) => { ev.preventDefault(); enviar(rasc); };
  return (
    <aside className="panel chat" aria-label="Assistente">
      <div><h3>Assistente</h3><p className="small muted">Responde com os dados do processo, a etapa aberta, as minutas e os documentos anexados.</p></div>
      {!disponivel && <p className="note">A IA não está configurada neste servidor.</p>}
      <div className="msgs" ref={caixa} aria-live="polite">
        {msgs.map((m, i) => <div key={i} className={`msg ${m.role}${m.err ? " err" : ""}`}>{m.content || "Pensando…"}</div>)}
      </div>
      <div className="chips">{["O que falta nesta etapa?", "Confira a minuta desta etapa contra o checklist e aponte incoerências com as outras peças.", "Que documentos preciso juntar agora?"].map((q) =>
        <button key={q} className="chip" disabled={!disponivel || busy} onClick={() => enviar(q)}>{q.length > 40 ? "Conferir a minuta" : q}</button>)}</div>
      <form className="chatform" onSubmit={sub}>
        <textarea id="chat-in" value={rasc} onChange={(ev) => setRasc(ev.target.value)} placeholder="Pergunte ou cole um trecho para conferir" aria-label="Mensagem para o assistente"
          onKeyDown={(ev) => { if (ev.key === "Enter" && !ev.shiftKey) { ev.preventDefault(); enviar(rasc); } }} disabled={!disponivel} />
        {busy ? <button type="button" className="btn" onClick={() => ctl.current?.abort()}>Parar</button> : <button className="btn pri" disabled={!disponivel}>Enviar</button>}
      </form>
    </aside>
  );
}

/* ---------- anexos e histórico ---------- */
function Anexos({ p, recarregar, podeIncluir }: { p: any; recarregar: () => Promise<any>; podeIncluir: boolean }) {
  const [msg, setMsg] = useState<{ t: string; tipo?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const enviar = async (f: File | undefined) => {
    if (!f) return;
    setBusy(true); setMsg(null);
    try { const fd = new FormData(); fd.append("arquivo", f); const r = await api.post(`/processos/${p.id}/anexos`, fd); await recarregar(); setMsg({ t: `"${f.name}" anexado (${r.caracteres.toLocaleString("pt-BR")} caracteres lidos).`, tipo: "ok" }); }
    catch (e: any) { setMsg({ t: e.message, tipo: "bad" }); }
    finally { setBusy(false); }
  };
  const remover = async (aid: number) => { await api.del(`/processos/${p.id}/anexos/${aid}`); await recarregar(); };
  return (
    <section className="panel">
      <div className="pad-s row"><div><h2>Documentos de apoio</h2><p className="small muted">Memorandos, planilhas, levantamentos e peças antigas. A IA usa o texto deles nas minutas, nas sugestões e no assistente.</p></div>
        {podeIncluir && <><label className="btn" htmlFor="anexo">{busy ? "Lendo…" : "Anexar documento"}</label>
          <input id="anexo" type="file" accept=".docx,.pdf,.txt,.md,.csv" hidden disabled={busy} onChange={(e) => { enviar(e.target.files?.[0]); e.target.value = ""; }} /></>}</div>
      {msg && <p className={"note " + (msg.tipo ?? "")} style={{ margin: "0 12px 12px" }}>{msg.t}</p>}
      {p.anexos.length === 0 ? <p className="pad-s muted">Nenhum documento anexado.</p> :
        <div className="tw"><table className="t"><tbody>{p.anexos.map((a: any) => (
          <tr key={a.id}><td>{a.nome}</td><td className="small muted">{a.caracteres.toLocaleString("pt-BR")} caracteres</td><td className="small muted">{dataHora(a.criado_em)}</td>
            <td className="r">{podeIncluir && <button className="lnk" onClick={() => remover(a.id)}>Remover</button>}</td></tr>))}</tbody></table></div>}
    </section>
  );
}

function Historico({ id, versao }: { id: number; versao: number }) {
  const [h, setH] = useState<any[] | null>(null);
  const [aberto, setAberto] = useState(false);
  useEffect(() => { if (aberto) api.get(`/processos/${id}/historico`).then(setH); }, [aberto, id, versao]);
  return (
    <details className="panel box" onToggle={(e) => setAberto((e.target as HTMLDetailsElement).open)}>
      <summary>Histórico do processo</summary>
      {!h ? <p className="pad muted">Carregando…</p> :
        <div className="tw"><table className="t"><tbody>{h.map((x, i) => (
          <tr key={i}><td className="small muted" style={{ whiteSpace: "nowrap" }}>{dataHora(x.em)}</td><td>{x.usuario ?? "—"}</td>
            <td>{ACOES[x.acao] ?? x.acao}{x.detalhe?.item ? ` ${x.detalhe.item}` : ""}{x.detalhe?.etapa ? ` · ${ETAPAS.find((e) => e.id === x.detalhe.etapa)?.nome ?? x.detalhe.etapa}` : ""}{x.detalhe?.versao ? ` · versão ${x.detalhe.versao}` : ""}{x.detalhe?.situacao ? ` · ${x.detalhe.situacao}` : ""}</td></tr>))}</tbody></table></div>}
    </details>
  );
}
