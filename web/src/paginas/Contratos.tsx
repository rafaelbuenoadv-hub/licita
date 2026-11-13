import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { api, brl, dataBR, numBR } from "../api";
import { tem, useEu } from "../main";

export const TIPO_OBJ: Record<string, string> = { obra: "Obra ou serviço de engenharia", servico: "Serviço", compra: "Compra", reforma: "Reforma de edifício ou equipamento" };
export const vazioContrato = { processo_id: "", numero: "", objeto: "", contratada: "", cnpj: "", tipo_objeto: "servico", valor: "", inicio: "", fim: "", gestor: "", fiscal: "", fiscal_substituto: "" };
export function contratoParaApi(f: typeof vazioContrato) {
  const v = numBR(f.valor);
  if (v == null || Number.isNaN(v)) throw new Error("Informe o valor inicial do contrato (ex.: 114.969,14).");
  return { ...f, processo_id: f.processo_id ? Number(f.processo_id) : null, valor_inicial: v, valor: undefined };
}
export function CamposContrato({ f, set, processos }: { f: typeof vazioContrato; set: (f: typeof vazioContrato) => void; processos?: any[] }) {
  const c = (k: keyof typeof vazioContrato) => ({ id: "ct-" + k, value: f[k], onChange: (e: any) => set({ ...f, [k]: e.target.value }) });
  return (
    <div className="form">
      {processos && <label className="wide">Processo de origem<select {...c("processo_id")} onChange={(e) => {
        const p = processos.find((x) => String(x.id) === e.target.value);
        set({ ...f, processo_id: e.target.value, objeto: f.objeto || p?.objeto || "", tipo_objeto: p?.tipo === "obra" ? "obra" : p?.tipo === "bens" ? "compra" : f.tipo_objeto });
      }}><option value="">Sem processo vinculado</option>{processos.map((p) => <option key={p.id} value={p.id}>{p.protocolo} · {p.numero ? `PA ${p.numero} · ` : ""}{p.objeto.slice(0, 90)}</option>)}</select></label>}
      <label>Número do contrato<input {...c("numero")} required /></label>
      <label>Tipo de objeto<select {...c("tipo_objeto")}>{Object.entries(TIPO_OBJ).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
      <label>Contratada<input {...c("contratada")} required /></label>
      <label>CNPJ<input {...c("cnpj")} /></label>
      <label>Valor inicial (R$)<input {...c("valor")} inputMode="decimal" required /></label>
      <label>Início da vigência<input type="date" {...c("inicio")} required /></label>
      <label>Fim da vigência<input type="date" {...c("fim")} required /></label>
      <label>Gestor<input {...c("gestor")} /></label>
      <label>Fiscal<input {...c("fiscal")} /></label>
      <label>Fiscal substituto<input {...c("fiscal_substituto")} /></label>
      <label className="wide">Objeto<textarea {...c("objeto")} required minLength={3} /></label>
    </div>
  );
}

export function Contratos() {
  const { eu } = useEu();
  const [lista, setLista] = useState<any[] | null>(null);
  const [novo, setNovo] = useState(false);
  const [f, setF] = useState({ ...vazioContrato });
  const [procs, setProcs] = useState<any[]>([]);
  const [erro, setErro] = useState("");
  const nav = useNavigate();
  useEffect(() => { api.get("/contratos").then(setLista); }, []);
  useEffect(() => { if (novo) api.get("/processos").then((ps) => setProcs(ps.filter((p: any) => p.situacao !== "cancelado"))); }, [novo]);
  const criar = async (ev: FormEvent) => {
    ev.preventDefault(); setErro("");
    try { const { id } = await api.post("/contratos", contratoParaApi(f)); nav(`/contratos/${id}`); }
    catch (e: any) { setErro(e.message); }
  };
  return (
    <>
      <div className="row"><h1>Contratos</h1>{tem(eu, "contratacao") && !novo && <button className="btn pri" onClick={() => setNovo(true)}>Registrar contrato</button>}</div>
      {novo && <form className="panel pad stack" onSubmit={criar}>
        <h2>Registrar contrato</h2>
        <CamposContrato f={f} set={setF} processos={procs} />
        {erro && <p className="note bad">{erro}</p>}
        <div className="tools"><button className="btn pri">Registrar</button><button type="button" className="btn" onClick={() => setNovo(false)}>Cancelar</button></div>
      </form>}
      <section className="panel">
        {lista === null ? <p className="pad muted">Carregando…</p> : lista.length === 0 ? <p className="pad muted">Nenhum contrato registrado. Os contratos nascem dos processos concluídos ou podem ser registrados diretamente.</p> :
          <div className="tw"><table className="t">
            <thead><tr><th>Contrato</th><th>Contratada</th><th>Objeto</th><th className="r">Valor atual</th><th className="r">Executado</th><th>Vigência</th><th>Situação</th></tr></thead>
            <tbody>{lista.map((c) => (
              <tr key={c.id} className="link" onClick={() => nav(`/contratos/${c.id}`)}>
                <td className="mono">{c.numero}</td><td>{c.contratada}</td><td style={{ minWidth: 220 }}>{c.objeto}</td>
                <td className="r">{brl(c.valor_atual)}</td><td className="r">{c.valor_atual ? `${Math.round((c.medido / c.valor_atual) * 100)}%` : "—"}</td>
                <td className="small">até {dataBR(c.fim_atual)}{c.situacao === "vigente" && <div className={c.dias_para_fim <= 30 ? "" : "muted"} style={c.dias_para_fim <= 30 ? { color: "var(--bad)" } : {}}>{c.dias_para_fim >= 0 ? `faltam ${c.dias_para_fim} dias` : `vencido há ${-c.dias_para_fim} dias`}</div>}</td>
                <td>{c.alertas.length > 0 ? <span className={"pill " + (c.alertas.some((a: any) => a.nivel === "alto") ? "bad" : "cur")}>{c.alertas.length} {c.alertas.length > 1 ? "alertas" : "alerta"}</span> : <span className={"pill " + (c.situacao === "vigente" ? "ok" : "")}>{c.situacao === "vigente" ? "Vigente" : c.situacao === "encerrado" ? "Encerrado" : "Rescindido"}</span>}</td>
              </tr>))}</tbody>
          </table></div>}
      </section>
    </>
  );
}
