import { aplicarPendencias } from "../shared/etapas.js";
import { camposDaSolicitacao, MODELO_SOLICITACAO } from "../shared/solicitacao.js";
import { q1 } from "./db.js";
import { localizadorDeTitulares, preencherPortarias } from "./portarias.js";

export async function modeloSolicitacao(orgao: number) {
  const modelo = await q1<{ texto: string }>("select texto from modelos where orgao_id=$1 and etapa=$2", [orgao, MODELO_SOLICITACAO.id]);
  return modelo?.texto ?? MODELO_SOLICITACAO.modelo;
}

export async function preencherSolicitacao(
  processo: { orgao_id: number; protocolo: string; objeto: string },
  dados: { secretaria: string; referencia: string; descricao: string },
) {
  if (!dados.descricao.includes("[[")) return dados.descricao;
  const procurar = await localizadorDeTitulares(processo.orgao_id);
  const titular = procurar(dados.secretaria);
  const valores = camposDaSolicitacao(dados.descricao, { ...processo, ...dados, titular });
  const texto = aplicarPendencias(dados.descricao, valores).texto;
  return titular ? preencherPortarias(texto, { secretarios: [titular], todosIdentificados: true, areasSemCadastro: [] }) : texto;
}
