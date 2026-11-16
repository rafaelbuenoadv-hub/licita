import { useRef, useState, type FormEvent } from "react";
import { api } from "../api";
import { useEu } from "../main";

interface Solicitacao {
  id: number;
  secretaria: string;
  referencia: string;
  descricao: string;
  nome_arquivo: string | null;
}

interface Props {
  processo: {
    id: number;
    requisitante: string;
    areas_adicionais: string[];
    situacao: string;
    pode: { editar: boolean };
    solicitacoes: Solicitacao[];
    secretarias: string[];
  };
  recarregar: () => Promise<unknown>;
}

const modos = {
  manual: "Criar manualmente",
  ia: "Criar com ajuda da IA",
  anexo: "Anexar solicitação existente",
};
type Modo = keyof typeof modos;
const tiposArquivo = ".pdf,.docx,.txt,.md,.csv";

export function Solicitacoes({ processo, recarregar }: Props) {
  const { ia } = useEu();
  const [modo, setModo] = useState<Modo | null>(null);
  const [chave, setChave] = useState("");
  const [secretaria, setSecretaria] = useState("");
  const [referencia, setReferencia] = useState("");
  const [descricao, setDescricao] = useState("");
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [ocupado, setOcupado] = useState<"salvar" | "ia" | null>(null);
  const [aviso, setAviso] = useState<{ texto: string; erro?: boolean } | null>(null);
  const seletor = useRef<HTMLInputElement>(null);
  const caminho = `/processos/${processo.id}/solicitacoes`;
  const areas = [processo.requisitante, ...processo.areas_adicionais].filter(Boolean);
  const podeAdicionar = processo.pode.editar && processo.situacao === "preparacao";

  const abrir = (novo: Modo) => {
    if (!modo) {
      setChave(crypto.randomUUID());
      setSecretaria(areas[0] ?? "");
      setReferencia("");
      setDescricao("");
      setArquivo(null);
    }
    setModo(novo);
    setAviso(null);
  };

  const montarDados = () => {
    if (arquivo && arquivo.size > 20 * 1024 * 1024) throw new Error("Selecione um documento de até 20 MB.");
    const dados = new FormData();
    dados.set("secretaria", secretaria);
    dados.set("referencia", referencia);
    dados.set("descricao", descricao);
    if (arquivo) dados.set("arquivo", arquivo);
    return dados;
  };

  const salvar = async (ev: FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    setOcupado("salvar");
    setAviso(null);
    try {
      if (modo === "anexo" && !arquivo) throw new Error("Selecione o documento da solicitação.");
      const dados = montarDados();
      dados.set("chave_envio", chave);
      await api.post(caminho, dados);
      setModo(null);
      await recarregar();
      setAviso({ texto: "Solicitação adicionada ao processo." });
    } catch (erro) {
      setAviso({ texto: erro instanceof Error ? erro.message : "Não foi possível salvar a solicitação.", erro: true });
    } finally {
      setOcupado(null);
    }
  };

  const gerar = async () => {
    if (secretaria.trim().length < 2) {
      setAviso({ texto: "Informe a secretaria antes de gerar o rascunho.", erro: true });
      return;
    }
    setOcupado("ia");
    setAviso(null);
    try {
      const r = await api.post<{ descricao: string }>(`${caminho}/ia`, montarDados());
      setDescricao(r.descricao);
      setAviso({ texto: "Rascunho gerado. Confira o texto e salve a solicitação." });
    } catch (erro) {
      setAviso({ texto: erro instanceof Error ? erro.message : "Não foi possível gerar o rascunho.", erro: true });
    } finally {
      setOcupado(null);
    }
  };

  return (
    <section className="sec stack">
      <h3>Solicitações das secretarias</h3>
      {areas.length > 0 && <p><strong>Áreas requisitantes</strong> · {areas.join("; ")}</p>}
      {podeAdicionar && <div className="tools">
        {(Object.entries(modos) as [Modo, string][]).map(([k, rotulo]) => (
          <button key={k} type="button" className={modo === k ? "btn pri" : "btn"} aria-pressed={modo === k} disabled={!!ocupado} onClick={() => abrir(k)}>{rotulo}</button>
        ))}
      </div>}
      {podeAdicionar && modo && (
        <form className="stack" onSubmit={salvar}>
          <div className="form">
            <label>Secretaria<input list="secretarias-solicitacao" required minLength={2} maxLength={200} value={secretaria} disabled={!!ocupado} onChange={(e) => setSecretaria(e.target.value)} /></label>
            <datalist id="secretarias-solicitacao">{[...new Set([...areas, ...processo.secretarias])].map((nome) => <option key={nome} value={nome} />)}</datalist>
            <label>Memorando ou referência<input maxLength={120} value={referencia} disabled={!!ocupado} onChange={(e) => setReferencia(e.target.value)} /></label>
            <label className="wide">{modo === "anexo" ? "Descrição complementar (opcional)" : "Descrição da solicitação"}
              <textarea required={modo !== "anexo"} maxLength={10000} value={descricao} disabled={!!ocupado}
                placeholder={modo === "ia" ? "Informe a necessidade, as quantidades e os prazos que já conhece." : undefined}
                onChange={(e) => setDescricao(e.target.value)} />
            </label>
          </div>
          <div className="tools">
            <input ref={seletor} hidden type="file" accept={tiposArquivo} onChange={(e) => setArquivo(e.target.files?.[0] ?? null)} />
            <button className="btn" type="button" disabled={!!ocupado} onClick={() => seletor.current?.click()}>{arquivo ? "Trocar documento" : "Anexar documento"}</button>
            {arquivo && <>
              <span className="small" style={{ overflowWrap: "anywhere" }}>{arquivo.name}</span>
              <button className="lnk" type="button" disabled={!!ocupado} onClick={() => {
                setArquivo(null);
                if (seletor.current) seletor.current.value = "";
              }}>Remover anexo</button>
            </>}
            <span className="small muted">PDF, Word (.docx) ou texto. Até 20 MB.</span>
          </div>
          {modo === "ia" && <div className="stack">
            {ia.disponivel ? <>
              <div><button className="btn" type="button" disabled={!!ocupado} onClick={gerar}>{ocupado === "ia" ? "Gerando rascunho…" : "Gerar rascunho com IA"}</button></div>
              <span className="small muted">Ao gerar, o Licita usa a descrição e envia o documento selecionado ao provedor de IA.</span>
            </> : <p className="note">IA indisponível no servidor. Você pode preencher e salvar a solicitação nesta tela.</p>}
          </div>}
          <div className="tools">
            <button className="btn pri" disabled={!!ocupado}>{ocupado === "salvar" ? "Salvando…" : "Salvar solicitação"}</button>
            <button className="btn" type="button" disabled={!!ocupado} onClick={() => { setModo(null); setAviso(null); }}>Cancelar</button>
          </div>
        </form>
      )}
      {aviso && <p className={`note ${aviso.erro ? "bad" : "ok"}`} role={aviso.erro ? "alert" : "status"}>{aviso.texto}</p>}
      {processo.solicitacoes.length > 0 && (
        <div className="tw">
          <table className="t">
            <thead><tr><th>Secretaria</th><th>Solicitação</th><th>Documento</th></tr></thead>
            <tbody>{processo.solicitacoes.map((s) => (
              <tr key={s.id}>
                <td>{s.secretaria}</td>
                <td>{s.referencia && <strong>{s.referencia}</strong>}<div style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{s.descricao}</div></td>
                <td>{s.nome_arquivo ? <a href={`/api${caminho}/${s.id}/arquivo`} download>{s.nome_arquivo}</a> : "—"}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </section>
  );
}
