export type OndeConferencia = "dados" | "conferencia" | "minuta" | "config" | "campos" | "anexos";
export interface PendenciaProcesso {
  etapa: string;
  codigo: string;
  texto: string;
  onde: OndeConferencia;
  alvo?: string;
  bloqueia: boolean;
}
export interface ResultadoEtapa {
  id: string;
  nome: string;
  documento: string | null;
  versao: number | null;
  pendencias: PendenciaProcesso[];
}
export interface ConferenciaCompleta {
  verificado_em: string;
  pronto: boolean;
  resumo: { impeditivas: number; avisos: number; documentos_previstos: number; documentos_gerados: number; arquivos: number; arquivos_gerais: number };
  etapas: ResultadoEtapa[];
  pendencias: PendenciaProcesso[];
}
/** IDs reais da tela, para abrir a etapa e posicionar a correção. */
export function focoDaPendencia(p: Pick<PendenciaProcesso, "onde" | "alvo" | "etapa">) {
  if (p.onde === "minuta") return "minuta-etapa";
  if (p.onde === "conferencia") return p.alvo ? `c-${p.alvo}` : undefined;
  if (p.onde === "dados") return p.alvo ? `p-${p.alvo}` : "dados-processo";
  if (p.onde === "anexos") return p.alvo ?? `anexos-${p.etapa}`;
  if (p.onde === "campos") return p.alvo === "solicitacao" ? "pedidos-secretarias" : p.alvo ? `campo-${p.alvo}` : undefined;
  return undefined;
}
