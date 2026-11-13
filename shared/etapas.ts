// Regras da fase preparatória (Lei nº 14.133/2021), compartilhadas entre servidor e interface.
// Cada item de conferência pode depender do tipo de objeto e da forma de contratação.

export type Tipo = "bens" | "servicos" | "obra";
export type Via = "licitacao" | "dispensa" | "inexigibilidade";
export type Papel = "admin" | "requisitante" | "contratacao" | "juridico" | "autoridade" | "fiscal";
export type Condicao = "obra" | "naoobra" | "lic" | "disp" | "inex" | "direta" | "naoinex";

export interface Item { id: string; texto: string; base?: string; cond?: Condicao }
export interface Etapa {
  id: string;
  nome: string;
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

export const ETAPAS: Etapa[] = [
  {
    id: "dfd", nome: "Solicitação", doc: "Documento de Formalização da Demanda (DFD)",
    oque: "A área que precisa da contratação formaliza o pedido. É o documento que abre o processo e alimenta o plano de contratações anual.",
    base: [{ rotulo: "Art. 12, VII", url: U.a12 }, { rotulo: "Art. 72, I", url: U.a72 }, { rotulo: "Art. 18, caput", url: U.a18 }],
    papeis: ["requisitante", "contratacao"],
    itens: [
      it("d1", "DFD assinado pela área requisitante, e não só pelo setor de licitações", "Art. 72, I"),
      it("d2", "Objeto descrito com clareza, sem marca nem direcionamento"),
      it("d3", "Justificativa da necessidade apoiada em dados; \"urgência\" só aparece se for o fundamento da contratação"),
      it("d4", "Quantidade e valor estimado preliminar informados"),
      it("d5", "Prazo de entrega ou de execução de que a área precisa"),
      it("d6", "Previsão no plano de contratações anual indicada, ou inclusão fora do plano justificada", "Art. 18, caput e § 1º, II"),
      it("d7", "Toda afirmação de fato tem documento nos autos que a comprove"),
      it("d8", "Estudos feitos antes do pedido formal foram ratificados pela área requisitante, se houver"),
    ],
    atencao: [
      "Número do processo igual em todas as peças (solicitação, sistema de compras, capa).",
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
    id: "etp", nome: "Estudo Técnico Preliminar", doc: "Estudo Técnico Preliminar (ETP)",
    oque: "Mostra o problema a resolver e a melhor solução, para que se avalie a viabilidade técnica e econômica. Os incisos I, IV, VI, VIII e XIII são obrigatórios; os demais podem faltar, desde que a ausência seja justificada.",
    base: [{ rotulo: "Art. 18, §§ 1º e 2º", url: U.a18 }],
    papeis: ["requisitante", "contratacao"],
    itens: [
      it("e1", "Descrição da necessidade, com os dados que a quantificam", "§ 1º, I (obrigatório)"),
      it("e2", "Previsão no plano de contratações anual, ou justificativa", "§ 1º, II"),
      it("e3", "Requisitos da contratação", "§ 1º, III"),
      it("e4", "Estimativa das quantidades com memória de cálculo", "§ 1º, IV (obrigatório)"),
      it("e5", "Levantamento de mercado: alternativas comparadas e justificativa da escolhida", "§ 1º, V"),
      it("e6", "Estimativa do valor com preços unitários e memória de cálculo", "§ 1º, VI (obrigatório)"),
      it("e7", "Descrição da solução como um todo", "§ 1º, VII"),
      it("e8", "Justificativa do parcelamento ou do não parcelamento", "§ 1º, VIII (obrigatório)"),
      it("e9", "Resultados pretendidos", "§ 1º, IX"),
      it("e10", "Providências antes do contrato, inclusive designação e capacitação de fiscal e gestor", "§ 1º, X"),
      it("e11", "Contratações correlatas ou interdependentes", "§ 1º, XI"),
      it("e12", "Impactos ambientais e medidas mitigadoras", "§ 1º, XII"),
      it("e13", "Conclusão sobre a viabilidade da contratação", "§ 1º, XIII (obrigatório)"),
      it("e14", "Assinado por quem elaborou; a fiscalização ficará com outro servidor", "Art. 7º, § 1º"),
    ],
    atencao: [
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
    id: "riscos", nome: "Análise de riscos", doc: "Mapa de riscos",
    oque: "Lista o que pode comprometer a seleção do fornecedor e a execução do contrato, com probabilidade, impacto e a ação prevista para cada risco.",
    base: [{ rotulo: "Art. 18, X", url: U.a18 }, { rotulo: "Art. 72, I", url: U.a72 }],
    papeis: ["requisitante", "contratacao"],
    itens: [
      it("r1", "Riscos da fase de seleção (procedimento deserto ou fracassado, sobrepreço, impugnação)", "Art. 18, X"),
      it("r2", "Riscos da execução (atraso, qualidade, acidente, inadimplência)", "Art. 18, X"),
      it("r3", "Probabilidade e impacto classificados para cada risco"),
      it("r4", "Ação preventiva ou de contingência, com responsável"),
      it("r5", "Riscos próprios de obra: projeto incompleto, condições do solo, licenciamento", "", "obra"),
    ],
    atencao: [
      "Riscos genéricos copiados de outro processo costumam ser devolvidos; cada risco deve ter relação com o objeto.",
      "A ação prevista para o risco precisa aparecer também no Termo de Referência ou no contrato.",
    ],
    modelo: `MAPA DE RISCOS
Identificação do processo e do procedimento
1. Objeto
2. Riscos da fase de planejamento e seleção (quadro Risco | Probabilidade | Impacto | Ação preventiva | Ação de contingência | Responsável)
3. Riscos da execução contratual (mesmo quadro)
4. Conclusão
Local e data; assinaturas`,
  },
  {
    id: "precos", nome: "Orçamento estimado", doc: "Relatório de formação de preços e declaração de veracidade",
    oque: "Define o valor estimado da contratação. Bens e serviços usam pesquisa de preços; obras e serviços de engenharia usam sistema oficial de custos, com BDI.",
    base: [{ rotulo: "Art. 18, IV", url: U.a18 }, { rotulo: "Art. 23" }, { rotulo: "Art. 72, II e VII", url: U.a72 }, { rotulo: "Art. 75, § 1º", url: U.a75p1 }],
    papeis: ["contratacao", "requisitante"],
    itens: [
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
    id: "tr", nome: "Termo de Referência", doc: "Termo de Referência (ou projeto básico)",
    oque: "Define o objeto e todas as condições da contratação: execução, fiscalização, pagamento, recebimento, seleção do fornecedor e habilitação. Vira anexo do edital.",
    base: [{ rotulo: "Art. 18, II, III e IX", url: U.a18 }, { rotulo: "Art. 6º, XXIII" }, { rotulo: "Art. 7º, § 1º", url: U.a7 }, { rotulo: "Art. 25, § 7º", url: U.a25 }],
    papeis: ["requisitante", "contratacao"],
    itens: [
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
    ],
    atencao: [
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
12. DISPOSIÇÕES GERAIS
Subitens numerados (1.1, 1.2...). Local e data; assinatura do titular da área requisitante; "Aprovo o presente Termo de Referência" e assinatura da autoridade`,
  },
  {
    id: "dot", nome: "Dotação e designações", doc: null,
    oque: "Confirma que há recurso no orçamento, na classificação certa, e que os agentes do processo foram designados por ato publicado.",
    base: [{ rotulo: "Art. 72, IV", url: U.a72 }, { rotulo: "Art. 18, caput", url: U.a18 }, { rotulo: "Art. 7º", url: U.a7 }],
    papeis: ["contratacao", "autoridade"],
    itens: [
      it("o1", "Declaração de adequação orçamentária com a dotação e a demonstração de saldo", "Art. 72, IV"),
      it("o2", "Natureza da despesa compatível com o objeto (obra é despesa de capital, não serviço de terceiros)"),
      it("o3", "Agente de contratação ou comissão designado por ato publicado", "Arts. 7º e 8º"),
      it("o4", "Gestor, fiscal e fiscal substituto designados por portaria, respeitada a segregação de funções", "Art. 7º, § 1º; art. 117"),
    ],
    atencao: [
      "Conferir o número da lei ou do decreto citado nas portarias de designação.",
      "A classificação da despesa deve ser a mesma na declaração da Contabilidade, no TR e no contrato.",
    ],
    modelo: null,
  },
  {
    id: "edital", nome: "Edital e contrato", doc: "Edital (ou aviso de contratação direta) e minuta de contrato",
    oque: "Reúne as regras da disputa e do contrato. Na dispensa eletrônica, o instrumento é o aviso de contratação direta; na inexigibilidade não há disputa, e a etapa trata da minuta de contrato.",
    base: [{ rotulo: "Art. 25", url: U.a25 }, { rotulo: "Art. 18, V, VI e VIII", url: U.a18 }, { rotulo: "Art. 72", url: U.a72 }],
    papeis: ["contratacao"],
    itens: [
      it("ed1", "Instrumento completo: objeto, convocação, julgamento, habilitação, recursos, penalidades, fiscalização e gestão, entrega e pagamento", "Art. 25, caput", "naoinex"),
      it("ed2", "Modalidade, critério de julgamento e modo de disputa motivados", "Art. 18, VIII", "lic"),
      it("ed3", "Instrumento com vocabulário de contratação direta, sem termos de pregão", "", "disp"),
      it("ed4", "Minuta de contrato como anexo", "Art. 18, VI"),
      it("ed5", "Termo de Referência anexado na mesma versão e data da pasta de planejamento"),
      it("ed6", "Exigências de habilitação idênticas às do Termo de Referência", "", "naoinex"),
      it("ed7", "Índice de reajuste com data-base vinculada ao orçamento estimado", "Art. 25, § 7º"),
      it("ed8", "Tratamento de microempresas e empresas de pequeno porte previsto", "LC 123/2006", "naoinex"),
      it("ed9", "Remissões a itens e anexos conferidas; numeração dos subitens sem saltos"),
      it("ed10", "Autos numerados, sem folhas faltando"),
    ],
    atencao: [
      "Edital juntado sem algumas folhas é ressalva frequente nos pareceres.",
      "Remissão a anexo que não existe ou que mudou de número.",
      "Cláusulas de contrato de compra coladas em contrato de obra (recebimento, reajuste, multa).",
    ],
    modelo: `EDITAL (ou AVISO DE CONTRATAÇÃO DIRETA)
Preâmbulo (órgão, procedimento, fundamento, data e plataforma da sessão)
1. Objeto
2. Participação
3. Esclarecimentos e impugnação
4. Proposta
5. Lances
6. Julgamento
7. Habilitação
8. Recurso
9. Tratamento de microempresas e empresas de pequeno porte
10. Adjudicação e homologação
11. Sanções
12. Disposições gerais
Relação de anexos (Termo de Referência; modelos de declaração; minuta de contrato)
Local e data; assinatura da autoridade ou do agente de contratação`,
  },
  {
    id: "parecer", nome: "Parecer jurídico", doc: "Relatório de saneamento (resposta ao parecer)",
    oque: "O órgão jurídico faz o controle prévio de legalidade. Se o parecer devolver o processo em diligência, cada ressalva recebe uma providência e um documento, reunidos no relatório de saneamento.",
    base: [{ rotulo: "Art. 53", url: U.a53 }, { rotulo: "Art. 72, III", url: U.a72 }],
    papeis: ["juridico", "contratacao"],
    itens: [
      it("j1", "Autos completos e numerados enviados ao órgão jurídico", "Art. 53, caput"),
      it("j2", "Parecer jurídico emitido e juntado", "Art. 53; § 4º na contratação direta"),
      it("j3", "Cada ressalva e recomendação respondida com providência e documento (ou parecer sem ressalvas)"),
      it("j4", "Peças retificadas substituídas em todos os lugares em que aparecem"),
      it("j5", "Análise complementar concluída, sem ressalva pendente"),
    ],
    atencao: [
      "Responder ressalva por ressalva, na ordem do parecer, indicando as folhas do documento juntado.",
      "Peça retificada deve dizer qual versão substitui e em atendimento a qual item do parecer.",
      "Registrar em separado as decisões de mérito tomadas pela Administração.",
    ],
    modelo: `RELATÓRIO DE SANEAMENTO
Resposta à diligência do Parecer Jurídico nº ...
Identificação do processo e do procedimento
Destinatário (órgão jurídico e parecerista)
Parágrafo de encaminhamento; objeto, valor estimado e fundamento
1. Ressalvas obstativas (quadro Nº | Ressalva | Providência adotada | Documento juntado (fls.))
2. Recomendações não obstativas (quadro Nº | Recomendação | Providência adotada | Documento)
3. Decisões de mérito adotadas pela Administração (alíneas)
4. Pedido (análise complementar)
Local e data; assinaturas do setor de licitações e da área requisitante`,
  },
  {
    id: "pub", nome: "Autorização e publicação", doc: "Extrato para publicação",
    oque: "A autoridade autoriza e o instrumento é divulgado. Daqui em diante corre o prazo para propostas.",
    base: [{ rotulo: "Art. 53, § 3º", url: U.a53 }, { rotulo: "Art. 54", url: U.a54 }, { rotulo: "Art. 55", url: U.a55 }, { rotulo: "Art. 75, § 3º", url: U.a75p3 }, { rotulo: "Art. 72, VIII e parágrafo único", url: U.a72 }],
    papeis: ["autoridade", "contratacao"],
    itens: [
      it("u1", "Autoridade competente determinou a divulgação do edital", "Art. 53, § 3º", "lic"),
      it("u2", "Inteiro teor do edital e dos anexos divulgado no PNCP", "Art. 54, caput", "lic"),
      it("u3", "Extrato publicado no diário oficial e em jornal diário de grande circulação", "Art. 54, § 1º", "lic"),
      it("u4", "Todos os anexos disponíveis em sítio oficial na mesma data, sem exigir cadastro", "Art. 25, § 3º", "lic"),
      it("u5", "Data da sessão respeita o prazo mínimo para propostas, contado da divulgação", "Art. 55", "lic"),
      it("u6", "Aviso divulgado em sítio eletrônico oficial por no mínimo 3 dias úteis", "Art. 75, § 3º", "disp"),
      it("u7", "Razão da escolha do contratado e justificativa de preço nos autos", "Art. 72, VI e VII", "inex"),
      it("u8", "Comprovação de habilitação e qualificação mínima do contratado", "Art. 72, V", "inex"),
      it("u9", "Autorização da autoridade competente", "Art. 72, VIII", "direta"),
      it("u10", "Ato de autorização ou extrato do contrato divulgado em sítio eletrônico oficial", "Art. 72, parágrafo único", "direta"),
    ],
    atencao: [
      "Prazos mínimos do art. 55, em dias úteis: bens por menor preço ou maior desconto, 8; serviços comuns e obras comuns por menor preço, 10; serviços e obras especiais por menor preço, 25; técnica e preço, 35.",
      "Alteração do edital que afete as propostas reabre o prazo (art. 55, § 1º).",
    ],
    modelo: `EXTRATO PARA PUBLICAÇÃO
Órgão; procedimento e número; processo administrativo; objeto; valor estimado (se divulgado); fundamento legal; critério de julgamento; data, hora e plataforma da sessão ou período de envio de propostas; onde obter o inteiro teor; local, data e autoridade`,
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
