import { consultarRegistrosCentrais } from "./repositorio.js";
import { projetarProcessoCentral } from "./projecao.js";
import type { ProcessoCentral } from "../../../shared/processo-central.js";

/** Núcleo interno: o órgão deve ser obtido da sessão autenticada pelo chamador. */
export async function obterProcessoCentral(processoId:number, orgaoId:number):Promise<ProcessoCentral> {
  return projetarProcessoCentral(await consultarRegistrosCentrais(processoId,orgaoId));
}
export { projetarProcessoCentral } from "./projecao.js";
