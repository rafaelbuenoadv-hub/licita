import { useState, type FormEvent } from "react";
import { api } from "../api";

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

export function Solicitacoes({ processo, recarregar }: Props) {
  const [chave, setChave] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [aviso, setAviso] = useState<{ texto: string; erro?: boolean } | null>(null);
  const caminho = `/processos/${processo.id}/solicitacoes`;
  const areas = [processo.requisitante, ...processo.areas_adicionais].filter(Boolean);
  const podeAdicionar = processo.pode.editar && processo.situacao === "preparacao";

  const salvar = async (ev: FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    if (!chave) return;
    const dados = new FormData(ev.currentTarget);
    dados.set("chave_envio", chave);
    const arquivo = dados.get("arquivo");
    if (arquivo instanceof File && !arquivo.name) dados.delete("arquivo");
    setSalvando(true);
    setAviso(null);
    try {
      await api.post(caminho, dados);
      setChave(null);
      await recarregar();
      setAviso({ texto: "Solicitação adicionada ao processo." });
    } catch (erro) {
      setAviso({ texto: erro instanceof Error ? erro.message : "Não foi possível salvar a solicitação.", erro: true });
    } finally {
      setSalvando(false);
    }
  };

  return (
    <section className="sec stack">
      <h3>Solicitações das secretarias</h3>
      {areas.length > 0 && <p><strong>Áreas requisitantes</strong> · {areas.join("; ")}</p>}
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
      {podeAdicionar && (chave ? (
        <form className="stack" onSubmit={salvar}>
          <div className="form">
            <label>Secretaria<input name="secretaria" list="secretarias-solicitacao" required maxLength={200} /></label>
            <datalist id="secretarias-solicitacao">{[...new Set([...areas, ...processo.secretarias])].map((nome) => <option key={nome} value={nome} />)}</datalist>
            <label>Memorando ou referência<input name="referencia" maxLength={120} /></label>
            <label className="wide">Descrição da solicitação<textarea name="descricao" required maxLength={10000} /></label>
            <label className="wide">Documento da solicitação (opcional)<input name="arquivo" type="file" accept=".pdf,.docx,.txt,.md,.csv" /></label>
          </div>
          <div className="tools">
            <button className="btn pri" disabled={salvando}>{salvando ? "Salvando…" : "Salvar solicitação"}</button>
            <button className="btn" type="button" disabled={salvando} onClick={() => setChave(null)}>Cancelar</button>
          </div>
        </form>
      ) : (
        <div><button className="btn" onClick={() => { setChave(crypto.randomUUID()); setAviso(null); }}>Adicionar solicitação de outra secretaria</button></div>
      ))}
      {aviso && <p className={`note ${aviso.erro ? "bad" : "ok"}`} role={aviso.erro ? "alert" : "status"}>{aviso.texto}</p>}
    </section>
  );
}
