import type { ItemOrcamento } from "./orcamentos.js";
import { normalizarCotacao } from "./solicitacao.js";

/**
 * Conciliação de itens: decide se a linha de um orçamento (ou um item repetido) é o mesmo item já lançado,
 * mesmo quando o fornecedor escreve a descrição de outro jeito ("LIMPEZA DE AR CONDICIONADO — Higienização…
 * (cód. 42361)" e "Limpeza de ar condicionado - higienização…"). Compara as palavras, os números da descrição
 * (faixas de BTU, bitolas, medidas), a unidade e a quantidade. Regra fixa, sem IA.
 */
type Comparavel = { descricao: string; unidade?: string | null; quantidade?: string | number | null };

const VAZIAS = new Set("para com sem dos das de da do e a o em no na nos nas tipo obs observacao fornecedor indicar qual diversos modelos modelo completo completa btu btus cod codigo".split(" "));
const SINONIMOS: Record<string, string> = { remoca: "desins", higien: "limpez", lavage: "limpez" };

function assinatura(texto: string) {
  const limpo = normalizarCotacao(texto)
    .replace(/\(?\bc[oó]d(?:igo)?\.?\s*\d+\)?/g, " ") // código do catálogo do fornecedor
    .replace(/(\d)\.(\d{3})\b/g, "$1$2");            // 36.000 -> 36000
  const numeros = new Set((limpo.match(/\d+(?:,\d+)?(?:\/\d+)?/g) ?? []).map((n) => n.replace(",", ".")));
  const palavras = new Set((limpo.match(/[a-z]{3,}/g) ?? [])
    .filter((p) => !VAZIAS.has(p)).map((p) => p.slice(0, 6)).map((p) => SINONIMOS[p] ?? p));
  return { numeros, palavras };
}
const numeroDe = (q: string | number | null | undefined) => {
  if (q == null || q === "") return null;
  if (typeof q === "number") return q;
  const n = Number(q.trim().replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
};
const comuns = (a: Set<string>, b: Set<string>) => [...a].filter((x) => b.has(x)).length;

/** Semelhança de 0 a 1 entre dois itens; -1 quando as unidades são diferentes (não podem ser o mesmo item). */
export function semelhanca(a: Comparavel, b: Comparavel) {
  const ua = normalizarCotacao(a.unidade ?? ""), ub = normalizarCotacao(b.unidade ?? "");
  if (ua && ub && ua !== ub) return -1;
  const sa = assinatura(a.descricao), sb = assinatura(b.descricao);
  if (!sa.palavras.size || !sb.palavras.size) return 0;
  const palavras = comuns(sa.palavras, sb.palavras) / Math.min(sa.palavras.size, sb.palavras.size);
  // Números decidem a variante do item (faixa de BTU, bitola): conjuntos diferentes derrubam a semelhança.
  const numeros = sa.numeros.size && sb.numeros.size
    ? comuns(sa.numeros, sb.numeros) / Math.max(sa.numeros.size, sb.numeros.size)
    : sa.numeros.size || sb.numeros.size ? 0.5 : 1;
  const qa = numeroDe(a.quantidade), qb = numeroDe(b.quantidade);
  const quantidade = qa != null && qb != null ? (qa === qb ? 1 : 0) : 0.5;
  return 0.5 * palavras + 0.35 * numeros + 0.15 * quantidade;
}
const MINIMO = 0.62;
const FOLGA = 0.04;

/**
 * Para cada pares candidato (origem, destino, nota), escolhe as ligações de maior nota sem repetir origem nem
 * destino. Uma origem cujo segundo melhor destino empata com o primeiro fica ambígua (vai para conferência manual).
 */
function ligar(notas: { origem: number; destino: number; nota: number }[], origens: number) {
  const melhores = new Map<number, number[]>();
  for (const n of notas) melhores.set(n.origem, [...(melhores.get(n.origem) ?? []), n.nota].sort((x, y) => y - x));
  const ambiguas = new Set([...melhores].filter(([, l]) => l.length > 1 && l[0] - l[1] < FOLGA).map(([o]) => o));
  const usadasO = new Set<number>(), usadosD = new Set<number>();
  const ligacoes = new Map<number, number>();
  for (const n of [...notas].sort((x, y) => y.nota - x.nota)) {
    if (n.nota < MINIMO || ambiguas.has(n.origem) || usadasO.has(n.origem) || usadosD.has(n.destino)) continue;
    usadasO.add(n.origem); usadosD.add(n.destino); ligacoes.set(n.origem, n.destino);
  }
  return Array.from({ length: origens }, (_, o) => ({ destino: ligacoes.get(o) ?? null, ambigua: !ligacoes.has(o) && ambiguas.has(o) }));
}

/** Item de destino de cada linha lida de um orçamento: primeiro a descrição idêntica, depois a mais parecida. */
export function destinosDoOrcamento(linhas: Comparavel[], lidos: ItemOrcamento[]) {
  const usados = new Set<number>();
  const exatos = lidos.map((item) => {
    const descricao = normalizarCotacao(item.descricao);
    const unidade = normalizarCotacao(item.unidade ?? "");
    const candidatos = linhas.flatMap((linha, indice) => {
      const igual = normalizarCotacao(linha.descricao) === descricao;
      const compativel = !unidade || !(linha.unidade ?? "").trim() || normalizarCotacao(linha.unidade ?? "") === unidade;
      return igual && compativel ? [indice] : [];
    });
    if (candidatos.length === 0) return null;
    if (candidatos.length > 1 || usados.has(candidatos[0])) return { indice: null, ambigua: true };
    usados.add(candidatos[0]);
    return { indice: candidatos[0], ambigua: false };
  });
  const pendentes = exatos.flatMap((r, i) => (r ? [] : [i]));
  const notas = pendentes.flatMap((i, o) => linhas.flatMap((linha, d) => {
    if (usados.has(d) || !linha.descricao.trim()) return [];
    const nota = semelhanca(lidos[i], linha);
    return nota > 0 ? [{ origem: o, destino: d, nota }] : [];
  }));
  const ligados = ligar(notas, pendentes.length);
  return exatos.map((r, i) => {
    if (r) return r;
    const l = ligados[pendentes.indexOf(i)];
    return l.destino != null ? { indice: l.destino, ambigua: false, aproximado: true } : { indice: null, ambigua: l.ambigua };
  });
}

/**
 * Itens repetidos na mesma solicitação (o mesmo item lançado duas vezes, cada vez com o preço de um fornecedor):
 * para cada item posterior, o item anterior com que ele deve ser juntado. Só junta itens sem fornecedor em comum.
 */
export function itensRepetidos(itens: (Comparavel & { fornecedores: string[] })[]) {
  const notas: { origem: number; destino: number; nota: number }[] = [];
  itens.forEach((b, o) => itens.forEach((a, d) => {
    if (d >= o || !a.descricao.trim() || !b.descricao.trim()) return;
    const fa = new Set(a.fornecedores.map(normalizarCotacao));
    if (b.fornecedores.some((f) => fa.has(normalizarCotacao(f)))) return;
    const nota = semelhanca(b, a);
    if (nota > 0) notas.push({ origem: o, destino: d, nota });
  }));
  // Um item que já recebeu outro não é absorvido; e quem é absorvido não recebe.
  const ligados = ligar(notas, itens.length);
  const destinos = new Set(ligados.flatMap((l) => (l.destino == null ? [] : [l.destino])));
  return ligados.flatMap((l, o) => (l.destino == null || destinos.has(o) ? [] : [{ item: o, juntarEm: l.destino }]));
}
