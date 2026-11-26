// Motor da pesquisa de preços: estatística por item, enquadramento no art. 23, § 1º, data-base e alertas de
// comparabilidade. Os textos dos itens 7 e 8 do relatório saem destes números, não de parágrafos fixos.
import { CRITERIOS_PRECO, FONTES_COTACAO, MOTIVOS_DESCARTE, normalizarCotacao, valorDasCotacoes, type CotacaoItem, type ItemSolicitacao } from "./solicitacao.js";

/**
 * Coeficiente de variação acima do qual a dispersão é apontada (%). A lei não fixa percentual:
 * valor provisório, a ser definido pela Procuradoria.
 */
export const LIMITE_CV = 25;
/** Prazos de referência: orçamento direto (inciso IV) e contratações similares (inciso II), em dias. */
export const PRAZO_ORCAMENTO_DIAS = 180, PRAZO_SIMILAR_DIAS = 365;

export const INCISOS_ART23 = {
  I: "Painel de preços ou banco de preços em saúde (PNCP)",
  II: "Contratações similares da Administração Pública",
  III: "Mídia especializada, tabela de referência ou sítio eletrônico",
  IV: "Pesquisa direta com fornecedores",
  V: "Notas fiscais eletrônicas",
} as const;
export type Inciso = keyof typeof INCISOS_ART23;
/** Inciso → marca do campo "Parâmetros utilizados" da etapa. */
export const MARCA_DO_INCISO: Record<Inciso, string> = { I: "painel", II: "similares", III: "midia", IV: "fornecedores", V: "notas" };

const real = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const pct = (v: number) => `${v.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
export const dataBr = (iso?: string | null) => (iso ? iso.slice(0, 10).split("-").reverse().join("/") : "—");
const celula = (t: string) => t.replace(/\s*\n\s*/g, " ").replace(/\|/g, "/").trim() || "—";
const dias = (de: string, ate: string) => Math.round((Date.parse(ate) - Date.parse(de.slice(0, 10))) / 86_400_000);

/** Inciso do art. 23, § 1º, derivado do tipo de fonte (nunca digitado). */
export function incisoDaCotacao(c: CotacaoItem): Inciso | null {
  if (/^tabela de refer[êe]ncia/i.test(c.fornecedor)) return "III";
  switch (c.fonte ?? "fornecedor") {
    case "fornecedor": return "IV";
    case "banco_precos": case "pncp": return "II";
    case "loja": return "III";
    default: return null;
  }
}

const VAZIAS = new Set(["com", "para", "sem", "das", "dos", "tipo", "por", "uma", "unidade", "und"]);
const palavrasDe = (t: string) => new Set(normalizarCotacao(t).split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !VAZIAS.has(w)).map((w) => w.replace(/s$/, "")));
/**
 * O produto cotado diverge do item quando boa parte das palavras do item não aparece nele ("Grama Batatais" × "Grama Mato Grosso")
 * ou quando ele traz outro produto, mais específico ("Usinagem de brita graduada tratada com cimento" × "Brita graduada").
 */
export function produtoDiverge(produto: string, item: string) {
  const p = palavrasDe(produto), i = palavrasDe(item);
  if (!p.size || !i.size) return false;
  const doItem = [...i].filter((w) => p.has(w)).length / i.size;
  const doProduto = [...p].filter((w) => i.has(w)).length / p.size;
  return doItem < 0.6 || (doProduto < 0.5 && p.size <= 8);
}

const temPreco = (c: CotacaoItem) => !!c.fornecedor.trim() && c.valor_unitario != null && c.valor_unitario > 0;
export const usadaNoCalculo = (c: CotacaoItem) => temPreco(c) && !c.descarte && !c.apenas_referencia;

export interface Estatistica { n: number; menor: number; maior: number; media: number; mediana: number; desvio: number | null; cv: number | null }
export function estatisticaDoItem(item: ItemSolicitacao): Estatistica | null {
  const v = (item.cotacoes ?? []).filter(usadaNoCalculo).map((c) => c.valor_unitario!).sort((a, b) => a - b);
  if (!v.length) return null;
  const n = v.length, media = v.reduce((s, x) => s + x, 0) / n;
  const mediana = n % 2 ? v[(n - 1) / 2] : (v[n / 2 - 1] + v[n / 2]) / 2;
  const desvio = n > 1 ? Math.sqrt(v.reduce((s, x) => s + (x - media) ** 2, 0) / (n - 1)) : null;
  return { n, menor: v[0], maior: v[n - 1], media, mediana, desvio, cv: desvio != null && media > 0 ? (desvio / media) * 100 : null };
}

export interface AlertaPreco { item: number; fornecedor: string | null; texto: string }
/** Pontos de atenção que exigem decisão (descartar, usar só como referência ou justificar). `hoje` em AAAA-MM-DD. */
export function alertasDosPrecos(itens: ItemSolicitacao[], hoje: string): AlertaPreco[] {
  const out: AlertaPreco[] = [];
  itens.forEach((item, k) => {
    for (const c of (item.cotacoes ?? []).filter(usadaNoCalculo)) {
      const a = (texto: string) => out.push({ item: k, fornecedor: c.fornecedor, texto });
      if (c.produto?.trim() && produtoDiverge(c.produto, item.descricao))
        a(`o produto cotado (“${c.produto.trim().slice(0, 120)}”) pode não corresponder ao item`);
      const inciso = incisoDaCotacao(c);
      if (c.verificacao) {
        if (c.verificacao.situacao && !/^ativa$/i.test(c.verificacao.situacao)) a(`CNPJ com situação cadastral “${c.verificacao.situacao}” na Receita (consulta de ${dataBr(c.verificacao.consultado_em)})`);
        if (c.verificacao.sancoes.length) a(`consta registro em ${c.verificacao.sancoes.join(", ")} (certidão consolidada do TCU de ${dataBr(c.verificacao.consultado_em)})`);
      }
      if (inciso === "IV") {
        if (c.frete === "nao_informado") a("frete não informado na proposta");
        else if (c.frete === "nao_incluso") a("frete não incluso no preço");
        if (c.validade && c.validade < hoje) a(`proposta com validade vencida em ${dataBr(c.validade)}`);
      }
      const data = c.data_preco ?? (inciso === "IV" ? c.consultado_em : undefined);
      if (data && inciso === "IV" && dias(data, hoje) > PRAZO_ORCAMENTO_DIAS) a(`orçamento de ${dataBr(data)}, com mais de 6 meses`);
      if (data && inciso === "II" && dias(data, hoje) > PRAZO_SIMILAR_DIAS) a(`contratação de ${dataBr(data)}, com mais de 1 ano`);
    }
    const e = estatisticaDoItem(item);
    if (e && e.n < 3) out.push({ item: k, fornecedor: null, texto: `apenas ${e.n} ${e.n === 1 ? "preço" : "preços"} no cálculo (recomendam-se ao menos três)` });
    if (e?.cv != null && e.cv > LIMITE_CV) out.push({ item: k, fornecedor: null, texto: `dispersão elevada: coeficiente de variação de ${pct(e.cv)}, acima do limite de ${LIMITE_CV}%` });
  });
  return out;
}

/** Incisos efetivamente usados (pelas cotações que entram no cálculo). */
export function incisosUsados(itens: ItemSolicitacao[]) {
  const usados = new Map<Inciso, number>();
  for (const c of itens.flatMap((i) => i.cotacoes ?? []).filter(usadaNoCalculo)) {
    const inciso = incisoDaCotacao(c);
    if (inciso) usados.set(inciso, (usados.get(inciso) ?? 0) + 1);
  }
  return [...usados.entries()].sort(([a], [b]) => a.localeCompare(b, "en", { numeric: true }));
}

/** Data-base: menor e maior data dos preços considerados (data do preço; na falta, a da consulta). */
export function dataBaseDosPrecos(itens: ItemSolicitacao[]) {
  const datas = itens.flatMap((i) => i.cotacoes ?? []).filter(usadaNoCalculo).map((c) => c.data_preco ?? c.consultado_em).filter((d): d is string => !!d).sort();
  if (!datas.length) return "";
  return datas[0] === datas.at(-1) ? dataBr(datas[0]) : `${dataBr(datas[0])} a ${dataBr(datas.at(-1))}`;
}

/** Quadro estatístico por item (item 7 do relatório). */
export function quadroEstatistico(itens: ItemSolicitacao[]) {
  const linhas = itens.map((item, k) => {
    const e = estatisticaDoItem(item);
    const adotado = item.cotacoes ? valorDasCotacoes(item.cotacoes, item.criterio) : item.valor_unitario;
    return e
      ? `| ${k + 1} | ${celula(item.descricao)} | ${e.n} | ${real(e.menor)} | ${real(e.maior)} | ${real(e.media)} | ${real(e.mediana)} | ${e.cv == null ? "—" : pct(e.cv)} | ${CRITERIOS_PRECO[item.criterio ?? "media"]}: ${adotado == null ? "—" : real(adotado)} |`
      : `| ${k + 1} | ${celula(item.descricao)} | 0 | — | — | — | — | — | — |`;
  });
  return ["| Item | Descrição | Preços | Menor | Maior | Média | Mediana | CV | Valor adotado |", "|:---:|---|:---:|---:|---:|---:|---:|---:|---:|", ...linhas].join("\n");
}

/** Quadro das fontes: uma linha por preço, com inciso, data do preço, data da consulta e comprovante. */
export function quadroDasFontes(itens: ItemSolicitacao[]) {
  const incisos = new Set<Inciso>();
  const linhas = itens.flatMap((item, k) => (item.cotacoes ?? []).filter(temPreco).map((c) => {
    const inciso = incisoDaCotacao(c);
    if (inciso) incisos.add(inciso);
    const uso = c.descarte ? " (descartado)" : c.apenas_referencia ? " (só referência)" : "";
    const v = c.verificacao;
    const verif = v && `Receita: ${v.situacao || "—"}${v.sancoes_consultadas ? `; TCU: ${v.sancoes.length ? `consta em ${v.sancoes.join(", ")}` : "nada consta"}` : ""} (${dataBr(v.consultado_em)})`;
    const ref = [c.cnpj && `CNPJ ${c.cnpj}`, verif, c.obs, c.link].filter(Boolean).join(" · ");
    return `| ${k + 1} | ${celula(`${c.fornecedor}${uso}${ref ? ` — ${ref}` : ""}`)} | ${inciso ?? "—"} | ${dataBr(c.data_preco)} | ${dataBr(c.consultado_em)} | ${real(c.valor_unitario!)} | ${c.orcamento_id != null ? "Anexado" : c.link ? "Link" : "—"} |`;
  }));
  if (!linhas.length) return "";
  const legenda = [...incisos].sort().map((i) => `${i} — ${INCISOS_ART23[i].charAt(0).toLowerCase()}${INCISOS_ART23[i].slice(1)}`).join("; ");
  return ["| Item | Fonte e referência | Inciso | Data do preço | Consulta | Preço unit. | Comprovante |", "|:---:|---|:---:|:---:|:---:|---:|:---:|", ...linhas].join("\n")
    + (legenda ? `\n\nIncisos do art. 23, § 1º, da Lei nº 14.133/2021: ${legenda}.` : "");
}

/**
 * Análise crítica (item 8): descartes e preços só de referência registrados, dispersão de cada item e pontos de atenção.
 * Havendo ponto de atenção sem justificativa do responsável, fica pendência — o sistema não declara a regularidade por ele.
 */
export function analiseDosPrecos(itens: ItemSolicitacao[], hoje: string, justificativa: string) {
  const l: string[] = [];
  const descartes = itens.flatMap((item, k) => (item.cotacoes ?? []).flatMap((c) => c.descarte
    ? [`Preço descartado — item ${k + 1} (${celula(item.descricao)}): ${celula(c.fornecedor)}, ${c.valor_unitario == null ? "valor não informado" : real(c.valor_unitario)}; motivo: ${MOTIVOS_DESCARTE[c.descarte.motivo]}; justificativa: ${celula(c.descarte.justificativa)}.`] : []));
  const referencias = itens.flatMap((item, k) => (item.cotacoes ?? []).flatMap((c) => c.apenas_referencia && temPreco(c)
    ? [`Preço somente de referência — item ${k + 1} (${celula(item.descricao)}): ${celula(c.fornecedor)}, ${real(c.valor_unitario!)}, mantido para consulta e fora do cálculo.`] : []));
  l.push(descartes.length ? `Foram descartados ${descartes.length} ${descartes.length === 1 ? "preço" : "preços"}, que não integram o cálculo:` : "Não houve preço descartado no quadro comparativo.", ...descartes, ...referencias);
  itens.forEach((item, k) => {
    const e = estatisticaDoItem(item);
    if (!e) return;
    l.push(`Item ${k + 1} (${celula(item.descricao)}): ${e.n} ${e.n === 1 ? "preço considerado" : "preços considerados"}${e.n > 1 ? `, de ${real(e.menor)} a ${real(e.maior)}; média de ${real(e.media)} e mediana de ${real(e.mediana)}${e.cv != null ? `; coeficiente de variação de ${pct(e.cv)}` : ""}` : `, de ${real(e.menor)}`}.`);
  });
  const alertas = alertasDosPrecos(itens, hoje);
  if (alertas.length) {
    l.push(`Pontos de atenção apurados na conferência automática (limite de dispersão adotado: ${LIMITE_CV}%):`,
      ...alertas.map((a) => `- Item ${a.item + 1}${a.fornecedor ? ` — ${celula(a.fornecedor)}` : ""}: ${a.texto}.`));
    if (justificativa.trim()) l.push(`Manifestação do responsável sobre os pontos de atenção: ${justificativa.trim()}`);
    else l.push("[[JUSTIFICAR: há pontos de atenção na pesquisa. Descarte os preços, marque-os como somente referência ou justifique a sua manutenção no campo “Análise complementar dos preços”]]");
  } else if (justificativa.trim()) l.push(`Análise complementar: ${justificativa.trim()}`);
  return l.join("\n\n");
}
