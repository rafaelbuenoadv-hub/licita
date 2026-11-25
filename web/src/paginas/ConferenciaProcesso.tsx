import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api, dataHora } from "../api";
import { focoDaPendencia, type ConferenciaCompleta } from "../../../shared/conferencia-processo";

export function ConferenciaProcesso({ processo, pendentes, salvarPendentes, irPara }: {
  processo: { id:number }; pendentes:boolean; salvarPendentes:()=>Promise<boolean>; irPara:(etapa:string,foco?:string)=>void;
}) {
  const [resultado,setResultado]=useState<ConferenciaCompleta|null>(null);
  const [ocupado,setOcupado]=useState(false),[erro,setErro]=useState("");
  const controle=useRef<AbortController|null>(null);
  useEffect(()=>{setResultado(null);setErro("");},[processo,pendentes]);
  useEffect(()=>()=>controle.current?.abort(),[]);
  const conferir=async()=>{
    if(ocupado) return;
    setOcupado(true);setErro("");setResultado(null);
    try {
      if(!(await salvarPendentes())) return;
      const abortar=new AbortController();controle.current=abortar;
      const r=await api.get<ConferenciaCompleta>(`/processos/${processo.id}/conferencia-completa`,abortar.signal);
      if(!abortar.signal.aborted) setResultado(r);
    } catch(e) {
      if(!controle.current?.signal.aborted) setErro(e instanceof Error ? e.message : "Não foi possível conferir o processo.");
    } finally {setOcupado(false);controle.current=null;}
  };
  return <section className="sec stack" aria-busy={ocupado} id="conferencia-processo-completo" tabIndex={-1}>
    <div className="row"><div><h3>Conferência do processo completo</h3>
      <p className="small muted">Verifica todas as etapas, documentos salvos, campos pendentes, revisões, valores e anexos cadastrados.</p></div>
      <button type="button" className="btn pri" disabled={ocupado} onClick={()=>void conferir()}>{ocupado ? "Conferindo processo…" : "Conferir processo completo"}</button>
    </div>
    {erro && <p className="note bad" role="alert">{erro}</p>}
    {ocupado && <p className="small muted" role="status">Reunindo as verificações de todas as etapas…</p>}
    {resultado && <div className="stack" role="status" aria-live="polite">
      <div className={`note ${resultado.pronto ? resultado.resumo.avisos ? "" : "ok" : "bad"}`}>
        <strong>{!resultado.pronto ? "Há pendências que impedem o encaminhamento." : resultado.resumo.avisos ? "Nenhuma pendência impeditiva. Confira os avisos." : "Nenhuma pendência encontrada nas verificações automáticas."}</strong>
        <p>{resultado.resumo.impeditivas} pendência(s) impeditiva(s) · {resultado.resumo.avisos} aviso(s)</p>
        <p className="small">{resultado.resumo.documentos_gerados} de {resultado.resumo.documentos_previstos} documentos gerados · {resultado.resumo.arquivos} arquivo(s) cadastrado(s), dos quais {resultado.resumo.arquivos_gerais} sem etapa definida.</p>
        <p className="small muted">Conferido em {dataHora(resultado.verificado_em)}. Ao alterar os dados, refaça a conferência.</p>
      </div>
      {resultado.etapas.map((etapa)=><details key={etapa.id} className="panel box" open={etapa.pendencias.length>0}>
        <summary>{etapa.nome} · {etapa.pendencias.length ? `${etapa.pendencias.length} pendência(s)/aviso(s)` : "Sem pendências"}</summary>
        <div className="pad stack">
          <p className="small muted">{etapa.documento ? etapa.versao ? `${etapa.documento} · versão ${etapa.versao}` : `${etapa.documento} · ainda não gerado` : "Etapa de registro de informações, sem documento próprio."}</p>
          {etapa.pendencias.length>0 && <ul className="pends">{etapa.pendencias.map((p,i)=><li key={`${p.codigo}-${i}`} className={p.bloqueia ? "" : "aviso"}>
            <span>{p.bloqueia ? "" : "Aviso: "}{p.texto}</span>
            {p.onde==="config" ? <Link to="/config" className="btn sm">Abrir Configurações</Link>
              : <button type="button" className="btn sm" onClick={()=>irPara(p.etapa,focoDaPendencia(p))}>Corrigir</button>}
          </li>)}</ul>}
        </div>
      </details>)}
    </div>}
    <p className="small muted">A conferência usa os dados salvos e as marcações dos responsáveis. Este botão não valida assinaturas digitais e não protocola o processo.</p>
  </section>;
}
