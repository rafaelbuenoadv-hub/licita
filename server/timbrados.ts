import { readFile } from "node:fs/promises";
import { ehMunicipioIbaiti } from "./municipio-ibaiti.js";

const modelos = [
  { codigo: "semad", nome: "Administração", cabecalho: 1596 / 286, rodape: 1 },
  { codigo: "sapmat", nome: "Agricultura, Pecuária, Meio Ambiente e Turismo", cabecalho: 1546 / 287, rodape: 2 },
  { codigo: "seas", nome: "Assistência Social", cabecalho: 1580 / 286, rodape: 3 },
  { codigo: "csci", nome: "Controle Interno", cabecalho: 1336 / 286, rodape: 1 },
  { codigo: "sece", nome: "Cultura, Esporte e Lazer", cabecalho: 1327 / 286, rodape: 1 },
  { codigo: "seduc", nome: "Educação", cabecalho: 1499 / 286, rodape: 4 },
  { codigo: "sefi", nome: "Finanças", cabecalho: 1458 / 287, rodape: 1 },
  { codigo: "semic", nome: "Indústria e Comércio", cabecalho: 1598 / 286, rodape: 5 },
  { codigo: "sovsu", nome: "Obras, Viação e Serviços Urbanos", cabecalho: 1461 / 286, rodape: 6 },
  { codigo: "proge", nome: "Procuradoria Geral", cabecalho: 1510 / 287, rodape: 1 },
  { codigo: "smte", nome: "Trabalho e Emprego", cabecalho: 1623 / 287, rodape: 5 },
];
const proporcoesRodape = [1679 / 106, 1679 / 106, 1371 / 84, 1670 / 93, 1497 / 84, 1679 / 100];
type Orgao = { nome: string; cnpj: string | null } | undefined;

export function timbradosDoOrgao(orgao: Orgao) {
  return orgao && ehMunicipioIbaiti(orgao) ? modelos.map(({ codigo, nome }) => ({ codigo, nome })) : [];
}

export async function lerTimbrado(orgao: Orgao, codigo: unknown) {
  if (!orgao || !ehMunicipioIbaiti(orgao)) return undefined;
  const modelo = modelos.find((m) => m.codigo === codigo);
  if (!modelo) return undefined;
  const caminho = new URL("./timbrados/", import.meta.url);
  const [cabecalho, rodape] = await Promise.all([
    readFile(new URL(`${modelo.codigo}.png`, caminho)),
    readFile(new URL(`rodape-${modelo.rodape}.png`, caminho)),
  ]);
  return {
    cabecalho: { dados: cabecalho, proporcao: modelo.cabecalho },
    rodape: { dados: rodape, proporcao: proporcoesRodape[modelo.rodape - 1] },
  };
}
