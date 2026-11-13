import { createContext, StrictMode, useContext, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, NavLink, Navigate, Route, Routes } from "react-router-dom";
import { api } from "./api";
import type { Papel } from "../../shared/etapas";
import "./estilo.css";
import { Login } from "./paginas/Login";
import { Painel } from "./paginas/Painel";
import { Processos } from "./paginas/Processos";
import { NovoProcesso } from "./paginas/NovoProcesso";
import { ProcessoPg } from "./paginas/Processo";
import { Pca } from "./paginas/Pca";
import { Contratos } from "./paginas/Contratos";
import { ContratoPg } from "./paginas/Contrato";
import { Config } from "./paginas/Config";
import { Mensagens } from "./paginas/Mensagens";

export interface Eu { id: number; nome: string; email: string; cargo: string; papeis: Papel[]; orgao_id: number; orgao_nome: string }
const Ctx = createContext<{ eu: Eu; ia: { disponivel: boolean; modelo: string } } | null>(null);
export function useEu() {
  const c = useContext(Ctx);
  if (!c) throw new Error("fora do contexto");
  return c;
}
export const tem = (eu: Eu, ...p: Papel[]) => eu.papeis.includes("admin") || p.some((x) => eu.papeis.includes(x));

function App() {
  const [eu, setEu] = useState<Eu | null | undefined>(undefined);
  const [ia, setIa] = useState({ disponivel: false, modelo: "" });
  const [naoLidas, setNaoLidas] = useState(0);
  const logado = !!eu;
  useEffect(() => {
    if (!logado) return;
    const ver = () => api.get<{ total: number }>("/mensagens/nao-lidas").then((r) => setNaoLidas(r.total)).catch(() => {});
    ver();
    const t = setInterval(ver, 60000);
    window.addEventListener("licita:mensagens", ver);
    return () => { clearInterval(t); window.removeEventListener("licita:mensagens", ver); };
  }, [logado]);
  const carregar = () => api.get<Eu>("/auth/eu").then((u) => { setEu(u); api.get("/ia/status").then(setIa).catch(() => {}); }).catch(() => setEu(null));
  useEffect(() => {
    carregar();
    const sair = () => setEu(null);
    window.addEventListener("licita:sair", sair);
    return () => window.removeEventListener("licita:sair", sair);
  }, []);
  if (eu === undefined) return <p className="muted" style={{ padding: 24 }}>Carregando…</p>;
  if (!eu) return <Login aoEntrar={carregar} />;
  const sair = async () => { await api.post("/auth/sair").catch(() => {}); setEu(null); };
  return (
    <Ctx.Provider value={{ eu, ia }}>
      <BrowserRouter>
        <div className="casca">
          <nav className="lateral" aria-label="Menu principal">
            <div className="marca">Licita</div>
            <div className="orgao">{eu.orgao_nome}</div>
            <NavLink to="/" end className={({ isActive }) => (isActive ? "ativo" : "")}>Painel</NavLink>
            <NavLink to="/processos" className={({ isActive }) => (isActive ? "ativo" : "")}>Processos</NavLink>
            <NavLink to="/pca" className={({ isActive }) => (isActive ? "ativo" : "")}>Plano de contratações</NavLink>
            <NavLink to="/contratos" className={({ isActive }) => (isActive ? "ativo" : "")}>Contratos</NavLink>
            <NavLink to="/mensagens" className={({ isActive }) => (isActive ? "ativo" : "")}>Mensagens{naoLidas > 0 && <span className="conta" aria-label={`${naoLidas} não lidas`}>{naoLidas}</span>}</NavLink>
            <NavLink to="/config" className={({ isActive }) => (isActive ? "ativo" : "")}>Configurações</NavLink>
            <div className="pe"><span>{eu.nome}</span><button className="lnk" onClick={sair}>Sair</button></div>
          </nav>
          <main className="conteudo">
            <Routes>
              <Route path="/" element={<Painel />} />
              <Route path="/processos" element={<Processos />} />
              <Route path="/processos/novo" element={<NovoProcesso />} />
              <Route path="/processos/:id" element={<ProcessoPg />} />
              <Route path="/pca" element={<Pca />} />
              <Route path="/contratos" element={<Contratos />} />
              <Route path="/contratos/:id" element={<ContratoPg />} />
              <Route path="/mensagens" element={<Mensagens />} />
              <Route path="/config" element={<Config />} />
              <Route path="*" element={<Navigate to="/" />} />
            </Routes>
          </main>
        </div>
      </BrowserRouter>
    </Ctx.Provider>
  );
}

createRoot(document.getElementById("raiz")!).render(<StrictMode><App /></StrictMode>);
