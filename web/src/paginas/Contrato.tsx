import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { api, brl, dataBR, fmtNum, numBR } from "../api";
import { tem, useEu } from "../main";
import { CamposContrato, TIPO_OBJ, contratoParaApi, vazioContrato } from "./Contratos";

const TIPOS_AD: Record<string, string> = { prazo: "Prorrogação de prazo", acrescimo: "Acréscimo de valor", supressao: "Supressão de valor", qualitativo: "Alteração qualitativa", reajuste: "Reajuste (apostila)" };
const SIT_MED: Record<string, string> = { medida: "Medida", atestada: "Atestada pelo fiscal", paga: "Paga" };
const hoje = () => new Date().toISOString().slice(0, 10);

export function ContratoPg() {
  const { id } = useParams();
  const { eu } = useEu();
  const [c, setC] = useState<any>(null);
  const [msg, setMsg] = useState<{ t: string; tipo?: string } | null>(null);
  const [editar, setEditar] = useState(false);
  const carregar = useCallback(() => api.get(`/contratos/${id}`).then(setC).catch((e) => setMsg({ t: e.message, tipo: "bad" })), [id]);
  useEffect(() => { carregar(); }, [carregar]);
  if (!c) return msg ? <p className="note bad">{msg.t}</p> : <p className="muted">Carregando contrato…</p>;
  const ok = (t: string) => { setMsg({ t, tipo: "ok" }); return carregar(); };
  const falha = (e: any) => setMsg({ t: e.message, tipo: "bad" });
  const mudaMedicao = (mid: number, situacao: string) => api.post(`/contratos/${c.id}/medicoes/${mid}/situacao`, { situacao }).then(() => ok("Medição atualizada.")).catch(falha);
  const usoPct = (c.uso_acrescimo * 100).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

  return (
    <>
      <div className="row"><div className="stack" style={{ gap: 2 }}><span className="lbl mono">Contrato {c.numero}</span><h1>{c.contratada}</h1>
        <span className="small muted">{c.objeto}</span></div><Link className="btn" to="/contratos">Todos os contratos</Link></div>
      {msg && <p className={"note " + (msg.tipo ?? "")}>{msg.t} <button className="lnk" onClick={() => setMsg(null)}>Fechar</button></p>}
      {c.alertas.map((a: any, i: number) => <p key={i} className={"note " + (a.nivel === "alto" ? "bad" : "")}>{a.texto}</p>)}

      <div className="kpis">
        <div className="panel kpi"><span className="lbl">Valor atual</span><b>{brl(c.valor_atual)}</b><span className="small muted">inicial {brl(c.valor_inicial)}</span></div>
        <div className="panel kpi"><span className="lbl">Medido · pago</span><b>{brl(c.medido)}</b><span className="small muted">pago {brl(c.pago)} · saldo {brl(c.saldo)}</span></div>
        <div className="panel kpi"><span className="lbl">Vigência</span><b>{dataBR(c.fim_atual)}</b><span className="small muted">{c.dias_para_fim >= 0 ? `faltam ${c.dias_para_fim} dias` : `encerrada há ${-c.dias_para_fim} dias`}</span></div>
        <div className="panel kpi"><span className="lbl">Acréscimos (art. 125)</span><b>{usoPct}%</b><span className="small muted">limite {c.limite * 100}% · {TIPO_OBJ[c.tipo_objeto]}</span></div>
      </div>

      <details className="panel box" open={editar} onToggle={(e) => setEditar((e.target as HTMLDetailsElement).open)}>
        <summary>Dados do contrato</summary>
        <div className="pad stack">
          <p className="small">Gestor: {c.gestor || "—"} · Fiscal: {c.fiscal || "—"} · Substituto: {c.fiscal_substituto || "—"} · CNPJ {c.cnpj || "—"} · Início {dataBR(c.inicio)}
            {c.processo && <> · Processo <Link to={`/processos/${c.processo.id}`}>{c.processo.numero ? `PA ${c.processo.numero}` : "vinculado"}</Link></>}</p>
          {editar && tem(eu, "contratacao") && <EditarContrato c={c} aoSalvar={() => ok("Contrato atualizado.")} aoFalhar={falha} />}
        </div>
      </details>

      <section className="panel">
        <div className="pad-s"><h2>Aditivos e apostilas</h2></div>
        {c.aditivos.length === 0 ? <p className="pad-s muted">Nenhum aditivo.</p> :
          <div className="tw"><table className="t"><thead><tr><th>Nº</th><th>Tipo</th><th>Data</th><th className="r">Valor</th><th>Novo fim</th><th>Justificativa</th></tr></thead>
            <tbody>{c.aditivos.map((a: any) => <tr key={a.id}><td className="mono">{a.numero}</td><td>{TIPOS_AD[a.tipo]}</td><td>{dataBR(a.data)}</td><td className="r">{a.valor ? brl(a.valor) : "—"}</td><td>{dataBR(a.nova_fim)}</td><td className="small">{a.justificativa}</td></tr>)}</tbody></table></div>}
        {tem(eu, "contratacao") && c.situacao === "vigente" && <NovoAditivo id={c.id} aoSalvar={() => ok("Aditivo registrado.")} aoFalhar={falha} />}
      </section>

      <section className="panel">
        <div className="pad-s"><h2>Medições e pagamentos</h2><p className="small muted">O fiscal registra e atesta; o setor de contratações registra o pagamento.</p></div>
        {c.medicoes.length === 0 ? <p className="pad-s muted">Nenhuma medição.</p> :
          <div className="tw"><table className="t"><thead><tr><th>Referência</th><th>Data</th><th className="r">Valor</th><th>Situação</th><th /></tr></thead>
            <tbody>{c.medicoes.map((m: any) => (
              <tr key={m.id}><td>{m.referencia}<div className="small muted">{m.observacao}</div></td><td>{dataBR(m.data)}</td><td className="r">{brl(m.valor)}</td>
                <td><span className={"pill " + (m.situacao === "paga" ? "ok" : m.situacao === "atestada" ? "cur" : "")}>{SIT_MED[m.situacao]}</span></td>
                <td className="r">{m.situacao === "medida" && tem(eu, "fiscal") && <button className="btn sm" onClick={() => mudaMedicao(m.id, "atestada")}>Atestar</button>}
                  {m.situacao === "atestada" && tem(eu, "contratacao") && <button className="btn sm" onClick={() => mudaMedicao(m.id, "paga")}>Registrar pagamento</button>}</td></tr>))}</tbody></table></div>}
        {tem(eu, "fiscal", "contratacao") && <NovaMedicao id={c.id} aoSalvar={() => ok("Medição registrada.")} aoFalhar={falha} />}
      </section>

      <section className="panel">
        <div className="pad-s"><h2>Registro de ocorrências</h2><p className="small muted">Anotações do fiscal sobre a execução (art. 117, § 1º).</p></div>
        {c.ocorrencias.length === 0 ? <p className="pad-s muted">Nenhuma ocorrência registrada.</p> :
          c.ocorrencias.map((o: any) => <div key={o.id} className="alerta"><div><b>{dataBR(o.data)}</b> · {o.autor ?? "—"}<div>{o.descricao}</div>{o.providencia && <div className="small muted">Providência: {o.providencia}</div>}</div></div>)}
        {tem(eu, "fiscal", "contratacao") && <NovaOcorrencia id={c.id} aoSalvar={() => ok("Ocorrência registrada.")} aoFalhar={falha} />}
      </section>
    </>
  );
}

function EditarContrato({ c, aoSalvar, aoFalhar }: any) {
  const [f, setF] = useState({ ...vazioContrato, ...Object.fromEntries(Object.keys(vazioContrato).map((k) => [k, c[k] == null ? "" : String(c[k])])), valor: fmtNum(c.valor_inicial) });
  const [sit, setSit] = useState(c.situacao);
  const salvar = async (ev: FormEvent) => { ev.preventDefault(); try { await api.put(`/contratos/${c.id}`, { ...contratoParaApi(f), situacao: sit }); aoSalvar(); } catch (e) { aoFalhar(e); } };
  return (
    <form className="stack" onSubmit={salvar}>
      <CamposContrato f={f} set={setF} />
      <label className="campo" style={{ maxWidth: 240 }}>Situação<select id="ct-sit" value={sit} onChange={(e) => setSit(e.target.value)}><option value="vigente">Vigente</option><option value="encerrado">Encerrado</option><option value="rescindido">Rescindido</option></select></label>
      <div><button className="btn pri">Salvar contrato</button></div>
    </form>
  );
}

function NovoAditivo({ id, aoSalvar, aoFalhar }: any) {
  const [f, setF] = useState({ numero: "", tipo: "prazo", valor: "", nova_fim: "", justificativa: "", data: hoje() });
  const c = (k: keyof typeof f) => ({ id: "ad-" + k, value: f[k], onChange: (e: any) => setF({ ...f, [k]: e.target.value }) });
  const salvar = async (ev: FormEvent) => {
    ev.preventDefault();
    const v = numBR(f.valor);
    if (Number.isNaN(v)) return aoFalhar(new Error("Valor inválido."));
    try { await api.post(`/contratos/${id}/aditivos`, { ...f, valor: v ?? 0, nova_fim: f.nova_fim || null }); setF({ ...f, numero: "", valor: "", nova_fim: "", justificativa: "" }); aoSalvar(); } catch (e) { aoFalhar(e); }
  };
  return (
    <form className="pad stack" onSubmit={salvar} style={{ borderTop: "1px solid var(--line)" }}>
      <h3>Registrar aditivo</h3>
      <div className="form">
        <label>Número<input {...c("numero")} required /></label>
        <label>Tipo<select {...c("tipo")}>{Object.entries(TIPOS_AD).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label>Data<input type="date" {...c("data")} /></label>
        {["acrescimo", "supressao", "reajuste"].includes(f.tipo) && <label>Valor (R$)<input {...c("valor")} inputMode="decimal" required /></label>}
        {(f.tipo === "prazo" || f.tipo === "qualitativo") && <label>Novo fim da vigência<input type="date" {...c("nova_fim")} required={f.tipo === "prazo"} /></label>}
        <label className="wide">Justificativa<textarea {...c("justificativa")} required minLength={10} placeholder="Motivo e fundamento (art. 124)" /></label>
      </div>
      <div><button className="btn pri">Registrar aditivo</button></div>
    </form>
  );
}

function NovaMedicao({ id, aoSalvar, aoFalhar }: any) {
  const [f, setF] = useState({ referencia: "", valor: "", data: hoje(), observacao: "" });
  const c = (k: keyof typeof f) => ({ id: "me-" + k, value: f[k], onChange: (e: any) => setF({ ...f, [k]: e.target.value }) });
  const salvar = async (ev: FormEvent) => {
    ev.preventDefault();
    const v = numBR(f.valor);
    if (!v || Number.isNaN(v)) return aoFalhar(new Error("Informe o valor da medição."));
    try { await api.post(`/contratos/${id}/medicoes`, { ...f, valor: v }); setF({ referencia: "", valor: "", data: hoje(), observacao: "" }); aoSalvar(); } catch (e) { aoFalhar(e); }
  };
  return (
    <form className="pad stack" onSubmit={salvar} style={{ borderTop: "1px solid var(--line)" }}>
      <h3>Registrar medição</h3>
      <div className="form">
        <label>Referência<input {...c("referencia")} required placeholder="ex.: 1ª medição – etapa 1" /></label>
        <label>Valor (R$)<input {...c("valor")} inputMode="decimal" required /></label>
        <label>Data<input type="date" {...c("data")} /></label>
        <label className="wide">Observação<input {...c("observacao")} /></label>
      </div>
      <div><button className="btn pri">Registrar medição</button></div>
    </form>
  );
}

function NovaOcorrencia({ id, aoSalvar, aoFalhar }: any) {
  const [f, setF] = useState({ descricao: "", providencia: "", data: hoje() });
  const c = (k: keyof typeof f) => ({ id: "oc-" + k, value: f[k], onChange: (e: any) => setF({ ...f, [k]: e.target.value }) });
  const salvar = async (ev: FormEvent) => {
    ev.preventDefault();
    try { await api.post(`/contratos/${id}/ocorrencias`, f); setF({ descricao: "", providencia: "", data: hoje() }); aoSalvar(); } catch (e) { aoFalhar(e); }
  };
  return (
    <form className="pad stack" onSubmit={salvar} style={{ borderTop: "1px solid var(--line)" }}>
      <h3>Registrar ocorrência</h3>
      <div className="form">
        <label>Data<input type="date" {...c("data")} /></label>
        <label className="wide">Ocorrência<textarea {...c("descricao")} required minLength={3} /></label>
        <label className="wide">Providência determinada<textarea {...c("providencia")} /></label>
      </div>
      <div><button className="btn pri">Registrar ocorrência</button></div>
    </form>
  );
}
