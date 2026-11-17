// Agente de contratação: ícone flutuante que o usuário arrasta até um campo (ou clica e aponta).
// Abre um diálogo que explica como preencher aquele campo e propõe o conteúdo, com botão para usar no campo.
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useLocation } from "react-router-dom";
import { fluxo } from "../api";

type Campo = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
type Mensagem = { role: "user" | "assistant"; content: string };
const ARRASTE = "application/x-licita-agente";
const MARCA = "SUGESTÃO PARA O CAMPO:";
const NAO_AJUDA = new Set(["password", "file", "checkbox", "radio", "hidden", "submit", "button", "range", "color"]);

/** Campo de formulário sob o ponteiro em que o agente pode ajudar (não ajuda em senha, arquivo nem no próprio diálogo). */
function campoEm(alvo: EventTarget | null): Campo | null {
  if (!(alvo instanceof Element) || alvo.closest(".agente-dialogo, .agente-icone")) return null;
  const el = alvo.closest("input, textarea, select") ?? alvo.closest("label")?.querySelector("input, textarea, select");
  if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement)) return null;
  if (el instanceof HTMLInputElement && NAO_AJUDA.has(el.type)) return null;
  return el;
}
function rotuloDe(el: Campo) {
  const proprio = el.getAttribute("aria-label");
  if (proprio) return proprio;
  const label = el.closest("label") ?? (el.id ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`) : null);
  const texto = label ? [...label.childNodes].filter((n) => n.nodeType === Node.TEXT_NODE).map((n) => n.textContent ?? "").join(" ").trim() : "";
  return texto || el.getAttribute("placeholder") || el.getAttribute("name") || "Campo sem rótulo";
}
const opcoesDe = (el: Campo) => (el instanceof HTMLSelectElement ? [...el.options].map((o) => o.text.trim()).filter(Boolean) : []);
const valorDe = (el: Campo) => (el instanceof HTMLSelectElement ? el.selectedOptions[0]?.text.trim() ?? "" : el.value);

/** Grava o valor num campo controlado pelo React, disparando os eventos que a tela escuta. */
function preencher(el: Campo, texto: string) {
  if (el instanceof HTMLSelectElement) {
    const alvo = texto.trim().toLowerCase();
    const op = [...el.options].find((o) => o.text.trim().toLowerCase() === alvo) ?? [...el.options].find((o) => o.text.trim().toLowerCase().startsWith(alvo));
    if (!op) return false;
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(el, op.value);
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const valor = el instanceof HTMLInputElement ? texto.replace(/\s*\n\s*/g, " ") : texto;
  Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, el.maxLength > 0 ? valor.slice(0, el.maxLength) : valor);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  return true;
}
/** Separa a explicação da sugestão que o agente propõe para o campo. */
export function separarSugestao(texto: string) {
  const k = texto.lastIndexOf(MARCA);
  if (k < 0) return { explicacao: texto.trim(), sugestao: "" };
  return { explicacao: texto.slice(0, k).trim(), sugestao: texto.slice(k + MARCA.length).trim() };
}

const SUGESTOES = [
  "Qual a diferença entre dispensa e inexigibilidade?",
  "Redija a resposta a um pedido de esclarecimento",
  "Quais documentos preciso juntar nesta etapa?",
  "Revise o texto que vou colar",
];

export function Agente({ disponivel }: { disponivel: boolean }) {
  const local = useLocation();
  const dialogo = useRef<HTMLDialogElement>(null);
  const icone = useRef<HTMLButtonElement>(null);
  const alvo = useRef<Campo | null>(null);
  const cancelar = useRef<AbortController | null>(null);
  const entrada = useRef<HTMLTextAreaElement>(null);
  const [modo, setModo] = useState<"" | "arrastando" | "apontando">("");
  const [campo, setCampo] = useState<{ rotulo: string; valor: string; opcoes: string[] } | null>(null);
  const [mensagens, setMensagens] = useState<Mensagem[]>([]);
  const [parcial, setParcial] = useState("");
  const [pergunta, setPergunta] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState("");
  const [aviso, setAviso] = useState("");

  // Com campo (dados), ajuda a preencher o campo apontado; sem campo (null), conversa livre.
  const perguntar = async (conversa: Mensagem[], dados: typeof campo) => {
    const el = dados ? alvo.current : null;
    if (dados && !el) return;
    const ctl = new AbortController();
    cancelar.current?.abort();
    cancelar.current = ctl;
    setMensagens(conversa); setOcupado(true); setErro(""); setParcial(""); setAviso("");
    // Os outros campos do mesmo formulário dão contexto ao agente (senha e arquivo ficam de fora).
    const escopo = el ? el.closest("form") ?? el.closest(".form") ?? el.closest("section") ?? document.querySelector("main") : null;
    const formulario = [...(escopo?.querySelectorAll("input, textarea, select") ?? [])]
      .filter((x): x is Campo => x !== el && !!campoEm(x)).slice(0, 40)
      .map((x) => ({ rotulo: rotuloDe(x).slice(0, 200), valor: valorDe(x).slice(0, 1500) })).filter((x) => x.valor);
    const processo = /^\/processos\/(\d+)/.exec(local.pathname)?.[1];
    try {
      const r = await fluxo("/ia/agente", {
        campo: dados && el ? { rotulo: dados.rotulo.slice(0, 300), valor: dados.valor.slice(0, 6000), opcoes: dados.opcoes.slice(0, 80), linhas: el instanceof HTMLTextAreaElement, limite: el instanceof HTMLSelectElement || el.maxLength <= 0 ? null : el.maxLength } : null,
        pagina: { titulo: (document.querySelector("main h1")?.textContent ?? "").slice(0, 300), caminho: local.pathname.slice(0, 200) },
        formulario, processo_id: processo ? Number(processo) : null, mensagens: conversa.slice(conversa.length > 31 ? -31 : 0),
      }, setParcial, ctl.signal);
      if (ctl.signal.aborted) return;
      setMensagens([...conversa, { role: "assistant", content: r.texto }]);
      if (r.truncado) setErro("A resposta atingiu o limite de tamanho. Peça para continuar, se precisar.");
    } catch (e) {
      if (!ctl.signal.aborted) setErro(e instanceof Error ? e.message : "Não foi possível obter a resposta.");
    } finally {
      if (cancelar.current === ctl) { cancelar.current = null; setOcupado(false); setParcial(""); }
    }
  };

  const abrir = (el: Campo) => {
    alvo.current = el;
    const dados = { rotulo: rotuloDe(el), valor: valorDe(el), opcoes: opcoesDe(el) };
    setCampo(dados); setPergunta(""); setMensagens([]); setErro(""); setAviso(""); setModo("");
    dialogo.current?.showModal();
    if (disponivel) perguntar([{ role: "user", content: "Como devo preencher este campo? Se já houver dados suficientes, proponha o conteúdo." }], dados);
  };

  /** Clique no ícone: abre a conversa livre, mantendo a conversa anterior enquanto a página não muda. */
  const conversar = () => {
    setModo("");
    if (campo) { alvo.current = null; setCampo(null); setMensagens([]); setErro(""); setAviso(""); }
    dialogo.current?.showModal();
    setTimeout(() => entrada.current?.focus(), 0);
  };
  const apontarCampo = () => { dialogo.current?.close(); setModo("apontando"); };
  const copiar = async (texto: string) => {
    try { await navigator.clipboard.writeText(texto); setAviso("Texto copiado. Cole onde precisar."); }
    catch { setErro("Não foi possível copiar. Selecione o texto e copie com Ctrl+C."); }
  };

  // Arrastar o ícone até um campo, em qualquer tela.
  useEffect(() => {
    const sobre = (ev: DragEvent) => {
      if (!ev.dataTransfer?.types.includes(ARRASTE) || !campoEm(ev.target)) return;
      ev.preventDefault();
      ev.dataTransfer.dropEffect = "copy";
    };
    const solta = (ev: DragEvent) => {
      if (!ev.dataTransfer?.types.includes(ARRASTE)) return;
      const el = campoEm(ev.target);
      if (!el) return;
      ev.preventDefault();
      abrir(el);
    };
    document.addEventListener("dragover", sobre);
    document.addEventListener("drop", solta);
    return () => { document.removeEventListener("dragover", sobre); document.removeEventListener("drop", solta); };
  });
  // Alternativa sem arrastar (toque e teclado): clicar no ícone e depois no campo.
  useEffect(() => {
    if (modo !== "apontando") return;
    const clique = (ev: MouseEvent) => {
      if (ev.target instanceof Element && ev.target.closest(".agente-icone")) return;
      const el = campoEm(ev.target);
      ev.preventDefault(); ev.stopPropagation();
      if (el) abrir(el); else setModo("");
    };
    const tecla = (ev: KeyboardEvent) => { if (ev.key === "Escape") setModo(""); };
    document.addEventListener("click", clique, true);
    document.addEventListener("keydown", tecla);
    return () => { document.removeEventListener("click", clique, true); document.removeEventListener("keydown", tecla); };
  });
  useEffect(() => {
    document.body.classList.toggle("agente-procurando", modo !== "");
    return () => document.body.classList.remove("agente-procurando");
  }, [modo]);

  const enviar = (ev: FormEvent) => {
    ev.preventDefault();
    const texto = pergunta.trim();
    if (!texto || ocupado) return;
    setPergunta("");
    perguntar([...mensagens, { role: "user", content: texto }], campo);
  };
  const usar = (sugestao: string) => {
    const el = alvo.current;
    if (!el || !el.isConnected) return setErro("O campo não está mais na tela. Feche e aponte o agente de novo.");
    if (el.disabled || (!(el instanceof HTMLSelectElement) && el.readOnly)) return setErro("Este campo não pode ser alterado nesta tela.");
    if (!preencher(el, sugestao)) return setErro("A sugestão não corresponde a nenhuma opção deste campo. Escolha a opção na tela.");
    setCampo((c) => c && { ...c, valor: valorDe(el) });
    setAviso("Sugestão colocada no campo. Confira e salve o formulário.");
  };
  const ultima = [...mensagens].reverse().find((m) => m.role === "assistant");
  const sugestao = ultima ? separarSugestao(ultima.content).sugestao : "";

  return (
    <>
      <button ref={icone} type="button" className={"agente-icone" + (modo === "apontando" ? " ativo" : "")} draggable aria-pressed={modo === "apontando"}
        title="Agente de contratação: clique para conversar, ou arraste até um campo para ajuda no preenchimento"
        onDragStart={(ev) => { ev.dataTransfer.setData(ARRASTE, "agente"); ev.dataTransfer.effectAllowed = "copy"; setModo("arrastando"); }}
        onDragEnd={() => setModo((m) => (m === "arrastando" ? "" : m))}
        onClick={() => (modo === "apontando" ? setModo("") : conversar())}>
        <svg aria-hidden="true" viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="7.5" r="3.5" /><path d="M4.5 20.5c.6-4 3.6-6.5 7.5-6.5s6.9 2.5 7.5 6.5" /><path d="m9.5 17.3 1.8 1.8 3.4-3.6" />
        </svg>
        <span className="agente-nome">Agente de contratação</span>
      </button>
      {modo === "apontando" && <div className="agente-dica" role="status">Clique no campo em que você quer ajuda. Esc cancela.</div>}
      <dialog ref={dialogo} className="agente-dialogo ajuda-dialogo panel pad" aria-labelledby="agente-titulo"
        onClose={() => { cancelar.current?.abort(); cancelar.current = null; setOcupado(false); alvo.current?.focus?.(); }}>
        <div className="stack">
          <div className="row"><div><span className="lbl">Agente de contratação</span><h2 id="agente-titulo">{campo ? campo.rotulo : "Como posso ajudar?"}</h2></div>
            <div className="tools">
              {!campo && mensagens.length > 0 && <button type="button" className="btn sm" disabled={ocupado} onClick={() => { setMensagens([]); setErro(""); setAviso(""); }}>Nova conversa</button>}
              <button type="button" className="btn" onClick={() => dialogo.current?.close()}>Fechar</button></div></div>
          {campo && <p className="small muted" style={{ overflowWrap: "anywhere" }}>{campo.valor ? `No campo agora: ${campo.valor.length > 240 ? campo.valor.slice(0, 240) + "…" : campo.valor}` : "O campo está em branco."}</p>}
          {!disponivel && <p className="note">A IA não está configurada neste servidor, então o agente não consegue responder. Peça ao administrador para definir a chave da API.</p>}
          {!campo && mensagens.length === 0 && <div className="stack" style={{ gap: 8 }}>
            <p className="small muted">Tire dúvidas sobre licitações e contratos, peça a redação de uma resposta ou cole um texto para revisar.{/^\/processos\/\d+/.test(local.pathname) ? " O agente considera o processo aberto nesta tela." : ""}</p>
            <div className="chips">{SUGESTOES.map((t) => <button key={t} type="button" className="chip" disabled={!disponivel} onClick={() => { setPergunta(t); entrada.current?.focus(); }}>{t}</button>)}</div>
          </div>}
          <div className="ajuda-conversa" role="log" aria-live="polite">
            {mensagens.slice(campo ? 1 : 0).map((m, i) => (
              <div key={i} className={"agente-msg " + m.role}><strong>{m.role === "user" ? "Você" : "Agente"}</strong>
                <p>{m.role === "assistant" && campo ? separarSugestao(m.content).explicacao : m.content}</p>
                {m.role === "assistant" && !campo && <button type="button" className="lnk small" onClick={() => copiar(m.content)}>Copiar resposta</button>}
              </div>))}
            {parcial && <div className="agente-msg assistant"><strong>Agente</strong><p>{campo ? separarSugestao(parcial).explicacao : parcial}</p></div>}
            {ocupado && !parcial && <p>{campo ? "Analisando o campo…" : "Pensando…"}</p>}
          </div>
          {sugestao && !ocupado && <div className="agente-sugestao">
            <span className="lbl">Sugestão para o campo</span>
            <p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{sugestao}</p>
            <div><button type="button" className="btn pri" onClick={() => usar(sugestao)}>Usar no campo</button></div>
          </div>}
          {aviso && <p className="note ok" role="status">{aviso}</p>}
          {erro && <p className="note bad" role="alert">{erro}</p>}
          <form className="stack" onSubmit={enviar}>
            <label className="campo">{campo ? "Pergunte ou dê mais informações" : "Sua mensagem"}
              <textarea ref={entrada} value={pergunta} maxLength={20000} disabled={!disponivel} onChange={(ev) => setPergunta(ev.target.value)}
                onKeyDown={(ev) => { if (ev.key === "Enter" && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); (ev.currentTarget.form as HTMLFormElement | null)?.requestSubmit(); } }}
                placeholder={campo ? "Ex.: são 30 unidades, para as escolas da zona rural" : "Escreva sua dúvida ou cole o texto (pedido de esclarecimento, impugnação, minuta…)"} style={campo ? undefined : { minHeight: 110 }} /></label>
            <div className="tools"><button className="btn pri" disabled={!disponivel || ocupado || !pergunta.trim()}>Enviar</button>
              <span className="small muted">Ctrl + Enter também envia.</span>
              {!campo && <button type="button" className="lnk small" onClick={apontarCampo}>Ajudar a preencher um campo da tela</button>}</div>
          </form>
          <p className="small muted">O agente propõe; quem decide e assina é você. Confira com os documentos do processo.</p>
        </div>
      </dialog>
    </>
  );
}
