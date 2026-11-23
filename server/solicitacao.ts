import { aplicarPendencias } from "../shared/etapas.js";
import { camposDaSolicitacao, documentoDaSolicitacao, MODELO_SOLICITACAO, type ItemSolicitacao } from "../shared/solicitacao.js";
import { q1 } from "./db.js";
import { localizadorDeTitulares, preencherPortarias } from "./portarias.js";

export async function modeloSolicitacao(orgao: number) {
  const modelo = await q1<{ texto: string }>("select texto from modelos where orgao_id=$1 and etapa=$2", [orgao, MODELO_SOLICITACAO.id]);
  return modelo?.texto ?? MODELO_SOLICITACAO.modelo;
}

export async function preencherSolicitacao(
  processo: { orgao_id: number; protocolo: string; objeto: string; prazo?: string },
  dados: { secretaria: string; referencia: string; descricao: string; objeto_solicitacao?: string; justificativa?: string; itens?: ItemSolicitacao[] },
) {
  // O quadro de itens entra antes de preencher os campos: assim um modelo com [[Itens]] não recebe o quadro duas vezes.
  const base = dados.itens === undefined ? dados.descricao : documentoDaSolicitacao(dados.descricao, dados.itens);
  if (!base.includes("[[")) return base;
  const procurar = await localizadorDeTitulares(processo.orgao_id);
  const titular = procurar(dados.secretaria);
  const valores = camposDaSolicitacao(base, { ...processo, ...dados, titular });
  const texto = aplicarPendencias(base, valores).texto;
  return titular ? preencherPortarias(texto, { secretarios: [titular], todosIdentificados: true, areasSemCadastro: [] }) : texto;
}
