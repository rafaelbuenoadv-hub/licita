import { useState, useImperativeHandle, type Ref } from "react";
import { ETAPAS, type Valores } from "../../../shared/etapas";
import { api } from "../api";
import { CamposEtapa } from "./CamposEtapa";

/** Uma entrada antecipada para os mesmos campos do ETP, sem criar outro documento. */
export function PlanejamentoEtp({ processo, editavel, recarregar, ref }: { processo: any; editavel: boolean; recarregar: () => Promise<unknown>; ref?: Ref<{salvar:()=>Promise<boolean>}> }) {
  const etapa = ETAPAS.find((e) => e.id === "etp")!;
  const iniciais = new Set(["i", "ii", "iii", "iv", "v"]);
  const [anterior, setAnterior] = useState<Valores>(processo.campos.etp ?? {});
  const [valores, setValores] = useState<Valores>({ ...processo.sugestoes_campos.etp, ...anterior });
  const [sujo, setSujo] = useState(Object.keys(processo.sugestoes_campos.etp ?? {}).some((k)=>iniciais.has(k))), [ocupado, setOcupado] = useState(false), [aviso, setAviso] = useState("");
  const salvar = async () => {
    if (!sujo) return true;
    setOcupado(true); setAviso("");
    try {
      const parcial = Object.fromEntries(Object.entries(valores).filter(([k]) => iniciais.has(k)));
      await api.put(`/processos/${processo.id}/etp/rascunho`, { valores: parcial, anterior });
      setAnterior({ ...anterior, ...parcial }); setSujo(false); await recarregar();
      setAviso("Rascunho salvo no mesmo ETP. Prossiga para a pesquisa de preços e conclua o estudo depois."); return true;
    } catch(e) { setAviso(e instanceof Error ? e.message : "Não foi possível salvar."); return false; }
    finally { setOcupado(false); }
  };
  useImperativeHandle(ref,()=>({salvar}));
  return <>
    <p className="note">ETP em elaboração. As informações salvas aqui estarão na Conclusão do ETP. Nenhum documento separado é emitido nesta etapa.</p>
    <CamposEtapa e={{...etapa, campos:etapa.campos.filter((c)=>iniciais.has(c.id))}} p={processo} valores={valores} editavel={editavel} sujo={sujo} gravando={ocupado} sugeridos={[]}
      mudar={(v)=>{setValores(v);setSujo(true);}} salvar={salvar} />
    {aviso && <p className="note" role="status">{aviso}</p>}
  </>;
}
