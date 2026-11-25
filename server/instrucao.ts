import type { PoolClient } from "pg";
import { resumoDaInstrucao, type DadosInstrucao } from "../shared/instrucao.js";
import type { Valores } from "../shared/etapas.js";

export async function registrosDaInstrucao(c: PoolClient, processo: number) {
  return (await c.query<DadosInstrucao>("select secretaria,objeto,justificativa,informacoes,itens,topicos_adicionais from solicitacoes_processo where processo_id=$1 order by id", [processo])).rows;
}

/** Atualiza apenas campos antes vazios ou iguais ao valor sugerido anteriormente. Preserva texto próprio de cada etapa. */
export async function sincronizarDadosDaInstrucao(c: PoolClient, processo: number, objetoProcesso: string, anteriores: DadosInstrucao[], usuario: number) {
  const antes = resumoDaInstrucao(anteriores), agora = resumoDaInstrucao(await registrosDaInstrucao(c, processo));
  const fontes = (x: typeof antes): Record<string, Valores> => ({
    dfd: { objeto: x.objeto || objetoProcesso, justificativa: x.justificativa, quantidade: x.quantidades },
    etp: { i: x.justificativa, iv: x.quantidades, vi: x.valorTexto },
  });
  const velhos = fontes(antes), novos = fontes(agora);
  const linhas = (await c.query<{ etapa: string; valores: Valores }>("select etapa,valores from campos_etapa where processo_id=$1 and etapa=any($2::text[]) for update", [processo, ["dfd", "etp"]])).rows;
  for (const linha of linhas) {
    const valores = { ...linha.valores };
    for (const [campo, valor] of Object.entries(novos[linha.etapa])) {
      const atual = valores[campo];
      if (!atual || atual === velhos[linha.etapa][campo]) valores[campo] = valor;
    }
    await c.query("update campos_etapa set valores=$1::jsonb,usuario_id=$2,atualizado_em=now() where processo_id=$3 and etapa=$4", [JSON.stringify(valores), usuario, processo, linha.etapa]);
  }
}
