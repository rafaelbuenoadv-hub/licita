import { consultarRegistrosCentrais } from "./repositorio.js";
import { projetarProcessoCentral } from "./projecao.js";
import type { ProcessoCentral } from "../../../shared/processo-central.js";

/** Núcleo interno: o órgão deve ser obtido da sessão autenticada pelo chamador. */
export async function obterProcessoCentral(processoId:number, orgaoId:number):Promise<ProcessoCentral> {
  return projetarProcessoCentral(await consultarRegistrosCentrais(processoId,orgaoId));
}
export { projetarProcessoCentral } from "./projecao.js";

import { consolidarItens,type ConfirmacaoGrupo } from "./consolidacao.js";
import { precificarGrupo } from "./precificacao.js";
import { validarCalculo } from "./validacao.js";
import { compararLegado } from "./comparacao-legado.js";

/** Modo paralelo: não persiste, não valida formalmente e não substitui os documentos atuais. */
export async function obterCalculoCentral(processoId:number,orgaoId:number,confirmacoes:ConfirmacaoGrupo[]=[]){
  const processo=await obterProcessoCentral(processoId,orgaoId);
  const {grupos,candidatos}=consolidarItens(processo.itens,confirmacoes);
  const itens=grupos.map(precificarGrupo),validacao=validarCalculo(itens);
  return {modo:"comparacao" as const,versaoDados:processo.versaoDados,confirmacoes,itens,candidatos,validacao,
    comparacao:compararLegado(processo,validacao.valorCalculado)};
}
