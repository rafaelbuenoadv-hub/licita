import { useRef, useState, type Dispatch, type SetStateAction } from "react";
import { api, brl, numBR } from "../api";
import { limparNomeFornecedor, nomeFornecedorOrcamento, type DadosOrcamento, type OrcamentoLido } from "../../../shared/orcamentos";
import { CRITERIOS_PRECO, FONTES_COTACAO, valorDasCotacoes, normalizarCotacao, totalDoItem, totalDosItens, type DescartePreco, type CriterioPreco, type FonteCotacao, type CotacaoItem, type ItemSolicitacao } from "../../../shared/solicitacao";

import { destinosDoOrcamento, itensRepetidos } from "../../../shared/importar-orcamento";
import type { ResultadoPncp } from "../../../shared/pncp";
import { createPncpEvidence, pncpProcedure } from "../comp/comprovantePncp";
import { BuscaPncpItem } from "./BuscaPncpItem";
import { BuscaPncpLote } from "./BuscaPncpLote";
import { ItensOrcamentos } from "./ItensOrcamentos";

export interface LinhaCotacao { orcamentoId: number | null; fornecedor: string; valor: string; fonte?: FonteCotacao; link?: string; consultadoEm?: string; obs?: string; descarte?: DescartePreco }
// escolhas: destino definido à mão na conferência (índice do item, ou null para lançar como item novo).
type LeituraOrcamento = { id: number; dados: DadosOrcamento; usar: boolean[]; escolhas: Record<number, number | null> };
export const cotacaoPreenchida = (c: LinhaCotacao) => c.orcamentoId != null || !!c.fornecedor.trim() || !!c.valor.trim();
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
      fonte: c.fonte, link: c.link, consultadoEm: c.consultado_em, obs: c.obs, descarte: c.descarte,
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
  let erroDescarte: string | undefined;
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
      if (c.descarte && (!valor || !c.descarte.justificativa.trim())) erroDescarte ??= `Item ${k + 1} — informe o preço e a justificativa do descarte de ${fornecedor || "cada fonte"}.`;
      cotacoes.push({
        orcamento_id: c.orcamentoId, fornecedor, valor_unitario: valor,
        ...(c.descarte ? { descarte: { ...c.descarte, justificativa: c.descarte.justificativa.trim() } } : {}),
        ...(c.fonte ? { fonte: c.fonte } : {}), ...(c.link ? { link: c.link.trim() } : {}),
        ...(c.consultadoEm ? { consultado_em: c.consultadoEm } : {}),
        ...(c.obs?.trim() ? { obs: c.obs.trim().slice(0, 1000) } : {}),
      });
    }
    const dados = { descricao: l.descricao.trim(), unidade: l.unidade.trim(), quantidade };
    const manterAnterior = !cotacoes.length && l.valorAnterior !== undefined;
    itens.push(manterAnterior ? { ...dados, valor_unitario: l.valorAnterior ?? null }
      : { ...dados, cotacoes, criterio: l.criterio, valor_unitario: valorDasCotacoes(cotacoes, l.criterio) });
  }
  return { itens, ...(erroDescarte ? { erro: erroDescarte } : {}) };
}

const formatos = ".pdf,.docx,.xlsx,.xls,.jpg,.jpeg,.png,.txt,.csv";
const legivel = (nome: string) => /\.(pdf|jpe?g|png|docx|xlsx|txt|csv)$/i.test(nome);
export const dataConsulta = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Sao_Paulo" }).format(new Date());

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

/**
 * Coluna de cotação: um fornecedor (ou referência) com nome, anexo e fonte informados uma vez para todos os itens.
 * Os dados continuam guardados por item (cada item tem a sua lista de cotações); a coluna junta as cotações
 * do mesmo orçamento anexado ou, sem anexo, do mesmo nome de fornecedor.
 */
interface Coluna { chave: string; fornecedor: string; orcamentoId: number | null; fonte?: FonteCotacao; link?: string; consultadoEm?: string }
const chaveDe = (c: { orcamentoId: number | null; fornecedor: string }) =>
  c.orcamentoId != null ? `o${c.orcamentoId}` : `n${normalizarCotacao(limparNomeFornecedor(c.fornecedor))}`;
function colunasDosDados(linhas: LinhaItem[]): Coluna[] {
  const vistas = new Map<string, Coluna>();
  for (const l of linhas) for (const c of l.cotacoes) {
    if (!cotacaoPreenchida(c)) continue;
    const chave = chaveDe(c);
    if (!vistas.has(chave)) vistas.set(chave, { chave, fornecedor: c.fornecedor, orcamentoId: c.orcamentoId, fonte: c.fonte, link: c.link, consultadoEm: c.consultadoEm });
  }
  return [...vistas.values()];
}
let sequenciaColuna = 0;
const colunaNova = (): Coluna => ({ chave: `p${++sequenciaColuna}`, fornecedor: "", orcamentoId: null, fonte: "fornecedor" });
const pendente = (c: Coluna) => c.chave.startsWith("p");
/** Preço que a proposta lida dá para cada item, conciliando descrições escritas de outro jeito pelo fornecedor. */
function precosDaProposta(linhas: LinhaItem[], dados?: DadosOrcamento | null) {
  const precos = new Map<number, string>();
  if (!dados?.itens.length) return precos;
  destinosDoOrcamento(linhas, dados.itens).forEach((d, i) => {
    const preco = precoLido(dados.itens[i].valor_unitario);
    if (d.indice != null && !d.ambigua && preco) precos.set(d.indice, preco);
  });
  return precos;
}

export function ItensSolicitacao({ processoId, linhas, setLinhas, orcamentos, orcamentosOcultos, setOrcamentosOcultos, recarregar, ia, ocupado, setCotando }: {
  processoId: number;
  linhas: LinhaItem[];
  setLinhas: Dispatch<SetStateAction<LinhaItem[]>>;
  orcamentos: OrcamentoLido[];
  orcamentosOcultos: number[];
  setOrcamentosOcultos: Dispatch<SetStateAction<number[]>>;
  recarregar: () => Promise<unknown>;
  ia: boolean;
  ocupado: boolean;
  setCotando: (ativo: boolean) => void;
}) {
  const [anexando, setAnexando] = useState("");
  const seletorImportacao = useRef<HTMLInputElement>(null);
  const painelOrcamentos = useRef<HTMLElement>(null);
  const [aviso, setAviso] = useState("");
  const [leitura, setLeitura] = useState<LeituraOrcamento | null>(null);
  const [reler, setReler] = useState<{ id: number; fornecedor: string } | null>(null);
  const [orcamentoParaLer, setOrcamentoParaLer] = useState("");
  // Colunas ainda sem preço lançado (fornecedor recém-adicionado): ficam só na tela até receberem um preço.
  const [pendentes, setPendentes] = useState<Coluna[]>(() => (colunasDosDados(linhas).length ? [] : [colunaNova()]));
  const lidas = lerLinhas(linhas);
  const total = totalDosItens(lidas.itens);
  const parcial = !!lidas.erro || lidas.itens.some((item) => totalDoItem(item) == null);
  const orcamentosAtivos = orcamentos.filter((o) => !orcamentosOcultos.includes(o.id));
  const excluirProposta = (id: number) => {
    setLinhas((lista) => lista.map((l) => ({ ...l, cotacoes: l.cotacoes.filter((c) => c.orcamentoId !== id) })));
    setOrcamentosOcultos((ids) => [...new Set([...ids, id])]);
    if (leitura?.id === id) setLeitura(null);
    if (reler?.id === id) setReler(null);
    if (orcamentoParaLer === String(id)) setOrcamentoParaLer("");
    setAviso("Proposta excluída da tabela. Clique em Salvar orçamentos e atualizar solicitação para gravar.");
  };
  const caminho = `/processos/${processoId}/orcamentos`;
  const alterar = (k: number, dados: Partial<LinhaItem>) =>
    setLinhas((lista) => lista.map((l, i) => i === k ? { ...l, ...dados } : l));

  const enviar = async (arquivo: File) => {
    if (!arquivo.size || arquivo.size > 20 * 1024 * 1024) throw new Error("Selecione um arquivo de orçamento de até 20 MB.");
    const form = new FormData();
    form.append("arquivo", arquivo);
    const { ids: [id], orcamentos: propostas } = await api.post<{ ids: number[]; orcamentos?: OrcamentoLido[] }>(`${caminho}?origem=solicitacao`, form);
    return { id, fornecedor: limparNomeFornecedor(propostas?.[0]?.fornecedor) };
  };

  // Leitura pelo servidor: com a IA, ou sem ela (planilha, Word com tabela, PDF com texto) quando a IA está parada.
  const semIA = useRef(false);
  const lerOrcamento = async (id: number) => {
    const r = await api.post<{ dados: DadosOrcamento; sem_ia?: boolean }>(`${caminho}/${id}/ler${ia ? "" : "?sem_ia=1"}`);
    semIA.current = !!r.sem_ia;
    return r.dados;
  };

  const executar = async (acao: string, funcao: () => Promise<void>) => {
    setAviso("");
    setAnexando(acao);
    setCotando(true);
    try { await funcao(); }
    catch (e) { setAviso(e instanceof Error ? e.message : "Não foi possível registrar o orçamento."); }
    finally { setAnexando(""); setCotando(false); }
  };

  const conferirImportacao = async ({ id, fornecedor }: { id: number; fornecedor: string }) => {
    setReler({ id, fornecedor });
    const dados = await lerOrcamento(id);
    const itens = dados.itens.filter((i) => i.descricao.trim());
    if (!itens.length) throw new Error("O orçamento foi anexado. A leitura não encontrou itens para lançar.");
    // A leitura nunca escolhe o destino: cada preço depende da indicação expressa do usuário.
    setLeitura({ id, dados: { ...dados, fornecedor: limparNomeFornecedor(dados.fornecedor) || fornecedor, itens },
      usar: itens.map(() => false), escolhas: {} });
    setReler(null);
  };
  const importar = (arquivo: File) => executar("importar", async () => {
    if (!legivel(arquivo.name)) throw new Error("Para importar os itens, envie PDF, Word, XLSX, foto ou texto.");
    setLeitura(null);
    setReler(null);
    const enviado = await enviar(arquivo);
    try { await conferirImportacao(enviado); }
    finally { await recarregar(); }
  });

  const lerAnexado = (id?: number) => {
    if (id != null) setOrcamentoParaLer(String(id));
    painelOrcamentos.current?.scrollIntoView({ block: "start", behavior: "smooth" });
    const proposta = orcamentosAtivos.find((o) => String(o.id) === (id == null ? orcamentoParaLer : String(id)));
    if (!proposta) return;
    void executar("importar", async () => {
      setLeitura(null);
      try { await conferirImportacao({ id: proposta.id, fornecedor: nomeFornecedorOrcamento(proposta) }); }
      finally { await recarregar(); }
    });
  };
  const destinos = leitura?.dados.itens.map((_, k) => ({
    indice: leitura.escolhas[k] ?? null, ambigua: !Object.hasOwn(leitura.escolhas, k),
  })) ?? [];
  const aplicarLeitura = () => {
    if (!leitura) return;
    const fornecedor = limparNomeFornecedor(leitura.dados.fornecedor);
    if (!fornecedor) {
      setAviso("Informe o fornecedor na conferência do orçamento para lançar os itens.");
      return;
    }
    const escolhidos = leitura.usar.flatMap((usar, k) => usar && !destinos[k].ambigua && destinos[k].indice != null ? [destinos[k].indice] : []);
    if (new Set(escolhidos).size !== escolhidos.length) {
      setAviso("Há duas linhas deste orçamento relacionadas ao mesmo item. Escolha destinos diferentes ou desmarque uma delas.");
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
        valor: precoLido(lido.valor_unitario), fonte: leitura.dados.fonte ?? "fornecedor", consultadoEm: dataConsulta(),
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

  const dadosColunas = colunasDosDados(linhas);
  const colunas = [...dadosColunas, ...pendentes.filter((p) => !dadosColunas.some((d) => d.chave === chaveDe(p) && (p.fornecedor.trim() || p.orcamentoId != null)))];
  const indiceNaLinha = (l: LinhaItem, col: Coluna) => (pendente(col) ? -1 : l.cotacoes.findIndex((c) => cotacaoPreenchida(c) && chaveDe(c) === col.chave));

  /** Altera nome, anexo ou fonte da coluna em todos os itens que têm preço dela. */
  const alterarColuna = (col: Coluna, dados: Partial<Omit<Coluna, "chave">>) => {
    if (pendente(col)) { setPendentes((lista) => lista.map((p) => (p.chave === col.chave ? { ...p, ...dados } : p))); return; }
    setLinhas((lista) => lista.map((l) => {
      const j = indiceNaLinha(l, col);
      return j < 0 ? l : { ...l, cotacoes: l.cotacoes.map((c, n) => (n === j ? { ...c, ...dados } : c)) };
    }));
  };
  /** Preço de um item na coluna: cria a cotação no item, altera, ou retira quando o preço é apagado. */
  const alterarPreco = (k: number, col: Coluna, valor: string) => {
    setLinhas((lista) => lista.map((l, i) => {
      if (i !== k) return l;
      const j = indiceNaLinha(l, col);
      if (j >= 0) return { ...l, cotacoes: valor.trim() ? l.cotacoes.map((c, n) => (n === j ? { ...c, valor } : c)) : l.cotacoes.filter((_, n) => n !== j) };
      if (!valor.trim()) return l;
      return { ...l, cotacoes: [...l.cotacoes.filter(cotacaoPreenchida), {
        orcamentoId: col.orcamentoId, fornecedor: col.fornecedor, valor, fonte: col.fonte, link: col.link, consultadoEm: col.consultadoEm || dataConsulta(),
      }] };
    }));
    if (pendente(col) && valor.trim()) setPendentes((lista) => lista.filter((p) => p.chave !== col.chave));
  };
  const removerColuna = (col: Coluna) => {
    if (pendente(col)) { setPendentes((lista) => lista.filter((p) => p.chave !== col.chave)); return; }
    setLinhas((lista) => lista.map((l) => ({ ...l, cotacoes: l.cotacoes.filter((c) => !(cotacaoPreenchida(c) && chaveDe(c) === col.chave)) })));
  };
  /** Vincula um orçamento à coluna e preenche os preços dos itens que aparecem iguais na proposta lida. */
  const vincularOrcamento = (col: Coluna, id: number, dados: DadosOrcamento | null | undefined, nome: string) => {
    const novo = { orcamentoId: id, fornecedor: limparNomeFornecedor(col.fornecedor) || nome, fonte: "fornecedor" as FonteCotacao, link: "", consultadoEm: col.consultadoEm || dataConsulta() };
    let preenchidos = 0;
    const precos = precosDaProposta(linhas, dados);
    const resultado = linhas.map((l, k) => {
      const j = indiceNaLinha(l, col);
      const preco = precos.get(k);
      if (j >= 0) {
        if (!l.cotacoes[j].valor && preco) preenchidos++;
        return { ...l, cotacoes: l.cotacoes.map((c, n) => (n === j ? { ...c, ...novo, valor: c.valor || preco || "" } : c)) };
      }
      if (!preco || l.cotacoes.some((c) => c.orcamentoId === id)) return l;
      preenchidos++;
      return { ...l, cotacoes: [...l.cotacoes.filter(cotacaoPreenchida), { ...novo, valor: preco }] };
    });
    setLinhas(resultado);
    if (pendente(col)) {
      if (resultado.some((l) => l.cotacoes.some((c) => c.orcamentoId === id))) setPendentes((lista) => lista.filter((p) => p.chave !== col.chave));
      else setPendentes((lista) => lista.map((p) => (p.chave === col.chave ? { ...p, ...novo } : p)));
    }
    return preenchidos;
  };
  const aplicarDadosDaColuna = (col: Coluna, id: number, dados: DadosOrcamento, fornecedor = "") => {
    const n = vincularOrcamento(col, id, dados, limparNomeFornecedor(dados.fornecedor) || fornecedor);
    const quem = semIA.current ? "A leitura do arquivo" : "A IA";
    setAviso(n ? `Orçamento lido. ${quem} lançou o preço de ${n} ${n === 1 ? "item" : "itens"}. Confira e complete os demais.`
      : "Orçamento lido. Confira os preços da coluna e preencha os que estiverem faltando.");
  };
  const anexarNaColuna = (i: number, col: Coluna, arquivo: File) => executar(`col-${i}`, async () => {
    const { id, fornecedor } = await enviar(arquivo);
    try {
      if (legivel(arquivo.name)) aplicarDadosDaColuna(col, id, await lerOrcamento(id), fornecedor);
      else vincularOrcamento(col, id, null, fornecedor);
    } catch (e) {
      vincularOrcamento(col, id, null, fornecedor);
      throw new Error(`Orçamento anexado. ${e instanceof Error ? e.message : "A leitura da proposta falhou."}`);
    } finally { await recarregar(); }
  });
  const relerColuna = (col: Coluna, id: number) => executar(`fornecedor-${id}`, async () => {
    aplicarDadosDaColuna(col, id, await lerOrcamento(id));
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

  // Itens lançados duas vezes (o mesmo item, cada vez com o preço de um fornecedor): juntar numa linha só.
  const repetidos = itensRepetidos(linhas.map((l) => ({
    descricao: l.descricao, unidade: l.unidade, quantidade: l.quantidade,
    fornecedores: l.cotacoes.filter(cotacaoPreenchida).map((c) => chaveDe(c)),
  })));
  const [conferirRepetidos, setConferirRepetidos] = useState(false);
  const juntarRepetidos = () => {
    const absorvidos = new Set(repetidos.map((r) => r.item));
    const resultado = linhas.map((l, k) => {
      const vindos = repetidos.filter((r) => r.juntarEm === k).map((r) => linhas[r.item]);
      if (!vindos.length) return l;
      return { ...l, quantidade: l.quantidade || vindos[0].quantidade,
        cotacoes: [...l.cotacoes.filter(cotacaoPreenchida), ...vindos.flatMap((v) => v.cotacoes.filter(cotacaoPreenchida))] };
    }).filter((_, k) => !absorvidos.has(k));
    setLinhas(resultado);
    setConferirRepetidos(false);
    setAviso(`${absorvidos.size} ${absorvidos.size === 1 ? "item repetido foi juntado" : "itens repetidos foram juntados"}: os preços ficaram lado a lado, na coluna de cada fornecedor. Confira e salve a solicitação.`);
  };
  const descricoes = linhas.map((linha) => linha.descricao);

  const importacaoOrcamento = <section className="orcamento-direto stack" ref={painelOrcamentos}>
    <div><h3>Orçamentos</h3><p className="small muted">Adicione o arquivo, escolha os itens dos preços lidos e confira a tabela abaixo.</p></div>
    <div className="tools">
      <button className="btn pri" type="button" disabled={!!anexando || ocupado} onClick={() => seletorImportacao.current?.click()}>
        {anexando === "importar" ? "Lendo orçamento…" : "+ Adicionar orçamento (arquivo)"}</button>
      <>
        <input hidden ref={seletorImportacao} type="file" accept=".pdf,.docx,.xlsx,.jpg,.jpeg,.png,.txt,.csv" onChange={(e) => {
          const arquivo = e.target.files?.[0];
          e.target.value = "";
          if (arquivo) void importar(arquivo);
        }} />
        {reler && <button type="button" className="btn sm" onClick={() => executar("importar", async () => {
          await conferirImportacao(reler);
          await recarregar();
        })}>Tentar ler o orçamento anexado</button>}
        <span className="small muted">{ia ? "Confira as linhas extraídas antes de lançar nos itens." : "Lê planilhas (.xlsx, .csv), Word com tabela e PDF com texto selecionável. Foto e PDF digitalizado: informe os preços na coluna."}</span>
      </>
    </div>
    {orcamentosAtivos.length > 0 && <details className="orcamento-existente"><summary>Usar orçamento já anexado</summary>
      <div className="grade-anexo">
        <label>Arquivo<select value={orcamentoParaLer} disabled={ocupado || !!anexando} onChange={(e) => setOrcamentoParaLer(e.target.value)}>
          <option value="">Selecione o arquivo</option>
          {orcamentosAtivos.map((o) => <option key={o.id} value={o.id}>{o.nome}</option>)}
        </select></label>
        <button type="button" className="btn" disabled={!orcamentoParaLer || ocupado || !!anexando} onClick={() => lerAnexado()}>Ler preços</button>
      </div>
    </details>}
    {leitura && <div className="cotacao-item stack">
      <h4>Escolha o item de cada preço</h4>
      <p className="small muted">Escolha o item na última coluna e clique em Adicionar preços à tabela. As linhas sem item escolhido ficam de fora.</p>
      <label className="campo">Fornecedor ou fonte do orçamento
        <input value={leitura.dados.fornecedor ?? ""} maxLength={200} placeholder="Informe a razão social ou o nome comercial"
          onChange={(e) => setLeitura({ ...leitura, dados: { ...leitura.dados, fornecedor: e.target.value } })} />
      </label>
      <div className="tw"><table className="t">
        <thead><tr><th>Descrição no orçamento</th><th>Un.</th><th>Qtd.</th><th>Preço unitário</th><th>Relacionar ao item</th></tr></thead>
        <tbody>{leitura.dados.itens.map((i, k) => <tr key={k}>
          <td>{i.descricao}</td><td>{i.unidade || "—"}</td><td>{i.quantidade ?? "—"}</td><td>{brl(i.valor_unitario)}</td>
          <td><select aria-label={`Lançar a linha ${k + 1} da proposta em`} value={destinos[k].ambigua ? "" : destinos[k].indice == null ? "novo" : String(destinos[k].indice)}
            onChange={(e) => {
              const escolhas = { ...leitura.escolhas };
              if (!e.target.value) delete escolhas[k];
              else escolhas[k] = e.target.value === "novo" ? null : Number(e.target.value);
              setLeitura({ ...leitura, escolhas, usar: leitura.usar.map((v, n) => n === k ? !!e.target.value : v) });
            }}>
            <option value="">Selecione manualmente o item</option>
            <option value="novo">Novo item</option>
            {linhas.map((l, n) => l.descricao.trim() && <option key={n} value={n}>Item {n + 1} · {l.descricao.slice(0, 60)}</option>)}
          </select>
          </td>
        </tr>)}</tbody>
      </table></div>
      <div className="tools">
        <button className="btn pri" type="button" disabled={!leitura.usar.some((v, k) => v && !destinos[k].ambigua)} onClick={aplicarLeitura}>Adicionar preços à tabela</button>
        <button className="btn" type="button" onClick={() => setLeitura(null)}>Fechar conferência</button>
      </div>
    </div>}

    {orcamentosOcultos.length > 0 && <details className="orcamento-existente">
      <summary>Propostas excluídas desta solicitação ({orcamentosOcultos.length})</summary>
      <ul>{orcamentos.filter((o) => orcamentosOcultos.includes(o.id)).map((o) => <li key={o.id}>{o.nome}{" "}
        <button type="button" className="lnk" disabled={ocupado || !!anexando} onClick={() => {
          setOrcamentosOcultos((ids) => ids.filter((id) => id !== o.id));
          setAviso("Proposta restaurada na tabela. Leia o arquivo ou informe os preços e salve a solicitação.");
        }}>Restaurar proposta</button>
      </li>)}</ul>
    </details>}
    {aviso && <p className="note" role="status">{aviso}</p>}
  </section>;

  return <fieldset className="wide itens-sol" disabled={ocupado || !!anexando}>
    <legend>Itens</legend>
    <BuscaPncpLote key={JSON.stringify(descricoes)} descricoes={descricoes} ocupado={ocupado || !!anexando} usar={usarPncp} />

    {repetidos.length > 0 && <div className="note stack" role="status" style={{ gap: 8 }}>
      <div className="row"><span><strong>{repetidos.length} {repetidos.length === 1 ? "item parece repetido" : "itens parecem repetidos"}</strong>: o mesmo item lançado de novo com o preço de outro fornecedor.</span>
        <button type="button" className="btn sm" onClick={() => setConferirRepetidos(!conferirRepetidos)}>{conferirRepetidos ? "Fechar" : "Conferir e juntar"}</button></div>
      {conferirRepetidos && <>
        <div className="tw"><table className="t">
          <thead><tr><th>Item repetido</th><th>Junta-se ao item</th><th>Preços levados</th></tr></thead>
          <tbody>{repetidos.map((r) => {
            const de = linhas[r.item], para = linhas[r.juntarEm];
            return <tr key={r.item}>
              <td><b>{r.item + 1}</b> · {de.descricao}</td>
              <td><b>{r.juntarEm + 1}</b> · {para.descricao}{de.quantidade.trim() && para.quantidade.trim() && de.quantidade.trim() !== para.quantidade.trim() && <div className="small" style={{ color: "var(--bad)" }}>Quantidades diferentes ({para.quantidade} e {de.quantidade}): fica {para.quantidade}.</div>}</td>
              <td className="small">{de.cotacoes.filter(cotacaoPreenchida).map((c) => `${limparNomeFornecedor(c.fornecedor) || "Fornecedor"}: ${c.valor ? `R$ ${c.valor}` : "—"}`).join("; ")}</td>
            </tr>;
          })}</tbody>
        </table></div>
        <div className="tools"><button type="button" className="btn pri" onClick={juntarRepetidos}>Juntar {repetidos.length} {repetidos.length === 1 ? "item" : "itens"}</button>
          <span className="small">Confira a lista: só junte itens que são de fato o mesmo.</span></div>
      </>}
    </div>}
    <ItensOrcamentos linhas={linhas} setLinhas={setLinhas} orcamentos={orcamentosAtivos} caminho={caminho} ocupado={ocupado} anexando={anexando}
      enviar={enviar} executar={executar} recarregar={recarregar} usarPncp={usarPncp} setAviso={setAviso} importacaoOrcamento={importacaoOrcamento} lerOrcamento={(id) => lerAnexado(id)} excluirProposta={excluirProposta} />
    {aviso && <p className="small" role="status">{aviso}</p>}
  </fieldset>;
}
