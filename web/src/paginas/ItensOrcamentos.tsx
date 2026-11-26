// Itens da contratação e orçamentos de cada item: lista de itens, janela "Adicionar item" e
// janela "Orçamentos e pesquisa de preços" com consolidação por média, mediana ou menor valor.
import { useEffect, useRef, useState, type Dispatch, type SetStateAction, type ReactNode } from "react";
import { brl, numBR } from "../api";
import { limparNomeFornecedor, nomeFornecedorOrcamento, type OrcamentoLido } from "../../../shared/orcamentos";
import { CRITERIOS_PRECO, FONTES_COTACAO, valorDasCotacoes, normalizarCotacao, type CriterioPreco, type FonteCotacao, type ItemSolicitacao } from "../../../shared/solicitacao";
import type { ResultadoPncp } from "../../../shared/pncp";
import { BuscaPncpItem } from "./BuscaPncpItem";
import { alertasDosPrecos } from "../../../shared/analise-precos";
import { ConsultaCnpj } from "./ConsultaCnpj";
import { cotacaoPreenchida, dataConsulta, linhaVazia, lerLinhas, type LinhaCotacao, type LinhaItem } from "./ItensSolicitacao";

const UNIDADES = ["UN", "CX", "PCT", "KG", "G", "L", "ML", "M", "M²", "M³", "T", "PAR", "JG", "RL", "FD", "GL", "SERV", "MÊS", "HORA", "DIÁRIA", "KIT", "CJ"];
const SEP = " — ";
/** O item guarda "nome — descrição" num só texto (é o que vai para os documentos). */
export const separarDescricao = (d: string) => { const i = d.indexOf(SEP); return i > 0 ? { nome: d.slice(0, i), descricao: d.slice(i + SEP.length) } : { nome: d, descricao: "" }; };
const juntarDescricao = (nome: string, descricao: string) => (nome.trim() && descricao.trim() ? `${nome.trim()}${SEP}${descricao.trim()}` : (nome || descricao).trim()).slice(0, 500);
const brData = (iso?: string) => (iso ? iso.split("-").reverse().join("/") : "—");

interface Props {
  linhas: LinhaItem[];
  setLinhas: Dispatch<SetStateAction<LinhaItem[]>>;
  orcamentos: OrcamentoLido[];
  caminho: string;
  ocupado: boolean;
  anexando: string;
  enviar: (arquivo: File) => Promise<{ id: number; fornecedor: string }>;
  executar: (acao: string, funcao: () => Promise<void>) => Promise<void>;
  recarregar: () => Promise<unknown>;
  usarPncp: (k: number, r: ResultadoPncp) => Promise<void>;
  setAviso: (t: string) => void;
  importacaoOrcamento: ReactNode;
  lerOrcamento: (id: number) => void;
  excluirProposta: (id: number) => void;
}

export function ItensOrcamentos(props: Props) {
  const { linhas, setLinhas } = props;
  const [editando, setEditando] = useState<number | "novo" | null>(null);
  const [orcamentosDe, setOrcamentosDe] = useState<{ k: number; pncp?: boolean } | null>(null);
  const [pncpDe, setPncpDe] = useState<number | null>(null);
  const [novaFonte, setNovaFonte] = useState("");
  const [fontesManuais, setFontesManuais] = useState<string[]>(() => [...new Set(linhas.flatMap((l) => l.cotacoes
    .filter((c) => c.orcamentoId == null && !!c.fornecedor.trim()).map((c) => c.fornecedor)))]);
  // Uma coluna por arquivo anexado ou fonte informada manualmente, compartilhada entre os itens.
  const chaveCotacao = (c: LinhaCotacao) => c.orcamentoId != null ? `o${c.orcamentoId}` : `n${normalizarCotacao(c.fornecedor)}`;
  const colunas = new Map<string, { chave: string; nome: string; fonte: FonteCotacao; arquivo?: OrcamentoLido }>();
  for (const o of props.orcamentos) {
    const chave = `o${o.id}`;
    colunas.set(chave, { chave, nome: nomeFornecedorOrcamento(o) || o.nome, fonte: o.dados?.fonte ?? "fornecedor", arquivo: o });
  }
  for (const l of linhas) for (const c of l.cotacoes.filter(cotacaoPreenchida)) {
    const chave = chaveCotacao(c);
    const existente = colunas.get(chave);
    colunas.set(chave, { ...existente, chave, nome: existente?.arquivo && nomeFornecedorOrcamento(existente.arquivo)
      || limparNomeFornecedor(c.fornecedor) || existente?.nome || "Fonte a informar", fonte: c.fonte ?? existente?.fonte ?? "fornecedor" });
  }
  for (const nome of fontesManuais) {
    const chave = `n${normalizarCotacao(nome)}`;
    if (!colunas.has(chave)) colunas.set(chave, { chave, nome, fonte: "fornecedor" });
  }
  const cotacoesTabela = [...colunas.values()];
  const excluirColuna = (col: { chave: string; nome: string; arquivo?: OrcamentoLido }) => {
    if (!confirm(`Excluir a proposta “${col.nome}” e os preços dela desta instrução?`)) return;
    if (col.arquivo) props.excluirProposta(col.arquivo.id);
    else {
      setLinhas((lista) => lista.map((l) => ({ ...l, cotacoes: l.cotacoes.filter((c) => chaveCotacao(c) !== col.chave) })));
      setFontesManuais((fontes) => fontes.filter((nome) => `n${normalizarCotacao(nome)}` !== col.chave));
      props.setAviso("Proposta excluída da tabela. Salve os dados da instrução para gravar.");
    }
  };
  const adicionarFonte = () => {
    const nome = limparNomeFornecedor(novaFonte);
    if (!nome) { props.setAviso("Informe o fornecedor ou a fonte para criar a coluna."); return; }
    if ([...colunas.values()].some((col) => normalizarCotacao(col.nome) === normalizarCotacao(nome))) {
      props.setAviso("Este fornecedor ou fonte já tem uma coluna na tabela. Digite os preços nela."); return;
    }
    setFontesManuais((atuais) => [...atuais, nome]);
    setNovaFonte("");
    props.setAviso("Coluna criada. Digite os preços na tabela e salve os dados da instrução.");
  };
  const alterarPreco = (k: number, chave: string, nome: string, fonte: FonteCotacao, arquivo: OrcamentoLido | undefined, valor: string) => {
    const linha = linhas[k];
    const atual = linha.cotacoes.findIndex((c) => cotacaoPreenchida(c) && chaveCotacao(c) === chave);
    if (valor.trim() && atual < 0 && linha.cotacoes.filter(cotacaoPreenchida).length >= 20) {
      props.setAviso("O item já tem 20 cotações. Retire uma em Mais opções antes de acrescentar outra."); return;
    }
    setLinhas((lista) => lista.map((l, i) => {
      if (i !== k) return l;
      const indice = l.cotacoes.findIndex((c) => cotacaoPreenchida(c) && chaveCotacao(c) === chave);
      if (!valor.trim()) return { ...l, cotacoes: l.cotacoes.filter((_, j) => j !== indice) };
      if (indice >= 0) return { ...l, valorAnterior: undefined, cotacoes: l.cotacoes.map((c, j) => j === indice ? { ...c, valor } : c) };
      return { ...l, valorAnterior: undefined, cotacoes: [...l.cotacoes.filter(cotacaoPreenchida), {
        orcamentoId: arquivo?.id ?? null, fornecedor: nome, valor, fonte, consultadoEm: dataConsulta(),
      }] };
    }));
  };
  const lidas = lerLinhas(linhas);
  // Índice de cada linha nos itens lidos (linhas vazias ficam de fora da leitura).
  const itemDa = (k: number): ItemSolicitacao | undefined => {
    const l = linhas[k];
    return l.descricao.trim() ? lerLinhas([l]).itens[0] : undefined;
  };
  const visiveis = linhas.map((l, k) => ({ l, k })).filter(({ l }) => l.descricao.trim() || l.cotacoes.some(cotacaoPreenchida));
  const total = lidas.itens.reduce((s, i) => s + (i.quantidade != null && i.valor_unitario != null ? i.quantidade * i.valor_unitario : 0), 0);
  const algumSemValor = lidas.itens.some((i) => i.valor_unitario == null);
  const remover = (k: number) => setLinhas((lista) => { const nova = lista.filter((_, i) => i !== k); return nova.length ? nova : [linhaVazia()]; });

  return (
    <div className="itens-orc">
      {props.importacaoOrcamento}
      <div className="orc-manual tools">
        <label>Orçamento sem arquivo<input value={novaFonte} maxLength={200} disabled={props.ocupado || !!props.anexando}
          placeholder="Nome do fornecedor ou fonte" onChange={(e) => setNovaFonte(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); adicionarFonte(); } }} /></label>
        <button type="button" className="btn" disabled={props.ocupado || !!props.anexando} onClick={adicionarFonte}>+ Criar coluna para digitar preços</button>
      </div>
      <div className="row">
        <div><h3>Itens da contratação</h3><p className="small muted">Cadastre os itens e consolide orçamentos de fornecedores, PNCP e outras fontes.</p></div>
        <button type="button" className="btn pri" disabled={props.ocupado || linhas.length >= 200} onClick={() => setEditando("novo")}>+ Adicionar item</button>
      </div>
      {visiveis.length === 0 ? <p className="muted vazio-itens">Nenhum item ainda. Clique em "Adicionar item".</p> :
        <div className="tw"><table className="t tabela-itens-orc">
          <thead><tr><th>Item</th><th>Item e descrição</th><th>Unidade</th><th className="r">Quantidade</th>
            {cotacoesTabela.map((col, j) => <th key={col.chave} className="coluna-cotacao">
              <span className="lbl">Cotação {j + 1}</span>
              <strong>{col.nome}</strong>
              <span className="small muted">{FONTES_COTACAO[col.fonte]}</span>
              {col.arquivo && <button type="button" className="lnk small" disabled={props.ocupado || !!props.anexando} onClick={() => props.lerOrcamento(col.arquivo!.id)}>Ler preços deste arquivo</button>}
              {col.arquivo && <a className="small" href={`/api${props.caminho}/${col.arquivo.id}/arquivo`} title={col.arquivo.nome}>📎 Ver anexo</a>}
              <button type="button" className="lnk perigo small" aria-label={`Excluir proposta da cotação ${j + 1}`} disabled={props.ocupado || !!props.anexando}
                onClick={() => excluirColuna(col)}>Excluir proposta</button>
            </th>)}
            <th className="r">Valor de referência</th><th>Pesquisa de preços</th><th className="r">Total</th><th className="r">Ações</th></tr></thead>
          <tbody>{visiveis.map(({ l, k }, n) => {
            const item = itemDa(k);
            const { nome, descricao } = separarDescricao(l.descricao);
            const valores = l.cotacoes.filter(cotacaoPreenchida);
            const total = item?.quantidade != null && item.valor_unitario != null ? item.quantidade * item.valor_unitario : null;
            return <tr key={k}>
              <td className="mono">{String(n + 1).padStart(2, "0")}</td>
              <td><b>{nome || "—"}</b>{descricao && <div className="small muted">{descricao}</div>}</td>
              <td>{l.unidade || "—"}</td>
              <td className="r num">{l.quantidade || "—"}</td>
              {cotacoesTabela.map((col, j) => {
                const c = l.cotacoes.find((c) => cotacaoPreenchida(c) && chaveCotacao(c) === col.chave);
                return <td key={col.chave} className="r num preco-cotacao">
                  <input aria-label={`Preço da cotação ${j + 1} para o item ${n + 1}`} inputMode="decimal" placeholder="Digite o preço"
                    className={c?.descarte ? "valor-descartado" : undefined} value={c?.valor ?? ""} disabled={props.ocupado || !!props.anexando} data-coluna={j}
                    onKeyDown={(e) => {
                      if (e.key !== "Enter") return;
                      e.preventDefault();
                      const campos = [...(e.currentTarget.closest("table")?.querySelectorAll<HTMLInputElement>(".preco-cotacao input") ?? [])]
                        .filter((input) => input.dataset.coluna === String(j));
                      const proximo = campos[campos.indexOf(e.currentTarget) + 1];
                      proximo?.focus(); proximo?.select();
                    }}
                    onChange={(e) => alterarPreco(k, col.chave, col.nome, col.fonte, col.arquivo, e.target.value)} />
                  {(c?.descarte || c?.apenas_referencia) && <span className="small muted">{c.descarte ? "Descartado" : "Somente referência"} · tratado na Pesquisa de preços</span>}

                </td>;

              })}
              <td className="r num">{item?.valor_unitario != null ? brl(item.valor_unitario) : <span className="muted">A pesquisar</span>}
                <span className="small muted">{CRITERIOS_PRECO[l.criterio ?? "media"]} · Pesquisa de preços</span>
              </td>
              <td><div className="acoes-preco">
                <button type="button" className="btn sm orc" onClick={() => setOrcamentosDe({ k })}>Mais opções{valores.length ? ` (${valores.length})` : ""}</button>
                <button type="button" className="btn sm pncp" onClick={() => setPncpDe(k)}>🔍 Buscar no PNCP</button>
              </div></td>
              <td className="r num">{total != null ? brl(Math.round(total * 100) / 100) : "—"}</td>
              <td className="r"><div className="acoes-linha">
                <button type="button" className="lnk" title="Editar item" aria-label={`Editar item ${n + 1}`} onClick={() => setEditando(k)}>✎</button>
                <button type="button" className="lnk perigo" title="Excluir item" aria-label={`Excluir item ${n + 1}`} onClick={() => { if (confirm(`Excluir o item ${n + 1}?`)) remover(k); }}>🗑</button>
              </div></td>
            </tr>;
          })}</tbody>
        </table></div>}
      {cotacoesTabela.length > 0 && <p className="small muted">Digite ou corrija os preços diretamente nas células. Média, mediana ou menor valor e o total são recalculados na hora. Depois, salve os dados da instrução.</p>}
      <p className="small muted">Defina os valores usados no cálculo, somente de referência e descartados na etapa Pesquisa de preços.</p>
      <div className="valor-preliminar"><span>Valor preliminar</span><b>{lidas.itens.length && total ? brl(Math.round(total * 100) / 100) + (algumSemValor ? " (parcial)" : "") : "A pesquisar"}</b></div>
      {lidas.erro && <p className="small aviso-anexo" role="status">{lidas.erro}</p>}
      <div className="tools fim">
        <button type="submit" name="acao" value="mesclar" className="btn pri" disabled={props.ocupado || !!props.anexando}>
          {props.ocupado ? "Salvando…" : "Salvar dados e orçamentos"}
        </button>
      </div>

      {editando !== null && <ModalItem linha={editando === "novo" ? undefined : linhas[editando]} fechar={() => setEditando(null)}
        salvar={(l) => {
          if (editando === "novo") setLinhas((lista) => {
            const vaga = lista.findIndex((x) => !x.descricao.trim() && !x.cotacoes.some(cotacaoPreenchida));
            return vaga >= 0 ? lista.map((x, i) => (i === vaga ? l : x)) : [...lista, l];
          });
          else setLinhas((lista) => lista.map((x, i) => (i === editando ? l : x)));
          setEditando(null);
        }} />}
      {pncpDe !== null && linhas[pncpDe] && <ModalPncp {...props} k={pncpDe} fechar={() => setPncpDe(null)} abrirOrcamentos={() => { const k = pncpDe; setPncpDe(null); setOrcamentosDe({ k }); }} />}
      {orcamentosDe && linhas[orcamentosDe.k] && <ModalOrcamentos {...props} k={orcamentosDe.k} focarPncp={!!orcamentosDe.pncp} fechar={() => setOrcamentosDe(null)} />}
    </div>
  );
}

/** Janela que abre como diálogo modal e fecha com Esc ou no X. */
function Janela({ titulo, subtitulo, fechar, largura, children }: { titulo: string; subtitulo?: string; fechar: () => void; largura?: number; children: React.ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const d = ref.current; if (d && !d.open) d.showModal(); return () => d?.close(); }, []);
  return (
    <dialog ref={ref} className="janela" style={largura ? { width: `min(${largura}px, calc(100% - 24px))` } : undefined} onCancel={(e) => { e.preventDefault(); fechar(); }}>
      <div className="janela-cab"><div><h2>{titulo}</h2>{subtitulo && <p className="small muted">{subtitulo}</p>}</div>
        <button type="button" className="lnk fechar" aria-label="Fechar" onClick={fechar}>×</button></div>
      {children}
    </dialog>
  );
}

function ModalItem({ linha, salvar, fechar }: { linha?: LinhaItem; salvar: (l: LinhaItem) => void; fechar: () => void }) {
  const inicial = separarDescricao(linha?.descricao ?? "");
  const [nome, setNome] = useState(inicial.nome);
  const [descricao, setDescricao] = useState(inicial.descricao);
  const [unidade, setUnidade] = useState(linha?.unidade ?? "");
  const [quantidade, setQuantidade] = useState(linha?.quantidade ?? "");
  const [valor, setValor] = useState(linha?.valorAnterior != null ? String(linha.valorAnterior).replace(".", ",") : "");
  const [erro, setErro] = useState("");
  const temCotacoes = !!linha?.cotacoes.some(cotacaoPreenchida);
  const confirmar = () => {
    if (!nome.trim()) return setErro("Informe o nome do item.");
    const q = numBR(quantidade);
    if (Number.isNaN(q) || q == null || q <= 0) return setErro("Informe a quantidade (ex.: 30 ou 2,5).");
    const v = valor.trim() ? numBR(valor) : null;
    if (Number.isNaN(v) || (v != null && v <= 0)) return setErro("Valor unitário inválido. Use, por exemplo, 189,90, ou deixe em branco.");
    salvar({ ...(linha ?? linhaVazia()), descricao: juntarDescricao(nome, descricao), unidade: unidade.trim().slice(0, 30), quantidade: quantidade.trim(),
      valorAnterior: temCotacoes ? linha?.valorAnterior : v });
  };
  return (
    <Janela titulo={linha ? "Editar item" : "Adicionar item"} subtitulo="Preencha as informações essenciais para continuar." fechar={fechar} largura={540}>
      {/* A janela fica dentro do formulário da solicitação: sem <form> próprio, para não enviar o formulário de fora. */}
      <div className="stack" onKeyDown={(e) => { if (e.key === "Enter" && (e.target as HTMLElement).tagName === "INPUT") { e.preventDefault(); confirmar(); } }}>
        <label>Nome do item<input autoFocus value={nome} maxLength={200} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Cadeira de escritório" /></label>
        <label>Descrição completa<textarea value={descricao} maxLength={480} rows={2} onChange={(e) => setDescricao(e.target.value)} placeholder="Especificação sem indicação indevida de marca..." /></label>
        <div className="grade-2">
          <label>Unidade<input list="unidades-item" value={unidade} maxLength={30} onChange={(e) => setUnidade(e.target.value.toUpperCase())} placeholder="Selecione ou digite" />
            <datalist id="unidades-item">{UNIDADES.map((u) => <option key={u} value={u} />)}</datalist></label>
          <label>Quantidade<input inputMode="decimal" value={quantidade} onChange={(e) => setQuantidade(e.target.value)} /></label>
        </div>
        {!temCotacoes && <div className="grade-2"><label>Valor unitário estimado<input inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} placeholder="Pode ficar em branco" /></label></div>}
        {temCotacoes && <p className="small muted">O valor unitário deste item vem dos orçamentos cadastrados.</p>}
        {erro && <p className="small aviso-anexo" role="alert">{erro}</p>}
        <div className="tools fim"><button type="button" className="btn" onClick={fechar}>Cancelar</button><button type="button" className="btn pri" onClick={confirmar}>✓ Salvar cadastro</button></div>
      </div>
    </Janela>
  );
}

/** Janela própria da busca no PNCP: já abre buscando pelo nome do item. Escolher um resultado lança o valor com o comprovante. */
function ModalPncp({ k, linhas, ocupado, anexando, usarPncp, fechar, abrirOrcamentos }: Props & { k: number; fechar: () => void; abrirOrcamentos: () => void }) {
  const linha = linhas[k];
  const { nome, descricao } = separarDescricao(linha.descricao);
  const doPncp = linha.cotacoes.filter((c) => cotacaoPreenchida(c) && c.fonte === "pncp");
  return (
    <Janela titulo="Buscar no PNCP" subtitulo={[nome, descricao].filter(Boolean).join(" — ")} fechar={fechar} largura={860}>
      <p className="small muted">Preços de itens iguais em contratações publicadas no PNCP. Ao escolher um resultado, o valor entra nos orçamentos do item com o comprovante anexado.</p>
      {doPncp.length > 0 && <p className="small"><b>{doPncp.length}</b> {doPncp.length === 1 ? "referência do PNCP já lançada" : "referências do PNCP já lançadas"} neste item.</p>}
      <BuscaPncpItem aberto descricao={nome || linha.descricao} ocupado={ocupado || !!anexando} usar={(r) => usarPncp(k, r)} />
      <div className="tools fim"><button type="button" className="btn" onClick={abrirOrcamentos}>Ver orçamentos do item</button><button type="button" className="btn pri" onClick={fechar}>Fechar</button></div>
    </Janela>
  );
}

const valorValido = (c: LinhaCotacao) => { const v = numBR(c.valor); return v != null && !Number.isNaN(v) && v > 0; };

function ModalOrcamentos({ k, linhas, setLinhas, orcamentos, caminho, ocupado, anexando, enviar, executar, recarregar, usarPncp, setAviso, focarPncp, fechar }: Props & { k: number; focarPncp: boolean; fechar: () => void }) {
  const linha = linhas[k];
  const { nome, descricao } = separarDescricao(linha.descricao);
  const vazio = { fonte: "fornecedor" as FonteCotacao, data: dataConsulta(), dataPreco: "", frete: "" as "" | "incluso" | "nao_incluso" | "nao_informado", fornecedor: "", valor: "", link: "", obs: "" };
  const [f, setF] = useState(vazio);
  const [erro, setErro] = useState("");
  const [anexarEm, setAnexarEm] = useState<number | "">("");
  const arquivo = useRef<HTMLInputElement>(null);
  const pncp = useRef<HTMLDivElement>(null);
  useEffect(() => { if (focarPncp) setTimeout(() => pncp.current?.scrollIntoView({ block: "center" }), 50); }, [focarPncp]);

  const cotacoes = linha.cotacoes.map((c, i) => ({ c, i })).filter(({ c }) => cotacaoPreenchida(c));
  const conhecidos = [...new Set([
    ...linhas.flatMap((l) => l.cotacoes.filter((c) => c.fonte === "fornecedor" || !c.fonte).map((c) => limparNomeFornecedor(c.fornecedor))),
    ...orcamentos.map((o) => nomeFornecedorOrcamento(o)),
  ].filter(Boolean))];
  const alterarLinha = (dados: Partial<LinhaItem>) => setLinhas((lista) => lista.map((l, i) => (i === k ? { ...l, ...dados } : l)));
  const lido = lerLinhas([linha]).itens[0];
  const comprovadas = lido?.cotacoes ?? [];
  const criterio = linha.criterio ?? "media";
  const alertas = lido ? alertasDosPrecos([lido], dataConsulta()) : [];
  const [cnpjDe, setCnpjDe] = useState<number | null>(null);
  const processoId = Number(/\/processos\/(\d+)\//.exec(caminho)?.[1]);

  const incluir = () => {
    const v = numBR(f.valor);
    if (v == null || Number.isNaN(v) || v <= 0) return setErro("Informe o valor unitário (ex.: 189,90).");
    if (!f.fornecedor.trim()) return setErro(f.fonte === "fornecedor" ? "Informe o fornecedor." : "Informe a fonte da referência (site, órgão ou documento).");
    if (cotacoes.length >= 20) return setErro("O item já tem 20 valores.");
    setErro("");
    const nova: LinhaCotacao = { orcamentoId: null, fornecedor: f.fornecedor.trim().slice(0, 200), valor: f.valor.trim(), fonte: f.fonte, link: f.link.trim(), consultadoEm: f.data, obs: f.obs.trim(),
      ...(f.dataPreco ? { dataPreco: f.dataPreco } : {}), ...(f.fonte === "fornecedor" && f.frete ? { frete: f.frete } : {}) };
    alterarLinha({ cotacoes: [...linha.cotacoes.filter(cotacaoPreenchida), nova], valorAnterior: undefined });
    setF({ ...vazio, fonte: f.fonte, data: f.data });
    setAnexarEm(linha.cotacoes.filter(cotacaoPreenchida).length);
  };
  const remover = (i: number) => alterarLinha({ cotacoes: linha.cotacoes.filter((_, n) => n !== i) });
  const anexar = (arq: File) => executar(`item-${k}`, async () => {
    const enviado = await enviar(arq);
    const alvo = anexarEm === "" ? -1 : anexarEm;
    setLinhas((lista) => lista.map((l, i) => {
      if (i !== k) return l;
      if (alvo >= 0 && l.cotacoes[alvo]) return { ...l, cotacoes: l.cotacoes.map((c, n) => (n === alvo ? { ...c, orcamentoId: enviado.id, fornecedor: c.fornecedor || enviado.fornecedor } : c)) };
      return { ...l, cotacoes: [...l.cotacoes.filter(cotacaoPreenchida), { orcamentoId: enviado.id, fornecedor: enviado.fornecedor, valor: "", fonte: "fornecedor", consultadoEm: dataConsulta() }] };
    }));
    await recarregar();
    setAviso(alvo >= 0 ? "Orçamento anexado ao valor escolhido." : "Orçamento anexado. Informe o valor unitário dele na tabela de valores.");
  });
  const nomeArquivo = (id: number | null) => orcamentos.find((o) => o.id === id)?.nome ?? "orçamento";

  const cartoes: [CriterioPreco, string][] = [["media", "Soma dos valores dividida pelo número de fontes."], ["mediana", "Valor central da amostra, menos sensível a extremos."], ["menor", "Menor preço unitário encontrado."]];
  return (
    <Janela titulo="Orçamentos e pesquisa de preços" subtitulo={[nome, descricao].filter(Boolean).join(" — ")} fechar={fechar} largura={1000}>
      <div className="orc-grade">
        <div className="stack">
          <section className="orc-bloco">
            <div className="grade-2">
              <label>Fonte do orçamento<select value={f.fonte} onChange={(e) => setF({ ...f, fonte: e.target.value as FonteCotacao })}>
                {Object.entries(FONTES_COTACAO).filter(([x]) => x !== "pncp").map(([x, t]) => <option key={x} value={x}>{t}</option>)}</select></label>
              <label>Data da consulta<input type="date" value={f.data} onChange={(e) => setF({ ...f, data: e.target.value })} /></label>
            </div>
            <div className="grade-2">
              <label>{f.fonte === "fornecedor" ? "Data da proposta" : "Data do preço (contratação ou publicação)"}<input type="date" value={f.dataPreco} onChange={(e) => setF({ ...f, dataPreco: e.target.value })} /></label>
              {f.fonte === "fornecedor" && <label>Frete<select value={f.frete} onChange={(e) => setF({ ...f, frete: e.target.value as typeof f.frete })}>
                <option value="">—</option><option value="incluso">Incluso no preço</option><option value="nao_incluso">Não incluso</option><option value="nao_informado">Não informado</option></select></label>}
            </div>
            <label>{f.fonte === "fornecedor" ? "Fornecedor" : "Fonte (site, órgão ou documento)"}
              <input list="fornecedores-orc" value={f.fornecedor} maxLength={200} onChange={(e) => setF({ ...f, fornecedor: e.target.value })} placeholder={f.fonte === "fornecedor" ? "Selecione ou digite o fornecedor" : "Ex.: Loja X, Prefeitura Y"} />
              <datalist id="fornecedores-orc">{conhecidos.map((x) => <option key={x} value={x} />)}</datalist></label>
            <div className="grade-2">
              <label>Valor unitário (R$)<input inputMode="decimal" value={f.valor} onChange={(e) => setF({ ...f, valor: e.target.value })} placeholder="ex.: 189,90" /></label>
              <label>Link ou referência<input value={f.link} maxLength={1500} onChange={(e) => setF({ ...f, link: e.target.value })} placeholder="https://... ou número do documento" /></label>
            </div>
            <label>Observações<textarea rows={2} value={f.obs} maxLength={1000} onChange={(e) => setF({ ...f, obs: e.target.value })} placeholder="Validade da proposta, condições ou outras informações" /></label>
            {erro && <p className="small aviso-anexo" role="alert">{erro}</p>}
            <div className="tools fim"><button type="button" className="btn pri" disabled={ocupado} onClick={incluir}>+ Incluir orçamento</button></div>
          </section>

          <section className="orc-bloco sem-pad">
            <h3 className="orc-tit">Valores cadastrados</h3>
            <div className="tw"><table className="t">
              <thead><tr><th>Fonte</th><th>Data do preço</th><th>Fornecedor / referência</th><th className="r">Valor unitário</th><th>Comprovante</th><th className="r">Ações</th></tr></thead>
              <tbody>{cotacoes.length === 0 ? <tr><td colSpan={6} className="muted centro">Nenhum orçamento cadastrado para este item.</td></tr>
                : cotacoes.map(({ c, i }) => <tr key={i}>
                  <td className="small">{FONTES_COTACAO[c.fonte ?? "fornecedor"]}</td>
                  <td className="small" title={c.dataPreco ? `Data do preço; consulta em ${brData(c.consultadoEm)}` : "Data da consulta"}>{brData(c.dataPreco ?? c.consultadoEm)}</td>
                  <td>{c.fornecedor || "—"}{c.verificacao && <div className={`small ${c.verificacao.sancoes.length || !/^ativa$/i.test(c.verificacao.situacao) ? "perigo" : "ok"}`}>
                    Receita: {c.verificacao.situacao || "—"}{c.verificacao.sancoes_consultadas && ` · TCU: ${c.verificacao.sancoes.length ? `consta em ${c.verificacao.sancoes.join(", ")}` : "nada consta"}`}</div>}{c.obs && <div className="small muted">{c.obs}</div>}{c.link && <div className="small">{/^https?:\/\//.test(c.link) ? <a href={c.link} target="_blank" rel="noopener noreferrer">link</a> : c.link}</div>}</td>
                  <td className="r num">{valorValido(c) ? <span className={c.descarte ? "valor-descartado" : undefined}>{brl(numBR(c.valor)!)}</span> : <input aria-label="Valor unitário" className="valor-inline" inputMode="decimal" placeholder="informar" defaultValue={c.valor}
                    onBlur={(e) => alterarLinha({ cotacoes: linha.cotacoes.map((x, n) => (n === i ? { ...x, valor: e.target.value.trim() } : x)) })} />}
                    {(c.descarte || c.apenas_referencia) && <div className="small muted">{c.descarte ? "Descartado" : "Somente referência"} · Pesquisa de preços</div>}
                  </td>
                  <td className="small">{c.orcamentoId != null ? <a className="anexo-ok" href={`/api${caminho}/${c.orcamentoId}/arquivo`}>✓ {nomeArquivo(c.orcamentoId)}</a>
                    : <button type="button" className="lnk" onClick={() => { setAnexarEm(i); arquivo.current?.click(); }}>Anexar (opcional)</button>}</td>
                  <td className="r"><button type="button" className="lnk" title="Consultar CNPJ e sanções do fornecedor" onClick={() => setCnpjDe(cnpjDe === i ? null : i)}>CNPJ</button>{" "}
                    <button type="button" className="lnk perigo" aria-label="Remover valor" onClick={() => remover(i)}>🗑</button></td>
                </tr>)}</tbody>
            </table></div>
          </section>
          {alertas.length > 0 && <section className="orc-bloco aviso-anexo" role="status">
            <strong>Pontos de atenção antes de calcular</strong>
            <ul className="small">{alertas.map((a, n) => <li key={n}>{a.fornecedor ? `${a.fornecedor}: ` : ""}{a.texto}</li>)}</ul>
            <span className="small">Descarte o preço, marque-o como somente referência ou justifique a manutenção na análise complementar da pesquisa de preços.</span>
          </section>}
          {cnpjDe != null && linha.cotacoes[cnpjDe] && <ConsultaCnpj key={cnpjDe} processoId={processoId} cnpjInicial={linha.cotacoes[cnpjDe].cnpj} fornecedor={linha.cotacoes[cnpjDe].fornecedor}
            aoJuntar={() => void recarregar()}
            registrar={(verificacao, cnpj) => alterarLinha({ cotacoes: linha.cotacoes.map((x, n) => (n === cnpjDe ? { ...x, cnpj, verificacao } : x)) })} />}

          <section className="orc-bloco">
            <div className="row"><div><h3 className="orc-tit">Anexos dos orçamentos</h3><p className="small muted">Opcional: anexe a proposta, cotação ou documento que comprova o preço deste item.</p></div></div>
            <div className="grade-anexo">
              <label>Vincular ao valor<select value={anexarEm} onChange={(e) => setAnexarEm(e.target.value === "" ? "" : Number(e.target.value))}>
                <option value="">Novo orçamento (informar o valor depois)</option>
                {cotacoes.map(({ c, i }) => <option key={i} value={i}>{c.fornecedor || "Sem nome"} · {c.valor || "sem valor"}{c.orcamentoId != null ? " · já tem anexo" : ""}</option>)}
              </select></label>
              <button type="button" className="btn pri" disabled={ocupado || !!anexando} onClick={() => arquivo.current?.click()}>📎 {anexando === `item-${k}` ? "Anexando…" : "Anexar orçamento"}</button>
              <input ref={arquivo} hidden type="file" accept=".pdf,.docx,.xlsx,.xls,.jpg,.jpeg,.png,.txt,.csv" onChange={(e) => { const a = e.target.files?.[0]; e.target.value = ""; if (a) void anexar(a); }} />
            </div>
            <div ref={pncp} className={"orc-pncp" + (focarPncp ? " destaque" : "")}>
              <BuscaPncpItem descricao={nome || linha.descricao} ocupado={ocupado || !!anexando} usar={(r) => usarPncp(k, r)} />
            </div>
          </section>
        </div>

        <aside className="stack orc-lado">
          <div className="orc-consolidar"><b>Consolidar valor estimado</b><span className="small">O critério e o tratamento dos valores são definidos na etapa Pesquisa de preços.</span></div>
          {cartoes.map(([c, texto]) => {
            const v = valorDasCotacoes(comprovadas, c);
            const ativo = criterio === c && v != null;
            return <div key={c} className={"orc-cartao" + (ativo ? " ativo" : "")}>
              <span>{CRITERIOS_PRECO[c]}</span>
              <b>{v != null ? brl(v) : "Sem preço válido"}</b>
              <span className="small muted">{texto}</span>
              {ativo && <span className="small">Critério em uso</span>}
            </div>;
          })}
          <p className="small muted">{comprovadas.filter((c) => c.valor_unitario != null && !c.descarte && !c.apenas_referencia).length} {comprovadas.filter((c) => c.valor_unitario != null && !c.descarte && !c.apenas_referencia).length === 1 ? "valor" : "valores"} no cálculo. O anexo do orçamento é opcional.</p>
        </aside>
      </div>
      <div className="tools fim"><button type="button" className="btn" onClick={fechar}>Fechar</button></div>
    </Janela>
  );
}
