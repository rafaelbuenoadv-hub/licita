import type { Via } from "../shared/etapas.js";
import { ehMunicipioIbaiti } from "./municipio-ibaiti.js";

const tce = "https://www.tce.pr.gov.br/fiscalizado/lei-de-licitacoes-e-contratos.htm";

const federais: Record<string, string> = {
  dfd: "Arts. 12, VII, e 18, caput: verificar compatibilidade com o PCA, quando elaborado. Art. 72, I: DFD na instrução da contratação direta.",
  etp: "Art. 18, §§ 1º e 2º: demonstrar a necessidade, comparar soluções e documentar quantidades, estimativas, parcelamento e conclusão. Observar os elementos mínimos e justificar a ausência dos demais.",
  riscos: "Art. 18, X: analisar riscos que possam comprometer a licitação e a execução. Relacionar os riscos a causas, consequências e medidas de tratamento próprias do objeto.",
  precos: "Art. 23: verificar compatibilidade com o mercado, quantidades, economia de escala e peculiaridades locais. Conferir fontes e metodologia pertinentes à natureza do objeto.",
  tr: "Art. 6º, XXIII: objeto, fundamentação, solução, requisitos, execução, gestão, medição e pagamento, seleção, estimativa e adequação orçamentária. Conferir coerência com o ETP.",
  dot: "Arts. 7º e 18, caput: verificar designações e compatibilidade orçamentária. Em contratação direta, conferir art. 72, IV.",
  edital: "Arts. 25 e 92: conferir conteúdo do edital e cláusulas contratuais necessárias. Art. 54: publicidade do edital, quando se tratar de licitação.",
  parecer: "Art. 53: controle prévio de legalidade, observadas as hipóteses do § 5º. Vincular cada resposta ao apontamento real do parecer.",
  pub: "Arts. 54 e 94: distinguir publicidade do edital e divulgação contratual. Na contratação direta, conferir art. 72, parágrafo único.",
};

export function fundamentosMinuta(entrada: {
  etapa: string; via: Via; objeto: string; areas: number; orgao?: { nome: string; cnpj: string | null; uf: string | null };
}) {
  const { etapa, via, objeto, areas, orgao } = entrada;
  const federal = [federais[etapa]];
  if (via !== "licitacao") federal.push("Art. 72: verificar os documentos exigidos conforme o caso. " +
    (via === "dispensa" ? "Art. 75: identificar a hipótese concreta; em dispensa por valor, conferir os somatórios do § 1º e o limite vigente."
      : "Art. 74: demonstrar a inviabilidade de competição e os requisitos da hipótese concreta."));

  const local: string[] = [];
  const ibaiti = !!orgao && ehMunicipioIbaiti(orgao);
  if (ibaiti) {
    local.push("Decreto Municipal nº 2.533/2024: aplicação geral da Lei nº 14.133/2021 no Município. Conferir a regra específica no ato.");
    if (via !== "licitacao") local.push("Decreto Municipal nº 2.532/2024, arts. 2º e 3º: instruir a contratação direta com as peças da Lei nº 14.133/2021 e observar as orientações normativas conjuntas aplicáveis.");
    if (via === "dispensa") local.push("Decreto Municipal nº 2.549/2024: regulamentação municipal da dispensa.");
    if (via === "licitacao" && ["tr", "edital", "parecer", "pub"].includes(etapa)) {
      local.push("Decreto Municipal nº 2.548/2024: pertinente se a modalidade definida for pregão ou concorrência.");
    }
    if (["tr", "edital"].includes(etapa)) {
      local.push("Lei Municipal nº 1.316/2026: conferir tratamento favorecido às categorias previstas no ato. Decreto Municipal nº 2.476/2023: retenção de IR na etapa de pagamento, quando cabível.");
    }
  }

  const precedentes: string[] = [];
  if (ibaiti || orgao?.uf?.trim().toUpperCase() === "PR") {
    if (/cons[oó]rci/i.test(objeto) && ["etp", "tr", "edital", "parecer"].includes(etapa)) {
      precedentes.push("Acórdão nº 248/2026, Tribunal Pleno, Consulta nº 253999/2025, com força normativa: em licitação compartilhada conduzida por consórcio público, compete a cada ente consorciado formalizar instrumento contratual autônomo. Verificar se essa é efetivamente a forma de contratação em análise.");
    }
    if (areas > 1 && ["dfd", "etp", "precos", "tr", "parecer"].includes(etapa)) {
      precedentes.push("Acórdão nº 2490/2026, Tribunal Pleno, Representação nº 772619/2025: o caso evidenciou que demandas de secretarias tratadas isoladamente prejudicaram a economia de escala e distorceram as cotações. Acórdão nº 2325/2026, Tribunal Pleno, Representação nº 771469/2025: estudos por unidade são possíveis, mas exigem integração no planejamento, sobretudo em registro de preços. Ambos sem força normativa.");
    }
    if (["etp", "precos", "tr", "parecer"].includes(etapa)) {
      precedentes.push("Acórdão nº 3143/2025, Tribunal Pleno, Representação nº 557706/2024, sem força normativa: as cotações locais foram insuficientes nas circunstâncias examinadas; avaliar representatividade e diversificar fontes quando possível.");
      if (/climatiza|ar[ -]condicionad/i.test(objeto)) precedentes.push("Acórdão nº 1657/2026, Tribunal Pleno, Representação nº 244732/2025, sem força normativa: em orçamento por metro quadrado para implantação de climatização, usar a mesma base física do preço de referência; distinguir área climatizada e área construída. Aplicar somente se a contratação utilizar essa unidade.");
    }
    if (via !== "licitacao" && ["dfd", "etp", "parecer"].includes(etapa)) {
      precedentes.push("Acórdão nº 2060/2026, Tribunal Pleno, Representação nº 663208/2025, sem força normativa: eventual dispensa do ETP completo precisa de motivação e das peças de planejamento indispensáveis ao caso.");
    }
  }

  return [
    "BASE PARA A FUNDAMENTAÇÃO — Lei Federal nº 14.133/2021",
    ...federal.filter(Boolean),
    ...(local.length ? ["NORMAS MUNICIPAIS DE IBAITI", ...local] : []),
    ...(precedentes.length ? ["JURISPRUDÊNCIA DO TCE-PR", ...precedentes, "Fonte oficial da jurisprudência por artigo: " + tce] : []),
    "Use apenas fundamentos pertinentes e explique sua aplicação aos fatos comprovados. Em seção de fundamentação ou no ponto pertinente do modelo, identifique norma, artigo conferido, e, se pertinente, acórdão, órgão julgador e link oficial. Decisões em representação orientam por analogia e não têm força normativa. Quando houver só ementa ou referência, não deduza o conteúdo de artigos municipais. A seleção de julgados é uma base de referência, sem pesquisa jurisprudencial em tempo real. Não invente decisões nem declare que foram pesquisadas outras fontes. Quando faltar prova, use campo pendente em vez de afirmar conformidade.",
  ].join("\n");
}
