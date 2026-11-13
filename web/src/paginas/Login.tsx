import { useState, type FormEvent } from "react";
import { api } from "../api";

export function Login({ aoEntrar }: { aoEntrar: () => void }) {
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState("");
  const [busy, setBusy] = useState(false);
  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setErro("");
    try { await api.post("/auth/entrar", { email, senha }); aoEntrar(); }
    catch (er: any) { setErro(er.message); }
    finally { setBusy(false); }
  };
  return (
    <div className="login">
      <form className="panel" onSubmit={enviar}>
        <div><span className="lbl">Lei nº 14.133/2021</span><h1>Licita</h1>
          <p className="muted small">Fase preparatória, plano de contratações e gestão de contratos.</p></div>
        <label className="campo">E-mail<input id="email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
        <label className="campo">Senha<input id="senha" type="password" autoComplete="current-password" value={senha} onChange={(e) => setSenha(e.target.value)} required /></label>
        {erro && <p className="note bad">{erro}</p>}
        <button className="btn pri" disabled={busy}>{busy ? "Entrando…" : "Entrar"}</button>
      </form>
    </div>
  );
}
