import { pendencias } from "./etapas.js";

export const ASSINATURA_SOLICITACAO = [
  "@ [[Nome do secretário]]",
  "@ Titular da área requisitante · [[Secretaria]]",
  "@ Portaria de nomeação nº [[Portaria de nomeação]]",
].join("\n");

export const MODELO_SOLICITACAO = {
  id: "solicitacao",
  nome: "Solicitação",
  doc: "Solicitação da secretaria",
  modelo: [
    "# SOLICITAÇÃO DE CONTRATAÇÃO",
    "Protocolo [[Protocolo]]",
    "",
    "## Unidade requisitante",
    "[[Secretaria]]",
    "",
    "## Objeto",
    "[[Objeto]]",
    "",
    "## Justificativa da necessidade",
    "[[Justificativa da contratação]]",
    "",
    "## Quantidades e prazo",
    "[[Quantidades e prazo de atendimento]]",
    "",
    ASSINATURA_SOLICITACAO,
  ].join("\n"),
};

export function camposDaSolicitacao(texto: string, dados: {
  secretaria: string;
  referencia: string;
  protocolo: string;
  objeto: string;
  titular?: { nome: string; portaria: string | null } | null;
}) {
  const valores: Record<string, string> = {
    secretaria: dados.secretaria,
    protocolo: dados.protocolo,
    objeto: dados.objeto,
    referencia: dados.referencia,
    "nome do secretario": dados.titular?.nome ?? "",
    "portaria de nomeacao": dados.titular?.portaria ?? "",
  };
  return Object.fromEntries(pendencias(texto).flatMap(({ i, rotulo }) => {
    const chave = rotulo.replace(/^preencher:\s*/i, "").normalize("NFD").replace(/\p{M}/gu, "").trim().toLowerCase();
    return Object.hasOwn(valores, chave) && valores[chave] ? [[i, valores[chave]]] : [];
  }));
}
