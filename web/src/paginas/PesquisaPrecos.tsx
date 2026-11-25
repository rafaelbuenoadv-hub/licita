import { useEffect, useState, type FormEvent } from "react";
import { api, brl } from "../api";
import { CRITERIOS_PRECO, MOTIVOS_DESCARTE, normalizarCotacao, totalDosItens, valorDasCotacoes, type CriterioPreco, type ItemSolicitacao, type CotacaoItem } from "../../../shared/solicitacao";
import type { Valores } from "../../../shared/etapas";

interface Solicitacao { id: number; secretaria: string; referencia: string; itens: ItemSolicitacao[] }
interface Props {
  processo: { id: number; solicitacoes: Solicitacao[] };
  editavel: boolean;
  recarregar: () => Promise<any>;
  aoSalvar: (campos: Valores) => void;
  irAosItens: () => void;
}
const chaveCotacao = (c: CotacaoItem) => c.orcamento_id == null ? `n:${normalizarCotacao(c.fornecedor)}` : `o:${c.orcamento_id}`;
const usoDa = (c: CotacaoItem) => c.descarte ? "descartado" : c.apenas_referencia ? "referencia" : "calculo";

export function PesquisaPrecos({ processo, editavel, recarregar, aoSalvar, irAosItens }: Props) {
  const fonte = JSON.stringify(processo.solicitacoes.map(({ id, secretaria, referencia, itens }) => ({ id, secretaria, referencia, itens })));
  const [base, setBase] = useState(fonte);
  const [dados, setDados] = useState<Solicitacao[]>(() => JSON.parse(fonte));
  const [sujo, setSujo] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState<{ texto: string; erro?: boolean }>();
  useEffect(() => { if (!sujo) { setBase(fonte); setDados(JSON.parse(fonte)); } }, [fonte, sujo]);
  const mudarItem = (sid: number, i: number, alterar: (item: ItemSolicitacao) => ItemSolicitacao) => {
    setDados((lista) => lista.map((s) => s.id !== sid ? s : { ...s, itens: s.itens.map((item, j) => {
      if (i !== j) return item;
      const novo = alterar(item);
      return novo.cotacoes ? { ...novo, valor_unitario: valorDasCotacoes(novo.cotacoes, novo.criterio) } : novo;
    }) }));
    setSujo(true); setAviso(undefined);
  };
  const mudarCotacao = (sid: number, i: number, j: number, alterar: (c: CotacaoItem) => CotacaoItem) => mudarItem(sid, i, (item) => ({ ...item, cotacoes: item.cotacoes?.map((c, k) => k === j ? alterar(c) : c) }));
  const salvar = async (ev: FormEvent) => {
    ev.preventDefault(); if (ocupado || !editavel) return;
    setOcupado(true); setAviso(undefined);
    try {
      const originais = JSON.parse(base) as Solicitacao[];
      for (const s of dados) for (const item of s.itens) for (const c of item.cotacoes ?? []) if (c.descarte && !c.descarte.justificativa.trim()) throw new Error(`Justifique o descarte de ${c.fornecedor} no item ${item.descricao}.`);
      const r = await api.put<{ campos: Valores }>(`/processos/${processo.id}/pesquisa-precos`, { solicitacoes: dados.map((s) => ({
        id: s.id, itens_anteriores: originais.find((o) => o.id === s.id)!.itens,
        analises: s.itens.map((item, i) => ({ indice: i, criterio: item.criterio ?? "media", cotacoes: (item.cotacoes ?? []).map((c, j) => ({ indice: j, uso: usoDa(c), ...(c.descarte ? { descarte: c.descarte } : {}) })) })),
      })) });
      await recarregar(); aoSalvar(r.campos); setSujo(false);
      setAviso({ texto: "Tratamento dos preços salvo. Os valores da Solicitação e do relatório foram atualizados. Confira o relatório e a pasta antes de protocolar." });
    } catch (e) { setAviso({ texto: e instanceof Error ? e.message : "Não foi possível salvar a análise.", erro: true }); }
    finally { setOcupado(false); }
  };
  const temCotacoes = dados.some((s) => s.itens.some((i) => i.cotacoes?.length));
  return <section className="sec stack" id="tratamento-precos">
    <div><h3>Tratamento das cotações</h3><p className="small muted">Escolha os preços que formam o cálculo, os que ficam somente como referência e os descartados. Os arquivos e valores originais continuam visíveis.</p></div>
    {!temCotacoes ? <div><p className="muted">Cadastre os itens e os preços na Solicitação para fazer a análise aqui.</p><button type="button" className="btn" onClick={irAosItens}>Abrir itens e orçamentos da Solicitação</button></div> : <form className="stack" onSubmit={salvar}>
      <fieldset className="stack" disabled={!editavel || ocupado} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
        {dados.map((s) => {
          const colunas = new Map<string, CotacaoItem>();
          for (const item of s.itens) for (const c of item.cotacoes ?? []) if (!colunas.has(chaveCotacao(c))) colunas.set(chaveCotacao(c), c);
          if (!colunas.size) return null;
          return <details key={s.id} open className="panel box">
            <summary>{s.secretaria}{s.referencia ? ` · ${s.referencia}` : ""}</summary>
            <div className="pad stack"><div className="tw"><table className="t tabela-pesquisa-precos">
              <thead><tr><th>Item / descrição</th><th>Qtd.</th>{[...colunas].map(([chave, c], j) => <th key={chave}>Cotação {j + 1}<div>{c.fornecedor}</div>{c.orcamento_id != null && <a href={`/api/processos/${processo.id}/orcamentos/${c.orcamento_id}/arquivo`}>Ver anexo</a>}</th>)}<th>Critério / valor calculado</th></tr></thead>
              <tbody>{s.itens.map((item, i) => <tr key={i}>
                <td><b>{i + 1}. {item.descricao}</b><div className="small muted">{item.unidade}</div></td><td>{item.quantidade ?? "—"}</td>
                {[...colunas].map(([chave], col) => {
                  const j = item.cotacoes?.findIndex((c) => chaveCotacao(c) === chave) ?? -1;
                  const c = item.cotacoes?.[j];
                  if (!c || c.valor_unitario == null) return <td key={chave} className="muted">Preço não informado</td>;
                  const rotulo = `cotação ${col + 1} do item ${i + 1} da solicitação ${s.id}`;
                  return <td key={chave} className="tratamento-cotacao">
                    <strong className={c.descarte ? "valor-descartado" : undefined}>{brl(c.valor_unitario)}</strong>
                    <label className="small">Uso do preço<select aria-label={`Uso da ${rotulo}`} value={usoDa(c)} onChange={(e) => mudarCotacao(s.id, i, j, (atual) => {
                      const { descarte, apenas_referencia, ...base } = atual;
                      return { ...base, ...(e.target.value === "referencia" ? { apenas_referencia: true } : {}), ...(e.target.value === "descartado" ? { descarte: descarte ?? { motivo: "inexequivel", justificativa: "" } } : {}) };
                    })}><option value="calculo">Usar no cálculo</option><option value="referencia">Somente referência</option><option value="descartado">Descartado</option></select></label>
                    {c.apenas_referencia && <span className="small muted">Referência para consulta. Fora do cálculo.</span>}
                    {c.descarte && <div className="descarte-preco">
                      <label>Motivo<select aria-label={`Motivo do descarte da ${rotulo}`} value={c.descarte.motivo} onChange={(e) => mudarCotacao(s.id, i, j, (v) => ({ ...v, descarte: { ...v.descarte!, motivo: e.target.value as "inexequivel" | "elevado" } }))}>{Object.entries(MOTIVOS_DESCARTE).map(([v, nome]) => <option key={v} value={v}>{nome}</option>)}</select></label>
                      <label>Justificativa<textarea required rows={3} maxLength={2000} aria-label={`Justificativa do descarte da ${rotulo}`} value={c.descarte.justificativa} onChange={(e) => mudarCotacao(s.id, i, j, (v) => ({ ...v, descarte: { ...v.descarte!, justificativa: e.target.value } }))} /></label>
                    </div>}
                  </td>;
                })}
                <td><label>Critério<select aria-label={`Critério do item ${i + 1} da solicitação ${s.id}`} value={item.criterio ?? "media"} onChange={(e) => mudarItem(s.id, i, (v) => ({ ...v, criterio: e.target.value as CriterioPreco }))}>{Object.entries(CRITERIOS_PRECO).map(([v, nome]) => <option key={v} value={v}>{nome}</option>)}</select></label><strong>{item.valor_unitario == null ? "Sem preço para o cálculo" : brl(item.valor_unitario)}</strong></td>
              </tr>)}</tbody>
            </table></div></div>
          </details>;
        })}
        <p><strong>Total com os preços usados no cálculo: {totalDosItens(dados.flatMap((s) => s.itens)) == null ? "A formar" : brl(totalDosItens(dados.flatMap((s) => s.itens)))}</strong></p>
        <div><button className="btn pri" disabled={!sujo || ocupado}>{ocupado ? "Salvando análise…" : "Salvar tratamento dos preços"}</button></div>
      </fieldset>
      {fonte !== base && sujo && <p className="note">Os preços cadastrados mudaram. <button type="button" className="lnk" onClick={() => setSujo(false)}>Recarregar cotações</button></p>}
    </form>}
    {aviso && <p className={`note ${aviso.erro ? "bad" : "ok"}`} role={aviso.erro ? "alert" : "status"}>{aviso.texto}</p>}
  </section>;
}
