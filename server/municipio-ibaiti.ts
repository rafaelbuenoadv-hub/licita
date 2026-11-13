export const CNPJ_IBAITI = "77008068000141";

export function ehMunicipioIbaiti(orgao: { nome: string; cnpj: string | null }) {
  const cnpj = orgao.cnpj?.replace(/\D/g, "");
  if (cnpj) return cnpj === CNPJ_IBAITI;
  const nome = orgao.nome.normalize("NFD").replace(/\p{M}/gu, "").trim().toLowerCase();
  return /^(?:(?:municipio|prefeitura(?: municipal)?) de )?ibaiti(?:\s*[-/]\s*pr)?$/.test(nome);
}
