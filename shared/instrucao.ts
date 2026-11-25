import { totalDosItens, type ItemSolicitacao, type TopicoSolicitacao } from "./solicitacao.js";

export interface DadosInstrucao {
  secretaria: string;
  referencia?: string;
  nome_arquivo?: string | null;
  objeto: string;
  justificativa: string;
  informacoes: string;
  itens: ItemSolicitacao[];
  topicos_adicionais: TopicoSolicitacao[];
}
const unicos = (xs: string[]) => [...new Set(xs.map((x) => x.trim()).filter(Boolean))];
export function resumoDaInstrucao(registros: DadosInstrucao[]) {
  const itens = registros.flatMap((s) => s.itens ?? []);
  const total = totalDosItens(itens);
  return {
    objeto: unicos(registros.map((s) => s.objeto ?? "")).join("; "),
    justificativa: unicos(registros.map((s) => s.justificativa ?? "")).join("\n\n"),
    quantidades: itens.map((i) => `- ${i.descricao}: ${i.quantidade ?? "?"} ${i.unidade || ""}`.trimEnd()).join("\n"),
    valorTexto: total == null ? "" : `Valor estimado: R$ ${total.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}, conforme os preços unitários dos ${itens.length} itens da instrução do processo.`,
    itens, total,
  };
}

/** Informações livres de apoio, reutilizadas sem transformar a instrução em uma peça autônoma. */
export function complementosDaInstrucao(registros: DadosInstrucao[]) {
  const blocos = registros.flatMap((s) => {
    const informacoes = s.informacoes?.trim() ?? "";
    const topicos = (s.topicos_adicionais ?? []).filter((t) => t.titulo.trim() || t.conteudo.trim());
    if (!informacoes && !topicos.length && !s.referencia && !s.nome_arquivo) return [];
    const limpar = (texto: string) => texto.replace(/^#{1,6}\s+/gm, "").replace(/^@\s+/gm, "");
    return [[registros.length > 1 ? `**${s.secretaria}**` : "", s.referencia ? `**Documento de origem:** ${s.referencia}` : "", s.nome_arquivo ? `**Arquivo de origem:** ${s.nome_arquivo}` : "", informacoes && limpar(informacoes), ...topicos.map((t) => [`**${t.titulo.trim().replace(/[\r\n*]/g, " ") || "Informações complementares"}**`, limpar(t.conteudo.trim())].filter(Boolean).join("\n\n"))].filter(Boolean).join("\n\n")];
  });
  return blocos.length ? ["## Informações complementares da instrução do processo", ...blocos].join("\n\n") : "";
}

/** Insere ou atualiza somente o tópico de apoio do cadastro, preservando o restante da peça. */
export function inserirComplementosDaInstrucao(texto: string, registros: DadosInstrucao[]) {
  const titulo = "## Informações complementares da instrução do processo";
  const secao = complementosDaInstrucao(registros);
  const marco = /^[ \t]*(?:@ |\[\[(?:PREENCHER:[ \t]*)?Local e data\]\][ \t]*$|(?:[^\n]*,[ \t]*)?\d{1,2} de [\p{L}]+ de \d{4}\.?[ \t]*$)/imu;
  if (secao && texto.includes(secao)) return texto;
  const inicio = texto.indexOf(titulo);
  if (inicio >= 0) {
    const depois = inicio + titulo.length, resto = texto.slice(depois);
    const proximo = resto.search(/^#{1,2} /m), assinatura = resto.search(/^[ \t]*@ /m);
    let limite = Math.min(proximo < 0 ? resto.length : proximo, assinatura < 0 ? resto.length : assinatura);
    if (proximo < 0 || assinatura >= 0 && assinatura < proximo) {
      const data = resto.slice(0, limite).search(/(?:^|\n)(?:[^\n]*,[ \t]*)?\d{1,2} de [\p{L}]+ de \d{4}\.?[ \t]*\s*$/iu);
      if (data >= 0) limite = data;
    }
    const fim = depois + limite;
    return [texto.slice(0, inicio).trimEnd(), secao, texto.slice(fim).trimStart()].filter(Boolean).join("\n\n");
  }
  if (!secao) return texto;
  const fim = texto.search(marco);
  return [(fim < 0 ? texto : texto.slice(0, fim)).trimEnd(), secao, fim < 0 ? "" : texto.slice(fim).trimStart()].filter(Boolean).join("\n\n");
}
