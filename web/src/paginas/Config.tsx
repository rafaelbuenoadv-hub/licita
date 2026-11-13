import { useEffect, useState, type FormEvent } from "react";
import { api, brl, fmtNum, numBR } from "../api";
import { PAPEIS, type Papel } from "../../../shared/etapas";
import { tem, useEu } from "../main";
import { Secretarios } from "./Secretarios";

export function Config() {
  const { eu, ia } = useEu();
  const admin = tem(eu, "admin");
  return (
    <>
      <div><span className="lbl">{eu.orgao_nome}</span><h1>Configurações</h1></div>
      <p className="small muted">Seu perfil: {eu.papeis.map((p) => PAPEIS[p]).join(", ")}. IA: {ia.disponivel ? `ativa (${ia.modelo})` : "não configurada neste servidor"}.</p>
      <TrocarSenha />
      {admin && <Orgao />}
      {admin && <Usuarios />}
      {admin && <Secretarios />}
      <Modelos podeEditar={tem(eu, "admin", "contratacao")} />
      <Limites podeEditar={admin} />
    </>
  );
}

function Msg({ m }: { m: { t: string; tipo?: string } | null }) { return m ? <p className={"note " + (m.tipo ?? "")}>{m.t}</p> : null; }

function TrocarSenha() {
  const [f, setF] = useState({ atual: "", nova: "" });
  const [m, setM] = useState<any>(null);
  const salvar = async (ev: FormEvent) => {
    ev.preventDefault();
    try { await api.post("/auth/senha", f); setF({ atual: "", nova: "" }); setM({ t: "Senha alterada. As outras sessões foram encerradas.", tipo: "ok" }); }
    catch (e: any) { setM({ t: e.message, tipo: "bad" }); }
  };
  return (
    <details className="panel box"><summary>Trocar minha senha</summary>
      <form className="pad stack" onSubmit={salvar}>
        <div className="form">
          <label>Senha atual<input id="s-atual" type="password" autoComplete="current-password" value={f.atual} onChange={(e) => setF({ ...f, atual: e.target.value })} required /></label>
          <label>Nova senha (mínimo 10 caracteres)<input id="s-nova" type="password" autoComplete="new-password" value={f.nova} onChange={(e) => setF({ ...f, nova: e.target.value })} required minLength={10} /></label>
        </div>
        <Msg m={m} /><div><button className="btn pri">Trocar senha</button></div>
      </form>
    </details>
  );
}

function Orgao() {
  const [o, setO] = useState<any>(null);
  const [m, setM] = useState<any>(null);
  useEffect(() => { api.get("/orgao").then((x) => setO({ ...x, cnpj: x.cnpj ?? "", municipio: x.municipio ?? "", uf: x.uf ?? "" })); }, []);
  if (!o) return null;
  const c = (k: string) => ({ id: "o-" + k, value: o[k], onChange: (e: any) => setO({ ...o, [k]: e.target.value }) });
  const salvar = async (ev: FormEvent) => {
    ev.preventDefault();
    try { await api.put("/admin/orgao", o); setM({ t: "Dados do órgão salvos.", tipo: "ok" }); } catch (e: any) { setM({ t: e.message, tipo: "bad" }); }
  };
  return (
    <details className="panel box"><summary>Dados do órgão e regulamentos locais</summary>
      <form className="pad stack" onSubmit={salvar}>
        <div className="form">
          <label className="wide">Nome<input {...c("nome")} required /></label>
          <label>CNPJ<input {...c("cnpj")} /></label><label>Município<input {...c("municipio")} /></label><label>UF<input {...c("uf")} maxLength={2} /></label>
          <label className="wide">Regulamentos locais que a IA deve citar<textarea {...c("normas")} style={{ minHeight: 140 }}
            placeholder={"Um por linha, com o que regulamenta. Ex.:\nDecreto Municipal nº 2.533/2024 – fase preparatória e pesquisa de preços\nDecreto Municipal nº 2.549/2024 – dispensa eletrônica"} /></label>
        </div>
        <Msg m={m} /><div><button className="btn pri">Salvar</button></div>
      </form>
    </details>
  );
}

function Usuarios() {
  const [lista, setLista] = useState<any[]>([]);
  const [f, setF] = useState<any>(null);
  const [m, setM] = useState<any>(null);
  const carregar = () => api.get("/admin/usuarios").then(setLista);
  useEffect(() => { carregar(); }, []);
  const salvar = async (ev: FormEvent) => {
    ev.preventDefault();
    try {
      if (f.id) await api.put(`/admin/usuarios/${f.id}`, { nome: f.nome, cargo: f.cargo, papeis: f.papeis, ativo: f.ativo, senha: f.senha || undefined });
      else await api.post("/admin/usuarios", { nome: f.nome, email: f.email, cargo: f.cargo, papeis: f.papeis, senha: f.senha });
      setF(null); await carregar(); setM({ t: "Usuário salvo.", tipo: "ok" });
    } catch (e: any) { setM({ t: e.message, tipo: "bad" }); }
  };
  const alterna = (p: Papel) => setF({ ...f, papeis: f.papeis.includes(p) ? f.papeis.filter((x: string) => x !== p) : [...f.papeis, p] });
  return (
    <details className="panel box"><summary>Usuários e perfis</summary>
      <div className="pad stack">
        <p className="small muted">Cada perfil atua em etapas específicas. Mantenha a segregação de funções: quem elabora o projeto e o orçamento não deve ser o fiscal do contrato (art. 7º, § 1º).</p>
        <div className="tw"><table className="t"><thead><tr><th>Nome</th><th>E-mail</th><th>Perfis</th><th>Situação</th><th /></tr></thead>
          <tbody>{lista.map((u) => <tr key={u.id}><td>{u.nome}<div className="small muted">{u.cargo}</div></td><td className="small">{u.email}</td>
            <td className="small">{u.papeis.map((p: Papel) => PAPEIS[p]).join(", ")}</td><td>{u.ativo ? <span className="pill ok">Ativo</span> : <span className="pill">Inativo</span>}</td>
            <td className="r"><button className="lnk" onClick={() => setF({ ...u, senha: "" })}>Editar</button></td></tr>)}</tbody></table></div>
        {!f && <div><button className="btn" onClick={() => setF({ id: 0, nome: "", email: "", cargo: "", papeis: ["requisitante"], ativo: true, senha: "" })}>Novo usuário</button></div>}
        {f && <form className="stack" onSubmit={salvar}>
          <h3>{f.id ? `Editar ${f.nome}` : "Novo usuário"}</h3>
          <div className="form">
            <label>Nome<input id="u-nome" value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} required /></label>
            <label>E-mail<input id="u-email" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} required disabled={!!f.id} /></label>
            <label>Cargo<input id="u-cargo" value={f.cargo} onChange={(e) => setF({ ...f, cargo: e.target.value })} /></label>
            <label>{f.id ? "Nova senha (deixe vazio para manter)" : "Senha inicial (mínimo 10 caracteres)"}<input id="u-senha" type="password" autoComplete="new-password" value={f.senha} onChange={(e) => setF({ ...f, senha: e.target.value })} required={!f.id} minLength={10} /></label>
          </div>
          <fieldset style={{ border: "1px solid var(--line)", borderRadius: 6 }}><legend className="small muted">Perfis</legend>
            <div className="tools">{(Object.keys(PAPEIS) as Papel[]).map((p) => <label key={p} className="small" style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input type="checkbox" id={"u-p-" + p} checked={f.papeis.includes(p)} onChange={() => alterna(p)} />{PAPEIS[p]}</label>)}</div></fieldset>
          {f.id > 0 && <label className="small" style={{ display: "flex", gap: 6, alignItems: "center" }}><input type="checkbox" id="u-ativo" checked={f.ativo} onChange={(e) => setF({ ...f, ativo: e.target.checked })} />Usuário ativo</label>}
          <Msg m={m} />
          <div className="tools"><button className="btn pri">Salvar usuário</button><button type="button" className="btn" onClick={() => setF(null)}>Cancelar</button></div>
        </form>}
        {!f && <Msg m={m} />}
      </div>
    </details>
  );
}

function Modelos({ podeEditar }: { podeEditar: boolean }) {
  const [lista, setLista] = useState<any[]>([]);
  const [sel, setSel] = useState<string>("");
  const [texto, setTexto] = useState("");
  const [m, setM] = useState<any>(null);
  const carregar = () => api.get("/modelos").then((l) => { setLista(l); return l; });
  useEffect(() => { carregar().then((l) => { if (l[0]) { setSel(l[0].etapa); setTexto(l[0].texto); } }); }, []);
  const atual = lista.find((x) => x.etapa === sel);
  const escolhe = (e: string) => { setSel(e); setTexto(lista.find((x) => x.etapa === e)?.texto ?? ""); setM(null); };
  const salvar = async (t: string) => {
    try { await api.put(`/admin/modelos/${sel}`, { texto: t }); await carregar(); if (!t) setTexto(atual.padrao); setM({ t: t ? "Modelo do órgão salvo. A IA passa a seguir esta estrutura." : "Voltou ao modelo padrão do sistema.", tipo: "ok" }); }
    catch (e: any) { setM({ t: e.message, tipo: "bad" }); }
  };
  return (
    <details className="panel box"><summary>Modelos de documento do órgão</summary>
      <div className="pad stack">
        <p className="small muted">A IA redige cada minuta seguindo a estrutura do modelo da etapa. Descreva as seções na ordem do padrão do órgão, uma por linha.</p>
        <label className="campo" style={{ maxWidth: 420 }}>Documento<select id="mod-sel" value={sel} onChange={(e) => escolhe(e.target.value)}>
          {lista.map((x) => <option key={x.etapa} value={x.etapa}>{x.doc}{x.personalizado ? " (personalizado)" : ""}</option>)}</select></label>
        <textarea id="mod-texto" className="edit" style={{ minHeight: 320 }} value={texto} onChange={(e) => setTexto(e.target.value)} readOnly={!podeEditar} />
        <Msg m={m} />
        {podeEditar && <div className="tools"><button className="btn pri" onClick={() => salvar(texto)}>Salvar modelo do órgão</button>
          {atual?.personalizado && <button className="btn" onClick={() => salvar("")}>Voltar ao padrão do sistema</button>}</div>}
      </div>
    </details>
  );
}

function Limites({ podeEditar }: { podeEditar: boolean }) {
  const [lista, setLista] = useState<any[]>([]);
  const [f, setF] = useState({ ano: String(new Date().getFullYear()), inciso: "II", valor: "", fonte: "" });
  const [m, setM] = useState<any>(null);
  const carregar = () => api.get("/limites").then(setLista);
  useEffect(() => { carregar(); }, []);
  const salvar = async (ev: FormEvent) => {
    ev.preventDefault();
    const v = numBR(f.valor);
    if (!v || Number.isNaN(v)) return setM({ t: "Informe o valor do limite.", tipo: "bad" });
    try { await api.put("/admin/limites", { ano: Number(f.ano), inciso: f.inciso, valor: v, fonte: f.fonte }); await carregar(); setM({ t: "Limite salvo.", tipo: "ok" }); }
    catch (e: any) { setM({ t: e.message, tipo: "bad" }); }
  };
  return (
    <details className="panel box"><summary>Limites de dispensa por valor (art. 75, I e II)</summary>
      <div className="pad stack">
        <p className="small muted">Os valores são atualizados todo ano por decreto federal. Cadastre os valores vigentes com o número do decreto; o valor do órgão prevalece sobre o padrão do sistema.</p>
        <div className="tw"><table className="t"><thead><tr><th>Ano</th><th>Inciso</th><th className="r">Valor</th><th>Fonte</th><th /></tr></thead>
          <tbody>{lista.map((l) => <tr key={`${l.ano}${l.inciso}`}><td>{l.ano}</td><td>{l.inciso}</td><td className="r">{brl(l.valor)}</td><td className="small">{l.fonte}</td><td className="small muted">{l.proprio ? "do órgão" : "padrão do sistema"}</td></tr>)}</tbody></table></div>
        {podeEditar && <form className="stack" onSubmit={salvar}>
          <div className="form">
            <label>Ano<input id="l-ano" value={f.ano} onChange={(e) => setF({ ...f, ano: e.target.value })} inputMode="numeric" required /></label>
            <label>Inciso<select id="l-inc" value={f.inciso} onChange={(e) => setF({ ...f, inciso: e.target.value })}><option value="I">I – obras e serviços de engenharia</option><option value="II">II – demais compras e serviços</option></select></label>
            <label>Valor (R$)<input id="l-valor" value={f.valor} onChange={(e) => setF({ ...f, valor: e.target.value })} inputMode="decimal" placeholder={fmtNum(0)} required /></label>
            <label>Fonte (decreto)<input id="l-fonte" value={f.fonte} onChange={(e) => setF({ ...f, fonte: e.target.value })} required minLength={3} placeholder="Decreto Federal nº ..." /></label>
          </div>
          <Msg m={m} /><div><button className="btn pri">Salvar limite</button></div>
        </form>}
      </div>
    </details>
  );
}
