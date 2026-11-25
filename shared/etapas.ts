// Regras da fase preparatória (Lei nº 14.133/2021), compartilhadas entre servidor e interface.
// Cada item de conferência pode depender do tipo de objeto e da forma de contratação.

export type Tipo = "bens" | "servicos" | "obra";
export type Via = "licitacao" | "dispensa" | "inexigibilidade";
export type Papel = "admin" | "requisitante" | "contratacao" | "juridico" | "autoridade" | "fiscal";
export type Condicao = "obra" | "naoobra" | "lic" | "disp" | "inex" | "direta" | "naoinex";

import { CAMPOS, MARCAS_OBRIGATORIAS, type Campo, type ValorCampo, type Valores } from "./campos.js";
export type { Campo, ValorCampo, Valores } from "./campos.js";

/** auto: marcado pelo sistema (ex.: todos os campos obrigatórios da etapa preenchidos). */
export interface Item { id: string; texto: string; base?: string; cond?: Condicao; auto?: boolean }
export type Fase = "interna";
export const FASES: Record<Fase, { nome: string; quem: string }> = {
  interna: { nome: "Fase interna", quem: "Secretaria demandante" },
};
export interface Etapa {
  id: string;
  nome: string;
  fase: Fase;
  /** Campos de preenchimento da etapa. */
  campos: Campo[];
  /** O documento pode ser montado, mas não é exigido para concluir. */
  docOpcional?: boolean;
  doc: string | null;
  oque: string;
  base: { rotulo: string; url?: string }[];
  itens: Item[];
  atencao: string[];
  modelo: string | null;
  /** Papéis que podem marcar os itens desta etapa (admin sempre pode). */
  papeis: Papel[];
}

export const TIPOS: Record<Tipo, string> = { bens: "Bens", servicos: "Serviços", obra: "Obra ou serviço de engenharia" };
export const VIAS: Record<Via, string> = { licitacao: "Licitação (pregão ou concorrência)", dispensa: "Dispensa por valor", inexigibilidade: "Inexigibilidade" };
export const PAPEIS: Record<Papel, string> = {
  admin: "Administrador do órgão",
  requisitante: "Área requisitante",
  contratacao: "Agente de contratação / Licitações",
  juridico: "Assessoria jurídica",
  autoridade: "Autoridade competente",
  fiscal: "Gestor ou fiscal de contrato",
};

const LEI = "https://vectorgov.io/api/v1/evidence/leis%3ALEI-14.133-2021%23";
const U = {
  a18: LEI + "ART-018%40FULL", a55: LEI + "ART-055%40FULL", a72: LEI + "ART-072%40FULL", a53: LEI + "ART-053%40FULL",
  a54: LEI + "ART-054%40FULL", a12: LEI + "INC-012-VII", a75p1: LEI + "PAR-075-1", a75p3: LEI + "PAR-075-3",
  a7: LEI + "ART-007%40FULL", a25: LEI + "ART-025%40FULL", a125: LEI + "ART-125%40FULL", a124: LEI + "ART-124%40FULL",
};
export const LINKS_LEI = U;

const it = (id: string, texto: string, base = "", cond?: Condicao): Item => ({ id, texto, base, cond });

const campos = (etapa: string): Item => ({ id: `${etapa}.campos`, texto: "Campos da etapa preenchidos", base: "conferido pelo sistema", auto: true });

export const ETAPAS: Etapa[] = [
  {
    id: "pac", nome: "Verificar no PAC", doc: "Registro da verificação no Plano Anual de Contratações", docOpcional: true,
    fase: "interna", campos: CAMPOS.pac,
    oque: "Confirme se o objeto já consta do Plano Anual de Contratações (PAC) vigente e no mês planejado para início. Busque o objeto no PAC e vincule o item ao processo. Se não consta, registre a justificativa da inclusão extraordinária.",
    base: [{ rotulo: "Art. 12, VII", url: U.a12 }, { rotulo: "Art. 18, caput e § 1º, II", url: U.a18 }, { rotulo: "Dec. 2.533/2024, art. 6º" }],
    papeis: ["requisitante", "contratacao"],
    itens: [
      campos("pac"),
      it("pc1", "Objeto e mês de início conferidos no PAC vigente, ou inclusão extraordinária justificada", "Art. 12, VII; Dec. 2.533/2024, art. 6º"),
    ],
    atencao: [
      "Objeto que não consta do PAC sem justificativa da inclusão extraordinária é a primeira causa de devolução.",
      "O mesmo item do PAC deve ser citado no DFD e no ETP.",
    ],
    modelo: `REGISTRO DE VERIFICAÇÃO NO PLANO ANUAL DE CONTRATAÇÕES
Identificação do processo; Secretaria demandante; objeto
1. Consta do PAC vigente (item e mês previsto) — ou justificativa da inclusão extraordinária
2. Início no mês planejado, ou motivo da alteração do cronograma
Local e data; assinatura do responsável pela Secretaria`,
  },
  {
    id: "solicitacao", nome: "Instrução do processo", doc: null,
    fase: "interna", campos: [],
    oque: "Cadastre os dados de cada Secretaria: objeto, justificativa, informações de apoio, itens, quantidades, orçamentos e anexos. A etapa não gera documento próprio: as informações alimentam o DFD, o ETP e a pesquisa de preços.",
    base: [{ rotulo: "Art. 18, I", url: U.a18 }, { rotulo: "Art. 23" }],
    papeis: ["requisitante", "contratacao"],
    // Etapa sem conferência obrigatória: registrar a solicitação é recomendado, mas não trava o andamento.
    itens: [],
    atencao: [
      "Descreva o objeto sem marca e com quantidades que tenham memória de cálculo.",
      "Orçamentos com mais de 6 meses antes da divulgação do edital não servem para a pesquisa de preços (art. 23, § 1º, IV).",
    ],
    modelo: null,
  },
  {
    id: "dfd", nome: "DFD", doc: "Documento de Formalização da Demanda (DFD)",
    fase: "interna", campos: CAMPOS.dfd ?? [],
    oque: "A Secretaria formaliza, por escrito, a necessidade da contratação: o que, quanto, quando e por que é necessário. É o documento que abre o processo internamente e referencia o item do PAC. Deve ser assinado pelo responsável pela Secretaria ou por quem ele designar.",
    base: [{ rotulo: "Art. 18, I", url: U.a18 }, { rotulo: "Art. 72, I", url: U.a72 }, { rotulo: "Dec. 2.533/2024, art. 6º" }],
    papeis: ["requisitante", "contratacao"],
    itens: [
      campos("dfd"),
      it("d1", "DFD assinado pela área requisitante, e não só pelo setor de licitações", "Art. 72, I"),
      it("d7", "Toda afirmação de fato tem documento nos autos que a comprove"),
      it("d8", "Estudos feitos antes do pedido formal foram ratificados pela área requisitante, se houver"),
    ],
    atencao: [
      "Número do processo igual em todas as peças (instrução do processo, sistema de compras, capa).",
      "Afirmações como \"o Município já fez contratações similares\" sem documento nos autos são apontadas pelo jurídico.",
      "Valores citados (taxas, tarifas) conferidos com o ato normativo que os fixa.",
    ],
    modelo: `DOCUMENTO DE FORMALIZAÇÃO DA DEMANDA
Identificação do processo e do procedimento
1. Área requisitante (órgão, responsável, ato de designação, memorando de origem)
2. Objeto
3. Justificativa da necessidade
4. Quantidade e valor estimado
5. Prazo
6. Previsão no Plano de Contratações Anual
7. Estudo Técnico Preliminar e análise de riscos
8. Solução sugerida
9. Forma de contratação (fundamento legal, critério de julgamento, modo de disputa)
10. Ratificação dos atos anteriores (somente se houver estudos anteriores ao pedido)
Local e data; assinatura do titular da área requisitante; ratificação do setor de licitações e contratos`,
  },
  {
    id: "precos", nome: "Pesquisa de preços", doc: "Pesquisa de preços e memória de cálculo",
    fase: "interna", campos: CAMPOS.precos ?? [],
    oque: "Define o valor estimado da contratação. Bens e serviços usam pesquisa de preços; obras e serviços de engenharia usam sistema oficial de custos, com BDI.",
    base: [{ rotulo: "Art. 18, IV", url: U.a18 }, { rotulo: "Art. 23" }, { rotulo: "Dec. 2.533/2024, art. 11" }, { rotulo: "Art. 72, II e VII", url: U.a72 }, { rotulo: "Art. 75, § 1º", url: U.a75p1 }],
    papeis: ["contratacao", "requisitante"],
    itens: [
      campos("precos"),
      it("p1", "Preços pesquisados em fontes identificadas, com data, e critério de tratamento (média, mediana ou menor valor)", "Art. 23, § 1º", "naoobra"),
      it("p2", "Custos unitários tirados de sistema oficial (SINAPI, SICRO ou referencial estadual), com localidade e mês de referência", "Art. 23, § 2º", "obra"),
      it("p3", "Composição do BDI e dos encargos sociais, composições analíticas e memória de cálculo nos autos", "Art. 18, IV", "obra"),
      it("p4", "Fonte e data-base idênticas em todas as peças (ETP, TR, planilha, edital)"),
      it("p5", "Fundamento normativo correto para o tipo de objeto"),
      it("p6", "Comparação com contratação similar de outro ente (PNCP)", "Art. 72, VII"),
      it("p7", "Relatório e declaração assinados por quem fez o orçamento; em obra, com ART ou RRT"),
      it("p8", "Somatório do exercício e de objetos da mesma natureza dentro do limite da dispensa; sem fracionamento", "Art. 75, § 1º", "disp"),
    ],
    atencao: [
      "Fonte única sem justificativa expressa da impossibilidade de diversificação é ressalva obstativa da Procuradoria.",
      "Guarde as cotações e as telas de consulta com data e hora: sem elas não há como comprovar a pesquisa.",
      "Data-base divergente entre peças é erro recorrente (ex.: mês de um ano no relatório e de outro na planilha).",
      "Norma de pesquisa de preços de bens e serviços citada em orçamento de obra é apontada como fundamento errado.",
      "O limite de dispensa por valor é atualizado por decreto federal todo ano: conferir o valor vigente.",
    ],
    modelo: `DECLARAÇÃO DE VERACIDADE DO ORÇAMENTO
Identificação do processo; objeto
Declaração numerada do autor do orçamento: valor e data; fonte, localidade, mês de referência e fundamento legal; composições próprias ou complementares; BDI; retificações de erro material, se houver; responsabilidade técnica
Local e data; assinatura do autor do orçamento

RELATÓRIO DE FORMAÇÃO DE PREÇOS
Identificação do processo; órgão; objeto
1. Fundamento normativo
2. Fonte e data-base (quadro Elemento | Dado)
3. Relação entre as tabelas referenciais usadas (ou fontes da pesquisa de preços e tratamento dos dados)
4. BDI e encargos sociais (somente obra)
5. Quantitativos
6. Parâmetro de comparação
7. Conclusão (valor máximo aceitável e data-base de reajuste)
Local e data; assinaturas do agente de contratação e do responsável técnico`,
  },
  {
    id: "etp", nome: "Estudo Técnico Preliminar", doc: "Estudo Técnico Preliminar (ETP)",
    fase: "interna", campos: CAMPOS.etp ?? [],
    oque: "Mostra o problema a resolver e a melhor solução, para que se avalie a viabilidade técnica e econômica. Os incisos I, IV, VI, VIII e XIII (★) são o conteúdo mínimo; os demais devem constar ou ter a ausência justificada. Em obras e serviços comuns de engenharia o ETP é opcional no Município, desde que não haja prejuízo técnico (Dec. 2.533/2024, art. 8º).",
    base: [{ rotulo: "Art. 18, §§ 1º a 3º", url: U.a18 }, { rotulo: "Dec. 2.533/2024, arts. 7º e 8º" }],
    papeis: ["requisitante", "contratacao"],
    itens: [
      campos("etp"),
      it("e14", "Assinado por quem elaborou; a fiscalização ficará com outro servidor", "Art. 7º, § 1º"),
    ],
    atencao: [
      "Se o ETP não explica POR QUE esta solução e POR QUE esta quantidade, o processo tende a voltar em diligência.",
      "Comparar de fato as alternativas (vantagens, desvantagens, conclusão), não só descrever a escolhida.",
      "Não invocar urgência quando o fundamento é o valor.",
      "Em versão retificada, fechar com um quadro \"Alterações em relação à versão anterior\" e o motivo de cada uma.",
      "Campos que dependem de outro setor ficam realçados em amarelo até serem preenchidos; não assinar com amarelo pendente.",
    ],
    modelo: `ESTUDO TÉCNICO PRELIMINAR
(Lei nº 14.133/2021, art. 18, §§ 1º e 2º)
Identificação do processo e do procedimento
1. Informações básicas (objeto e natureza do objeto)
2. Descrição da necessidade (com quadro Indicador | Dado | Fonte)
3. Área requisitante
4. Requisitos da contratação
5. Levantamento de mercado e análise das alternativas (quadro Alternativa | Vantagens | Desvantagens | Conclusão)
6. Estimativa das quantidades
7. Estimativa do valor
8. Descrição da solução como um todo
9. Justificativa para o parcelamento ou não
10. Contratações correlatas ou interdependentes
11. Alinhamento com o planejamento
12. Resultados pretendidos
13. Impactos ambientais e medidas mitigadoras (quadro Impacto | Medida mitigadora | Responsável)
14. Providências a serem adotadas
15. Análise de riscos (quadro Risco | Probabilidade | Impacto | Ação preventiva / contingência)
16. Declaração de viabilidade
17. Responsáveis pela elaboração e fiscalização
Local e data; assinaturas de quem elaborou`,
  },
  {
    id: "tr", nome: "Termo de Referência / Projeto Básico", doc: "Termo de Referência ou Projeto Básico, com análise de riscos",
    fase: "interna", campos: CAMPOS.tr ?? [],
    oque: "Termo de Referência para bens e serviços comuns; Projeto Básico para obras e serviços de engenharia. Define o objeto e as regras de execução, gestão e pagamento. A análise de riscos faz parte da fase preparatória; a matriz de alocação de riscos é facultativa, mas obrigatória em obras de grande vulto e na contratação integrada ou semi-integrada.",
    base: [{ rotulo: "Art. 18, II, III e IX", url: U.a18 }, { rotulo: "Art. 6º, XXIII e XXV" }, { rotulo: "Arts. 18, X, e 22 (riscos)" }, { rotulo: "Art. 7º, § 1º", url: U.a7 }, { rotulo: "Art. 25, § 7º", url: U.a25 }],
    papeis: ["requisitante", "contratacao"],
    itens: [
      campos("tr"),
      it("t1", "Objeto, quantitativos e valor máximo iguais aos do ETP e do orçamento"),
      it("t2", "Local, prazo de execução ou entrega e vigência", "Art. 18, III"),
      it("t3", "Gestor e fiscal indicados, distintos de quem fez o projeto, o orçamento e o ETP", "Art. 7º, § 1º; art. 117"),
      it("t4", "Medição e pagamento definidos", "Art. 18, III"),
      it("t5", "Recebimento provisório e definitivo, com prazos", "Art. 140"),
      it("t6", "Critério de julgamento e de aceitabilidade de preços", "Art. 18, VIII"),
      it("t7", "Habilitação justificada; qualificação técnica limitada às parcelas de maior relevância", "Art. 18, IX; art. 67"),
      it("t8", "Garantia de execução exigida, ou dispensada com motivação", "Arts. 96 a 98"),
      it("t9", "Subcontratação admitida ou vedada, com justificativa", "Art. 122"),
      it("t10", "Índice de reajuste com data-base na data do orçamento", "Art. 25, § 7º"),
      it("t11", "Projetos, memorial, ART/RRT, planilha e cronograma físico-financeiro integram o termo", "Art. 18, II", "obra"),
      it("t12", "Licenças e manifestações ambiental e sanitária tratadas, quando o objeto exigir", "", "obra"),
      it("t13", "Adequação orçamentária indicada"),
      it("t14", "Aprovado pela autoridade competente"),
      it("r1", "Riscos da fase de seleção analisados (procedimento deserto ou fracassado, sobrepreço, impugnação)", "Art. 18, X"),
      it("r2", "Riscos da execução analisados (atraso, qualidade, acidente, inadimplência), com a mitigação refletida no TR", "Art. 18, X"),
      it("r5", "Riscos próprios de obra: projeto incompleto, condições do solo, licenciamento", "", "obra"),
    ],
    atencao: [
      "Quantidade e valor do TR devem ser os mesmos do ETP e da pesquisa de preços: a Procuradoria confere a coerência.",
      "Marca, exigência desnecessária e quantidade sem memória de cálculo são pontos típicos de impugnação.",
      "Riscos genéricos copiados de outro processo costumam ser devolvidos; cada risco deve ter relação com o objeto.",
      "Exigência de conselho profissional deve admitir todos os conselhos com atribuição legal para o objeto.",
      "Vocabulário de outra modalidade (\"pregoeiro\", \"ata de registro de preços\") em dispensa ou concorrência.",
      "Designar como fiscal a autora do projeto e do orçamento fere a segregação de funções.",
      "O mesmo texto, com a mesma data, deve estar na pasta de planejamento e no anexo do edital.",
    ],
    modelo: `TERMO DE REFERÊNCIA
Linha com a forma de contratação e o fundamento legal
Identificação do processo e do procedimento
1. OBJETO (1.1 descrição; natureza do objeto; regime de execução; quadro Lote | Item | Descrição | Unid. | Quant. | Valor máximo; valor máximo por extenso)
2. JUSTIFICATIVA
3. DOCUMENTOS TÉCNICOS QUE INTEGRAM ESTE TERMO (e formação de preços)
4. CONDIÇÕES DE EXECUÇÃO (local, prazo, vigência, ordem de serviço ou de fornecimento, prorrogação, subcontratação, garantia de execução, garantia do objeto, sustentabilidade)
5. OBRIGAÇÕES ESPECÍFICAS DA CONTRATADA
6. MODELO DE GESTÃO E FISCALIZAÇÃO DO CONTRATO (gestor, fiscal, fiscal substituto)
7. MEDIÇÃO E PAGAMENTO (inclusive reajuste)
8. RECEBIMENTO DO OBJETO
9. FORMA E CRITÉRIOS DE SELEÇÃO DO FORNECEDOR
10. EXIGÊNCIAS DE HABILITAÇÃO (jurídica; fiscal, social e trabalhista; econômico-financeira; técnica; justificativa das exigências técnicas)
11. ADEQUAÇÃO ORÇAMENTÁRIA
12. ANÁLISE DE RISCOS (quadro Risco | Probabilidade | Impacto | Mitigação | Responsável) e MATRIZ DE ALOCAÇÃO DE RISCOS, quando cabível
13. DISPOSIÇÕES GERAIS
Subitens numerados (1.1, 1.2...). Local e data; assinatura do titular da área requisitante; "Aprovo o presente Termo de Referência" e assinatura da autoridade`,
  },
  {
    id: "dot", nome: "Dotação orçamentária", doc: "Solicitação de reserva de dotação orçamentária",
    fase: "interna", campos: CAMPOS.dot,
    oque: "A Secretaria solicita formalmente à Contabilidade a reserva ou indicação da dotação compatível com o objeto, com base no TR ou PB já elaborado. Sem essa indicação o processo não pode ser protocolado. Solicite com antecedência — esta etapa depende de outro setor.",
    base: [{ rotulo: "Art. 150" }, { rotulo: "Art. 72, IV", url: U.a72 }],
    papeis: ["requisitante", "contratacao", "autoridade"],
    itens: [
      campos("dot"),
      it("o1", "Solicitação formal à Contabilidade com objeto, valor, parcela do exercício e cronograma; protocolo guardado", "Art. 150"),
      it("o2", "Natureza da despesa compatível com o objeto (obra é despesa de capital, não serviço de terceiros)"),
    ],
    atencao: [
      "Ausência de indicação de dotação no momento do protocolo é erro comum.",
      "Se o contrato atravessa exercícios, informe a divisão por ano.",
      "Com convênio, confira as regras específicas do instrumento.",
      "A classificação da despesa deve ser a mesma na indicação da Contabilidade, no TR e no contrato.",
    ],
    modelo: `SOLICITAÇÃO DE RESERVA DE DOTAÇÃO ORÇAMENTÁRIA
Ofício da Secretaria demandante à Contabilidade; identificação do processo
1. Objeto (conforme o Termo de Referência ou Projeto Básico)
2. Valor estimado total e parcela do exercício
3. Divisão por exercício (se o contrato atravessa anos)
4. Origem do recurso (próprio, convênio ou transferência)
5. Cronograma de desembolso
6. Pedido de reserva e indicação da dotação
Local e data; assinatura do responsável pela Secretaria`,
  },
  {
    id: "fiscal", nome: "Fiscal do contrato", doc: "Indicação do fiscal do contrato",
    fase: "interna", campos: CAMPOS.fiscal,
    oque: "Indique o servidor que atuará como fiscal do futuro contrato — preferencialmente efetivo, com atribuições ou formação compatíveis com o objeto e sem vínculo com o contratado — e o substituto, que também deve ser servidor apto e sem vínculo com o contratado.",
    base: [{ rotulo: "Art. 7º", url: U.a7 }, { rotulo: "Art. 117" }, { rotulo: "Dec. 2.533/2024, art. 5º" }],
    papeis: ["requisitante", "contratacao"],
    itens: [
      campos("fiscal"),
      it("o4", "Fiscal e substituto designados pela autoridade competente, respeitada a segregação de funções", "Art. 7º, § 1º; art. 117; Dec. 2.533/2024, art. 5º"),
    ],
    atencao: [
      "Designar como fiscal quem elaborou o projeto, o orçamento ou o ETP fere a segregação de funções.",
      "O fiscal anota as ocorrências e comunica aos superiores o que ultrapassar a sua competência (art. 117, §§ 1º e 2º).",
    ],
    modelo: `INDICAÇÃO DE FISCAL DO CONTRATO
Identificação do processo; Secretaria demandante; objeto
1. Fiscal do contrato (nome, matrícula, cargo, vínculo e compatibilidade com o objeto)
2. Fiscal substituto
3. Gestor do contrato (se definido)
4. Declarações (ausência de vínculo com contratados; segregação de funções)
Local e data; assinatura do responsável pela Secretaria`,
  },
  {
    id: "protocolo", nome: "Protocolo", doc: "Encaminhamento ao Departamento de Licitações e Contratos",
    fase: "interna", campos: CAMPOS.protocolo,
    oque: "Encerra a fase interna. Confira o checklist e protocole o processo completo no Departamento de Licitações e Contratos. A partir daí a responsabilidade passa a ser do Departamento.",
    base: [{ rotulo: "Art. 18, caput", url: U.a18 }, { rotulo: "Dec. 2.533/2024, art. 5º" }],
    papeis: ["requisitante", "contratacao"],
    itens: [
      campos("protocolo"),
      it("f2", "Documentos das etapas anteriores reunidos em ordem nos autos (verificação no PAC, instrução do processo, DFD, ETP, pesquisa de preços, TR/PB, indicação de dotação, indicação do fiscal)"),
    ],
    atencao: [
      "Processo protocolado incompleto, faltando algum documento das etapas anteriores, volta em diligência.",
      "Ausência de indicação de dotação orçamentária no momento do protocolo é erro comum.",
    ],
    modelo: `ENCAMINHAMENTO AO DEPARTAMENTO DE LICITAÇÕES E CONTRATOS
Identificação do processo; Secretaria demandante; objeto
1. Documentos da fase interna encaminhados (verificação no PAC, instrução do processo, DFD, ETP, pesquisa de preços, TR/PB com análise de riscos, indicação de dotação, indicação do fiscal)
2. Observações ao Departamento
3. Encaminhamento do processo completo para análise e providências do Departamento
Local e data; assinatura do responsável pela Secretaria`,
  },

];

export interface ProcessoBase { tipo: Tipo; via: Via }
export type Checks = Record<string, boolean>;

export function vale(p: ProcessoBase, c?: Condicao): boolean {
  if (!c) return true;
  const o = p.tipo === "obra", v = p.via;
  switch (c) {
    case "obra": return o;
    case "naoobra": return !o;
    case "lic": return v === "licitacao";
    case "disp": return v === "dispensa";
    case "inex": return v === "inexigibilidade";
    case "direta": return v !== "licitacao";
    case "naoinex": return v !== "inexigibilidade";
  }
}
export const itensDe = (e: Etapa, p: ProcessoBase) => e.itens.filter((i) => vale(p, i.cond));
export const feitos = (e: Etapa, p: ProcessoBase, c: Checks) => itensDe(e, p).filter((i) => c[i.id]).length;
export const feita = (e: Etapa, p: ProcessoBase, c: Checks) => feitos(e, p, c) === itensDe(e, p).length;
export function liberada(ix: number, p: ProcessoBase, c: Checks) {
  for (let k = 0; k < ix; k++) if (!feita(ETAPAS[k], p, c)) return false;
  return true;
}
export function atual(p: ProcessoBase, c: Checks) {
  for (let k = 0; k < ETAPAS.length; k++) if (!feita(ETAPAS[k], p, c)) return k;
  return ETAPAS.length - 1;
}
export const concluido = (p: ProcessoBase, c: Checks) => ETAPAS.every((e) => feita(e, p, c));
export const TRILHA_PROCESSO = ETAPAS.map(({ id, nome, fase }, i) => ({ id, nome, fase, numero: i + 1 }));
/** Quantas etapas a Secretaria cumpre antes do protocolo no Departamento de Licitações. */
export const ETAPAS_INTERNAS = ETAPAS.filter((e) => e.fase === "interna").length;

type EstadoTrilha = "atual" | "concluida" | "disponivel" | "bloqueada";
export type EtapaNaTrilha = (typeof TRILHA_PROCESSO)[number] & { estado: EstadoTrilha };
export interface TrilhaProcesso { atual: EtapaNaTrilha; etapas: EtapaNaTrilha[] }

export function trilhaDoProcesso(p: ProcessoBase, c: Checks): TrilhaProcesso {
  const indice = atual(p, c);
  const etapas = TRILHA_PROCESSO.map((etapa, i): EtapaNaTrilha => {
    // Etapa sem conferência (Solicitação) só aparece concluída depois de liberada pelas anteriores.
    const estado = feita(ETAPAS[i], p, c) && liberada(i, p, c) ? "concluida" : i === indice ? "atual" : liberada(i, p, c) ? "disponivel" : "bloqueada";
    return { ...etapa, estado };
  });
  return { atual: etapas[indice], etapas };
}

/* ---------- campos de preenchimento ---------- */
export const temValor = (x?: ValorCampo) => Array.isArray(x) ? x.length > 0 : Boolean(x?.trim());
export function campoVisivel(c: Campo, p: ProcessoBase, v: Valores) {
  if (!vale(p, c.cond)) return false;
  if (!c.se) return true;
  const ref = v[c.se.campo];
  if (c.se.menosDe !== undefined) return (Array.isArray(ref) ? ref.length : 0) < c.se.menosDe;
  const atual = Array.isArray(ref) ? "" : (ref ?? "");
  if (c.se.em) return c.se.em.includes(atual);
  if (c.se.fora) return !c.se.fora.includes(atual);
  return true;
}
export const camposVisiveis = (e: Etapa, p: ProcessoBase, v: Valores) => e.campos.filter((c) => campoVisivel(c, p, v));
/** Campos obrigatórios ainda em branco (ou declarações obrigatórias não marcadas). */
export function camposFaltando(e: Etapa, p: ProcessoBase, v: Valores) {
  return camposVisiveis(e, p, v).filter((c) => {
    if (c.opcional) return false;
    const exigidas = MARCAS_OBRIGATORIAS[`${e.id}.${c.id}`];
    if (exigidas) { const x = v[c.id]; return !exigidas.every((o) => Array.isArray(x) && x.includes(o)); }
    return !temValor(v[c.id]);
  });
}
/** Mantém só os campos da etapa, com o tipo certo de valor. */
export function limparValores(e: Etapa, v: Valores): Valores {
  const out: Valores = {};
  for (const c of e.campos) {
    const x = v[c.id];
    if (x === undefined) continue;
    if (c.tipo === "marcas") { if (Array.isArray(x)) out[c.id] = x.filter((o) => c.opcoes?.some(([k]) => k === o)); }
    else if (typeof x === "string") out[c.id] = c.tipo === "opcao" && x && !c.opcoes?.some(([k]) => k === x) ? "" : x;
  }
  return out;
}
/** Texto do valor de um campo para documentos e para a IA. */
export function textoDoCampo(c: Campo, x?: ValorCampo) {
  if (!temValor(x)) return "";
  const rotulo = (k: string) => c.opcoes?.find(([o]) => o === k)?.[1] ?? k;
  if (Array.isArray(x)) return x.map((k) => `- ${rotulo(k)}`).join("\n");
  if (c.tipo === "opcao") return rotulo(x!);
  if (c.tipo === "valor") {
    const n = Number(x!.replace(/\./g, "").replace(",", "."));
    return Number.isFinite(n) && /\d/.test(x!) ? n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : x!.trim();
  }
  return x!.trim();
}
export const itemDosCampos = (e: Etapa) => e.itens.find((i) => i.auto);

export const etapaPorId = (id: string) => ETAPAS.find((e) => e.id === id);
export function etapaDoItem(itemId: string) {
  return ETAPAS.find((e) => e.itens.some((i) => i.id === itemId));
}
export function podeMarcar(papeis: Papel[], e: Etapa) {
  return papeis.includes("admin") || e.papeis.some((p) => papeis.includes(p));
}

/** Campos pendentes de uma minuta: cada ocorrência de [[...]] separadamente. */
export function pendencias(texto: string) {
  const out: { i: number; rotulo: string; trecho: string }[] = [];
  const re = /\[\[(.+?)\]\]/g;
  let r: RegExpExecArray | null;
  while ((r = re.exec(texto))) {
    const a = texto.lastIndexOf("\n", r.index) + 1;
    let b = texto.indexOf("\n", r.index);
    if (b < 0) b = texto.length;
    const rel = r.index - a;
    let ln = texto.slice(a, a + rel) + "▮" + texto.slice(a + rel + r[0].length, b);
    ln = ln.replace(/^(#+|@)\s*/, "").replace(/\s*\|\s*/g, " · ").replace(/^ · | · $/g, "").replace(/\[\[(.+?)\]\]/g, "$1");
    const k = ln.indexOf("▮"), ini = Math.max(0, k - 120), fim = Math.min(ln.length, k + 130);
    out.push({ i: out.length, rotulo: r[1], trecho: (ini > 0 ? "…" : "") + ln.slice(ini, fim) + (fim < ln.length ? "…" : "") });
  }
  return out;
}
export function aplicarPendencias(texto: string, valores: Record<string, string>) {
  let k = 0, n = 0;
  const novo = texto.replace(/\[\[(.+?)\]\]/g, (m) => {
    const v = (valores[String(k++)] ?? "").trim();
    if (v) { n++; return v; }
    return m;
  });
  return { texto: novo, aplicados: n };
}

/** Limites de alteração contratual (art. 125). */
export function limiteAditivo(tipoObjeto: string) {
  return tipoObjeto === "reforma" ? 0.5 : 0.25;
}
