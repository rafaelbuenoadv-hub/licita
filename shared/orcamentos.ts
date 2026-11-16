// Dados que a IA lê de um orçamento e a comparação entre as propostas (regras fixas, sem IA).

export type Inclusao = "incluso" | "nao_incluso" | "nao_informado";
export interface ItemOrcamento { descricao: string; unidade: string | null; quantidade: number | null; valor_unitario: number | null; valor_total: number | null }
export interface DadosOrcamento {
  fornecedor: string | null; cnpj: string | null;
  /** Datas no formato AAAA-MM-DD. */
  data: string | null; validade: string | null;
  itens: ItemOrcamento[];
  valor_total: number | null;
  frete: Inclusao; instalacao: Inclusao;
  prazo_entrega: string | null; observacoes: string | null;
}
export interface OrcamentoLido { id: number; nome: string; dados: DadosOrcamento | null }
export interface Alerta { texto: string; orcamentos: number[] }

const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const soDigitos = (s: string | null) => (s ?? "").replace(/\D/g, "");

/** Aponta diferenças que atrapalham comparar as propostas. `hoje` no formato AAAA-MM-DD. */
export function compararOrcamentos(lista: OrcamentoLido[], hoje: string): Alerta[] {
  const lidos = lista.filter((o): o is OrcamentoLido & { dados: DadosOrcamento } => !!o.dados);
  const out: Alerta[] = [];
  const nomes = (os: OrcamentoLido[]) => os.map((o) => o.dados?.fornecedor || o.nome).join(", ");

  for (const [campo, rotulo] of [["frete", "frete"], ["instalacao", "instalação ou montagem"]] as const) {
    const com = lidos.filter((o) => o.dados[campo] === "incluso"), sem = lidos.filter((o) => o.dados[campo] === "nao_incluso");
    if (com.length && sem.length) out.push({
      texto: `O ${rotulo === "frete" ? "frete está incluído" : "valor inclui instalação ou montagem"} em ${nomes(com)}, mas não em ${nomes(sem)}. Os totais não são comparáveis sem esse ajuste.`,
      orcamentos: [...com, ...sem].map((o) => o.id),
    });
  }
  const contagens = new Set(lidos.filter((o) => o.dados.itens.length).map((o) => o.dados.itens.length));
  if (contagens.size > 1) out.push({
    texto: `As propostas não têm o mesmo número de itens (${lidos.filter((o) => o.dados.itens.length).map((o) => `${o.dados.fornecedor || o.nome}: ${o.dados.itens.length}`).join("; ")}). Confira se todas cotaram o mesmo escopo.`,
    orcamentos: lidos.map((o) => o.id),
  });
  for (const o of lidos) {
    const d = o.dados, quem = d.fornecedor || o.nome;
    const totais = d.itens.map((i) => i.valor_total ?? (i.quantidade != null && i.valor_unitario != null ? i.quantidade * i.valor_unitario : null));
    if (d.valor_total != null && totais.length && totais.every((t): t is number => t != null)) {
      const soma = Math.round(totais.reduce((s, t) => s + t, 0) * 100) / 100;
      if (Math.abs(soma - d.valor_total) > 0.05) out.push({ texto: `${quem}: a soma dos itens (${brl(soma)}) difere do total informado (${brl(d.valor_total)}).`, orcamentos: [o.id] });
    }
    if (d.validade && d.validade < hoje) out.push({ texto: `${quem}: a validade da proposta venceu em ${d.validade.split("-").reverse().join("/")}.`, orcamentos: [o.id] });
    if (!d.data) out.push({ texto: `${quem}: o orçamento não traz data.`, orcamentos: [o.id] });
    if (!soDigitos(d.cnpj)) out.push({ texto: `${quem}: o orçamento não traz CNPJ ou CPF do fornecedor.`, orcamentos: [o.id] });
  }
  const porCnpj = new Map<string, OrcamentoLido[]>();
  for (const o of lidos) { const c = soDigitos(o.dados.cnpj); if (c) porCnpj.set(c, [...(porCnpj.get(c) ?? []), o]); }
  for (const os of porCnpj.values()) if (os.length > 1) out.push({ texto: `Há ${os.length} orçamentos do mesmo fornecedor (${os[0].dados?.fornecedor || os[0].nome}). A pesquisa de preços pede fornecedores distintos.`, orcamentos: os.map((o) => o.id) });
  return out;
}
