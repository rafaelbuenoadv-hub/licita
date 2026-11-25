/** Etapas de coleta sem documento próprio acompanham a peça que utilizam. */
export function destinoDosAnexos(etapa: string) {
  if (etapa === "solicitacao" || etapa === "pac") return "dfd";
  if (etapa === "planejamento") return "etp";
  return ["protocolo", "dfd", "precos", "etp", "tr", "dot", "fiscal"].includes(etapa) ? etapa : "gerais";
}
