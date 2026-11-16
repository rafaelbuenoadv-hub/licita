import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, dataHora, fluxo } from "../api";
import { Folha } from "../comp/Folha";
import { tem, useEu } from "../main";
import { VIAS } from "../../../shared/etapas";
import { SITUACOES_RECOMENDACAO, TIPOS_PDF, TIPOS_REVISAO } from "../../../shared/revisao";

const vias = { ...VIAS, a_confirmar: "A confirmar" };
type Via = keyof typeof vias;
type TipoMinuta = keyof typeof TIPOS_REVISAO;
type TipoPdf = keyof typeof TIPOS_PDF;
type Situacao = keyof typeof SITUACOES_RECOMENDACAO;
type Revisao = { id: number; numero: string; objeto: string; via: Via; processo_id: number | null };
type Processo = { id: number; numero: string; protocolo: string; objeto: string; via: Via };
type Minuta = { id: number; tipo: TipoMinuta; origem: "manual" | "ia"; criado_em: string };
type Recomendacao = { id?: number; descricao: string; referencia: string; ajuste: string; evidencia: string; situacao: Situacao };
type Sugestao = Pick<Recomendacao, "descricao" | "referencia" | "ajuste">;
type Detalhe = Revisao & {
  arquivos: { id: number; tipo: TipoPdf; nome: string; paginas: number }[];
  minutas: Minuta[];
  recomendacoes: Recomendacao[];
};

const vazia: Recomendacao = { descricao: "", referencia: "", ajuste: "", evidencia: "", situacao: "pendente" };
const erroTexto = (e: unknown) => e instanceof Error ? e.message : "Não foi possível concluir. Tente novamente.";

export function Revisoes() {
  const { eu } = useEu();
  const { id } = useParams();
  if (!tem(eu, "contratacao", "juridico")) return <p className="note bad">Seu perfil não tem acesso à revisão de processos.</p>;
  return id ? <DetalheRevisao key={id} id={id} /> : <ListaRevisoes />;
}

function ListaRevisoes() {
  const [lista, setLista] = useState<Revisao[] | null>(null);
  const [processos, setProcessos] = useState<Processo[]>([]);
  const [aberto, setAberto] = useState(false);
  const [form, setForm] = useState({ numero: "", objeto: "", via: "a_confirmar" as Via, processo_id: "" });
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState("");
  const navegar = useNavigate();

  useEffect(() => {
    let ativo = true;
    api.get<Revisao[]>("/revisoes").then((r) => { if (ativo) setLista(r); }).catch((e) => { if (ativo) setErro(erroTexto(e)); });
    api.get<Processo[]>("/processos").then((r) => { if (ativo) setProcessos(r); }).catch(() => {});
    return () => { ativo = false; };
  }, []);

  const criar = async (ev: FormEvent) => {
    ev.preventDefault();
    setOcupado(true);
    setErro("");
    try {
      const r = await api.post<{ id: number }>("/revisoes", { ...form, processo_id: form.processo_id ? Number(form.processo_id) : null });
      navegar(`/revisoes/${r.id}`);
    } catch (e) { setErro(erroTexto(e)); }
    finally { setOcupado(false); }
  };

  return <>
    <div className="row"><h1>Revisão de processos</h1>
      <button className="btn pri" type="button" onClick={() => setAberto(!aberto)}>{aberto ? "Fechar formulário" : "Nova revisão"}</button></div>
    {erro && <p className="note bad" role="alert">{erro}</p>}
    {aberto && <form className="panel pad stack" onSubmit={criar}>
      <div className="form">
        <label className="wide">Vincular a um processo do Licita (opcional)
          <select value={form.processo_id} onChange={(ev) => {
            const processo_id = ev.target.value;
            const p = processos.find((x) => String(x.id) === processo_id);
            setForm(p ? { processo_id, numero: p.numero || p.protocolo, objeto: p.objeto, via: p.via } : { ...form, processo_id });
          }}><option value="">Processo instruído fora do Licita</option>
            {processos.map((p) => <option key={p.id} value={p.id}>{p.numero || p.protocolo} · {p.objeto}</option>)}
          </select>
        </label>
        <label>Número do processo<input value={form.numero} required maxLength={120} onChange={(e) => setForm({ ...form, numero: e.target.value })} /></label>
        <label>Forma de contratação<select value={form.via} onChange={(e) => setForm({ ...form, via: e.target.value as Via })}>
          {Object.entries(vias).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label className="wide">Objeto<textarea value={form.objeto} required minLength={5} maxLength={2000} onChange={(e) => setForm({ ...form, objeto: e.target.value })} /></label>
      </div>
      <div><button className="btn pri" disabled={ocupado}>Abrir revisão</button></div>
    </form>}
    {lista === null && !erro && <p className="muted">Carregando revisões…</p>}
    {lista?.length === 0 && <p className="muted">Nenhuma revisão cadastrada.</p>}
    {lista && lista.length > 0 && <div className="panel tw"><table className="t">
      <thead><tr><th>Processo</th><th>Objeto</th><th>Forma de contratação</th></tr></thead>
      <tbody>{lista.map((r) => <tr key={r.id}><td><Link to={`/revisoes/${r.id}`}>{r.numero}</Link></td><td>{r.objeto}</td><td>{vias[r.via]}</td></tr>)}</tbody>
    </table></div>}
  </>;
}

function DetalheRevisao({ id }: { id: string }) {
  const { ia } = useEu();
  const [revisao, setRevisao] = useState<Detalhe | null>(null);
  const [tipo, setTipo] = useState<TipoMinuta>("revisao");
  const [texto, setTexto] = useState("");
  const [versao, setVersao] = useState("");
  const [origem, setOrigem] = useState<Minuta["origem"]>("manual");
  const [orientacao, setOrientacao] = useState("");
  const [progresso, setProgresso] = useState("");
  const [sugestoes, setSugestoes] = useState<Sugestao[]>([]);
  const [ocupado, setOcupado] = useState("");
  const [aviso, setAviso] = useState<{ texto: string; erro?: boolean } | null>(null);
  const [rec, setRec] = useState<Recomendacao | null>(null);
  const cancelar = useRef<AbortController | null>(null);
  const caminho = `/revisoes/${id}`;
  const carregar = useCallback(async () => setRevisao(await api.get<Detalhe>(caminho)), [caminho]);
  const falha = (e: unknown) => setAviso({ texto: erroTexto(e), erro: true });
  useEffect(() => {
    carregar().catch(falha);
    return () => cancelar.current?.abort();
  }, [carregar]);

  const executar = async (acao: string, trabalho: () => Promise<void>) => {
    setAviso(null); setOcupado(acao);
    try { await trabalho(); }
    catch (e) { if (!(e instanceof Error && e.name === "AbortError")) falha(e); }
    finally { setOcupado(""); }
  };
  const anexar = (ev: FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    const form = ev.currentTarget;
    const dados = new FormData(form);
    void executar("anexar", async () => {
      await api.post(`${caminho}/arquivos`, dados);
      form.reset();
      await carregar();
      setAviso({ texto: "PDF anexado." });
    });
  };
  const gerar = () => {
    setProgresso("Preparando a leitura dos PDFs…");
    const ctl = new AbortController();
    cancelar.current = ctl;
    void executar("ia", async () => {
      try {
        const r = await fluxo(`${caminho}/ia`, { tipo, orientacao }, setProgresso, ctl.signal);
        setVersao(""); setOrigem("ia"); setTexto(r.minuta);
        setSugestoes(r.recomendacoes);
        setAviso({ texto: "Rascunho gerado. Confira as referências nos autos e salve uma versão." });
      } finally {
        cancelar.current = null;
        setProgresso("");
      }
    });
  };
  const lerVersao = (minuta: string) => {
    if (!minuta) { setVersao(""); setTexto(""); setOrigem("manual"); return; }
    void executar("abrir", async () => {
      const r = await api.get<{ texto: string }>(`${caminho}/minutas/${minuta}`);
      const item = revisao?.minutas.find((m) => String(m.id) === minuta);
      setVersao(minuta); setTexto(r.texto); setOrigem(item?.origem ?? "manual");
    });
  };
  const salvar = () => void executar("salvar", async () => {
    const r = await api.post<{ id: number }>(`${caminho}/minutas`, { tipo, texto, origem });
    await carregar();
    setVersao(String(r.id));
    setAviso({ texto: "Nova versão salva." });
  });
  const gravarRec = (ev: FormEvent) => {
    ev.preventDefault();
    if (!rec) return;
    void executar("recomendacao", async () => {
      if (rec.id) await api.put(`${caminho}/recomendacoes/${rec.id}`, rec);
      else await api.post(`${caminho}/recomendacoes`, rec);
      setRec(null);
      await carregar();
      setAviso({ texto: "Recomendação registrada." });
    });
  };

  if (!revisao) return <p className={aviso?.erro ? "note bad" : "muted"}>{aviso?.texto ?? "Carregando revisão…"}</p>;
  const autos = revisao.arquivos.some((a) => a.tipo === "autos");
  const parecer = revisao.arquivos.some((a) => a.tipo === "parecer");
  const versoes = revisao.minutas.filter((m) => m.tipo === tipo);
  return <>
    <div className="row"><div><span className="lbl">Processo {revisao.numero}</span><h1>{revisao.objeto}</h1>
      <p className="small muted">{vias[revisao.via]} {revisao.processo_id && <Link to={`/processos/${revisao.processo_id}`}>Abrir processo vinculado</Link>}</p></div>
      <Link className="btn" to="/revisoes">Todas as revisões</Link></div>
    <section className="panel pad stack">
      <h2>Documentos do processo</h2>
      {revisao.arquivos.length > 0 && <ul>{revisao.arquivos.map((a) => <li key={a.id}>
        <a href={`/api${caminho}/arquivos/${a.id}`}>{a.nome}</a> · {TIPOS_PDF[a.tipo]} · {a.paginas} {a.paginas === 1 ? "página" : "páginas"}
      </li>)}</ul>}
      <form className="form" onSubmit={anexar}>
        <label>Tipo de documento<select name="tipo">{Object.entries(TIPOS_PDF).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label>Arquivo PDF<input type="file" name="arquivo" accept="application/pdf,.pdf" required /></label>
        <div><button className="btn" disabled={!!ocupado}>{ocupado === "anexar" ? "Anexando…" : "Anexar PDF"}</button></div>
      </form>
      <p className="small muted">Até 20 MB por arquivo. Se necessário, anexe os autos em volumes.</p>
    </section>

    {aviso && <p className={`note ${aviso.erro ? "bad" : "ok"}`} role={aviso.erro ? "alert" : "status"}>{aviso.texto}</p>}
    <section className="panel pad stack">
      <h2>Revisão e minutas</h2>
      <div className="form">
        <label>Documento<select value={tipo} disabled={!!ocupado} onChange={(ev) => {
          setTipo(ev.target.value as TipoMinuta);
          setVersao(""); setTexto(""); setOrigem("manual"); setSugestoes([]);
        }}>{Object.entries(TIPOS_REVISAO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        {versoes.length > 0 && <label>Versões salvas<select value={versao} disabled={!!ocupado} onChange={(e) => lerVersao(e.target.value)}>
          <option value="">Rascunho</option>
          {versoes.map((m) => <option key={m.id} value={m.id}>{dataHora(m.criado_em)} · {m.origem === "ia" ? "Assistida por IA" : "Manual"}</option>)}
        </select></label>}
        <label className="wide">Orientação para a IA (opcional)<input value={orientacao} maxLength={4000} onChange={(e) => setOrientacao(e.target.value)} /></label>
      </div>
      <div className="tools">
        <button className="btn pri" disabled={!!ocupado || !ia.disponivel || !autos} onClick={gerar}> {texto.trim() ? "Gerar novo rascunho com IA" : "Gerar com IA"}</button>
        {ocupado === "ia" && <button className="btn" onClick={() => cancelar.current?.abort()}>Parar análise</button>}
        <button className="btn" disabled={!!ocupado || !texto.trim()} onClick={salvar}>Salvar nova versão</button>
        {versao && <a className="btn" href={`/api${caminho}/minutas/${versao}?formato=docx`}>Baixar versão em Word</a>}
      </div>
      {!ia.disponivel && <p className="small muted">IA indisponível. Você pode revisar os PDFs e elaborar a minuta manualmente.</p>}
      {ia.disponivel && !autos && <p className="small muted">Anexe os autos para gerar uma análise.</p>}
      {ia.disponivel && tipo === "saneamento" && !parecer && <p className="small muted">Se o parecer estiver em arquivo separado, anexe-o como Parecer existente.</p>}
      {ia.disponivel && autos && <p className="small muted">Ao gerar com IA, o Licita envia os PDFs anexados ao provedor de IA configurado.</p>}
      {progresso && <p className="small" role="status" style={{ whiteSpace: "pre-line" }}>{progresso.trim().split("\n").at(-1)}</p>}
      <label>Texto para conferência<textarea className="edit" value={texto} maxLength={400000} readOnly={!!ocupado} onChange={(e) => setTexto(e.target.value)} /></label>
      {texto.trim() && <details><summary>Prévia da minuta</summary><Folha texto={texto} vazio="" /></details>}
    </section>

    <section className="panel pad stack">
      <div className="row"><h2>Adequações ao parecer</h2>
        <button className="btn" disabled={!!ocupado} onClick={() => setRec(vazia)}>Nova recomendação</button></div>
      {sugestoes.length > 0 && <div><h3>Sugestões extraídas pela IA</h3><ul>{sugestoes.map((s, i) => <li key={i}>
        {s.descricao} {s.referencia && <span className="small muted"> · {s.referencia}</span>}{" "}
        <button className="lnk" disabled={!!ocupado} onClick={() => setRec({ ...vazia, ...s })}>Revisar e registrar</button>
      </li>)}</ul></div>}
      {revisao.recomendacoes.length > 0 && <div className="tw"><table className="t">
        <thead><tr><th>Recomendação</th><th>Providência e evidência</th><th>Situação</th><th>Ação</th></tr></thead>
        <tbody>{revisao.recomendacoes.map((r) => <tr key={r.id}><td>{r.descricao}<div className="small muted">{r.referencia}</div></td>
          <td>{r.ajuste}<div className="small muted">{r.evidencia}</div></td><td>{SITUACOES_RECOMENDACAO[r.situacao]}</td>
          <td><button className="lnk" disabled={!!ocupado} onClick={() => setRec(r)}>Editar</button></td></tr>)}</tbody>
      </table></div>}
      {rec && <form className="stack" onSubmit={gravarRec}>
        <div className="form">
          <label className="wide">Recomendação<textarea required minLength={3} maxLength={4000} value={rec.descricao} onChange={(e) => setRec({ ...rec, descricao: e.target.value })} /></label>
          <label>Item ou página do parecer<input maxLength={800} value={rec.referencia} onChange={(e) => setRec({ ...rec, referencia: e.target.value })} /></label>
          <label>Situação<select value={rec.situacao} onChange={(e) => setRec({ ...rec, situacao: e.target.value as Situacao })}>
            {Object.entries(SITUACOES_RECOMENDACAO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label className="wide">Providência ou justificativa<textarea maxLength={6000} value={rec.ajuste} onChange={(e) => setRec({ ...rec, ajuste: e.target.value })} /></label>
          <label className="wide">Evidência nos autos<input maxLength={2000} value={rec.evidencia} onChange={(e) => setRec({ ...rec, evidencia: e.target.value })} /></label>
        </div>
        <div className="tools"><button className="btn pri" disabled={!!ocupado}>Salvar recomendação</button>
          <button className="btn" type="button" disabled={!!ocupado} onClick={() => setRec(null)}>Cancelar</button></div>
      </form>}
    </section>
  </>;
}
