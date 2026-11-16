// "Concluir e avançar": confere a etapa, aponta o que falta e prepara a peça seguinte com o que já foi informado.
// Tudo aqui é regra fixa; funciona mesmo com a IA indisponível.
import { q, q1 } from "./db.js";
import { secretariosDoProcesso } from "./portarias.js";
import { consultarPca, type ItemConsultaPca } from "../shared/consulta-pca.js";
import { ETAPAS, TIPOS, VIAS, itensDe, pendencias, type Checks, type Etapa, type Tipo, type Via } from "../shared/etapas.js";

export interface Pendencia {
  codigo: string;
  texto: string;
  /** Onde o usuário resolve: campo dos dados do processo, item da conferência, minuta da etapa ou Configurações. */
  onde: "dados" | "conferencia" | "minuta" | "config";
  alvo?: string;
  /** Impede concluir a etapa. Avisos (false) aparecem, mas não travam. */
  bloqueia: boolean;
}
interface Proc {
  id: number; orgao_id: number; tipo: Tipo; via: Via; objeto: string; protocolo: string; requisitante: string; areas_adicionais: string[];
  valor_estimado: number | null; ano: number; pca_item_id: number | null;
}
const moeda = (v: number | null) => (v == null ? "" : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }));
const minutaDe = (processo: number, etapa: string) =>
  q1<{ versao: number; texto: string }>("select versao, texto from minutas where processo_id=$1 and etapa=$2 order by versao desc limit 1", [processo, etapa]);

export async function conferirEtapa(p: Proc, e: Etapa, checks: Checks): Promise<Pendencia[]> {
  const l: Pendencia[] = [];
  if (e.id === "dfd") {
    if (!p.requisitante.trim()) l.push({ codigo: "area", texto: "Informe a área requisitante nos dados do processo.", onde: "dados", alvo: "requisitante", bloqueia: true });
    if (p.valor_estimado == null) l.push({ codigo: "valor", texto: "Informe o valor estimado preliminar nos dados do processo.", onde: "dados", alvo: "valor", bloqueia: true });
    const cad = await secretariosDoProcesso(p);
    for (const a of cad.areasSemCadastro) l.push({ codigo: "secretario", texto: `Não há secretário cadastrado para "${a}". Cadastre em Configurações ou ajuste o nome da área.`, onde: "config", bloqueia: true });
    for (const s of cad.secretarios) if (!s.portaria) l.push({ codigo: "portaria", texto: `Falta a portaria de nomeação de ${s.nome} (${s.secretaria}). Cadastre em Configurações, no cadastro de secretários.`, onde: "config", bloqueia: true });
    if (!p.pca_item_id) {
      const itens = await q<ItemConsultaPca>("select id, descricao, tipo, tipo_oficial, ordem_oficial, pagina_oficial from pca_itens where orgao_id=$1 and ano=$2", [p.orgao_id, p.ano]);
      const { vinculo, candidatos } = consultarPca(p.objeto, p.tipo, itens);
      const rotulo = (i: ItemConsultaPca) => `${i.ordem_oficial ? `item ${i.ordem_oficial}, página ${i.pagina_oficial} — ` : ""}${i.descricao}`;
      const opcoes = vinculo ? [vinculo] : candidatos;
      l.push({
        codigo: "pca", onde: "dados", alvo: "pca_item_id", bloqueia: false,
        texto: opcoes.length === 1 ? `O processo não está vinculado ao PCA. Sugestão: ${rotulo(opcoes[0])}.`
          : opcoes.length ? `O processo não está vinculado ao PCA. Itens parecidos: ${opcoes.map(rotulo).join("; ")}. Escolha um nos dados do processo.`
          : "O processo não está vinculado ao PCA e não encontrei item parecido. Se a contratação está fora do plano, a justificativa precisa constar do DFD.",
      });
    }
  }
  if (e.modelo) {
    const m = await minutaDe(p.id, e.id);
    if (!m) l.push({ codigo: "minuta", texto: `A minuta do documento (${e.doc ?? e.nome}) ainda não foi redigida.`, onde: "minuta", bloqueia: true });
    else {
      const n = pendencias(m.texto).length;
      if (n) l.push({ codigo: "campos", texto: `A minuta tem ${n} ${n === 1 ? "campo pendente" : "campos pendentes"} (trechos realçados em amarelo).`, onde: "minuta", bloqueia: true });
    }
  }
  for (const i of itensDe(e, p)) if (!checks[i.id]) l.push({ codigo: "item", texto: `Conferência obrigatória: ${i.texto}`, onde: "conferencia", alvo: i.id, bloqueia: true });
  return l;
}

/** Seções "## N. Título" de uma minuta, com o texto de cada uma. */
function secoes(texto: string) {
  const out: { titulo: string; corpo: string }[] = [];
  let atual: { titulo: string; linhas: string[] } | null = null;
  for (const linha of texto.split("\n")) {
    const h = /^##\s+(.*)$/.exec(linha);
    if (h) { if (atual) out.push({ titulo: atual.titulo, corpo: atual.linhas.join("\n").trim() }); atual = { titulo: h[1], linhas: [] }; }
    else if (/^\s*@ /.test(linha)) { if (atual) out.push({ titulo: atual.titulo, corpo: atual.linhas.join("\n").trim() }); atual = null; }
    else atual?.linhas.push(linha);
  }
  if (atual) out.push({ titulo: atual.titulo, corpo: atual.linhas.join("\n").trim() });
  return out;
}
const semAcento = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/** Rascunho do ETP com objeto, justificativa, quantidades, valor, área e PCA aproveitados do processo e do DFD. */
export async function rascunhoEtp(p: Proc) {
  const dfd = await minutaDe(p.id, "dfd");
  const partes = secoes(dfd?.texto ?? "");
  const doDfd = (re: RegExp) => partes.find((s) => re.test(semAcento(s.titulo)))?.corpo ?? "";
  const cad = await secretariosDoProcesso(p);
  const itemPca = p.pca_item_id ? await q1<{ descricao: string; ordem_oficial: number | null; pagina_oficial: number | null }>(
    "select descricao, ordem_oficial, pagina_oficial from pca_itens where id=$1 and orgao_id=$2", [p.pca_item_id, p.orgao_id]) : undefined;
  const areas = [p.requisitante, ...p.areas_adicionais].map((a) => a.trim()).filter(Boolean);
  const ou = (texto: string, falta: string) => texto || `[[PREENCHER: ${falta}]]`;
  const titulares = cad.secretarios.map((s) => `${s.secretaria} — ${s.nome}. Portaria de nomeação nº ${s.portaria || `[[PREENCHER: portaria de nomeação — ${s.secretaria}]]`}.`);
  const s = (n: number, titulo: string, corpo: string) => `## ${n}. ${titulo}\n${corpo}`;
  return [
    "# ESTUDO TÉCNICO PRELIMINAR",
    `Protocolo ${p.protocolo} · Lei nº 14.133/2021, art. 18, §§ 1º e 2º`,
    s(1, "Informações básicas", `Objeto: ${p.objeto}\nNatureza do objeto: ${TIPOS[p.tipo]}. Forma de contratação prevista: ${VIAS[p.via]}.`),
    s(2, "Descrição da necessidade", ou(doDfd(/justificativa/), "descrição da necessidade, com quadro Indicador | Dado | Fonte — área requisitante")),
    s(3, "Área requisitante", [areas.join("; ") || "[[PREENCHER: área requisitante]]", ...titulares].join("\n")),
    s(4, "Requisitos da contratação", "[[PREENCHER: requisitos da contratação — área requisitante]]"),
    s(5, "Levantamento de mercado e análise das alternativas", "| Alternativa | Vantagens | Desvantagens | Conclusão |\n|---|---|---|---|\n| [[PREENCHER: alternativa 1]] | [[PREENCHER: vantagens]] | [[PREENCHER: desvantagens]] | [[PREENCHER: conclusão]] |"),
    s(6, "Estimativa das quantidades", ou(doDfd(/quantidade/), "quantidades e memória de cálculo — área requisitante")),
    s(7, "Estimativa do valor", p.valor_estimado == null ? "[[PREENCHER: valor estimado — setor de compras]]" : `Valor estimado preliminar informado na solicitação: ${moeda(p.valor_estimado)}. O valor definitivo resulta da etapa de orçamento estimado.`),
    s(8, "Descrição da solução como um todo", ou(doDfd(/solucao/), "descrição da solução — área requisitante")),
    s(9, "Justificativa para o parcelamento ou não", "[[PREENCHER: justificativa do parcelamento ou não]]"),
    s(10, "Contratações correlatas ou interdependentes", "[[PREENCHER: contratações correlatas, ou informar que não há]]"),
    s(11, "Alinhamento com o planejamento", itemPca ? `Contratação prevista no Plano de Contratações Anual de ${p.ano}: ${itemPca.ordem_oficial ? `item ${itemPca.ordem_oficial}, página ${itemPca.pagina_oficial} — ` : ""}${itemPca.descricao}.`
      : ou(doDfd(/plano de contratac/), `previsão no PCA de ${p.ano} ou justificativa da inclusão fora do plano`)),
    s(12, "Resultados pretendidos", "[[PREENCHER: resultados pretendidos]]"),
    s(13, "Impactos ambientais e medidas mitigadoras", "| Impacto | Medida mitigadora | Responsável |\n|---|---|---|\n| [[PREENCHER: impacto]] | [[PREENCHER: medida]] | [[PREENCHER: responsável]] |"),
    s(14, "Providências a serem adotadas", "[[PREENCHER: providências prévias à contratação, ou informar que não há]]"),
    s(15, "Análise de riscos", "| Risco | Probabilidade | Impacto | Ação preventiva / contingência |\n|---|---|---|---|\n| [[PREENCHER: risco]] | [[PREENCHER: probabilidade]] | [[PREENCHER: impacto]] | [[PREENCHER: ação]] |"),
    s(16, "Declaração de viabilidade", "[[PREENCHER: declaração de viabilidade ou não da contratação]]"),
    s(17, "Responsáveis pela elaboração e fiscalização", "[[PREENCHER: nomes, cargos e atos de designação de quem elaborou]]"),
    `[[PREENCHER: local e data]]`,
    "@ [[PREENCHER: nome de quem elaborou]]\n@ [[PREENCHER: cargo]]",
  ].join("\n\n");
}

export const proximaEtapa = (e: Etapa) => ETAPAS[ETAPAS.indexOf(e) + 1] as Etapa | undefined;
