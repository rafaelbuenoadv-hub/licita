import { useEffect, useState, type FormEvent } from "react";
import { api } from "../api";

interface Secretario {
  id: number;
  secretaria: string;
  nome: string;
  email: string;
  telefone: string;
  fonte: string;
}

interface CadastroSecretarios {
  lista: Secretario[];
  pode_importar_ibaiti: boolean;
}

const caminho = "/admin/secretarios";
const novo = { id: 0, secretaria: "", nome: "", email: "", telefone: "", fonte: "" };
const campos = [
  { chave: "secretaria", rotulo: "Secretaria", limite: 180, obrigatorio: true },
  { chave: "nome", rotulo: "Nome do titular", limite: 180, obrigatorio: true },
  { chave: "email", rotulo: "E-mail institucional", limite: 254, tipo: "email" },
  { chave: "telefone", rotulo: "Telefone institucional", limite: 80, tipo: "tel" },
  { chave: "fonte", rotulo: "Link da fonte oficial", limite: 1200, tipo: "url" },
] as const;

export function Secretarios() {
  const [cadastro, setCadastro] = useState<CadastroSecretarios | null>(null);
  const [form, setForm] = useState<Secretario | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState<{ texto: string; tipo: "ok" | "bad" } | null>(null);

  const carregar = async () => setCadastro(await api.get<CadastroSecretarios>(caminho));
  const mostrarErro = (erro: unknown) => setAviso({
    texto: erro instanceof Error ? erro.message : "Não foi possível concluir a operação.",
    tipo: "bad",
  });

  useEffect(() => { carregar().catch(mostrarErro); }, []);

  const importar = async () => {
    setOcupado(true);
    setAviso(null);
    try {
      const { inseridos } = await api.post<{ inseridos: number }>(`${caminho}/importar-ibaiti`);
      await carregar();
      const texto = inseridos === 0 ? "Os registros da lista oficial já estão cadastrados."
        : inseridos === 1 ? "1 registro importado." : `${inseridos} registros importados.`;
      setAviso({ texto, tipo: "ok" });
    } catch (erro) {
      mostrarErro(erro);
    } finally {
      setOcupado(false);
    }
  };

  const salvar = async (ev: FormEvent) => {
    ev.preventDefault();
    if (!form) return;
    const { id, ...dados } = form;
    setOcupado(true);
    setAviso(null);
    try {
      if (id) await api.put(`${caminho}/${id}`, dados);
      else await api.post(caminho, dados);
      setForm(null);
      await carregar();
      setAviso({ texto: "Cadastro salvo.", tipo: "ok" });
    } catch (erro) {
      mostrarErro(erro);
    } finally {
      setOcupado(false);
    }
  };

  return (
    <details className="panel box">
      <summary>Secretários municipais</summary>
      <div className="pad stack">
        {cadastro && (
          <>
            {cadastro.lista.length > 0 ? (
              <div className="tw">
                <table className="t">
                  <thead><tr><th>Secretaria</th><th>Titular</th><th>Contato institucional</th><th>Fonte</th><th>Ações</th></tr></thead>
                  <tbody>{cadastro.lista.map((s) => (
                    <tr key={s.id}>
                      <td>{s.secretaria}</td>
                      <td>{s.nome}</td>
                      <td className="small">
                        {s.email && <div>{s.email}</div>}
                        {s.telefone && <div>{s.telefone}</div>}
                        {!s.email && !s.telefone && "—"}
                      </td>
                      <td>{s.fonte ? <a href={s.fonte} target="_blank" rel="noreferrer" aria-label={`Fonte oficial de ${s.secretaria}`}>Consultar</a> : "—"}</td>
                      <td><button className="lnk" disabled={ocupado} onClick={() => { setForm(s); setAviso(null); }}
                        aria-label={`Editar titular de ${s.secretaria}`}>Editar</button></td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            ) : <p className="small muted">Nenhum secretário cadastrado.</p>}
            {!form && (
              <div className="tools">
                <button className="btn" disabled={ocupado} onClick={() => { setForm(novo); setAviso(null); }}>Novo cadastro</button>
                {cadastro.pode_importar_ibaiti && <button className="btn pri" disabled={ocupado} onClick={importar}>Importar lista oficial de Ibaiti</button>}
              </div>
            )}
          </>
        )}
        {form && (
          <form className="stack" onSubmit={salvar}>
            <h3>{form.id ? "Editar titular" : "Novo cadastro"}</h3>
            <div className="form">
              {campos.map(({ chave, rotulo, limite, ...opcoes }) => (
                <label key={chave}>
                  {rotulo}
                  <input type={"tipo" in opcoes ? opcoes.tipo : "text"} required={"obrigatorio" in opcoes}
                    maxLength={limite} value={form[chave]} disabled={ocupado}
                    onChange={(e) => setForm({ ...form, [chave]: e.target.value })} />
                </label>
              ))}
            </div>
            <div className="tools">
              <button className="btn pri" disabled={ocupado}>Salvar cadastro</button>
              <button className="btn" type="button" disabled={ocupado} onClick={() => { setForm(null); setAviso(null); }}>Cancelar</button>
            </div>
          </form>
        )}
        {aviso && <p className={`note ${aviso.tipo}`} role={aviso.tipo === "bad" ? "alert" : "status"}>{aviso.texto}</p>}
      </div>
    </details>
  );
}
