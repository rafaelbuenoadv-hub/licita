import type { PoolClient } from "pg";
import { pool } from "../../db.js";
import { ErroHttp } from "../../erros.js";
import type { RegistrosCentrais, IdentificacaoCentral, DemandaCentral, CampoCentral, OrcamentoCentral, PcaCentral, MinutaCentral, AnexoCentral, RevisaoCentral } from "../../../shared/processo-central.js";

/** O chamador deve fornecer o órgão do usuário autenticado, nunca o órgão informado pelo cliente. */
export async function lerRegistrosCentrais(c: PoolClient, processoId: number, orgaoId: number): Promise<RegistrosCentrais> {
  const params = [processoId, orgaoId];
  const p = (await c.query<IdentificacaoCentral>(`
    select id, orgao_id, protocolo, numero, procedimento, objeto, tipo, via,
      requisitante, areas_adicionais, ano, situacao, pca_item_id, valor_estimado::text,
      classe, normas, obs, atualizado_em::text
    from processos where id=$1 and orgao_id=$2 and excluido_em is null`, params)).rows[0];
  if (!p) throw new ErroHttp(404, "Processo não encontrado.");
  const demandas = (await c.query<DemandaCentral>(`
    select s.id,s.secretaria,s.referencia,s.objeto,s.justificativa,s.informacoes,s.itens,s.topicos_adicionais,s.orcamentos_ocultos
    from solicitacoes_processo s join processos p on p.id=s.processo_id
    where p.id=$1 and p.orgao_id=$2 and p.excluido_em is null order by s.id`, params)).rows;
  const campos = (await c.query<CampoCentral>(`
    select e.etapa,e.valores,e.atualizado_em::text from campos_etapa e join processos p on p.id=e.processo_id
    where p.id=$1 and p.orgao_id=$2 and p.excluido_em is null order by e.etapa`, params)).rows;
  const orcamentos = (await c.query<OrcamentoCentral>(`
    select o.id,o.fornecedor,o.fornecedor_manual,o.valor::text,o.nome,o.dados,o.lido_em::text
    from orcamentos o join processos p on p.id=o.processo_id
    where p.id=$1 and p.orgao_id=$2 and p.excluido_em is null order by o.id`, params)).rows;
  const pca = (await c.query<PcaCentral>(`
    select i.id,i.ano,i.descricao,i.ordem_oficial,i.periodo_oficial
    from processos p join pca_itens i on i.id=p.pca_item_id and i.orgao_id=p.orgao_id
    where p.id=$1 and p.orgao_id=$2 and p.excluido_em is null`, params)).rows[0] ?? null;
  const documentos = (await c.query<MinutaCentral>(`
    select m.etapa,m.versao,m.origem,m.criado_em::text from minutas m join processos p on p.id=m.processo_id
    where p.id=$1 and p.orgao_id=$2 and p.excluido_em is null order by m.etapa,m.versao`, params)).rows;
  const anexos = (await c.query<AnexoCentral>(`
    select a.id,a.nome,a.etapa,null::int as solicitacao_id from anexos a join processos p on p.id=a.processo_id
    where p.id=$1 and p.orgao_id=$2 and p.excluido_em is null
    union all
    select a.id,a.nome,'solicitacao' as etapa,s.id as solicitacao_id
    from solicitacao_anexos a join solicitacoes_processo s on s.id=a.solicitacao_id join processos p on p.id=s.processo_id
    where p.id=$1 and p.orgao_id=$2 and p.excluido_em is null order by etapa,solicitacao_id,id`, params)).rows;
  const revisoes = (await c.query<RevisaoCentral>(`
    select r.etapa,r.motivo,r.em::text from revisoes_documentos r join processos p on p.id=r.processo_id
    where p.id=$1 and p.orgao_id=$2 and p.excluido_em is null order by r.etapa`, params)).rows;
  const checagens = (await c.query<{item:string}>(`
    select e.item from checagens e join processos p on p.id=e.processo_id
    where p.id=$1 and p.orgao_id=$2 and p.excluido_em is null order by e.item`, params)).rows.map(x=>x.item);
  return {identificacao:p,demandas,campos,orcamentos,pca,documentos,anexos,revisoes,checagens};
}

/** Snapshot consistente e somente leitura; não usa tx(), que permite escritas. */
export async function consultarRegistrosCentrais(processoId:number, orgaoId:number): Promise<RegistrosCentrais> {
  if (!Number.isInteger(processoId) || processoId<=0 || !Number.isInteger(orgaoId) || orgaoId<=0)
    throw new ErroHttp(400,"Identificação inválida.");
  const c=await pool.connect();
  let descartar = false;
  try {
    await c.query("begin isolation level repeatable read read only");
    const dados=await lerRegistrosCentrais(c,processoId,orgaoId);
    await c.query("commit");
    return dados;
  } catch (e) {
    try { await c.query("rollback"); } catch { descartar = true; }
    throw e;
  } finally {
    c.release(descartar);
  }
}
