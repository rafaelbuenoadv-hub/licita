import { q } from "./db.js";
import { CNPJ_IBAITI, ehMunicipioIbaiti } from "./municipio-ibaiti.js";

interface NormaOficial {
  esfera: "Federal" | "Municipal";
  tipo: "Decreto" | "Lei";
  numero: number;
  ano: number;
  assunto: string;
  fonte: string;
}

export async function normasOficiais(orgao: { nome: string; cnpj: string | null } | undefined) {
  if (!orgao) return [];
  const cnpj = ehMunicipioIbaiti(orgao) ? CNPJ_IBAITI : orgao.cnpj?.replace(/\D/g, "") ?? "";
  return q<NormaOficial>(
    `select 'Federal' as esfera, tipo, numero, ano, assunto, fonte from normas_federais
     union all
     select 'Municipal' as esfera, tipo, numero, ano, assunto, fonte from normas_municipais where cnpj=$1
     order by esfera, tipo, ano, numero`,
    [cnpj],
  );
}
