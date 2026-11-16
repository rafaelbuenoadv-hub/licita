import type { ItemOrcamento } from "./orcamentos.js";
import { normalizarCotacao } from "./solicitacao.js";

export function destinosDoOrcamento(linhas: { descricao: string; unidade: string }[], lidos: ItemOrcamento[]) {
  const usados = new Set<number>();
  return lidos.map((item) => {
    const descricao = normalizarCotacao(item.descricao);
    const unidade = normalizarCotacao(item.unidade ?? "");
    const candidatos = linhas.flatMap((linha, indice) => {
      const igual = normalizarCotacao(linha.descricao) === descricao;
      const compativel = !unidade || !linha.unidade.trim() || normalizarCotacao(linha.unidade) === unidade;
      return igual && compativel ? [indice] : [];
    });
    if (candidatos.length === 0) return { indice: null, ambigua: false };
    if (candidatos.length > 1 || usados.has(candidatos[0])) return { indice: null, ambigua: true };
    usados.add(candidatos[0]);
    return { indice: candidatos[0], ambigua: false };
  });
}
