import { useRef, useState, type Dispatch, type SetStateAction } from "react";
import { api, brl, numBR } from "../api";
import type { DadosOrcamento, OrcamentoLido } from "../../../shared/orcamentos";
import { CRITERIOS_PRECO, FONTES_COTACAO, valorDasCotacoes, normalizarCotacao, totalDoItem, totalDosItens, type CriterioPreco, type FonteCotacao, type CotacaoItem, type ItemSolicitacao } from "../../../shared/solicitacao";

import { destinosDoOrcamento } from "../../../shared/importar-orcamento";
import type { ResultadoPncp } from "../../../shared/pncp";
import { createPncpEvidence, pncpProcedure } from "../comp/comprovantePncp";
import { BuscaPncpItem } from "./BuscaPncpItem";

interface LinhaCotacao { orcamentoId: number | null; fornecedor: string; valor: string; fonte?: FonteCotacao; link?: string; consultadoEm?: string }
export interface LinhaItem {
  descricao: string;
  unidade: string;
  quantidade: string;
  valorAnterior?: number | null;
  criterio?: CriterioPreco;
  cotacoes: LinhaCotacao[];
}
const cotacaoVazia = (): LinhaCotacao => ({ orcamentoId: null, fornecedor: "", valor: "" });
export const linhaVazia = (): LinhaItem => ({ descricao: "", unidade: "", quantidade: "", cotacoes: [cotacaoVazia(), cotacaoVazia()] });

export function linhasDosItens(itens: ItemSolicitacao[]): LinhaItem[] {
  if (!itens.length) return [linhaVazia()];
  return itens.map((item) => {
    const cotacoes: LinhaCotacao[] = (item.cotacoes ?? []).map((c) => ({
      orcamentoId: c.orcamento_id,
      fornecedor: c.fornecedor,
      valor: c.valor_unitario == null ? "" : String(c.valor_unitario).replace(".", ","),
      fonte: c.fonte, link: c.link, consultadoEm: c.consultado_em,
    }));
    while (cotacoes.length < 2) cotacoes.push(cotacaoVazia());
    return {
      descricao: item.descricao,
      unidade: item.unidade,
      quantidade: item.quantidade == null ? "" : String(item.quantidade).replace(".", ","),
      valorAnterior: item.cotacoes === undefined ? item.valor_unitario : undefined,
      criterio: item.criterio,
      cotacoes,
    };
  });
}

export function lerLinhas(linhas: LinhaItem[]): { itens: ItemSolicitacao[]; erro?: string } {
  const itens: ItemSolicitacao[] = [];
  for (const [k, l] of linhas.entries()) {
    const preenchidas = l.cotacoes.filter((c) => c.orcamentoId || c.fornecedor.trim() || c.valor.trim());
    if (!l.descricao.trim() && !l.unidade.trim() && !l.quantidade.trim() && !preenchidas.length && l.valorAnterior == null) continue;
    if (!l.descricao.trim()) return { itens, erro: `Item ${k + 1} — informe a descrição.` };
    const quantidade = numBR(l.quantidade);
    if (Number.isNaN(quantidade) || (quantidade != null && (quantidade < 0 || quantidade > 1e12))) {
      return { itens, erro: `Item ${k + 1} — informe uma quantidade válida.` };
    }
    const cotacoes: CotacaoItem[] = [];
    for (const c of preenchidas) {
      if (!c.orcamentoId) return { itens, erro: `Item ${k + 1} — anexe ou selecione o orçamento de ${c.fornecedor.trim() || "cada fornecedor informado"}.` };
      const valor = numBR(c.valor);
      if (Number.isNaN(valor) || (valor != null && (valor <= 0 || valor > 1e12))) return { itens, erro: `Item ${k + 1} — informe um preço unitário válido.` };
      if (valor != null && !c.fornecedor.trim()) return { itens, erro: `Item ${k + 1} — informe o nome do fornecedor da cotação.` };
      cotacoes.push({
        orcamento_id: c.orcamentoId, fornecedor: c.fornecedor.trim(), valor_unitario: valor,
        ...(c.fonte ? { fonte: c.fonte } : {}), ...(c.link ? { link: c.link.trim() } : {}),
        ...(c.consultadoEm ? { consultado_em: c.consultadoEm } : {}),
      });
    }
    const dados = { descricao: l.descricao.trim(), unidade: l.unidade.trim(), quantidade };
    const manterAnterior = !cotacoes.length && l.valorAnterior !== undefined;
    itens.push(manterAnterior ? { ...dados, valor_unitario: l.valorAnterior ?? null }
      : { ...dados, cotacoes, criterio: l.criterio, valor_unitario: valorDasCotacoes(cotacoes, l.criterio) });
  }
  return { itens };
}

const formatos = ".pdf,.docx,.xlsx,.xls,.jpg,.jpeg,.png,.txt,.csv";
const legivel = (nome: string) => /\.(pdf|jpe?g|png|docx|xlsx|txt|csv)$/i.test(nome);
const dataConsulta = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Sao_Paulo" }).format(new Date());

function incluirCotacao(linha: LinhaItem, nova: LinhaCotacao) {
  const preenchida = linha.cotacoes.findIndex((c) => c.orcamentoId === nova.orcamentoId
    || (!c.orcamentoId && c.fornecedor.trim() && normalizarCotacao(c.fornecedor) === normalizarCotacao(nova.fornecedor)));
  if (preenchida >= 0) {
    return { ...linha, cotacoes: linha.cotacoes.map((c, i) => i === preenchida ? {
      ...nova, ...c, orcamentoId: nova.orcamentoId, fornecedor: c.fornecedor || nova.fornecedor, valor: c.valor || nova.valor,
      fonte: c.fonte ?? nova.fonte, consultadoEm: c.consultadoEm || nova.consultadoEm,
    } : c) };
  }
  const vaga = linha.cotacoes.findIndex((c) => !c.orcamentoId && !c.fornecedor.trim() && !c.valor.trim());
  return { ...linha, cotacoes: vaga < 0 ? [...linha.cotacoes, nova] : linha.cotacoes.map((c, i) => i === vaga ? nova : c) };
}
const precoLido = (v: number | null) => v != null && v > 0 && v <= 1e12 ? String(v).replace(".", ",") : "";

export function ItensSolicitacao({ processoId, linhas, setLinhas, orcamentos, recarregar, ia, ocupado, setCotando }: {
  processoId: number;
  linhas: LinhaItem[];
  setLinhas: Dispatch<SetStateAction<LinhaItem[]>>;
  orcamentos: OrcamentoLido[];
  recarregar: () => Promise<unknown>;
  ia: boolean;
  ocupado: boolean;
  setCotando: (ativo: boolean) => void;
}) {
  const [anexando, setAnexando] = useState("");
  const seletorImportacao = useRef<HTMLInputElement>(null);
  const [aviso, setAviso] = useState("");
  const [leitura, setLeitura] = useState<{ id: number; dados: DadosOrcamento; usar: boolean[] } | null>(null);
  const lidas = lerLinhas(linhas);
  const total = totalDosItens(lidas.itens);
  const parcial = !!lidas.erro || lidas.itens.some((item) => totalDoItem(item) == null);
  const caminho = `/processos/${processoId}/orcamentos`;
  const alterar = (k: number, dados: Partial<LinhaItem>) =>
    setLinhas((lista) => lista.map((l, i) => i === k ? { ...l, ...dados } : l));
  const alterarCotacao = (k: number, j: number, dados: Partial<LinhaCotacao>) =>
    setLinhas((lista) => lista.map((l, i) => i === k ? { ...l,
      cotacoes: l.cotacoes.map((c, n) => n === j ? { ...c, ...dados } : c),
    } : l));

  const selecionar = (k: number, j: number, id: number | null, dados?: DadosOrcamento | null) => {
    const anterior = linhas[k].cotacoes[j];
    const item = linhas[k];
    const exatos = dados?.itens.filter((i) => normalizarCotacao(i.descricao) === normalizarCotacao(item.descricao)
      && (!item.unidade.trim() || (i.unidade && normalizarCotacao(i.unidade) === normalizarCotacao(item.unidade))));
    alterarCotacao(k, j, {
      orcamentoId: id,
      fornecedor: (anterior.orcamentoId === null ? anterior.fornecedor.trim() : "") || dados?.fornecedor?.slice(0, 200) || "",
      valor: exatos?.length === 1 ? precoLido(exatos[0].valor_unitario) : "",
      fonte: anterior.fonte === "pncp" ? "fornecedor" : anterior.fonte,
      link: anterior.fonte === "pncp" ? "" : anterior.link,
    });
  };

  const enviar = async (arquivo: File) => {
    if (!arquivo.size || arquivo.size > 20 * 1024 * 1024) throw new Error("Selecione um arquivo de orçamento de até 20 MB.");
    const form = new FormData();
    form.append("arquivo", arquivo);
    const { ids: [id] } = await api.post<{ ids: number[] }>(`${caminho}?origem=solicitacao`, form);
    return id;
  };

  const lerOrcamento = async (id: number) =>
    (await api.post<{ dados: DadosOrcamento }>(`${caminho}/${id}/ler`)).dados;

  const executar = async (acao: string, funcao: () => Promise<void>) => {
    setAviso("");
    setAnexando(acao);
    setCotando(true);
    try { await funcao(); }
    catch (e) { setAviso(e instanceof Error ? e.message : "Não foi possível registrar o orçamento."); }
    finally { setAnexando(""); setCotando(false); }
  };

  const anexar = (k: number, j: number, arquivo: File) => executar(`${k}-${j}`, async () => {
    const id = await enviar(arquivo);
    let dados: DadosOrcamento | null = null;
    if (ia && legivel(arquivo.name)) {
      try { dados = await lerOrcamento(id); }
      catch { setAviso("Orçamento anexado. A leitura por IA falhou. Informe o fornecedor e o preço unitário."); }
    }
    selecionar(k, j, id, dados);
    await recarregar();
  });

  const importar = (arquivo: File) => executar("importar", async () => {
    if (!legivel(arquivo.name)) throw new Error("Para importar os itens, envie PDF, Word, XLSX, foto ou texto.");
    setLeitura(null);
    const id = await enviar(arquivo);
    try {
      const dados = await lerOrcamento(id);
      const itens = dados.itens.filter((i) => i.descricao.trim());
      if (!itens.length) throw new Error("O orçamento foi anexado. A leitura não encontrou itens para lançar.");
      setLeitura({ id, dados: { ...dados, itens }, usar: itens.map(() => true) });
    } finally { await recarregar(); }
  });

  const destinos = leitura ? destinosDoOrcamento(linhas, leitura.dados.itens) : [];
  const aplicarLeitura = () => {
    if (!leitura) return;
    const resultado = [...linhas];
    let aplicadas = 0;
    for (const [i, lido] of leitura.dados.itens.entries()) {
      const destino = destinos[i];
      if (!leitura.usar[i] || destino.ambigua) continue;
      const anterior = destino.indice == null ? linhaVazia() : resultado[destino.indice];
      if (anterior.cotacoes.filter((c) => c.orcamentoId).length >= 20 && !anterior.cotacoes.some((c) => c.orcamentoId === leitura.id)) continue;
      const item = incluirCotacao({
        ...anterior, descricao: anterior.descricao || lido.descricao.trim().slice(0, 500),
        unidade: anterior.unidade || (lido.unidade ?? "").trim().slice(0, 30),
        quantidade: anterior.quantidade || (lido.quantidade != null && lido.quantidade >= 0 && lido.quantidade <= 1e12 ? String(lido.quantidade).replace(".", ",") : ""),
      }, {
        orcamentoId: leitura.id, fornecedor: (leitura.dados.fornecedor ?? "").slice(0, 200),
        valor: precoLido(lido.valor_unitario), fonte: "fornecedor", consultadoEm: dataConsulta(),
      });
      if (destino.indice != null) resultado[destino.indice] = item;
      else {
        const vaga = resultado.findIndex((l) => !l.descricao.trim() && !l.quantidade && !l.unidade && !l.cotacoes.some((c) => c.orcamentoId || c.fornecedor));
        if (vaga >= 0) resultado[vaga] = item;
        else if (resultado.length < 200) resultado.push(item);
        else continue;
      }
      aplicadas++;
    }
    setLinhas(resultado);
    setLeitura(null);
    setAviso(`${aplicadas} de ${leitura.usar.filter(Boolean).length} linhas selecionadas lançadas. Confira os dados antes de salvar.`);
  };

  const usarPncp = (k: number, r: ResultadoPncp) => executar(`pncp-${k}`, async () => {
    const item = linhas[k];
    const repetida = item.cotacoes.some((c) => c.link === r.sourceUrl && c.fornecedor.includes(` · item ${r.itemNumber}`));
    if (repetida) throw new Error("Esta referência do PNCP já está vinculada ao item.");
    if (item.cotacoes.filter((c) => c.orcamentoId || c.fornecedor).length >= 20) throw new Error("O item já tem 20 cotações.");
    const data = dataConsulta();
    const arquivo = await createPncpEvidence(r, data);
    const id = await enviar(arquivo);
    const nome = `${r.organization || "PNCP"} · ${r.control} · item ${r.itemNumber}`;
    alterar(k, incluirCotacao(item, {
      orcamentoId: id, fornecedor: nome.slice(0, 200), valor: precoLido(r.unitValue),
      fonte: "pncp", link: r.sourceUrl, consultadoEm: data,
    }));
    await recarregar();
    setAviso("Referência do PNCP lançada e comprovante anexado.");
  });

  return <fieldset className="wide itens-sol" disabled={ocupado || !!anexando}>
    <legend>Itens</legend>
    <div className="tools">
      <button className="btn pri" type="button" disabled={!ia || !!anexando || ocupado} onClick={() => seletorImportacao.current?.click()}>
        {anexando === "importar" ? "Lendo orçamento…" : "Anexar e ler orçamento"}</button>
      {ia ? <>
        <input hidden ref={seletorImportacao} type="file" accept=".pdf,.docx,.xlsx,.jpg,.jpeg,.png,.txt,.csv" onChange={(e) => {
          const arquivo = e.target.files?.[0];
          e.target.value = "";
          if (arquivo) void importar(arquivo);
        }} />
        <span className="small muted">Confira as linhas extraídas antes de lançar nos itens.</span>
      </> : <p className="small muted">Leitura automática indisponível. Você pode anexar propostas e informar os preços dentro dos itens.</p>}
    </div>
    {leitura && <div className="cotacao-item stack">
      <h4>Conferir orçamento · {leitura.dados.fornecedor || "Fornecedor a informar"}</h4>
      <div className="tw"><table className="t">
        <thead><tr><th>Usar</th><th>Descrição</th><th>Un.</th><th>Qtd.</th><th>Preço unitário</th><th>Lançamento</th></tr></thead>
        <tbody>{leitura.dados.itens.map((i, k) => <tr key={k}>
          <td><input type="checkbox" aria-label={`Usar linha ${k + 1} da proposta`} checked={leitura.usar[k] && !destinos[k].ambigua}
            disabled={destinos[k].ambigua} onChange={(e) => setLeitura({ ...leitura, usar: leitura.usar.map((v, n) => n === k ? e.target.checked : v) })} /></td>
          <td>{i.descricao}</td><td>{i.unidade || "—"}</td><td>{i.quantidade ?? "—"}</td><td>{brl(i.valor_unitario)}</td>
          <td>{destinos[k].ambigua ? "Vincular manualmente" : destinos[k].indice == null ? "Novo item" : `Item ${destinos[k].indice! + 1}`}</td>
        </tr>)}</tbody>
      </table></div>
      <div className="tools">
        <button className="btn pri" type="button" disabled={!leitura.usar.some((v, k) => v && !destinos[k].ambigua)} onClick={aplicarLeitura}>Lançar itens selecionados</button>
        <button className="btn" type="button" onClick={() => setLeitura(null)}>Fechar conferência</button>
      </div>
    </div>}

    {linhas.map((linha, k) => {
      const item = lidas.erro || lidas.itens.length !== linhas.length ? lerLinhas([linha]).itens[0] : lidas.itens[k];
      const subtotal = item ? totalDoItem(item) : null;
      return <div className="cotacao-item stack" key={k}>
        <div className="row"><h4>Item {k + 1}</h4>
          {linhas.length > 1 && <button type="button" className="lnk" aria-label={`Remover item ${k + 1}`}
            onClick={() => setLinhas((lista) => lista.filter((_, i) => i !== k))}>Remover item</button>}</div>
        <div className="form cotacao-dados">
          <label>Descrição do item<input aria-label={`Descrição do item ${k + 1}`} maxLength={500} value={linha.descricao} onChange={(e) => alterar(k, { descricao: e.target.value })} /></label>
          <label>Unidade<input aria-label={`Unidade do item ${k + 1}`} maxLength={30} value={linha.unidade} placeholder="un" onChange={(e) => alterar(k, { unidade: e.target.value })} /></label>
          <label>Quantidade<input aria-label={`Quantidade do item ${k + 1}`} inputMode="decimal" value={linha.quantidade} onChange={(e) => alterar(k, { quantidade: e.target.value })} /></label>
        </div>
        <details open={!!linha.descricao.trim()}>
          <summary>Cotações do item {k + 1}</summary>
          <div className="stack">
            {linha.cotacoes.map((c, j) => {
              const orcamento = orcamentos.find((o) => o.id === c.orcamentoId);
              const precos = orcamento?.dados?.itens.filter((i) => precoLido(i.valor_unitario)) ?? [];
              return <div className="cotacao-fornecedor stack" key={j}>
                <div className="row"><strong>Fornecedor {j + 1}</strong>
                  {(linha.cotacoes.length > 2 || c.orcamentoId || c.fornecedor) && <button type="button" className="lnk"
                    onClick={() => alterar(k, { cotacoes: linha.cotacoes.length > 2 ? linha.cotacoes.filter((_, i) => i !== j)
                      : linha.cotacoes.map((x, i) => i === j ? cotacaoVazia() : x) })}>Retirar cotação do item</button>}</div>
                <div className="form">
                  <label>Fonte do orçamento<select value={c.fonte ?? "fornecedor"} onChange={(e) => alterarCotacao(k, j, { fonte: e.target.value as FonteCotacao })}>
                    {Object.entries(FONTES_COTACAO).filter(([fonte]) => fonte !== "pncp" || c.fonte === "pncp").map(([fonte, nome]) => <option key={fonte} value={fonte}>{nome}</option>)}
                  </select></label>
                  <label>{c.fonte && c.fonte !== "fornecedor" ? "Nome da fonte" : "Nome do fornecedor"}<input aria-label={`Nome do fornecedor ${j + 1} do item ${k + 1}`} maxLength={200} value={c.fornecedor} onChange={(e) => alterarCotacao(k, j, { fornecedor: e.target.value })} /></label>
                  <label>Preço unitário da proposta (R$)<input aria-label={`Preço unitário do fornecedor ${j + 1} do item ${k + 1}`}
                    inputMode="decimal" value={c.valor} disabled={!c.orcamentoId} onChange={(e) => alterarCotacao(k, j, { valor: e.target.value })} /></label>
                  <label>Data da consulta<input type="date" value={c.consultadoEm ?? ""} onChange={(e) => alterarCotacao(k, j, { consultadoEm: e.target.value })} /></label>
                  {c.fonte && c.fonte !== "fornecedor" && <label className="wide">Link da referência
                    <input type="url" value={c.link ?? ""} onChange={(e) => alterarCotacao(k, j, { link: e.target.value })} />
                  </label>}
                  {orcamentos.length > 0 && <label className="wide">Usar orçamento já anexado
                    <select aria-label={`Orçamento do fornecedor ${j + 1} do item ${k + 1}`} value={c.orcamentoId ?? ""} onChange={(e) => {
                      const o = orcamentos.find((x) => String(x.id) === e.target.value);
                      selecionar(k, j, o?.id ?? null, o?.dados);
                    }}>
                      <option value="">Selecione um orçamento</option>
                      {orcamentos.map((o) => <option key={o.id} value={o.id}
                        disabled={linha.cotacoes.some((x, n) => n !== j && x.orcamentoId === o.id)}>{o.dados?.fornecedor ? `${o.dados.fornecedor} · ` : ""}{o.nome}</option>)}
                    </select>
                  </label>}
                  {precos.length > 0 && <label className="wide">Preço identificado na proposta
                    <select value="" onChange={(e) => {
                      const preco = e.target.value !== "" ? precos[Number(e.target.value)] : undefined;
                      if (preco) alterarCotacao(k, j, { valor: precoLido(preco.valor_unitario) });
                    }}>
                      <option value="">Selecione a linha que corresponde ao item</option>
                      {precos.map((i, n) => <option key={n} value={n}>{i.descricao}{i.unidade ? ` · ${i.unidade}` : ""} · {brl(i.valor_unitario)}</option>)}
                    </select>
                  </label>}
                </div>
                <div className="tools">
                  <button className="btn sm" type="button" onClick={() => document.getElementById(`cotacao-arquivo-${k}-${j}`)?.click()}>
                    {anexando === `${k}-${j}` ? "Anexando orçamento…" : c.orcamentoId ? "Trocar orçamento" : "Anexar orçamento"}</button>
                  <input hidden id={`cotacao-arquivo-${k}-${j}`} type="file" accept={formatos} onChange={(e) => {
                    const arquivo = e.target.files?.[0];
                    e.target.value = "";
                    if (arquivo) void anexar(k, j, arquivo);
                  }} />
                  {c.orcamentoId && <a href={`/api${caminho}/${c.orcamentoId}/arquivo`}>{orcamento?.nome ?? "Baixar orçamento"}</a>}
                </div>
              </div>;
            })}
            {linha.cotacoes.length < 20 && <div><button className="btn sm" type="button" onClick={() => alterar(k, { cotacoes: [...linha.cotacoes, cotacaoVazia()] })}>Adicionar fornecedor</button></div>}
          </div>
        </details>
        <BuscaPncpItem descricao={linha.descricao} ocupado={ocupado || !!anexando} usar={(r) => usarPncp(k, r)} />
        <div className="cotacao-soma">
          <label className="campo">Critério de preço
            <select value={linha.criterio ?? "media"} onChange={(e) => alterar(k, { criterio: e.target.value as CriterioPreco })}>
              {Object.entries(CRITERIOS_PRECO).map(([valor, rotulo]) => <option key={valor} value={valor}>{rotulo}</option>)}
            </select>
          </label>
          <span><strong>{item?.cotacoes === undefined && item?.valor_unitario != null ? "Valor unitário anterior" : "Valor unitário estimado"}</strong> {brl(item?.valor_unitario)}</span>
          <span><strong>Subtotal do item</strong> {brl(subtotal)}</span>
        </div>
      </div>;
    })}
    <div className="row">
      {linhas.length < 200 && <button type="button" className="btn sm" onClick={() => setLinhas((lista) => [...lista, linhaVazia()])}>Adicionar item</button>}
      <strong>{parcial && total != null ? "Subtotal dos itens com valor" : "Total estimado"} {brl(total)}</strong>
    </div>
    <p className="small muted">O cálculo usa os preços unitários registrados com comprovante. Uma proposta pode ser usada em vários itens. {ia ? "Confira os preços identificados pela IA." : ""}</p>
    {aviso && <p className="small" role="status">{aviso}</p>}
  </fieldset>;
}
