import { useId, useRef, useState } from "react";
import { ETAPAS } from "../../../shared/etapas";
import { destinoDosAnexos } from "../../../shared/anexos-etapas";
import { api, dataHora } from "../api";

interface Anexo { id:number; nome:string; etapa:string; criado_em:string; tem_arquivo:boolean }
interface Processo { id:number; situacao:string; anexos:Anexo[] }
const FORMATOS = ".pdf,.docx,.xlsx,.xls,.jpg,.jpeg,.png,.txt,.md,.csv";
const nomeDaEtapa = (id:string) => ETAPAS.find((e)=>e.id===id)?.nome ?? "Processo em geral";

export function AnexosEtapa({ processo, etapa, podeIncluir, podeExcluir, recarregar }: {
  processo:Processo; etapa?:string; podeIncluir:boolean; podeExcluir:boolean; recarregar:()=>Promise<unknown>;
}) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [referencia, setReferencia] = useState(etapa ?? "");
  const [ocupado, setOcupado] = useState(false);
  const [mensagem, setMensagem] = useState<{texto:string;erro?:boolean}>();
  const lista = etapa ? processo.anexos.filter((a)=>a.etapa===etapa) : processo.anexos;
  const destino = etapa ? destinoDosAnexos(etapa) : "gerais";
  const enviar = async (arquivos:File[]) => {
    if (!arquivos.length || ocupado) return;
    if (arquivos.some((f)=>!f.size || f.size>20*1024*1024)) {
      setMensagem({texto:"Anexe arquivos não vazios, de até 20 MB cada.",erro:true}); return;
    }
    setOcupado(true); setMensagem(undefined);
    let incluidos=0;
    try {
      for (const arquivo of arquivos) {
        setMensagem({texto:`Enviando ${incluidos+1} de ${arquivos.length}: ${arquivo.name}…`});
        const dados=new FormData();dados.set("arquivo",arquivo);dados.set("etapa",etapa ?? referencia);
        await api.post(`/processos/${processo.id}/anexos`,dados);incluidos++;
      }
      setMensagem({texto:`${incluidos===1 ? "Arquivo anexado" : `${incluidos} arquivos anexados`}. Os documentos acompanharão a etapa na montagem do processo.`});
    } catch(e) {
      setMensagem({texto:`${incluidos ? `${incluidos} arquivo(s) já anexado(s). ` : ""}${e instanceof Error ? e.message : "Não foi possível anexar o arquivo."}`,erro:true});
    } finally {await recarregar();setOcupado(false);}
  };
  const mudarReferencia = async (anexo:Anexo, nova:string) => {
    setOcupado(true);setMensagem(undefined);
    try {await api.put(`/processos/${processo.id}/anexos/${anexo.id}/referencia`,{etapa:nova});await recarregar();setMensagem({texto:"Etapa do anexo atualizada."});}
    catch(e) {setMensagem({texto:e instanceof Error ? e.message : "Não foi possível mover o anexo.",erro:true});}
    finally {setOcupado(false);}
  };
  const excluir = async (anexo:Anexo) => {
    setOcupado(true);setMensagem(undefined);
    try {await api.del(`/processos/${processo.id}/anexos/${anexo.id}`);await recarregar();setMensagem({texto:"Anexo removido."});}
    catch(e) {setMensagem({texto:e instanceof Error ? e.message : "Não foi possível remover o anexo.",erro:true});}
    finally {setOcupado(false);}
  };
  return <section className={etapa ? "sec stack" : "panel pad stack"} aria-busy={ocupado} id={etapa ? `anexos-${etapa}` : "anexos-gerais"} tabIndex={-1}>
    <div className="row"><div><h3>{etapa ? "Anexos desta etapa" : "Todos os anexos"} <span className="small muted">({lista.length})</span></h3>
      <p className="small muted">{etapa ? destino !== etapa ? `Na montagem, estes arquivos acompanham ${nomeDaEtapa(destino)}.` : "Na montagem em PDF ou Word, estes arquivos aparecem logo após o documento desta etapa."
        : "Confira a vinculação dos arquivos. Anexos sem etapa definida ficam ao final do processo."}</p></div>
      {podeIncluir && <div className="tools">
        {!etapa && <label>Etapa dos novos anexos<select disabled={ocupado} value={referencia} onChange={(e)=>setReferencia(e.target.value)}>
          <option value="">Processo em geral</option>{ETAPAS.map((e)=><option key={e.id} value={e.id}>{e.nome}</option>)}
        </select></label>}
        <button type="button" className="btn" disabled={ocupado} onClick={()=>inputRef.current?.click()}>{ocupado ? "Aguarde…" : "Anexar arquivos"}</button>
        <input ref={inputRef} id={inputId} aria-label={etapa ? `Anexar arquivos a ${nomeDaEtapa(etapa)}` : "Anexar arquivos ao processo"} hidden type="file" multiple accept={FORMATOS} disabled={ocupado}
          onChange={(e)=>{const arquivos=Array.from(e.target.files??[]);e.target.value="";void enviar(arquivos);}} />
      </div>}
    </div>
    {etapa === "dfd" && <p className="small muted">O DFD também será acompanhado dos documentos anexados à Instrução e ao PAC.</p>}
    {etapa === "etp" && <p className="small muted">Os anexos do planejamento inicial acompanham este mesmo ETP.</p>}
    <p className="small muted">PDF, Word, planilhas, imagens e texto. Até 20 MB por arquivo. Documentos digitalizados podem ser anexados sem leitura por IA.</p>
    {mensagem && <p className={`note ${mensagem.erro ? "bad" : "ok"}`} role={mensagem.erro ? "alert" : "status"}>{mensagem.texto}</p>}
    {lista.length ? <div className="tw"><table className="t"><thead><tr><th>Arquivo</th><th>Etapa</th><th>Juntado em</th><th /></tr></thead><tbody>
      {lista.map((a)=><tr key={a.id}>
        <td>{a.tem_arquivo ? <a href={`/api/processos/${processo.id}/anexos/${a.id}/arquivo`}>{a.nome}</a> : <>{a.nome}<span className="small muted"> · Registro em texto</span></>}</td>
        <td>{podeIncluir ? <select aria-label={`Etapa do anexo ${a.nome}`} disabled={ocupado} value={a.etapa ?? ""} onChange={(e)=>void mudarReferencia(a,e.target.value)}>
          <option value="">Processo em geral</option>{ETAPAS.map((e)=><option key={e.id} value={e.id}>{e.nome}</option>)}
        </select> : nomeDaEtapa(a.etapa)}</td>
        <td className="small muted">{dataHora(a.criado_em)}</td>
        <td>{podeExcluir && <button className="lnk" disabled={ocupado} onClick={()=>void excluir(a)}>Remover</button>}</td>
      </tr>)}
    </tbody></table></div> : <p className="small muted">{etapa ? "Nenhum anexo vinculado a esta etapa." : "Nenhum anexo cadastrado."}</p>}
  </section>;
}
