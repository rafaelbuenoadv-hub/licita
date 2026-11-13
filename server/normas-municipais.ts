import { q } from "./db.js";
import { CNPJ_IBAITI, ehMunicipioIbaiti } from "./municipio-ibaiti.js";

interface NormaMunicipal {
  tipo: "Decreto" | "Lei";
  numero: number;
  ano: number;
  assunto: string;
  fonte: string;
}

export async function normasOficiais(orgao: { nome: string; cnpj: string | null } | undefined) {
  if (!orgao) return [];
  const cnpj = ehMunicipioIbaiti(orgao) ? CNPJ_IBAITI : orgao.cnpj?.replace(/\D/g, "");
  if (!cnpj) return [];
  return q<NormaMunicipal>(
    "select tipo, numero, ano, assunto, fonte from normas_municipais where cnpj=$1 order by tipo, ano, numero",
    [cnpj],
  );
}
