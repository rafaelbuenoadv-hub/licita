// Resultado da consulta de fornecedor pelo CNPJ e links oficiais das certidões de regularidade.

export interface CertidaoSancao { cadastro: string; situacao: "nada_consta" | "consta" | "indefinida"; observacao: string | null }
export interface ConsultaCnpj {
  cnpj: string;
  consultado_em: string;
  cadastro: {
    razao_social: string; nome_fantasia: string; situacao: string; data_situacao: string | null;
    porte: string; simples: boolean | null; cnae: string; municipio: string; abertura: string | null;
  } | null;
  /** Certidão consolidada do TCU: inidôneos (TCU), CNIA (CNJ), CEIS e CNEP (CGU). */
  certidoes: CertidaoSancao[] | null;
  codigo_tcu: string | null;
  falhas: string[];
}

/** Resumo gravado na cotação, para a análise de preços e o relatório. */
export interface VerificacaoFornecedor {
  consultado_em: string;
  situacao: string;
  porte: string;
  /** Cadastros em que consta registro (vazio = nada consta em todos os consultados). */
  sancoes: string[];
  /** false quando a certidão do TCU não pôde ser consultada. */
  sancoes_consultadas: boolean;
}

export function resumoDaConsulta(c: ConsultaCnpj): VerificacaoFornecedor {
  return {
    consultado_em: c.consultado_em.slice(0, 10),
    situacao: c.cadastro?.situacao ?? "",
    porte: c.cadastro?.porte ?? "",
    sancoes: (c.certidoes ?? []).filter((x) => x.situacao === "consta").map((x) => x.cadastro),
    sancoes_consultadas: c.certidoes != null,
  };
}

export const formatarCnpj = (c: string) => {
  const d = c.replace(/\D/g, "");
  return d.length === 14 ? d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5") : c;
};

/** Certidões de regularidade sem consulta automática gratuita (exigem captcha): emissão no site oficial. */
export const CERTIDOES_REGULARIDADE = [
  { id: "federal", nome: "Certidão conjunta de débitos federais e Dívida Ativa da União (Receita/PGFN)", url: "https://solucoes.receita.fazenda.gov.br/Servicos/certidaointernet/PJ/Emitir" },
  { id: "fgts", nome: "Certificado de Regularidade do FGTS (Caixa)", url: "https://consulta-crf.caixa.gov.br/consultacrf/pages/consultaEmpregador.jsf" },
  { id: "trabalhista", nome: "Certidão Negativa de Débitos Trabalhistas (TST)", url: "https://cndt-certidao.tst.jus.br/inicio.faces" },
  { id: "estadual", nome: "Certidão de regularidade fiscal estadual (Receita do Paraná)", url: "https://www.cdw.fazenda.pr.gov.br/cdw/emissao/certidaoAutomatica" },
  { id: "municipal", nome: "Certidão de regularidade fiscal municipal (Município sede do fornecedor)", url: "" },
] as const;
