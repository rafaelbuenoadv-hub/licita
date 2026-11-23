// Documentos completos da fase interna, montados sem IA com os campos das etapas, os itens da Solicitação,
// o PAC e o cadastro de secretários: ETP, relatório de pesquisa de preços e Termo de Referência / Projeto Básico.
import { q, q1 } from "./db.js";
import { secretariosDoProcesso } from "./portarias.js";
import { ehMunicipioIbaiti } from "./municipio-ibaiti.js";
import { FONTES_COTACAO, CRITERIOS_PRECO, planejamentoDoProcesso, quadroDeItens, totalDosItens, type ItemSolicitacao } from "../shared/solicitacao.js";
import { reaisPorExtenso } from "../shared/extenso.js";
import { ETAPAS, TIPOS, VIAS, textoDoCampo, type Tipo, type Valores, type Via } from "../shared/etapas.js";

interface Proc {
  id: number; orgao_id: number; tipo: Tipo; via: Via; objeto: string; protocolo: string; requisitante: string; areas_adicionais: string[];
  valor_estimado: number | null; ano: number; pca_item_id: number | null; classe?: string;
}
type Autor = { nome: string; cargo: string };
const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const real = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const formatarCnpj = (c: string) => { const d = c.replace(/\D/g, ""); return d.length === 14 ? d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5") : c; };
const celula = (t: string) => t.replace(/\s*\n\s*/g, " ").replace(/\|/g, "/").trim() || "—";
const brData = (iso?: string) => (iso ? iso.split("-").reverse().join("/") : "—");
const falta = (o: string) => `[[PREENCHER: ${o}]]`;

/** Texto de um campo da etapa (opções e marcas viram os rótulos). */
function campo(campos: Record<string, Valores>, etapa: string, id: string) {
  const c = ETAPAS.find((e) => e.id === etapa)?.campos.find((x) => x.id === id);
  return c ? textoDoCampo(c, campos[etapa]?.[id]) : "";
}

async function contexto(p: Proc, campos: Record<string, Valores>, autor: Autor) {
  const [orgao, cad, solicitacoes] = await Promise.all([
    q1<{ nome: string; cnpj: string | null; municipio: string | null; uf: string | null }>("select nome, cnpj, municipio, uf from orgaos where id=$1", [p.orgao_id]),
    secretariosDoProcesso(p),
    q<{ secretaria: string; itens: ItemSolicitacao[] }>("select secretaria, itens from solicitacoes_processo where processo_id=$1 order by id", [p.id]),
  ]);
  const itens = solicitacoes.flatMap((s) => s.itens ?? []).filter((i) => i.descricao?.trim());
  const areas = [...new Set([p.requisitante, ...p.areas_adicionais, ...solicitacoes.map((s) => s.secretaria)].map((a) => a.trim()).filter(Boolean))];
  const responsavel = typeof campos.dfd?.responsavel === "string" ? (campos.dfd.responsavel as string).trim() : "";
  const titular = cad.secretarios[0];
  const [nomeResp, restoResp] = responsavel.includes(" — ") ? responsavel.split(" — ", 2) : [responsavel, ""];
  const requisitante = {
    nome: nomeResp || titular?.nome || "",
    cargo: restoResp.replace(/\s*\(Portaria.*$/, "") || (titular ? `Secretário(a) Municipal de ${titular.secretaria}` : ""),
    portaria: /\(Portaria nº ([^)]+)\)/.exec(restoResp)?.[1] ?? titular?.portaria ?? "",
  };
  const hoje = new Date();
  const local = `${orgao?.municipio ?? ""}${orgao?.uf ? `/${orgao.uf}` : ""}`;
  return {
    orgao, ibaiti: !!orgao && ehMunicipioIbaiti(orgao), itens, areas, requisitante, autor,
    total: totalDosItens(itens) ?? p.valor_estimado,
    data: `${local}${local ? ", " : ""}${hoje.getDate()} de ${MESES[hoje.getMonth()]} de ${hoje.getFullYear()}.`,
  };
}
type Ctx = Awaited<ReturnType<typeof contexto>>;

function cabecalho(titulo: string, p: Proc, c: Ctx, fundamento: string) {
  return [
    `# ${titulo}`,
    `${c.orgao?.nome ?? ""}${c.orgao?.cnpj ? ` · CNPJ ${formatarCnpj(c.orgao.cnpj)}` : ""}`,
    `Protocolo ${p.protocolo} · Exercício ${p.ano} · Secretaria requisitante: ${c.areas.join("; ") || "—"}`,
    `Fundamento: ${fundamento}.`,
  ];
}
const assinaturaRequisitante = (c: Ctx) =>
  [`@ ${c.requisitante.nome || c.autor.nome}`, `@ ${c.requisitante.cargo || c.autor.cargo}`, c.requisitante.portaria && `@ Portaria de nomeação nº ${c.requisitante.portaria}`].filter(Boolean).join("\n");
const assinaturaAutor = (c: Ctx, papel: string) => [`@ ${c.autor.nome}`, `@ ${c.autor.cargo || papel}`].filter((x) => x !== "@ ").join("\n");
const valorComExtenso = (v: number) => `${real(v)} (${reaisPorExtenso(v)})`;

/* ---------------- ETP ---------------- */
const INCISOS_ETP: [string, string, string][] = [
  ["i", "Descrição da necessidade", "I"], ["ii", "Previsão no Plano Anual de Contratações", "II"], ["iii", "Requisitos da contratação", "III"],
  ["iv", "Estimativa das quantidades", "IV"], ["v", "Levantamento de mercado", "V"], ["vi", "Estimativa do valor da contratação", "VI"],
  ["vii", "Descrição da solução como um todo", "VII"], ["viii", "Justificativa do parcelamento ou não da contratação", "VIII"],
  ["ix", "Resultados pretendidos", "IX"], ["x", "Providências prévias ao contrato", "X"], ["xi", "Contratações correlatas e/ou interdependentes", "XI"],
  ["xii", "Impactos ambientais e medidas mitigadoras", "XII"], ["xiii", "Posicionamento conclusivo", "XIII"],
];

export async function documentoEtp(p: Proc, campos: Record<string, Valores>, autor: Autor) {
  const c = await contexto(p, campos, autor);
  const etp = (id: string) => campo(campos, "etp", id);
  const l = cabecalho("ESTUDO TÉCNICO PRELIMINAR — ETP", p, c,
    `Lei nº 14.133/2021, art. 18, §§ 1º a 3º${c.ibaiti ? "; Decreto Municipal nº 2.533/2024, arts. 7º e 8º" : ""}`);
  l.push("## 1. Informações básicas", [
    "| Informação | Dados |", "|---|---|",
    `| Objeto | ${celula(campo(campos, "dfd", "objeto") || p.objeto)} |`,
    `| Natureza do objeto | ${TIPOS[p.tipo]} |`,
    `| Forma de contratação prevista | ${VIAS[p.via]} |`,
    `| Área requisitante | ${celula(c.areas.join("; "))} |`,
    `| Documento de origem | Documento de Formalização da Demanda — protocolo ${p.protocolo} |`,
  ].join("\n"),
  "Este estudo evidencia o problema a ser resolvido e a melhor solução para atendê-lo, de modo a permitir a avaliação da viabilidade técnica e econômica da contratação (art. 18, § 1º). Os incisos I, IV, VI, VIII e XIII compõem o conteúdo mínimo obrigatório (art. 18, § 2º); os demais constam abaixo ou têm a ausência justificada.");
  INCISOS_ETP.forEach(([id, titulo, inciso], n) => {
    l.push(`## ${n + 2}. ${titulo} (art. 18, § 1º, ${inciso})`);
    let texto = etp(id);
    if (id === "ii" && !texto) texto = planejamentoDoProcesso(campos);
    l.push(texto || falta(titulo.toLowerCase()));
    if (id === "iv" && c.itens.length) l.push(["| Item | Descrição | Un. | Qtd. |", "|:---:|---|:---:|---:|",
      ...c.itens.map((i, k) => `| ${k + 1} | ${celula(i.descricao)} | ${celula(i.unidade)} | ${i.quantidade == null ? "—" : i.quantidade.toLocaleString("pt-BR")} |`)].join("\n"));
    if (id === "vi" && c.total != null) l.push(`Valor total estimado: **${valorComExtenso(c.total)}**, conforme a pesquisa de preços que integra o processo (art. 23).`);
  });
  l.push("## 15. Responsáveis pela elaboração",
    "O estudo foi elaborado pela área requisitante, com o apoio técnico necessário. A fiscalização do futuro contrato caberá a servidor distinto dos responsáveis pela elaboração deste estudo (art. 7º, § 1º).",
    c.data, assinaturaRequisitante(c));
  return l.join("\n\n");
}

/* ---------------- Pesquisa de preços ---------------- */
export async function documentoPrecos(p: Proc, campos: Record<string, Valores>, autor: Autor) {
  const c = await contexto(p, campos, autor);
  const obra = p.tipo === "obra";
  const pr = (id: string) => campo(campos, "precos", id);
  const l = cabecalho("RELATÓRIO DE PESQUISA DE PREÇOS E MEMÓRIA DE CÁLCULO", p, c,
    `Lei nº 14.133/2021, art. 23, ${obra ? "§ 2º" : "§ 1º"}${c.ibaiti ? "; Decreto Municipal nº 2.533/2024, art. 11" : ""}`);
  l.push("## 1. Objeto", campo(campos, "dfd", "objeto") || p.objeto);
  l.push("## 2. Finalidade",
    "Este relatório fixa o valor estimado da contratação, compatível com os valores praticados pelo mercado, considerados os preços constantes de bancos de dados públicos e as quantidades a contratar (Lei nº 14.133/2021, art. 23, caput).");
  const parametros = pr(obra ? "parametros_obra" : "parametros");
  l.push(`## 3. Parâmetros utilizados (art. 23, ${obra ? "§ 2º" : "§ 1º"})`, parametros || falta("parâmetros utilizados"));
  const unica = pr(obra ? "fonte_unica_obra" : "fonte_unica");
  if (unica) l.push(`Justificativa do uso de fonte única: ${unica}`);
  l.push("## 4. Data-base", pr("data_base") ? `Os preços têm como data-base ${pr("data_base")}, que será adotada em todas as peças do processo.` : falta("data-base do orçamento"));
  l.push("## 5. Quadro comparativo de preços");
  if (c.itens.length) l.push(quadroDeItens(c.itens, true).replace("Total estimado da solicitação", "Total estimado"));
  else l.push(falta("quadro de preços por item"));
  const fontes = c.itens.flatMap((i) => (i.cotacoes ?? []).filter((x) => x.valor_unitario != null));
  const vistas = new Map<string, (typeof fontes)[number]>();
  for (const f of fontes) if (!vistas.has(f.fornecedor)) vistas.set(f.fornecedor, f);
  if (vistas.size) {
    l.push("## 6. Fontes consultadas", [
      "| Fonte | Tipo | Data da consulta | Referência | Comprovante |", "|---|---|:---:|---|:---:|",
      ...[...vistas.values()].map((f) => `| ${celula(f.fornecedor)} | ${FONTES_COTACAO[f.fonte ?? "fornecedor"]} | ${brData(f.consultado_em)} | ${celula(f.link ?? "")} | ${f.orcamento_id != null ? "Anexado" : "—"} |`),
    ].join("\n"));
  } else l.push("## 6. Fontes consultadas", falta("fontes consultadas, com data e hora de acesso"));
  const criterio = c.itens.find((i) => i.criterio)?.criterio;
  l.push("## 7. Método de cálculo e memória",
    `Método adotado: ${pr("metodo") || (criterio ? CRITERIOS_PRECO[criterio] : falta("método de cálculo"))}.`,
    pr("memoria") || falta("memória de cálculo"));
  l.push("## 8. Análise crítica dos preços", pr("analise_critica") || falta("análise crítica: preços descartados e por quê, ou que nenhum foi descartado"));
  if (obra) l.push("## 9. BDI e encargos sociais", pr("bdi") || falta("BDI e encargos sociais"));
  const valorCampo = typeof campos.precos?.valor_total === "string" ? Number((campos.precos.valor_total as string).replace(/\./g, "").replace(",", ".")) : NaN;
  const valor = Number.isFinite(valorCampo) && valorCampo > 0 ? valorCampo : c.total;
  l.push(`## ${obra ? 10 : 9}. Valor estimado da contratação`,
    valor != null ? `O valor estimado da contratação é de **${valorComExtenso(valor)}**.` : falta("valor estimado"),
    "Declara-se que a pesquisa observou os parâmetros do art. 23 da Lei nº 14.133/2021 e que os documentos de suporte e a memória de cálculo integram os autos.");
  l.push(c.data, assinaturaAutor(c, "Responsável pela pesquisa de preços"));
  return l.join("\n\n");
}

/* ---------------- Termo de Referência / Projeto Básico ---------------- */
const ALINEAS_TR: [string, string, string][] = [
  ["a", "Definição do objeto", "a"], ["b", "Fundamentação da contratação", "b"], ["c", "Descrição da solução como um todo", "c"],
  ["d", "Requisitos da contratação", "d"], ["e", "Modelo de execução do objeto", "e"], ["f", "Modelo de gestão do contrato", "f"],
  ["g", "Critérios de medição e de pagamento", "g"], ["h", "Forma e critérios de seleção do fornecedor", "h"],
  ["i", "Estimativas do valor da contratação", "i"], ["j", "Adequação orçamentária", "j"],
];
const ALINEAS_PB: [string, string, string][] = [
  ["pb_a", "Levantamentos e ensaios", "a"], ["pb_b", "Soluções técnicas globais e localizadas", "b"],
  ["pb_c", "Serviços, materiais e equipamentos", "c"], ["pb_d", "Métodos construtivos", "d"],
  ["pb_e", "Plano de licitação e gestão da obra", "e"], ["pb_f", "Orçamento detalhado", "f"],
];

export async function documentoTr(p: Proc, campos: Record<string, Valores>, autor: Autor) {
  const c = await contexto(p, campos, autor);
  const obra = p.tipo === "obra";
  const tr = (id: string) => campo(campos, "tr", id);
  const l = cabecalho(obra ? "PROJETO BÁSICO" : "TERMO DE REFERÊNCIA", p, c,
    `Lei nº 14.133/2021, art. 6º, ${obra ? "XXV" : "XXIII"}, e art. 18, II e X${c.ibaiti ? "; Decreto Municipal nº 2.533/2024" : ""}`);
  l.push(`Forma de contratação: ${VIAS[p.via]}. Natureza do objeto: ${TIPOS[p.tipo]}.`);
  let n = 0;
  for (const [id, titulo, alinea] of obra ? ALINEAS_PB : ALINEAS_TR) {
    l.push(`## ${++n}. ${titulo} (art. 6º, ${obra ? "XXV" : "XXIII"}, alínea "${alinea}")`, tr(id) || falta(titulo.toLowerCase()));
    if (id === "a" && c.itens.length) l.push(quadroDeItens(c.itens));
    if (id === "a" && c.total != null) l.push(`Valor máximo estimado: **${valorComExtenso(c.total)}**.`);
    if (id === "i" && c.total != null) l.push(`Valor total estimado: **${valorComExtenso(c.total)}**, conforme o relatório de pesquisa de preços (art. 23).`);
    if (id === "j" && typeof campos.dot?.dotacao === "string" && campos.dot.dotacao.trim()) l.push(`Dotação orçamentária: ${campos.dot.dotacao.trim()}`);
  }
  l.push(`## ${++n}. Análise de riscos (art. 18, X)`, tr("riscos") || falta("análise de riscos"));
  if (campos.tr?.matriz === "sim") l.push(`## ${++n}. Matriz de alocação de riscos (arts. 6º, XXVII, e 22)`, tr("matriz_texto") || falta("matriz de alocação de riscos"));
  else if (campos.tr?.matriz === "nao") l.push(`Não foi adotada matriz de alocação de riscos, facultativa para este objeto (art. 22).`);
  l.push(`## ${++n}. Coerência com os demais documentos`,
    "O objeto, as quantidades e o valor deste termo são os mesmos do Documento de Formalização da Demanda, do Estudo Técnico Preliminar e do relatório de pesquisa de preços.");
  l.push(c.data, assinaturaRequisitante(c),
    `Aprovo o presente ${obra ? "Projeto Básico" : "Termo de Referência"}.`,
    "@ Autoridade competente");
  return l.join("\n\n");
}
