import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { api, brl, fmtNum, numBR } from "../api";
import { TIPOS } from "../../../shared/etapas";
import { tem, useEu } from "../main";

const vazio = { id: 0, descricao: "", classe: "", tipo: "bens", valor: "", trimestre: "", requisitante: "" };

export function Pca() {
  const { eu } = useEu();
  const [ano, setAno] = useState(new Date().getFullYear());
  const [d, setD] = useState<any>(null);
  const [f, setF] = useState({ ...vazio });
  const [msg, setMsg] = useState<{ t: string; tipo?: string } | null>(null);
  const pode = tem(eu, "contratacao", "requisitante");
  const carregar = () => api.get(`/pca?ano=${ano}`).then(setD);
  useEffect(() => { setD(null); carregar(); }, [ano]);

  const salvar = async (ev: FormEvent) => {
    ev.preventDefault(); setMsg(null);
    const v = numBR(f.valor);
    if (v == null || Number.isNaN(v)) return setMsg({ t: "Informe o valor estimado (ex.: 25.000,00).", tipo: "bad" });
    const corpo = { ano, descricao: f.descricao, classe: f.classe, tipo: f.tipo, valor_estimado: v, trimestre: f.trimestre ? Number(f.trimestre) : null, requisitante: f.requisitante };
    try {
      if (f.id) await api.put(`/pca/${f.id}`, corpo); else await api.post("/pca", corpo);
      setF({ ...vazio }); await carregar(); setMsg({ t: "Item salvo no plano.", tipo: "ok" });
    } catch (e: any) { setMsg({ t: e.message, tipo: "bad" }); }
  };
  const remover = async (id: number) => { try { await api.del(`/pca/${id}`); await carregar(); } catch (e: any) { setMsg({ t: e.message, tipo: "bad" }); } };
  const c = (k: keyof typeof vazio) => ({ id: "pca-" + k, value: f[k] as string, onChange: (e: any) => setF({ ...f, [k]: e.target.value }) });

  return (
    <>
      <div className="row"><div><span className="lbl">Art. 12, VII · art. 18, caput</span><h1>Plano de contratações anual</h1></div>
        <label className="campo" style={{ width: 120 }}>Exercício<select id="pca-ano" value={ano} onChange={(e) => setAno(Number(e.target.value))}>
          {[1, 0, -1, -2].map((k) => { const a = new Date().getFullYear() + k; return <option key={a}>{a}</option>; })}</select></label></div>
      {!d ? <p className="muted">Carregando plano…</p> : <>
        <div className="kpis">
          <div className="panel kpi"><span className="lbl">Total planejado</span><b>{brl(d.total_planejado)}</b></div>
          <div className="panel kpi"><span className="lbl">Itens no plano</span><b>{d.itens.length}</b></div>
          <div className="panel kpi"><span className="lbl">Processos fora do plano</span><b>{d.fora_do_plano.length}</b></div>
          <div className="panel kpi"><span className="lbl">Limites de dispensa {ano}</span>
            <span className="small">{["I", "II"].map((i) => { const l = d.limites.find((x: any) => x.inciso === i); return <div key={i}>Inciso {i}: {l ? brl(l.valor) : "não cadastrado"}</div>; })}</span></div>
        </div>

        <section className="panel">
          <div className="pad-s"><h2>Por natureza da despesa</h2><p className="small muted">Para o limite de dispensa somam-se, no exercício, as contratações do mesmo ramo de atividade (art. 75, § 1º). Obras e serviços de engenharia: inciso I; demais: inciso II.</p></div>
          <div className="tw"><table className="t">
            <thead><tr><th>Natureza</th><th>Inciso</th><th className="r">Planejado</th><th className="r">Em processos</th><th className="r">Por dispensa</th><th className="r">Limite</th><th>Situação</th></tr></thead>
            <tbody>{d.resumo.map((r: any) => (
              <tr key={r.classe}><td>{r.classe}</td><td>{r.inciso}</td><td className="r">{brl(r.planejado)}</td><td className="r">{brl(r.processos)}</td><td className="r">{brl(r.dispensas)}</td><td className="r">{brl(r.limite)}</td>
                <td>{r.alerta === "excede" ? <span className="pill bad">Dispensas passam do limite</span> : r.alerta === "planejado_excede" ? <span className="pill cur">Planejado passa do limite</span> : r.alerta === "sem_limite" ? <span className="pill cur">Limite não cadastrado</span> : <span className="pill ok">Regular</span>}</td></tr>))}</tbody>
          </table></div>
        </section>

        <section className="panel">
          <div className="pad-s"><h2>Itens do plano</h2></div>
          {d.itens.length === 0 ? <p className="pad-s muted">Nenhum item cadastrado para {ano}. Use o formulário abaixo para incluir as demandas do exercício.</p> :
            <div className="tw"><table className="t">
              <thead><tr><th>Descrição</th><th>Natureza</th><th>Tipo</th><th>Trim.</th><th>Área</th><th className="r">Valor</th><th /></tr></thead>
              <tbody>{d.itens.map((i: any) => (
                <tr key={i.id}><td>{i.descricao}</td><td className="small">{i.classe}</td><td className="small">{TIPOS[i.tipo as keyof typeof TIPOS]}</td><td>{i.trimestre ?? "—"}</td><td className="small">{i.requisitante}</td><td className="r">{brl(i.valor_estimado)}</td>
                  <td className="r">{pode && <><button className="lnk" onClick={() => setF({ id: i.id, descricao: i.descricao, classe: i.classe, tipo: i.tipo, valor: fmtNum(i.valor_estimado), trimestre: i.trimestre ? String(i.trimestre) : "", requisitante: i.requisitante })}>Editar</button>{tem(eu, "contratacao") && <> · <button className="lnk" onClick={() => remover(i.id)}>Remover</button></>}</>}</td></tr>))}</tbody>
            </table></div>}
          {pode && <form className="pad stack" onSubmit={salvar} style={{ borderTop: "1px solid var(--line)" }}>
            <h3>{f.id ? "Editar item" : "Incluir item"}</h3>
            <div className="form">
              <label className="wide">Descrição<input {...c("descricao")} required minLength={3} /></label>
              <label>Natureza / ramo<input {...c("classe")} placeholder="ex.: material de expediente" /></label>
              <label>Tipo<select {...c("tipo")}>{Object.entries(TIPOS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
              <label>Valor estimado (R$)<input {...c("valor")} inputMode="decimal" required /></label>
              <label>Trimestre<select {...c("trimestre")}><option value="">—</option>{[1, 2, 3, 4].map((t) => <option key={t}>{t}</option>)}</select></label>
              <label>Área requisitante<input {...c("requisitante")} /></label>
            </div>
            {msg && <p className={"note " + (msg.tipo ?? "")}>{msg.t}</p>}
            <div className="tools"><button className="btn pri">{f.id ? "Salvar alterações" : "Incluir no plano"}</button>{f.id > 0 && <button type="button" className="btn" onClick={() => setF({ ...vazio })}>Cancelar edição</button>}</div>
          </form>}
        </section>

        {d.fora_do_plano.length > 0 && <section className="panel">
          <div className="pad-s"><h2>Processos sem item do plano</h2><p className="small muted">Precisam de justificativa no DFD e no ETP (art. 18, § 1º, II).</p></div>
          <div className="tw"><table className="t"><tbody>{d.fora_do_plano.map((x: any) => (
            <tr key={x.id}><td className="mono">{x.protocolo}</td><td><Link to={`/processos/${x.id}`}>{x.objeto}</Link></td><td className="r">{brl(x.valor_estimado)}</td></tr>))}</tbody></table></div>
        </section>}
      </>}
    </>
  );
}
