import { useRef, useState, type Dispatch, type SetStateAction } from "react";
import { api, brl, numBR } from "../api";
import { limparNomeFornecedor, nomeFornecedorOrcamento, type DadosOrcamento, type OrcamentoLido } from "../../../shared/orcamentos";
import { CRITERIOS_PRECO, FONTES_COTACAO, valorDasCotacoes, normalizarCotacao, totalDoItem, totalDosItens, type CriterioPreco, type FonteCotacao, type CotacaoItem, type ItemSolicitacao } from "../../../shared/solicitacao";

import { destinosDoOrcamento } from "../../../shared/importar-orcamento";
import type { ResultadoPncp } from "../../../shared/pncp";
import { createPncpEvidence, pncpProcedure } from "../comp/comprovantePncp";
import { BuscaPncpItem } from "./BuscaPncpItem";
import { BuscaPncpLote } from "./BuscaPncpLote";

interface LinhaCotacao { orcamentoId: number | null; fornecedor: string; valor: string; fonte?: FonteCotacao; link?: string; consultadoEm?: string }
type LeituraOrcamento = { id: number; dados: DadosOrcamento; usar: boolean[] };
const cotacaoPreenchida = (c: LinhaCotacao) => c.orcamentoId != null || !!c.fornecedor.trim() || !!c.valor.trim();
export interface LinhaItem {
  descricao: string;
  unidade: string;
  quantidade: string;
  valorAnterior?: number | null;
  criterio?: CriterioPreco;
  cotacoes: LinhaCotacao[];
}
const cotacaoVazia = (): LinhaCotacao => ({ orcamentoId: null, fornecedor: "", valor: "" });
export const linhaVazia = (): LinhaItem => ({ descricao: "", unidade: "", quantidade: "", cotacoes: [cotacaoVazia()] });

export function linhasDosItens(itens: ItemSolicitacao[], orcamentos: OrcamentoLido[]): LinhaItem[] {
  if (!itens.length) return [linhaVazia()];
  return itens.map((item) => {
    const cotacoes: LinhaCotacao[] = (item.cotacoes ?? []).map((c) => ({
      orcamentoId: c.orcamento_id,
      fornecedor: limparNomeFornecedor(c.fornecedor) || nomeFornecedorOrcamento(orcamentos.find((o) => o.id === c.orcamento_id)),
      valor: c.valor_unitario == null ? "" : String(c.valor_unitario).replace(".", ","),
      fonte: c.fonte, link: c.link, consultadoEm: c.consultado_em,
    }));
    if (!cotacoes.length) cotacoes.push(cotacaoVazia());
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
    const preenchidas = l.cotacoes.filter(cotacaoPreenchida);
    if (!l.descricao.trim() && !l.unidade.trim() && !l.quantidade.trim() && !preenchidas.length && l.valorAnterior == null) continue;
    if (!l.descricao.trim()) return { itens, erro: `Item ${k + 1} — informe a descrição.` };
    const quantidade = numBR(l.quantidade);
    if (Number.isNaN(quantidade) || (quantidade != null && (quantidade < 0 || quantidade > 1e12))) {
      return { itens, erro: `Item ${k + 1} — informe uma quantidade válida.` };
    }
    const cotacoes: CotacaoItem[] = [];
    for (const c of preenchidas) {
      const valor = numBR(c.valor);
      if (Number.isNaN(valor) || (valor != null && (valor <= 0 || valor > 1e12))) return { itens, erro: `Item ${k + 1} — informe um preço unitário válido.` };
      const fornecedor = limparNomeFornecedor(c.fornecedor);
      if (valor != null && !fornecedor) return { itens, erro: `Item ${k + 1} — informe o nome do fornecedor da cotação.` };
      cotacoes.push({
        orcamento_id: c.orcamentoId, fornecedor, valor_unitario: valor,
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

function localizarCotacao(linha: LinhaItem, orcamento: number | null, fornecedor: string) {
  const nome = normalizarCotacao(fornecedor);
  return linha.cotacoes.findIndex((c) => (orcamento != null && c.orcamentoId === orcamento)
    || (c.orcamentoId == null && !!nome && normalizarCotacao(c.fornecedor) === nome));
}

function incluirCotacao(linha: LinhaItem, nova: LinhaCotacao) {
  const preenchida = localizarCotacao(linha, nova.orcamentoId, nova.fornecedor);
  if (preenchida >= 0) {
    return { ...linha, cotacoes: linha.cotacoes.map((c, i) => i === preenchida ? {
      ...nova, ...c, orcamentoId: nova.orcamentoId, fornecedor: c.fornecedor || nova.fornecedor, valor: c.valor || nova.valor,
      fonte: c.fonte ?? nova.fonte, consultadoEm: c.consultadoEm || nova.consultadoEm,
    } : c) };
  }
  const vaga = linha.cotacoes.findIndex((c) => !cotacaoPreenchida(c));
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
  const [leitura, setLeitura] = useState<LeituraOrcamento | null>(null);
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

  const selecionar = (k: number, j: number, id: number | null, dados?: DadosOrcamento | null, nome = "") => {
    const anterior = linhas[k].cotacoes[j];
    const item = linhas[k];
    const exatos = dados?.itens.filter((i) => normalizarCotacao(i.descricao) === normalizarCotacao(item.descricao)
      && (!item.unidade.trim() || (i.unidade && normalizarCotacao(i.unidade) === normalizarCotacao(item.unidade))));
    const manterDigitado = anterior.orcamentoId == null || id == null;
    const valorIdentificado = exatos?.length === 1 ? precoLido(exatos[0].valor_unitario) : "";
    alterarCotacao(k, j, {
      orcamentoId: id,
      fornecedor: (manterDigitado && limparNomeFornecedor(anterior.fornecedor)) || nome || limparNomeFornecedor(dados?.fornecedor),
      valor: (manterDigitado && anterior.valor.trim()) || valorIdentificado,
      fonte: anterior.fonte === "pncp" ? "fornecedor" : anterior.fonte,
      link: anterior.fonte === "pncp" ? "" : anterior.link,
    });
  };

  const enviar = async (arquivo: File) => {
    if (!arquivo.size || arquivo.size > 20 * 1024 * 1024) throw new Error("Selecione um arquivo de orçamento de até 20 MB.");
    const form = new FormData();
    form.append("arquivo", arquivo);
    const { ids: [id], orcamentos: propostas } = await api.post<{ ids: number[]; orcamentos?: OrcamentoLido[] }>(`${caminho}?origem=solicitacao`, form);
    return { id, fornecedor: limparNomeFornecedor(propostas?.[0]?.fornecedor) };
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
    const { id, fornecedor } = await enviar(arquivo);
    let dados: DadosOrcamento | null = null;
    if (ia && legivel(arquivo.name)) {
      try { dados = await lerOrcamento(id); }
      catch { setAviso("Orçamento anexado. Confira o fornecedor e informe o preço unitário."); }
    }
    selecionar(k, j, id, dados, limparNomeFornecedor(dados?.fornecedor) || fornecedor);
    await recarregar();
  });

  const importar = (arquivo: File) => executar("importar", async () => {
    if (!legivel(arquivo.name)) throw new Error("Para importar os itens, envie PDF, Word, XLSX, foto ou texto.");
    setLeitura(null);
    const { id, fornecedor } = await enviar(arquivo);
    try {
      const dados = await lerOrcamento(id);
      const itens = dados.itens.filter((i) => i.descricao.trim());
      if (!itens.length) throw new Error("O orçamento foi anexado. A leitura não encontrou itens para lançar.");
      setLeitura({ id, dados: { ...dados, fornecedor: limparNomeFornecedor(dados.fornecedor) || fornecedor, itens }, usar: itens.map(() => true) });
    } finally { await recarregar(); }
  });

  const destinos = leitura ? destinosDoOrcamento(linhas, leitura.dados.itens) : [];
  const aplicarLeitura = () => {
    if (!leitura) return;
    const fornecedor = limparNomeFornecedor(leitura.dados.fornecedor);
    if (!fornecedor) {
      setAviso("Informe o fornecedor na conferência do orçamento para lançar os itens.");
      return;
    }
    void executar("lancar", async () => {
      const proposta = orcamentos.find((o) => o.id === leitura.id);
      if (fornecedor !== nomeFornecedorOrcamento(proposta)) {
        await api.put(`${caminho}/${leitura.id}`, { fornecedor });
        await recarregar();
      }
      lancarLeitura(leitura, fornecedor);
    });
  };
  const lancarLeitura = (leitura: LeituraOrcamento, fornecedor: string) => {
    const resultado = [...linhas];
    let aplicadas = 0;
    for (const [i, lido] of leitura.dados.itens.entries()) {
      const destino = destinos[i];
      if (!leitura.usar[i] || destino.ambigua) continue;
      const anterior = destino.indice == null ? linhaVazia() : resultado[destino.indice];
      if (anterior.cotacoes.filter(cotacaoPreenchida).length >= 20 && localizarCotacao(anterior, leitura.id, fornecedor) < 0) continue;
      const item = incluirCotacao({
        ...anterior, descricao: anterior.descricao || lido.descricao.trim().slice(0, 500),
        unidade: anterior.unidade || (lido.unidade ?? "").trim().slice(0, 30),
        quantidade: anterior.quantidade || (lido.quantidade != null && lido.quantidade >= 0 && lido.quantidade <= 1e12 ? String(lido.quantidade).replace(".", ",") : ""),
      }, {
        orcamentoId: leitura.id, fornecedor,
        valor: precoLido(lido.valor_unitario), fonte: "fornecedor", consultadoEm: dataConsulta(),
      });
      if (destino.indice != null) resultado[destino.indice] = item;
      else {
        const vaga = resultado.findIndex((l) => !l.descricao.trim() && !l.quantidade && !l.unidade && !l.cotacoes.some(cotacaoPreenchida));
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

  const relerFornecedor = (k: number, j: number, orcamento: OrcamentoLido) => executar(`fornecedor-${orcamento.id}`, async () => {
    const dados = await lerOrcamento(orcamento.id);
    const fornecedor = limparNomeFornecedor(dados.fornecedor);
    if (fornecedor) alterarCotacao(k, j, { fornecedor });
    else setAviso("O fornecedor não foi identificado no arquivo. Confira a proposta e informe o nome.");
    await recarregar();
  });

  const usarPncp = (k: number, r: ResultadoPncp) => executar(`pncp-${k}`, async () => {
    const item = linhas[k];
    const repetida = item.cotacoes.some((c) => c.link === r.sourceUrl && c.fornecedor.includes(` · item ${r.itemNumber}`));
    if (repetida) throw new Error("Esta referência do PNCP já está vinculada ao item.");
    if (item.cotacoes.filter(cotacaoPreenchida).length >= 20) throw new Error("O item já tem 20 cotações.");
    const data = dataConsulta();
    const arquivo = await createPncpEvidence(r, data);
    const { id } = await enviar(arquivo);
    const nome = `${r.organization || "PNCP"} · ${r.control} · item ${r.itemNumber}`;
    alterar(k, incluirCotacao(item, {
      orcamentoId: id, fornecedor: nome.slice(0, 200), valor: precoLido(r.unitValue),
      fonte: "pncp", link: r.sourceUrl, consultadoEm: data,
    }));
    await recarregar();
    setAviso("Referência do PNCP lançada e comprovante anexado.");
  });

  const descricoes = linhas.map((linha) => linha.descricao);

  return <fieldset className="wide itens-sol" disabled={ocupado || !!anexando}>
    <legend>Itens</legend>
    <BuscaPncpLote key={JSON.stringify(descricoes)} descricoes={descricoes} ocupado={ocupado || !!anexando} usar={usarPncp} />
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
      <h4>Conferir orçamento</h4>
      <label className="campo">Fornecedor da proposta
        <input value={leitura.dados.fornecedor ?? ""} maxLength={200} placeholder="Informe a razão social ou o nome comercial"
          onChange={(e) => setLeitura({ ...leitura, dados: { ...leitura.dados, fornecedor: e.target.value } })} />
      </label>
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
              const fornecedor = limparNomeFornecedor(c.fornecedor);
              return <div className="cotacao-fornecedor cotacao-linha" key={j}>
                <div className="cotacao-grade">
                  <label>{c.fonte && c.fonte !== "fornecedor" ? "Fonte" : `Fornecedor ${j + 1}`}
                    <input aria-label={`Nome do fornecedor ${j + 1} do item ${k + 1}`} maxLength={200} value={c.fornecedor}
                      placeholder={c.orcamentoId && !fornecedor ? "Identifique o fornecedor" : "Nome do fornecedor"}
                      onChange={(e) => alterarCotacao(k, j, { fornecedor: e.target.value })} />
                  </label>
                  <label>Preço unitário (R$)<input aria-label={`Preço unitário do fornecedor ${j + 1} do item ${k + 1}`}
                    inputMode="decimal" value={c.valor} onChange={(e) => alterarCotacao(k, j, { valor: e.target.value })} /></label>
                  <div className="cotacao-anexo">
                    <button className="btn sm" type="button" onClick={() => document.getElementById(`cotacao-arquivo-${k}-${j}`)?.click()}>
                      {anexando === `${k}-${j}` ? "Anexando…" : c.orcamentoId ? "Trocar anexo" : "Anexar orçamento"}</button>
                    <input hidden id={`cotacao-arquivo-${k}-${j}`} type="file" accept={formatos} onChange={(e) => {
                      const arquivo = e.target.files?.[0];
                      e.target.value = "";
                      if (arquivo) void anexar(k, j, arquivo);
                    }} />
                    {c.orcamentoId ? <a title={orcamento?.nome} href={`/api${caminho}/${c.orcamentoId}/arquivo`}>{orcamento?.nome ?? "Baixar orçamento"}</a>
                      : c.valor.trim() && <span className="small muted">Anexo pendente</span>}
                  </div>
                </div>
                <details className="cotacao-detalhes">
                  <summary>Fonte, data e opções</summary>
                  <div className="form">
                  <label>Fonte do orçamento<select value={c.fonte ?? "fornecedor"} onChange={(e) => alterarCotacao(k, j, { fonte: e.target.value as FonteCotacao })}>
                    {Object.entries(FONTES_COTACAO).filter(([fonte]) => fonte !== "pncp" || c.fonte === "pncp").map(([fonte, nome]) => <option key={fonte} value={fonte}>{nome}</option>)}
                  </select></label>
                  <label>Data da consulta<input type="date" value={c.consultadoEm ?? ""} onChange={(e) => alterarCotacao(k, j, { consultadoEm: e.target.value })} /></label>
                  {c.fonte && c.fonte !== "fornecedor" && <label className="wide">Link da referência
                    <input type="url" value={c.link ?? ""} onChange={(e) => alterarCotacao(k, j, { link: e.target.value })} />
                  </label>}
                  {orcamentos.length > 0 && <label className="wide">Usar orçamento já anexado
                    <select aria-label={`Orçamento do fornecedor ${j + 1} do item ${k + 1}`} value={c.orcamentoId ?? ""} onChange={(e) => {
                      const o = orcamentos.find((x) => String(x.id) === e.target.value);
                      selecionar(k, j, o?.id ?? null, o?.dados, nomeFornecedorOrcamento(o));
                    }}>
                      <option value="">Selecione um orçamento</option>
                      {orcamentos.map((o) => <option key={o.id} value={o.id}
                        disabled={linha.cotacoes.some((x, n) => n !== j && x.orcamentoId === o.id)}>{[nomeFornecedorOrcamento(o), o.nome].filter(Boolean).join(" · ")}</option>)}
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
                  {(linha.cotacoes.length > 1 || cotacaoPreenchida(c)) && <button type="button" className="lnk"
                    onClick={() => alterar(k, { cotacoes: linha.cotacoes.length > 1 ? linha.cotacoes.filter((_, i) => i !== j)
                      : linha.cotacoes.map((x, i) => i === j ? cotacaoVazia() : x) })}>Retirar cotação do item</button>}
                </details>
                {orcamento && !fornecedor && <div className="tools">
                  <span className="small muted">Confira o nome no orçamento e preencha o fornecedor.</span>
                  {ia && legivel(orcamento.nome) && <button type="button" className="lnk" onClick={() => relerFornecedor(k, j, orcamento)}>Ler fornecedor com IA</button>}
                </div>}
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
    <p className="small muted">Você pode digitar o preço antes de anexar. O cálculo é atualizado quando a proposta fica vinculada ao item. {ia ? "Confira os preços identificados pela IA." : ""}</p>
    {aviso && <p className="small" role="status">{aviso}</p>}
  </fieldset>;
}
