import { useRef, useState, type MouseEvent } from "react";
import { fluxo } from "../api";

export const camposAjuda = {
  requisitante: "Área requisitante",
  ano: "Exercício",
  tipo: "Tipo de objeto",
  via: "Forma de contratação",
  valor: "Valor estimado",
  classe: "Natureza / ramo",
  pca_item_id: "Item do plano de contratações",
  objeto: "Objeto",
  normas: "Regulamentos citados neste processo",
  obs: "Observações",
} as const;

type Campo = keyof typeof camposAjuda;
type Mensagem = { role: "user" | "assistant"; content: string };
const arraste = "application/x-licita-ajuda";

export function AjudaCampo({ contexto, disponivel }: { contexto: Record<string, unknown>; disponivel: boolean }) {
  const dialogo = useRef<HTMLDialogElement>(null);
  const livro = useRef<HTMLButtonElement>(null);
  const cancelar = useRef<AbortController | null>(null);
  const [campo, setCampo] = useState<Campo>("objeto");
  const [pergunta, setPergunta] = useState("");
  const [mensagens, setMensagens] = useState<Mensagem[]>([]);
  const [parcial, setParcial] = useState("");
  const [erro, setErro] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [arrastando, setArrastando] = useState(false);

  const abrir = (alvo: Campo) => {
    setCampo(alvo);
    setPergunta("");
    setMensagens([]);
    setErro("");
    setParcial("");
    dialogo.current?.showModal();
  };

  const perguntar = async (ev: MouseEvent) => {
    ev.preventDefault();
    ev.stopPropagation();
    const texto = pergunta.trim();
    if (ocupado || !texto) return;
    const ctl = new AbortController();
    cancelar.current = ctl;
    const conversa: Mensagem[] = [...mensagens.slice(-10), { role: "user", content: texto }];
    setOcupado(true);
    setErro("");
    setParcial("");
    try {
      const r = await fluxo("/ia/ajuda-campo", { campo, contexto, mensagens: conversa }, setParcial, ctl.signal);
      if (ctl.signal.aborted) return;
      setMensagens([...conversa, { role: "assistant", content: r.texto }]);
      setPergunta("");
      if (r.truncado) setErro("A resposta atingiu o limite de tamanho. Você pode pedir para continuar.");
    } catch (e) {
      if (!ctl.signal.aborted) setErro(e instanceof Error ? e.message : "Não foi possível obter a resposta.");
    } finally {
      if (cancelar.current === ctl) {
        cancelar.current = null;
        setOcupado(false);
        setParcial("");
      }
    }
  };

  return (
    <div className="wide">
      <button ref={livro} type="button" className="btn livro-ajuda" draggable
        onDragStart={(ev) => { ev.dataTransfer.setData(arraste, "ajuda"); ev.dataTransfer.effectAllowed = "copy"; setArrastando(true); }}
        onDragEnd={() => setArrastando(false)} onClick={() => abrir("objeto")}>
        <svg aria-hidden="true" viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" strokeWidth="1.7">
          <path d="M12 5.5C9.2 3.5 5.3 3.3 2.5 4.5v14c2.8-1.2 6.7-1 9.5 1 2.8-2 6.7-2.2 9.5-1v-14c-2.8-1.2-6.7-1-9.5 1Zm0 0v14M5.5 8.5h3.8m-3.8 3h3.8m5.4-3h3.8m-3.8 3h3.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Ajuda da IA
      </button>
      <span className="small muted"> Arraste o livro até um campo ou clique para escolher.</span>
      {arrastando && <div className="livro-alvos" aria-hidden="true" ref={(el) => {
        const formulario = el?.closest(".form");
        if (formulario) formulario.classList.add("recebendo-livro");
        return () => formulario?.classList.remove("recebendo-livro");
      }} />}
      <dialog ref={dialogo} className="ajuda-dialogo panel pad" aria-labelledby="ajuda-titulo"
        onClose={() => { cancelar.current?.abort(); cancelar.current = null; setOcupado(false); livro.current?.focus(); }}>
        <div className="stack">
          <div className="row"><h2 id="ajuda-titulo">Ajuda da IA</h2>
            <button type="button" className="btn" onClick={() => dialogo.current?.close()}>Fechar</button></div>
          <label>Campo<select value={campo} disabled={ocupado} onChange={(ev) => {
            setCampo(ev.target.value as Campo); setMensagens([]); setErro("");
          }}>{Object.entries(camposAjuda).map(([k, nome]) => <option key={k} value={k}>{nome}</option>)}</select></label>
          <div className="ajuda-conversa" role="log" aria-live="polite">
            {mensagens.map((m, i) => <p key={i}><strong>{m.role === "user" ? "Você" : "IA"}</strong><br />{m.content}</p>)}
            {parcial && <p><strong>IA</strong><br />{parcial}</p>}
            {ocupado && !parcial && <p>Preparando resposta…</p>}
          </div>
          {!disponivel && <p className="note">A IA precisa estar configurada para responder.</p>}
          {erro && <p className="note bad" role="alert">{erro}</p>}
          <label>Sua pergunta<textarea autoFocus value={pergunta} maxLength={2000} onChange={(ev) => setPergunta(ev.target.value)}
            placeholder="Como devo preencher este campo?" /></label>
          <div><button type="button" className="btn pri" disabled={!disponivel || ocupado || !pergunta.trim()}
            onClick={perguntar}>Enviar pergunta</button></div>
        </div>
      </dialog>
      <span hidden ref={(el) => {
        const formulario = el?.closest(".form");
        if (!(formulario instanceof HTMLElement)) return;
        const alvo = (ev: DragEvent) => {
          if (!ev.dataTransfer?.types.includes(arraste)) return;
          const elemento = ev.target instanceof Element ? ev.target.closest("[data-campo-ajuda], label") : null;
          const chave = elemento?.getAttribute("data-campo-ajuda") ?? elemento?.querySelector("[data-campo-ajuda]")?.getAttribute("data-campo-ajuda");
          if (!chave || !Object.hasOwn(camposAjuda, chave)) return;
          ev.preventDefault();
          if (ev.type === "drop") { setArrastando(false); abrir(chave as Campo); }
          else ev.dataTransfer.dropEffect = "copy";
        };
        formulario.addEventListener("dragover", alvo);
        formulario.addEventListener("drop", alvo);
        return () => { formulario.removeEventListener("dragover", alvo); formulario.removeEventListener("drop", alvo); };
      }} />
    </div>
  );
}
