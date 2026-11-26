// Catálogo de riscos por classe de objeto e conferência cruzada entre as peças da fase interna
// (DFD, pesquisa de preços, ETP, TR e dotação): o que diverge vira pendência, em vez de uma declaração de coerência fixa.
import type { Valores } from "./campos.js";
import { totalDosItens, normalizarCotacao, type ItemSolicitacao } from "./solicitacao.js";

export interface Risco { risco: string; probabilidade: "Baixa" | "Média" | "Alta"; impacto: "Baixo" | "Médio" | "Alto"; medida: string; responsavel: string }
export const CATALOGO_RISCOS: Record<string, Risco> = {
  deserta: { risco: "Licitação deserta ou fracassada", probabilidade: "Média", impacto: "Alto", medida: "Pesquisa de preços ampla e exigências de habilitação proporcionais ao objeto; se ocorrer, repetir o certame ou contratar diretamente nas hipóteses legais (art. 75, III)", responsavel: "Agente de contratação" },
  inexequivel: { risco: "Proposta com preço inexequível", probabilidade: "Média", impacto: "Alto", medida: "Análise de exequibilidade e diligência para comprovação dos custos (art. 59, § 2º, e art. 64)", responsavel: "Agente de contratação" },
  atraso: { risco: "Atraso na entrega ou na execução", probabilidade: "Média", impacto: "Médio", medida: "Prazo fixado no Termo de Referência, notificação imediata e multa de mora", responsavel: "Fiscal do contrato" },
  qualidade: { risco: "Objeto em desacordo com as especificações", probabilidade: "Média", impacto: "Alto", medida: "Especificação clara, recebimento provisório com conferência e substituição às custas da contratada", responsavel: "Fiscal do contrato" },
  perecimento: { risco: "Perecimento ou perda de qualidade no transporte ou armazenamento", probabilidade: "Alta", impacto: "Alto", medida: "Entregas parceladas conforme o uso, conferência no ato da entrega e recusa imediata do que estiver impróprio", responsavel: "Fiscal do contrato e Secretaria requisitante" },
  orcamento: { risco: "Insuficiência de dotação orçamentária", probabilidade: "Baixa", impacto: "Alto", medida: "Indicação e reserva da dotação antes da contratação; em ata, empenho a cada contratação", responsavel: "Contabilidade" },
  variacao: { risco: "Variação relevante de preços de mercado durante a vigência", probabilidade: "Média", impacto: "Médio", medida: "Reajuste anual pelo índice previsto e, se for o caso, reequilíbrio econômico-financeiro (art. 124, II, d)", responsavel: "Gestor do contrato" },
  continuidade: { risco: "Interrupção de serviço contínuo", probabilidade: "Baixa", impacto: "Alto", medida: "Acompanhamento da execução, prazos de atendimento e planejamento da renovação ou de nova contratação antes do fim da vigência", responsavel: "Gestor do contrato" },
};

/** Riscos sugeridos pela classe do objeto. */
export function riscosSugeridos(tipo: string, perfil: string, via: string) {
  return [via === "licitacao" && "deserta", via === "licitacao" && "inexequivel", "atraso", "qualidade", tipo === "bens" && perfil === "perecivel" && "perecimento",
    "orcamento", tipo === "servicos" && "continuidade"].filter((x): x is string => !!x);
}

export function tabelaDeRiscos(marcados: string[]) {
  const linhas = marcados.flatMap((k) => (CATALOGO_RISCOS[k] ? [CATALOGO_RISCOS[k]] : []));
  if (!linhas.length) return "";
  return ["| Risco | Probabilidade | Impacto | Medida de tratamento | Responsável |", "|---|:---:|:---:|---|---|",
    ...linhas.map((r) => `| ${r.risco} | ${r.probabilidade} | ${r.impacto} | ${r.medida} | ${r.responsavel} |`)].join("\n");
}

const texto = (v: Valores | undefined, k: string) => (typeof v?.[k] === "string" ? (v[k] as string) : "");
const numero = (x: unknown) => (typeof x === "string" && x.trim() ? Number(x.replace(/\./g, "").replace(",", ".")) : NaN);
const real = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const mencionaSrp = (t: string) => /registro de precos|\bsrp\b/.test(normalizarCotacao(t));

/** Instrumento sugerido: ata quando DFD/ETP falam em registro de preços; nota de empenho em dispensa de compra; contrato nos demais casos. */
export function instrumentoSugerido(campos: Record<string, Valores>, tipo: string, via: string) {
  const textos = [texto(campos.dfd, "solucoes"), texto(campos.dfd, "modalidade"), texto(campos.etp, "v"), texto(campos.etp, "vii"), texto(campos.etp, "xiii")].join(" ");
  if (mencionaSrp(textos)) return "ata";
  if (via === "dispensa" && tipo === "bens") return "empenho";
  return "contrato";
}

/**
 * Divergências entre as peças. Cada texto explica o que diverge e onde; vazio quando as peças são coerentes.
 * Só compara o que está informado (campo em branco não é divergência).
 */
export function divergenciasEntrePecas(campos: Record<string, Valores>, itens: ItemSolicitacao[], via: string) {
  const out: string[] = [];
  const total = itens.length ? totalDosItens(itens) : null;
  const valores: [string, number][] = [["itens da instrução", total ?? NaN], ["pesquisa de preços", numero(campos.precos?.valor_total)], ["dotação orçamentária", numero(campos.dot?.valor_total)]];
  const informados = valores.filter(([, v]) => Number.isFinite(v) && v > 0);
  if (informados.some(([, v]) => Math.abs(v - informados[0][1]) > 0.01))
    out.push(`O valor estimado difere entre as peças (${informados.map(([o, v]) => `${o}: ${real(v)}`).join("; ")}).`);
  const instrumento = texto(campos.tr, "instrumento");
  const srp: string[] = [];
  if (mencionaSrp(texto(campos.dfd, "solucoes") + " " + texto(campos.dfd, "modalidade"))) srp.push("DFD");
  if (mencionaSrp([texto(campos.etp, "v"), texto(campos.etp, "vii"), texto(campos.etp, "xiii")].join(" "))) srp.push("ETP");
  if (instrumento && instrumento !== "ata" && srp.length)
    out.push(`O ${srp.join(" e o ")} ${srp.length > 1 ? "tratam" : "trata"} de Sistema de Registro de Preços, mas o Termo de Referência adota ${instrumento === "contrato" ? "contrato" : "nota de empenho"}. Ajuste o instrumento no TR ou o texto das peças.`);
  if (instrumento === "ata" && via !== "licitacao")
    out.push("Ata de registro de preços pressupõe licitação (pregão ou concorrência) ou as hipóteses de contratação direta do art. 82, § 6º; confira o instrumento escolhido.");
  const modalidade = normalizarCotacao(texto(campos.dfd, "modalidade"));
  if (modalidade && via === "licitacao" && /dispensa|inexigib/.test(modalidade)) out.push("O DFD indica contratação direta, mas o processo está cadastrado como licitação.");
  if (modalidade && via !== "licitacao" && /pregao|concorrencia/.test(modalidade)) out.push(`O DFD indica ${texto(campos.dfd, "modalidade")}, mas o processo está cadastrado como contratação direta.`);
  return out;
}
