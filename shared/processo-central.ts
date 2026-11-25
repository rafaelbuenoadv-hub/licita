/** Contrato da Entrega A: projeção de leitura do legado, sem consolidação nem validação formal. */
export interface IdentificacaoCentral {
  id: number; orgao_id: number; protocolo: string; numero: string;
  procedimento: string; objeto: string; tipo: string; via: string;
  requisitante: string; areas_adicionais: string[]; ano: number;
  situacao: string; pca_item_id: number | null; valor_estimado: string | null;
  classe: string; normas: string; obs: string; atualizado_em: string;
}
export interface DemandaCentral {
  id: number; secretaria: string; referencia: string; objeto: string;
  justificativa: string; informacoes: string; itens: unknown[];
  topicos_adicionais: unknown[]; orcamentos_ocultos: unknown[];
}
export interface CampoCentral {
  etapa: string; valores: Record<string, unknown>; atualizado_em: string;
}
export interface OrcamentoCentral {
  id: number; fornecedor: string; fornecedor_manual: string | null;
  valor: string | null; nome: string; dados: unknown; lido_em: string | null;
}
export interface PcaCentral {
  id: number; ano: number; descricao: string; ordem_oficial: number | null;
  periodo_oficial: string | null;
}
export interface MinutaCentral {
  etapa: string; versao: number; origem: string; criado_em: string;
}
export interface AnexoCentral {
  id: number; nome: string; etapa: string; solicitacao_id: number | null;
}
export interface RevisaoCentral { etapa: string; motivo: string; em: string }
export interface RegistrosCentrais {
  identificacao: IdentificacaoCentral;
  demandas: DemandaCentral[];
  campos: CampoCentral[];
  orcamentos: OrcamentoCentral[];
  pca: PcaCentral | null;
  documentos: MinutaCentral[];
  anexos: AnexoCentral[];
  revisoes: RevisaoCentral[];
  checagens: string[];
}
export interface ProcessoCentral extends RegistrosCentrais {
  secretarias: string[];
  itens: { solicitacao_id: number; secretaria: string; indice: number; dado: unknown }[];
  versaoDados: string;
  /** Nenhum preço é validado pelo núcleo de leitura. */
  modo: "leitura_legado";
}
