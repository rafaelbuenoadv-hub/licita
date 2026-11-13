import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, brl } from "../api";
import { useEu } from "../main";

export function Painel() {
  const { eu, ia } = useEu();
  const [d, setD] = useState<any>(null);
  const [erro, setErro] = useState("");
  const nav = useNavigate();
  useEffect(() => { api.get("/painel").then(setD).catch((e) => setErro(e.message)); }, []);
  if (erro) return <p className="note bad">{erro}</p>;
  if (!d) return <p className="muted">Carregando painel…</p>;
  const alertasContrato = d.contratos.alertas as any[];
  return (
    <>
      <div className="row"><div><span className="lbl">Exercício {d.ano}</span><h1>Bom trabalho, {eu.nome.split(" ")[0]}</h1></div>
        <Link className="btn pri" to="/processos/novo">Novo processo</Link></div>
      {!ia.disponivel && <p className="note">A IA não está configurada neste servidor. A trilha, as conferências e as minutas funcionam normalmente; peça ao administrador para definir a chave da API.</p>}
      <div className="kpis">
        <div className="panel kpi"><span className="lbl">Processos em preparo</span><b>{d.processos.em_preparo}</b></div>
        <div className="panel kpi"><span className="lbl">Parados há 15 dias ou mais</span><b>{d.processos.parados.length}</b></div>
        <div className="panel kpi"><span className="lbl">Contratos vigentes</span><b>{d.contratos.vigentes}</b></div>
        <div className="panel kpi"><span className="lbl">Alertas de contrato</span><b>{alertasContrato.length}</b></div>
      </div>

      <section className="panel">
        <div className="pad-s row"><h2>Onde estão os processos</h2><span className="small muted">em preparo, por etapa</span></div>
        <div className="tw"><table className="t"><tbody>
          {d.processos.por_etapa.map((e: any, i: number) => (
            <tr key={i}><td className="mono muted" style={{ width: 30 }}>{i + 1}</td><td>{e.etapa}</td>
              <td style={{ width: "50%" }}><span className="bar" aria-hidden>{Array.from({ length: Math.min(e.total, 20) }, (_, k) => <i key={k} className="cur" />)}</span></td>
              <td className="r">{e.total}</td></tr>))}
        </tbody></table></div>
      </section>

      {d.fracionamento.length > 0 && (
        <section className="panel">
          <div className="pad-s"><h2>Atenção ao fracionamento</h2><p className="small muted">Dispensas por valor da mesma natureza no exercício (art. 75, § 1º).</p></div>
          {d.fracionamento.map((f: any, i: number) => (
            <div key={i} className={"alerta" + (f.alerta === "excede" ? " alto" : "")}>
              <div><b>{f.classe}</b> · dispensas somam {brl(f.dispensas)}{f.limite != null ? ` · limite do inciso ${f.inciso}: ${brl(f.limite)}` : ` · limite do inciso ${f.inciso} não cadastrado para ${d.ano}`}
                <div className="small muted">{f.alerta === "excede" ? "As dispensas já passam do limite. Reavalie a forma de contratação." : f.alerta === "planejado_excede" ? "O planejado no PCA para esta natureza passa do limite: as próximas compras não podem ir por dispensa." : "Cadastre o limite do ano em Configurações."}</div></div>
            </div>))}
          <div className="pad-s"><Link to="/pca">Abrir o plano de contratações</Link></div>
        </section>
      )}

      <section className="panel">
        <div className="pad-s"><h2>Contratos que pedem providência</h2></div>
        {alertasContrato.length === 0 ? <p className="pad-s muted">Nenhum alerta nos contratos vigentes.</p> :
          alertasContrato.map((a, i) => (
            <div key={i} className={"alerta " + a.nivel} role="link" style={{ cursor: "pointer" }} onClick={() => nav(`/contratos/${a.contrato_id}`)}>
              <div><b className="mono">{a.numero}</b> · {a.contratada}<div className="small">{a.texto}</div></div>
            </div>))}
      </section>

      <section className="panel">
        <div className="pad-s"><h2>Processos parados</h2><p className="small muted">Sem movimentação há 15 dias ou mais.</p></div>
        {d.processos.parados.length === 0 ? <p className="pad-s muted">Nenhum processo parado.</p> :
          <div className="tw"><table className="t"><tbody>
            {d.processos.parados.map((p: any) => (
              <tr key={p.id} className="link" onClick={() => nav(`/processos/${p.id}`)}>
                <td className="mono">{p.protocolo}</td><td>{p.objeto}</td><td>{p.etapa}</td><td className="r">{p.parado_dias} dias</td></tr>))}
          </tbody></table></div>}
      </section>
    </>
  );
}
