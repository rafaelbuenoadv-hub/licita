export const UFS_PNCP = "AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO".split(" ");
export const SITUACOES_PNCP = {
  todos: "Todos",
  recebendo_proposta: "Recebendo propostas",
  propostas_encerradas: "Em julgamento / propostas encerradas",
  encerradas: "Concluídos / encerrados",
};

export interface ResultadoPncp {
  control: string;
  organization: string;
  sourceUrl: string;
  description: string;
  itemNumber: number;
  unit: string;
  quantity: number;
  unitValue: number;
  state: string;
  municipality: string;
  modality: string;
  procurementNumber: string;
  processNumber: string;
  statusName: string;
  publicationDate: string;
  proposalOpeningDate: string;
}
