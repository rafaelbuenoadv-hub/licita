// Campos de preenchimento de cada etapa da fase interna, conforme a capacitação
// "A Fase Interna da Licitação" (Procuradoria-Geral do Município de Ibaiti, PAC 2027)
// e a Lei nº 14.133/2021 / Decreto Municipal nº 2.533/2024.
import type { Condicao } from "./etapas.js";

export type TipoCampo = "texto" | "area" | "opcao" | "marcas" | "valor";
export type ValorCampo = string | string[];
export type Valores = Record<string, ValorCampo>;

export interface Campo {
  id: string;
  /** Título curto: aparece no formulário e vira o título da seção no documento. */
  rotulo: string;
  tipo: TipoCampo;
  /** Explicação do que escrever (vem da capacitação). */
  ajuda?: string;
  opcoes?: [valor: string, texto: string][];
  /** Campo que pode ficar em branco. */
  opcional?: boolean;
  /** Só vale para certo tipo de objeto ou forma de contratação. */
  cond?: Condicao;
  /** Só aparece conforme a resposta de outro campo da mesma etapa. */
  se?: { campo: string; em?: string[]; fora?: string[]; menosDe?: number };
  /** Conteúdo mínimo obrigatório do ETP (art. 18, § 2º) — marcado com ★. */
  minimo?: boolean;
  /** Fica fora do documento montado com os campos (dado de controle). */
  foraDoDocumento?: boolean;
}

const SIM_NAO: [string, string][] = [["sim", "Sim"], ["nao", "Não"]];
const OUTROS_ETP = "Se este elemento não se aplica ao objeto, explique por quê (art. 18, § 2º).";

export const CAMPOS: Record<string, Campo[]> = {
  pac: [
    { id: "consta", rotulo: "O objeto consta do PAC vigente?", tipo: "opcao", opcoes: [["sim", "Sim, consta do Plano Anual de Contratações"], ["nao", "Não consta do PAC"]],
      ajuda: "Confira no Plano Anual de Contratações se o objeto está previsto e para qual mês." },
    { id: "item_pac", rotulo: "Item do PAC", tipo: "texto", se: { campo: "consta", em: ["sim"] },
      ajuda: "Preenchido ao escolher o item na busca do PAC, acima." },
    { id: "mes_planejado", rotulo: "Mês previsto no PAC para o início", tipo: "texto", se: { campo: "consta", em: ["sim"] } },
    { id: "no_prazo", rotulo: "A contratação começa no mês planejado?", tipo: "opcao", opcoes: SIM_NAO, se: { campo: "consta", em: ["sim"] } },
    { id: "motivo_prazo", rotulo: "Motivo da alteração do cronograma", tipo: "area", se: { campo: "no_prazo", em: ["nao"] },
      ajuda: "Explique por que a contratação começa antes ou depois do mês previsto no PAC." },
    { id: "justificativa_inclusao", rotulo: "Justificativa da inclusão extraordinária", tipo: "area", se: { campo: "consta", em: ["nao"] },
      ajuda: "Por que o objeto não foi planejado e por que precisa ser contratado agora." },
  ],
  dfd: [
    { id: "responsavel", rotulo: "Responsável pela Secretaria", tipo: "texto", ajuda: "Nome e cargo de quem solicita e assina o DFD (o titular da Secretaria ou quem ele designar)." },
    { id: "contato", rotulo: "Contato do responsável", tipo: "texto", ajuda: "Telefone e e-mail." },
    { id: "objeto", rotulo: "Objeto resumido", tipo: "area", ajuda: "O que se pretende contratar, sem indicar marca nem direcionar a um fornecedor." },
    { id: "justificativa", rotulo: "Justificativa da necessidade", tipo: "area", ajuda: "Qual problema público a contratação resolve e o que acontece se ela não for feita." },
    { id: "quantidade", rotulo: "Quantidade estimada", tipo: "area", ajuda: "Quanto é necessário e a lógica do cálculo (consumo anterior, população atendida etc.)." },
    { id: "data_pretendida", rotulo: "Data pretendida", tipo: "area", ajuda: "Quando o objeto é necessário e por quê, em linha com o cronograma do PAC." },
    { id: "modalidade", rotulo: "Modalidade de contratação", tipo: "texto",
      ajuda: "Ex.: Pregão Eletrônico; Dispensa de Licitação; Adesão à Ata de Registro de Preços (Carona); Inexigibilidade." },
    { id: "solucoes", rotulo: "Soluções sugeridas para contratação", tipo: "area",
      ajuda: "Como o objeto foi contratado antes e por que a solução proposta (pregão próprio, adesão a ata, dispensa etc.) é a adequada agora." },
    { id: "etp", rotulo: "Necessidade do Estudo Técnico Preliminar e da matriz de riscos", tipo: "opcao", opcoes: [
      ["sim", "Exige Estudo Técnico Preliminar e análise de riscos"],
      ["dispensado", "ETP dispensado: obra ou serviço comum de engenharia, sem prejuízo técnico (Lei nº 14.133/2021, art. 18, § 3º; Dec. 2.533/2024, art. 8º)"],
    ] },
  ],
  etp: [
    { id: "i", rotulo: "I — Descrição da necessidade", tipo: "area", minimo: true, ajuda: "O problema a resolver, sob a perspectiva do interesse público e não do órgão." },
    { id: "ii", rotulo: "II — Previsão no PAC", tipo: "area", ajuda: "Item do PAC e alinhamento da contratação com o planejamento." },
    { id: "iii", rotulo: "III — Requisitos da contratação", tipo: "area", ajuda: "Condições mínimas que a solução precisa atender para resolver o problema. " + OUTROS_ETP },
    { id: "iv", rotulo: "IV — Estimativa das quantidades", tipo: "area", minimo: true, ajuda: "Com memória de cálculo e documentos de suporte; considere contratações interdependentes e economia de escala." },
    { id: "v", rotulo: "V — Levantamento de mercado", tipo: "area", ajuda: "Alternativas possíveis e justificativa técnica e econômica da solução escolhida. " + OUTROS_ETP },
    { id: "vi", rotulo: "VI — Estimativa do valor", tipo: "area", minimo: true, ajuda: "Preços unitários referenciais, memória de cálculo e documentos de suporte." },
    { id: "vii", rotulo: "VII — Descrição da solução como um todo", tipo: "area", ajuda: "Inclua manutenção e assistência técnica, quando for o caso. " + OUTROS_ETP },
    { id: "viii", rotulo: "VIII — Parcelamento ou não da contratação", tipo: "area", minimo: true, ajuda: "Por que o objeto será dividido em itens ou lotes, ou contratado em lote único." },
    { id: "ix", rotulo: "IX — Resultados pretendidos", tipo: "area", ajuda: "Economicidade e melhor aproveitamento dos recursos humanos, materiais e financeiros. " + OUTROS_ETP },
    { id: "x", rotulo: "X — Providências prévias ao contrato", tipo: "area", ajuda: "O que a Administração precisa fazer antes de contratar, inclusive capacitar servidores para fiscalização e gestão. " + OUTROS_ETP },
    { id: "xi", rotulo: "XI — Contratações correlatas ou interdependentes", tipo: "area", ajuda: "Outras contratações que dependem desta ou que a influenciam. " + OUTROS_ETP },
    { id: "xii", rotulo: "XII — Impactos ambientais", tipo: "area", ajuda: "Impactos e medidas mitigadoras, com baixo consumo de energia e logística reversa, quando aplicável. " + OUTROS_ETP },
    { id: "xiii", rotulo: "XIII — Posicionamento conclusivo", tipo: "area", minimo: true, ajuda: "Declare se a contratação é adequada para atender a necessidade. Sem isso, o ETP não conclui." },
  ],
  precos: [
    { id: "parametros", rotulo: "Parâmetros utilizados (art. 23, § 1º)", tipo: "marcas", cond: "naoobra", opcoes: [
      ["painel", "I — Painel de preços (PNCP) ou banco de preços em saúde"],
      ["similares", "II — Contratações similares da Administração Pública (último ano)"],
      ["midia", "III — Mídia e sítios especializados, com data e hora de acesso"],
      ["fornecedores", "IV — Pesquisa direta com no mínimo 3 fornecedores"],
      ["notas", "V — Notas fiscais eletrônicas"],
    ], ajuda: "A Procuradoria recomenda combinar ao menos dois parâmetros." },
    { id: "parametros_obra", rotulo: "Parâmetros utilizados (art. 23, § 2º)", tipo: "marcas", cond: "obra", opcoes: [
      ["sinapi", "I — SICRO ou SINAPI"],
      ["midia", "II — Mídia especializada, tabelas de referência ou sítios, com data de acesso"],
      ["similares", "III — Contratações similares da Administração Pública (último ano)"],
      ["notas", "IV — Notas fiscais eletrônicas"],
    ], ajuda: "Combine ao menos dois parâmetros; o valor deve incluir BDI e encargos sociais." },
    { id: "fonte_unica", rotulo: "Justificativa da fonte única", tipo: "area", se: { campo: "parametros", menosDe: 2 }, cond: "naoobra",
      ajuda: "Fonte única só é aceita com justificativa expressa da impossibilidade de diversificar. Sem ela, a Procuradoria aponta ressalva obstativa." },
    { id: "fonte_unica_obra", rotulo: "Justificativa da fonte única", tipo: "area", se: { campo: "parametros_obra", menosDe: 2 }, cond: "obra",
      ajuda: "Fonte única só é aceita com justificativa expressa da impossibilidade de diversificar." },
    { id: "metodo", rotulo: "Método de cálculo", tipo: "opcao", opcoes: [["media", "Média"], ["mediana", "Mediana"], ["menor", "Menor preço"], ["outro", "Outro (explicar na memória de cálculo)"]] },
    { id: "memoria", rotulo: "Memória de cálculo", tipo: "area", ajuda: "O método escolhido preenche um texto base editável. Confira o cálculo e a razão da escolha e complemente com as fontes consultadas e suas datas de referência e de acesso." },
    { id: "analise_critica", rotulo: "Análise complementar dos preços (opcional)", tipo: "area", opcional: true,
      ajuda: "Classifique os preços no quadro de tratamento desta etapa. O relatório registra automaticamente os valores usados, somente de referência e descartados. Use este campo para complementar a análise (Dec. 2.533/2024, art. 11, §§ 2º e 3º)." },
    { id: "bdi", rotulo: "BDI e encargos sociais", tipo: "texto", cond: "obra", ajuda: "Percentuais adotados e onde está a composição." },
    { id: "data_base", rotulo: "Data-base do orçamento", tipo: "texto", ajuda: "Mês e ano de referência dos preços, igual em todas as peças." },
    { id: "valor_total", rotulo: "Valor estimado total (R$)", tipo: "valor" },
  ],
  tr: [
    { id: "a", rotulo: "a) Definição do objeto", tipo: "area", cond: "naoobra", ajuda: "Natureza, quantitativos, prazo do contrato e possibilidade de prorrogação." },
    { id: "b", rotulo: "b) Fundamentação da contratação", tipo: "area", cond: "naoobra", ajuda: "Referência ao ETP ou, se não puder ser divulgado, extrato das partes não sigilosas." },
    { id: "c", rotulo: "c) Descrição da solução", tipo: "area", cond: "naoobra", ajuda: "A solução como um todo, considerado todo o ciclo de vida do objeto." },
    { id: "d", rotulo: "d) Requisitos da contratação", tipo: "area", cond: "naoobra", ajuda: "O que o objeto e o contratado precisam atender. Sem marca nem exigência desnecessária." },
    { id: "e", rotulo: "e) Modelo de execução do objeto", tipo: "area", cond: "naoobra", ajuda: "Como o contrato produzirá os resultados pretendidos, do início ao encerramento: local, prazo, entrega." },
    { id: "f", rotulo: "f) Modelo de gestão do contrato", tipo: "area", cond: "naoobra", ajuda: "Como a execução será acompanhada e fiscalizada pelo órgão." },
    { id: "g", rotulo: "g) Critérios de medição e pagamento", tipo: "area", cond: "naoobra", ajuda: "Como se mede o que foi entregue e quando e como se paga." },
    { id: "h", rotulo: "h) Forma e critérios de seleção do fornecedor", tipo: "area", cond: "naoobra", ajuda: "Como será escolhido o contratado. Exigências de habilitação proporcionais ao objeto." },
    { id: "i", rotulo: "i) Estimativas do valor da contratação", tipo: "area", cond: "naoobra", ajuda: "Preços unitários referenciais e memória de cálculo — os mesmos da pesquisa de preços." },
    { id: "j", rotulo: "j) Adequação orçamentária", tipo: "area", cond: "naoobra", ajuda: "Demonstre que há recursos previstos para pagar o objeto." },
    { id: "pb_a", rotulo: "a) Levantamentos e ensaios", tipo: "area", cond: "obra", ajuda: "Topografia, cadastro, sondagens, ensaios geotécnicos e laboratoriais, estudos socioambientais." },
    { id: "pb_b", rotulo: "b) Soluções técnicas", tipo: "area", cond: "obra", ajuda: "Globais e localizadas, detalhadas para evitar reformulações no preço, na qualidade e no prazo." },
    { id: "pb_c", rotulo: "c) Serviços, materiais e equipamentos", tipo: "area", cond: "obra", ajuda: "Identificação e especificações, sem frustrar o caráter competitivo." },
    { id: "pb_d", rotulo: "d) Métodos construtivos", tipo: "area", cond: "obra", ajuda: "Métodos, instalações provisórias e condições organizacionais da obra." },
    { id: "pb_e", rotulo: "e) Plano de licitação e gestão", tipo: "area", cond: "obra", ajuda: "Programação, estratégia de suprimentos e normas de fiscalização." },
    { id: "pb_f", rotulo: "f) Orçamento detalhado", tipo: "area", cond: "obra", ajuda: "Custo global com quantitativos de serviços e fornecimentos (obrigatório nos regimes do art. 46, I, II, III, IV e VII)." },
    { id: "prazo_execucao", rotulo: "Prazo de entrega ou de execução", tipo: "texto", opcional: true,
      ajuda: "Ex.: até 15 (quinze) dias corridos, contados do recebimento da ordem de fornecimento." },
    { id: "local_execucao", rotulo: "Local de entrega ou de execução", tipo: "texto", opcional: true,
      ajuda: "Endereço ou setor. Em branco, o TR diz que o local será indicado na ordem de fornecimento ou de serviço." },
    { id: "vigencia", rotulo: "Vigência do contrato ou da ata", tipo: "texto", opcional: true, ajuda: "Ex.: 12 (doze) meses, contados da assinatura (arts. 84 e 105 a 107)." },
    { id: "prazo_pagamento", rotulo: "Prazo de pagamento", tipo: "texto", opcional: true, ajuda: "Ex.: até 30 (trinta) dias, contados do atesto da nota fiscal." },
    { id: "reajuste", rotulo: "Índice de reajuste", tipo: "texto", opcional: true, ajuda: "Índice e data-base do reajuste (art. 25, § 7º). Ex.: IPCA/IBGE." },
    { id: "garantia_objeto", rotulo: "Garantia do produto ou do serviço", tipo: "texto", opcional: true,
      ajuda: "Prazo de garantia exigido. Em branco, vale a garantia legal do Código de Defesa do Consumidor." },
    { id: "subcontratacao", rotulo: "Admite subcontratação?", tipo: "opcao", opcional: true, opcoes: [["nao", "Não"], ["parcial", "Sim, parcial, com autorização do contratante"]] },
    { id: "obrigacoes_adicionais", rotulo: "Obrigações adicionais da contratada (opcional)", tipo: "area", opcional: true,
      ajuda: "O TR já traz as obrigações gerais da contratada e do contratante. Inclua aqui só o que for próprio deste objeto." },
    { id: "riscos", rotulo: "Análise de riscos", tipo: "area",
      ajuda: "Riscos do processo e da execução e como mitigá-los (art. 18, X). Ex.: atraso na entrega da merenda no início do ano letivo → prazo de entrega no TR e sanção por atraso." },
    { id: "matriz_obrigatoria", rotulo: "É obra ou serviço de grande vulto, ou contratação integrada ou semi-integrada?", tipo: "opcao", opcoes: SIM_NAO, cond: "obra", foraDoDocumento: true,
      ajuda: "Nesses casos a matriz de alocação de riscos é obrigatória (art. 22, § 3º)." },
    { id: "matriz", rotulo: "Haverá matriz de alocação de riscos?", tipo: "opcao", opcoes: SIM_NAO, foraDoDocumento: true, ajuda: "Facultativa em regra (art. 22)." },
    { id: "matriz_texto", rotulo: "Matriz de alocação de riscos", tipo: "area", se: { campo: "matriz", em: ["sim"] },
      ajuda: "Quais riscos ficam com a Administração e quais com o contratado; eventos que afetem o equilíbrio econômico-financeiro (art. 6º, XXVII)." },
  ],
  dot: [
    { id: "valor_total", rotulo: "Valor estimado total (R$)", tipo: "valor", ajuda: "Use o valor da pesquisa de preços." },
    { id: "valor_exercicio", rotulo: "Parcela que vence neste exercício (R$)", tipo: "valor" },
    { id: "plurianual", rotulo: "O contrato atravessa mais de um exercício?", tipo: "opcao", opcoes: SIM_NAO },
    { id: "divisao_anos", rotulo: "Divisão do valor por exercício", tipo: "area", se: { campo: "plurianual", em: ["sim"] } },
    { id: "origem", rotulo: "Origem do recurso", tipo: "opcao", opcoes: [["proprio", "Recurso próprio"], ["convenio", "Convênio"], ["transferencia", "Transferência"]] },
    { id: "convenio", rotulo: "Convênio ou transferência", tipo: "texto", se: { campo: "origem", em: ["convenio", "transferencia"] },
      ajuda: "Número do instrumento e regras específicas a observar." },
    { id: "cronograma", rotulo: "Cronograma de desembolso", tipo: "area", opcional: true, ajuda: "Quando os pagamentos devem ocorrer." },
    { id: "protocolo_contabilidade", rotulo: "Solicitação protocolada na Contabilidade", tipo: "texto",
      ajuda: "Nº e data do ofício ou do protocolo. Solicite com antecedência: esta etapa costuma ser o maior gargalo de prazo." },
    { id: "dotacao", rotulo: "Dotação indicada pela Contabilidade", tipo: "area", opcional: true,
      ajuda: "Órgão, unidade, funcional programática, natureza da despesa e fonte. Preencha quando a Contabilidade responder: sem ela o processo não é protocolado." },
  ],
  fiscal: [
    { id: "fiscal_nome", rotulo: "Fiscal do contrato", tipo: "texto", ajuda: "Nome completo do servidor indicado." },
    { id: "fiscal_matricula", rotulo: "Matrícula e cargo do fiscal", tipo: "texto" },
    { id: "fiscal_vinculo", rotulo: "Vínculo do fiscal", tipo: "opcao", opcoes: [["efetivo", "Servidor efetivo"], ["comissionado", "Cargo em comissão"], ["outro", "Outro"]],
      ajuda: "Preferencialmente servidor efetivo (art. 7º, I)." },
    { id: "fiscal_justificativa", rotulo: "Por que o fiscal não é servidor efetivo", tipo: "area", se: { campo: "fiscal_vinculo", em: ["comissionado", "outro"] } },
    { id: "fiscal_compatibilidade", rotulo: "Atribuições ou formação compatíveis com o objeto", tipo: "area" },
    { id: "substituto_nome", rotulo: "Fiscal substituto", tipo: "texto" },
    { id: "substituto_matricula", rotulo: "Matrícula e cargo do substituto", tipo: "texto" },
    { id: "gestor", rotulo: "Gestor do contrato indicado", tipo: "texto", opcional: true, ajuda: "Indicação para posterior designação formal pela autoridade competente." },
    { id: "declaracoes", rotulo: "Declarações", tipo: "marcas", opcoes: [
      ["sem_vinculo", "O fiscal e o substituto não têm vínculo com possíveis contratados (art. 7º, III)"],
      ["segregacao", "O fiscal não acumula funções mais suscetíveis a risco neste processo (art. 7º, § 1º)"],
    ] },
  ],
};

CAMPOS.protocolo = [
  { id: "responsavel", rotulo: "Responsável pelo encaminhamento", tipo: "texto", ajuda: "Nome e cargo de quem protocola em nome da Secretaria." },
  { id: "observacoes", rotulo: "Observações ao Departamento de Licitações", tipo: "area", opcional: true, ajuda: "Prazos, urgência ou informações úteis ao encaminhamento do processo." },
];

export const MARCAS_OBRIGATORIAS: Record<string, string[]> = { "fiscal.declaracoes": ["sem_vinculo", "segregacao"] };
