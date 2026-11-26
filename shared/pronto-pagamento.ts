// Pronto pagamento: pequenas compras e serviços de pronto pagamento (Lei nº 14.133/2021, art. 95, § 2º),
// com contrato verbal e pagamento imediato. Regras compartilhadas entre servidor e interface.

export interface ItemPP { descricao: string; unidade: string; quantidade: number | null; valor_unitario: number | null }
export interface DadosPP {
  // 1. Pedido
  secretaria: string; responsavel: string; tipo: "compra" | "servico"; objeto: string; justificativa: string;
  itens: ItemPP[]; fornecedor: string; fornecedor_doc: string; fornecedor_contato: string; pesquisa_preco: string; dotacao: string;
  // 3. Recebimento
  nota_numero: string; nota_data: string; nota_valor: number | null; recebido_por: string; recebido_em: string; recebimento_obs: string;
  // 4. Pagamento
  forma_pagamento: "" | "empenho" | "suprimento"; empenho: string; pago_em: string; pagamento_obs: string;
}
export type SituacaoPP = "pedido" | "autorizado" | "recebido" | "pago" | "cancelado";

export const VAZIO_PP: DadosPP = {
  secretaria: "", responsavel: "", tipo: "compra", objeto: "", justificativa: "", itens: [], fornecedor: "", fornecedor_doc: "", fornecedor_contato: "",
  pesquisa_preco: "", dotacao: "", nota_numero: "", nota_data: "", nota_valor: null, recebido_por: "", recebido_em: "", recebimento_obs: "",
  forma_pagamento: "", empenho: "", pago_em: "", pagamento_obs: "",
};

export const ETAPAS_PP = [
  { id: "pedido", nome: "Pedido", quem: "Secretaria", texto: "Secretaria, objeto, justificativa, itens com quantidade e valor, e o fornecedor." },
  { id: "autorizacao", nome: "Autorização", quem: "Ordenador da despesa", texto: "Confere o valor dentro do limite e autoriza a compra ou o serviço." },
  { id: "recebimento", nome: "Recebimento", quem: "Secretaria", texto: "Nota fiscal e atesto de que o bem ou o serviço foi entregue conforme o pedido." },
  { id: "pagamento", nome: "Pagamento", quem: "Contabilidade / Tesouraria", texto: "Empenho ou suprimento de fundos e data do pagamento." },
] as const;
export const ORDEM_SITUACAO: Record<SituacaoPP, number> = { pedido: 0, autorizado: 1, recebido: 2, pago: 3, cancelado: -1 };
export const SITUACOES: Record<SituacaoPP, string> = { pedido: "Pedido em elaboração", autorizado: "Autorizado", recebido: "Recebido e atestado", pago: "Pago", cancelado: "Cancelado" };
export const FORMAS_PAGAMENTO: Record<string, string> = {
  empenho: "Empenho e pagamento direto ao fornecedor",
  suprimento: "Suprimento de fundos (adiantamento — Lei nº 4.320/1964, arts. 65 e 68)",
};

/** Valor máximo do art. 95, § 2º, atualizado todo ano por decreto federal (art. 182). */
export const LIMITES_PP: Record<number, { valor: number; fonte: string }> = {
  2025: { valor: 12545.11, fonte: "Decreto nº 12.343/2024" },
  2026: { valor: 13098.41, fonte: "Decreto nº 12.807/2025" },
};
export function limitePP(ano: number) {
  if (LIMITES_PP[ano]) return { ...LIMITES_PP[ano], ano, exato: true };
  const anos = Object.keys(LIMITES_PP).map(Number).sort((a, b) => a - b);
  const usado = [...anos].reverse().find((a) => a <= ano) ?? anos[0];
  return { ...LIMITES_PP[usado], ano: usado, exato: false };
}

/** Titular da Secretaria, do cadastro de secretários, no texto do campo "responsável". */
export const titularPP = (t: { nome: string; secretaria: string; portaria: string | null }) =>
  `${t.nome} — Titular da Secretaria Municipal de ${t.secretaria}${t.portaria ? ` (Portaria nº ${t.portaria})` : ""}`;
/** Linhas de assinatura a partir do responsável: nome, cargo e portaria de nomeação, quando houver. */
export function assinaturaPP(responsavel: string, secretaria: string) {
  const [nome, resto] = responsavel.includes(" — ") ? responsavel.split(" — ", 2) : [responsavel || "Responsável pelo pedido", secretaria];
  const m = /^(.*?)\s*\(Portaria nº ([^)]+)\)\s*$/.exec(resto ?? "");
  return [`@ ${nome.trim()}`, `@ ${(m ? m[1] : resto || secretaria).trim()}`, ...(m ? [`@ Portaria de nomeação nº ${m[2].trim()}`] : [])].join("\n");
}

export const totalItemPP = (i: ItemPP) => i.quantidade != null && i.valor_unitario != null ? Math.round(i.quantidade * i.valor_unitario * 100) / 100 : null;
export const totalPP = (itens: ItemPP[]) => Math.round(itens.reduce((s, i) => s + (totalItemPP(i) ?? 0), 0) * 100) / 100;

export interface Pendencia { campo: string; texto: string }
/** O que falta no pedido para enviar à autorização. */
export function pendenciasPedido(d: DadosPP, ano: number): Pendencia[] {
  const l: Pendencia[] = [];
  const vazio = (x: string) => !x.trim();
  if (vazio(d.secretaria)) l.push({ campo: "secretaria", texto: "Informe a Secretaria solicitante." });
  if (vazio(d.responsavel)) l.push({ campo: "responsavel", texto: "Informe o responsável pelo pedido." });
  if (vazio(d.objeto)) l.push({ campo: "objeto", texto: "Descreva o objeto (sem marca)." });
  if (vazio(d.justificativa)) l.push({ campo: "justificativa", texto: "Justifique a necessidade e por que é pequena compra ou serviço de pronto pagamento." });
  if (!d.itens.length) l.push({ campo: "itens", texto: "Inclua ao menos um item." });
  else if (d.itens.some((i) => vazio(i.descricao) || totalItemPP(i) == null)) l.push({ campo: "itens", texto: "Todo item precisa de descrição, quantidade e valor unitário." });
  if (vazio(d.fornecedor)) l.push({ campo: "fornecedor", texto: "Informe o fornecedor." });
  if (vazio(d.fornecedor_doc)) l.push({ campo: "fornecedor_doc", texto: "Informe o CNPJ ou CPF do fornecedor." });
  if (vazio(d.pesquisa_preco)) l.push({ campo: "pesquisa_preco", texto: "Diga como o preço foi verificado (orçamentos, pesquisa ou preço de tabela)." });
  const total = totalPP(d.itens), lim = limitePP(ano);
  if (total > lim.valor) l.push({ campo: "itens", texto: `O total (${real(total)}) passa do limite do pronto pagamento (${real(lim.valor)}, ${lim.fonte}). Abra um processo de dispensa ou licitação.` });
  return l;
}
export function pendenciasRecebimento(d: DadosPP, total: number): Pendencia[] {
  const l: Pendencia[] = [];
  if (!d.nota_numero.trim()) l.push({ campo: "nota_numero", texto: "Informe o número da nota fiscal." });
  if (!d.nota_data) l.push({ campo: "nota_data", texto: "Informe a data da nota fiscal." });
  if (d.nota_valor == null) l.push({ campo: "nota_valor", texto: "Informe o valor da nota fiscal." });
  else if (d.nota_valor > total + 0.009) l.push({ campo: "nota_valor", texto: `A nota (${real(d.nota_valor)}) é maior que o valor autorizado (${real(total)}).` });
  if (!d.recebido_por.trim()) l.push({ campo: "recebido_por", texto: "Informe quem recebeu e atesta." });
  if (!d.recebido_em) l.push({ campo: "recebido_em", texto: "Informe a data do recebimento." });
  return l;
}
export function pendenciasPagamento(d: DadosPP): Pendencia[] {
  const l: Pendencia[] = [];
  if (!d.forma_pagamento) l.push({ campo: "forma_pagamento", texto: "Escolha a forma de pagamento." });
  if (d.forma_pagamento === "empenho" && !d.empenho.trim()) l.push({ campo: "empenho", texto: "Informe o número do empenho." });
  if (!d.pago_em) l.push({ campo: "pago_em", texto: "Informe a data do pagamento." });
  return l;
}

const real = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dataBR = (iso: string) => iso ? iso.split("-").reverse().join("/") : "";
const celula = (t: string) => t.replace(/\|/g, "/").replace(/\n+/g, " ");
const num = (n: number) => n.toLocaleString("pt-BR", { maximumFractionDigits: 3 });

export interface RegistroPP {
  protocolo: string; ano: number; situacao: SituacaoPP; dados: DadosPP; orgao: string; municipio: string;
  autorizado_por: string | null; autorizado_em: string | null;
}
/** Documento do pronto pagamento, no formato das minutas (# título, ## seções, quadros e @ assinaturas). */
export function documentoPP(r: RegistroPP, tipo: "autorizacao" | "completo") {
  const d = r.dados, total = totalPP(d.itens), lim = limitePP(r.ano);
  const l = [
    tipo === "autorizacao" ? "# SOLICITAÇÃO E AUTORIZAÇÃO DE PRONTO PAGAMENTO" : "# PROCESSO DE PRONTO PAGAMENTO",
    `${r.orgao} · Pronto pagamento nº ${r.protocolo}`,
    `Lei nº 14.133/2021, art. 95, § 2º — pequenas compras e serviços de pronto pagamento até ${real(lim.valor)} (${lim.fonte}).`,
    "## 1. Secretaria solicitante", `${d.secretaria}. Responsável: ${d.responsavel.replace(" — ", ", ")}.`,
    "## 2. Objeto", `${d.tipo === "servico" ? "Prestação de serviço" : "Compra"}: ${d.objeto}`,
    "## 3. Justificativa", d.justificativa,
    "## 4. Itens",
    [
      "| Item | Descrição | Un. | Qtd. | Valor unitário | Valor total |",
      "|:---:|---|:---:|---:|---:|---:|",
      ...d.itens.map((i, k) => `| ${k + 1} | ${celula(i.descricao)} | ${celula(i.unidade) || "—"} | ${i.quantidade == null ? "—" : num(i.quantidade)} | ${i.valor_unitario == null ? "—" : real(i.valor_unitario)} | ${real(totalItemPP(i) ?? 0)} |`),
      `| | **Total** | | | | **${real(total)}** |`,
    ].join("\n"),
    "## 5. Fornecedor", [d.fornecedor, d.fornecedor_doc && `CNPJ/CPF ${d.fornecedor_doc}`, d.fornecedor_contato].filter(Boolean).join(" · "),
    "## 6. Verificação do preço", d.pesquisa_preco,
  ];
  if (d.dotacao.trim()) l.push("## 7. Dotação orçamentária", d.dotacao);
  l.push("## Declaração",
    `O valor total de ${real(total)} não ultrapassa o limite do art. 95, § 2º, da Lei nº 14.133/2021 para o exercício. A contratação é verbal, de entrega ou execução imediata e sem obrigações futuras.`);
  l.push(`${r.municipio}${r.municipio ? ", " : ""}____ de ____________ de ${r.ano}.`, assinaturaPP(d.responsavel, d.secretaria));
  l.push("## Autorização", r.autorizado_por
    ? `Autorizo a ${d.tipo === "servico" ? "prestação do serviço" : "compra"} acima, no valor de ${real(total)}, por pronto pagamento. Autorizado em ${dataBR(r.autorizado_em!.slice(0, 10))}.`
    : `Autorizo a ${d.tipo === "servico" ? "prestação do serviço" : "compra"} acima, no valor de ${real(total)}, por pronto pagamento.`,
    `@ ${r.autorizado_por ?? "Ordenador da despesa"}\n@ Ordenador da despesa`);
  if (tipo === "completo") {
    if (ORDEM_SITUACAO[r.situacao] >= 2) l.push("## Recebimento e atesto",
      `Nota fiscal nº ${d.nota_numero}, de ${dataBR(d.nota_data)}, no valor de ${real(d.nota_valor ?? 0)}. Atesto que ${d.tipo === "servico" ? "o serviço foi prestado" : "os bens foram entregues"} conforme o pedido, em ${dataBR(d.recebido_em)}.${d.recebimento_obs ? ` ${d.recebimento_obs}` : ""}`,
      `@ ${d.recebido_por}\n@ Responsável pelo recebimento`);
    if (ORDEM_SITUACAO[r.situacao] >= 3) l.push("## Pagamento",
      `${FORMAS_PAGAMENTO[d.forma_pagamento] ?? ""}${d.empenho ? `. Empenho nº ${d.empenho}` : ""}. Pago em ${dataBR(d.pago_em)}.${d.pagamento_obs ? ` ${d.pagamento_obs}` : ""}`);
  }
  return l.join("\n\n");
}
