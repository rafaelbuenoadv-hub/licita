// Documentos completos da fase interna, montados sem IA com os campos das etapas, os itens da Solicitação,
// o PAC e o cadastro de secretários: ETP, relatório de pesquisa de preços e Termo de Referência / Projeto Básico.
import { resumoDaInstrucao, complementosDaInstrucao, type DadosInstrucao } from "../shared/instrucao.js";
import { q, q1 } from "./db.js";
import { secretariosDoProcesso } from "./portarias.js";
import { ehMunicipioIbaiti } from "./municipio-ibaiti.js";
import { analiseCriticaDosPrecos, SEM_DESCARTES, FONTES_COTACAO, CRITERIOS_PRECO, planejamentoDoProcesso, quadroDeItens, totalDosItens, type ItemSolicitacao } from "../shared/solicitacao.js";
import { reaisPorExtenso } from "../shared/extenso.js";
import { ETAPAS, TIPOS, VIAS, textoDoCampo, type Tipo, type Valores, type Via } from "../shared/etapas.js";

interface Proc {
  id: number; orgao_id: number; tipo: Tipo; via: Via; objeto: string; protocolo: string; requisitante: string; areas_adicionais: string[];
  valor_estimado: number | null; ano: number; pca_item_id: number | null; classe?: string;
}
type Autor = { nome: string; cargo: string };
const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const real = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const celula = (t: string) => t.replace(/\s*\n\s*/g, " ").replace(/\|/g, "/").trim() || "—";
const brData = (iso?: string) => (iso ? iso.split("-").reverse().join("/") : "—");
const falta = (o: string) => `[[PREENCHER: ${o}]]`;

/** Texto de um campo da etapa (opções e marcas viram os rótulos). */
function campo(campos: Record<string, Valores>, etapa: string, id: string) {
  const c = ETAPAS.find((e) => e.id === etapa)?.campos.find((x) => x.id === id);
  return c ? textoDoCampo(c, campos[etapa]?.[id]) : "";
}

async function contexto(p: Proc, campos: Record<string, Valores>, autor: Autor) {
  const [orgao, cad, solicitacoes, autoridades] = await Promise.all([
    q1<{ nome: string; cnpj: string | null; municipio: string | null; uf: string | null }>("select nome, cnpj, municipio, uf from orgaos where id=$1", [p.orgao_id]),
    secretariosDoProcesso(p),
    q<DadosInstrucao>("select secretaria, referencia, nome_arquivo, objeto, justificativa, informacoes, itens, topicos_adicionais from solicitacoes_processo where processo_id=$1 order by id", [p.id]),
    q<{ nome: string; cargo: string }>("select nome, cargo from usuarios where orgao_id=$1 and ativo and 'autoridade' = any(papeis) order by id", [p.orgao_id]),
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
    autoridade: autoridades.length === 1 ? autoridades[0] : null,
    instrucao: resumoDaInstrucao(solicitacoes), complementos: complementosDaInstrucao(solicitacoes), orgao, ibaiti: !!orgao && ehMunicipioIbaiti(orgao), itens, areas, requisitante, autor,
    total: itens.length ? totalDosItens(itens) : p.valor_estimado,
    data: `${local}${local ? ", " : ""}${hoje.getDate()} de ${MESES[hoje.getMonth()]} de ${hoje.getFullYear()}.`,
  };
}
type Ctx = Awaited<ReturnType<typeof contexto>>;

/** Cabeçalho no mesmo padrão da Formalização de Demanda: título, protocolo e preâmbulo. */
function cabecalho(titulo: string, p: Proc, _c: Ctx, preambulo: string) {
  return [`# ${titulo}`, `Protocolo ${p.protocolo} · Exercício ${p.ano}`, preambulo];
}
/** Lista em alíneas (a, b, c…), uma por linha; a última termina em ponto. */
const alineas = (itens: string[]) => itens.map((x, i) => {
  const t = x.replace(/^-\s*/, "").replace(/[.;]\s*$/, "");
  return `${String.fromCharCode(97 + i)}) ${t}${i === itens.length - 1 ? "." : ";"}`;
}).join("\n");
const secao = (n: number | string, titulo: string) => `## ${n}. ${titulo.toLocaleUpperCase("pt-BR").replace(/\bART\. /g, "art. ")}`;
const listaDeSecretarias = (areas: string[]) => (areas.length > 1 ? `${areas.slice(0, -1).join("; ")}; e ${areas.at(-1)}` : areas[0] ?? "");
const assinaturaRequisitante = (c: Ctx) =>
  [`@ ${c.requisitante.nome || c.autor.nome}`, `@ ${c.requisitante.cargo || c.autor.cargo}`, c.requisitante.portaria && `@ Portaria de nomeação nº ${c.requisitante.portaria}`].filter(Boolean).join("\n");
const assinaturaAutoridade = (c: Ctx) => (c.autoridade ? [`@ ${c.autoridade.nome}`, `@ ${c.autoridade.cargo || "Autoridade competente"}`].join("\n") : "@ Autoridade competente");
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
  const l = cabecalho("ESTUDO TÉCNICO PRELIMINAR", p, c,
    `O presente Estudo Técnico Preliminar, elaborado ${c.areas.length ? `pela ${listaDeSecretarias(c.areas)}` : "pela área requisitante"} nos termos do art. 18, § 1º, da Lei Federal nº 14.133/2021${c.ibaiti ? " e dos arts. 7º e 8º do Decreto Municipal nº 2.533/2024" : ""}, constitui a primeira etapa do planejamento da contratação. Tem por finalidade evidenciar o problema a ser resolvido e a melhor solução para atendê-lo, de modo a permitir a avaliação da viabilidade técnica e econômica da contratação e servir de base ao Termo de Referência.`);
  l.push(secao(1, "Informações gerais"),
    `**Objeto:** ${campo(campos, "dfd", "objeto") || c.instrucao.objeto || p.objeto}`,
    `**Natureza do objeto:** ${TIPOS[p.tipo]}.`,
    `**Forma de contratação prevista:** ${campo(campos, "dfd", "modalidade") || VIAS[p.via]}.`,
    `**Secretarias contempladas:** ${listaDeSecretarias(c.areas) || "—"}.`,
    `**Documento de origem:** Formalização de Demanda do protocolo ${p.protocolo}.`);
  INCISOS_ETP.forEach(([id, titulo, inciso], n) => {
    void inciso;
    l.push(secao(n + 2, titulo));
    let texto = etp(id);
    if (id === "i" && !texto) texto = c.instrucao.justificativa;
    if (id === "iv" && (!texto || texto === c.instrucao.quantidades) && c.itens.length) texto = "Os quantitativos estão discriminados no quadro a seguir.";
    if (id === "ii" && !texto) texto = planejamentoDoProcesso(campos);
    l.push(texto || falta(titulo.toLowerCase()));
    if (id === "iv" && c.itens.length) l.push(["| Item | Descrição | Un. | Qtd. |", "|:---:|---|:---:|---:|",
      ...c.itens.map((i, k) => `| ${k + 1} | ${celula(i.descricao)} | ${celula(i.unidade)} | ${i.quantidade == null ? "—" : i.quantidade.toLocaleString("pt-BR")} |`)].join("\n"));
    if (id === "vi" && c.total != null) l.push(`Valor total estimado: **${valorComExtenso(c.total)}**, conforme a pesquisa de preços que integra o processo (art. 23).`);
  });
  if (c.complementos) l.push(c.complementos);
  l.push(secao(15, "Responsáveis pela elaboração"),
    "O estudo foi elaborado pela área requisitante, com o apoio técnico necessário. A fiscalização do futuro contrato caberá a servidor distinto dos responsáveis pela elaboração deste estudo (art. 7º, § 1º, da Lei nº 14.133/2021).",
    c.data, assinaturaRequisitante(c));
  return l.join("\n\n");
}

/* ---------------- Pesquisa de preços ---------------- */
export async function documentoPrecos(p: Proc, campos: Record<string, Valores>, autor: Autor) {
  const c = await contexto(p, campos, autor);
  const obra = p.tipo === "obra";
  const pr = (id: string) => campo(campos, "precos", id);
  const l = cabecalho("RELATÓRIO DE FORMAÇÃO DE PREÇOS", p, c,
    `O presente relatório, elaborado nos termos do art. 23, ${obra ? "§ 2º" : "§ 1º"}, da Lei Federal nº 14.133/2021${c.ibaiti ? " e do art. 11 do Decreto Municipal nº 2.533/2024" : ""}, tem por finalidade fixar o valor estimado da contratação, compatível com os valores praticados pelo mercado, considerados os preços constantes de bancos de dados públicos e as quantidades a contratar, e registrar a memória de cálculo adotada.`);
  l.push(secao(1, "Objeto"), campo(campos, "dfd", "objeto") || c.instrucao.objeto || p.objeto);
  l.push(secao(2, "Secretarias contempladas"), `${listaDeSecretarias(c.areas) || "—"}.`);
  const parametros = pr(obra ? "parametros_obra" : "parametros");
  l.push(secao(3, `Parâmetros utilizados (art. 23, ${obra ? "§ 2º" : "§ 1º"})`), parametros || falta("parâmetros utilizados"));
  const unica = pr(obra ? "fonte_unica_obra" : "fonte_unica");
  if (unica) l.push(`Justificativa do uso de fonte única: ${unica}`);
  l.push(secao(4, "Data-base"), pr("data_base") ? `Os preços têm como data-base ${pr("data_base")}, que será adotada em todas as peças do processo.` : falta("data-base do orçamento"));
  l.push(secao(5, "Quadro comparativo de preços"));
  if (c.itens.length) l.push(quadroDeItens(c.itens, true, false).replace("Total estimado da solicitação", "Total estimado"));
  else l.push(falta("quadro de preços por item"));
  const fontes = c.itens.flatMap((i) => (i.cotacoes ?? []).filter((x) => x.valor_unitario != null));
  const vistas = new Map<string, (typeof fontes)[number]>();
  for (const f of fontes) if (!vistas.has(f.fornecedor)) vistas.set(f.fornecedor, f);
  if (vistas.size) {
    l.push(secao(6, "Fontes consultadas"), [
      "| Fonte | Tipo | Data da consulta | Referência | Comprovante |", "|---|---|:---:|---|:---:|",
      ...[...vistas.values()].map((f) => `| ${celula(f.fornecedor)} | ${FONTES_COTACAO[f.fonte ?? "fornecedor"]} | ${brData(f.consultado_em)} | ${celula(f.link ?? "")} | ${f.orcamento_id != null ? "Anexado" : "—"} |`),
    ].join("\n"));
  } else l.push(secao(6, "Fontes consultadas"), falta("fontes consultadas, com data e hora de acesso"));
  const criterio = c.itens.find((i) => i.criterio)?.criterio;
  l.push(secao(7, "Método de cálculo e memória"),
    `Método adotado: ${pr("metodo") || (criterio ? CRITERIOS_PRECO[criterio] : falta("método de cálculo"))}.`,
    pr("memoria") || falta("memória de cálculo"));
  const analise = analiseCriticaDosPrecos(c.itens);
  l.push(secao(8, "Análise crítica dos preços"), analise);
  const complemento = pr("analise_critica");
  if (complemento && complemento !== analise && !complemento.startsWith(SEM_DESCARTES) && !complemento.startsWith("Preços riscados no quadro comparativo")) l.push(`Análise complementar: ${complemento}`);
  if (obra) l.push(secao(9, "BDI e encargos sociais"), pr("bdi") || falta("BDI e encargos sociais"));
  const valorCampo = typeof campos.precos?.valor_total === "string" ? Number((campos.precos.valor_total as string).replace(/\./g, "").replace(",", ".")) : NaN;
  const valor = c.itens.length ? c.total : Number.isFinite(valorCampo) && valorCampo > 0 ? valorCampo : c.total;
  l.push(secao(obra ? 10 : 9, "Valor estimado da contratação"),
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
  const obra = p.tipo === "obra", bens = p.tipo === "bens";
  const tr = (id: string) => campo(campos, "tr", id);
  const nome = obra ? "Projeto Básico" : "Termo de Referência";
  const modalidade = campo(campos, "dfd", "modalidade") || VIAS[p.via];
  const l = cabecalho(nome.toUpperCase(), p, c,
    `O presente ${nome}, elaborado nos termos do art. 6º, inciso ${obra ? "XXV" : "XXIII"}, e do art. 18, incisos II e X, da Lei Federal nº 14.133/2021${c.ibaiti ? ", bem como do Decreto Municipal nº 2.533/2024" : ""}, reúne os elementos necessários e suficientes para caracterizar o objeto e orientar a seleção do fornecedor e a execução do contrato. Forma de contratação: ${modalidade}. Natureza do objeto: ${TIPOS[p.tipo]}.`);
  let n = 0;
  for (const [id, titulo] of obra ? ALINEAS_PB : ALINEAS_TR) {
    l.push(secao(++n, titulo), tr(id) || falta(titulo.toLowerCase()));
    if (id === "a" && c.itens.length) l.push(quadroDeItens(c.itens));
    if (id === "a" && c.total != null) l.push(`Valor máximo estimado: **${valorComExtenso(c.total)}**.`);
    if (id === "i" && c.total != null && !/R\$/.test(tr("i"))) l.push(`Valor total estimado: **${valorComExtenso(c.total)}**, conforme o Relatório de Formação de Preços (art. 23).`);
    if (id === "j" && typeof campos.dot?.dotacao === "string" && campos.dot.dotacao.trim()) l.push(`Dotação orçamentária: ${campos.dot.dotacao.trim()}`);
  }

  // Cláusulas padrão: parâmetros da etapa, com texto de partida quando em branco.
  const execucao = bens ? "entrega" : "execução";
  const ordem = bens ? "ordem de fornecimento" : "ordem de serviço";
  l.push(secao(++n, `Prazo e local de ${execucao}`),
    `O prazo de ${execucao} é de ${tr("prazo_execucao") || `até 15 (quinze) dias corridos, contados do recebimento da ${ordem}`}.`,
    `Local: ${tr("local_execucao") || `o indicado pela Secretaria requisitante na ${ordem}`}${bens ? ", em dias úteis e horário de expediente, correndo por conta da contratada as despesas de transporte, frete, carga e descarga" : ""}.`,
    `Os ${bens ? "produtos" : "serviços"} em desacordo com as especificações deverão ser ${bens ? "substituídos" : "refeitos"} no prazo de até 5 (cinco) dias úteis da notificação, sem ônus para o Município.`);
  l.push(secao(++n, "Obrigações da contratada"), alineas([
    `- Executar o objeto conforme as especificações, os prazos e as condições deste ${nome} e da proposta;`,
    `- Reparar, corrigir, remover ou substituir, às suas expensas, no todo ou em parte, o objeto em que se verificarem vícios, defeitos ou incorreções;`,
    "- Responsabilizar-se pelos encargos trabalhistas, previdenciários, fiscais e comerciais resultantes da execução do contrato (art. 121 da Lei nº 14.133/2021);",
    "- Manter, durante toda a execução, as condições de habilitação e qualificação exigidas na contratação;",
    "- Comunicar ao fiscal do contrato, por escrito, qualquer anormalidade que impeça ou atrase a execução, com os esclarecimentos necessários;",
    "- Responder pelos danos causados diretamente ao Município ou a terceiros, decorrentes de sua culpa ou dolo na execução do contrato;",
    "- Atender prontamente às solicitações do fiscal e do gestor do contrato.",
    ...(tr("obrigacoes_adicionais") ? tr("obrigacoes_adicionais").split(/\n+/).map((x) => x.replace(/^\s*(?:[-•]|[a-z]\))\s*/, "")).filter(Boolean) : []),
  ]));
  l.push(secao(++n, "Obrigações do contratante"), alineas([
    "- Emitir as ordens e prestar as informações e os esclarecimentos necessários à execução do objeto;",
    "- Acompanhar e fiscalizar a execução do contrato por meio do gestor e do fiscal designados (art. 117 da Lei nº 14.133/2021);",
    "- Notificar a contratada, por escrito, das falhas e irregularidades constatadas, fixando prazo para a correção;",
    "- Efetuar o pagamento nas condições e no prazo estabelecidos neste " + nome + ";",
    "- Aplicar as sanções cabíveis, assegurados o contraditório e a ampla defesa.",
  ]));
  l.push(secao(++n, "Recebimento do objeto"),
    bens
      ? "O objeto será recebido provisoriamente, no ato da entrega, para posterior verificação da conformidade com as especificações, e definitivamente, em até 10 (dez) dias úteis, após a verificação da qualidade e da quantidade e a consequente aceitação, mediante termo ou atesto na nota fiscal (art. 140, II, da Lei nº 14.133/2021)."
      : "O objeto será recebido provisoriamente pelo fiscal do contrato, mediante termo detalhado, quando verificado o cumprimento das exigências técnicas, e definitivamente pelo gestor do contrato, mediante termo que comprove o atendimento das exigências contratuais (art. 140, I, da Lei nº 14.133/2021).",
    "O recebimento provisório ou definitivo não exclui a responsabilidade civil pela solidez e segurança da obra ou serviço nem a responsabilidade ético-profissional pela perfeita execução do contrato.");
  l.push(secao(++n, "Condições de pagamento"),
    `O pagamento será efetuado em ${tr("prazo_pagamento") || "até 30 (trinta) dias, contados do atesto da nota fiscal"}, por meio de transferência bancária para conta indicada pela contratada, observada a ordem cronológica de pagamentos (art. 141 da Lei nº 14.133/2021).`,
    "A nota fiscal deverá vir acompanhada das provas de regularidade fiscal, trabalhista e com o FGTS. Havendo erro na nota fiscal ou circunstância que impeça a liquidação da despesa, o prazo de pagamento ficará suspenso até a regularização.");
  l.push(secao(++n, "Vigência e reajuste"),
    `A vigência será de ${tr("vigencia") || "12 (doze) meses, contados da assinatura do contrato"}, admitida a prorrogação nas hipóteses da Lei nº 14.133/2021.`,
    `Os preços serão fixos e irreajustáveis pelo prazo de 1 (um) ano, contado da data do orçamento estimado${tr("reajuste") ? `, após o qual poderão ser reajustados pelo índice ${tr("reajuste")}` : ""} (art. 25, § 7º, e art. 92, § 3º, da Lei nº 14.133/2021).`);
  l.push(secao(++n, "Garantia"),
    tr("garantia_objeto")
      ? `A contratada deverá garantir o objeto pelo prazo de ${tr("garantia_objeto")}, sem prejuízo da garantia legal prevista no Código de Defesa do Consumidor.`
      : "O objeto deverá observar, no mínimo, a garantia legal prevista no Código de Defesa do Consumidor (Lei nº 8.078/1990).",
    "Não será exigida garantia contratual (art. 96 da Lei nº 14.133/2021).");
  l.push(secao(++n, "Subcontratação"),
    campos.tr?.subcontratacao === "parcial"
      ? "Será admitida a subcontratação parcial do objeto, mediante prévia autorização do contratante, mantida a responsabilidade integral da contratada pela execução (art. 122 da Lei nº 14.133/2021)."
      : "Não será admitida a subcontratação do objeto.");
  l.push(secao(++n, "Sanções administrativas"),
    "A contratada que cometer as infrações previstas no art. 155 da Lei nº 14.133/2021 ficará sujeita às sanções de advertência, multa, impedimento de licitar e contratar e declaração de inidoneidade, previstas no art. 156, observados o contraditório, a ampla defesa e os critérios de dosimetria do mesmo artigo.",
    "O atraso injustificado na execução sujeitará a contratada à multa de mora de 0,5% (meio por cento) por dia sobre o valor da parcela em atraso, limitada a 10% (dez por cento), sem prejuízo das demais sanções (art. 162 da Lei nº 14.133/2021).");

  l.push(secao(++n, "Análise de riscos"), tr("riscos") || falta("análise de riscos"));
  if (campos.tr?.matriz === "sim") l.push(secao(++n, "Matriz de alocação de riscos"), tr("matriz_texto") || falta("matriz de alocação de riscos"));
  else if (campos.tr?.matriz === "nao") l.push("Não foi adotada matriz de alocação de riscos, facultativa para este objeto (art. 22 da Lei nº 14.133/2021).");

  // Coerência: só declara quando os valores das peças realmente batem.
  const numero = (x: unknown) => (typeof x === "string" && x.trim() ? Number(x.replace(/\./g, "").replace(",", ".")) : NaN);
  const valores = [c.total ?? NaN, numero(campos.precos?.valor_total), numero(campos.dot?.valor_total)].filter((x) => Number.isFinite(x) && x > 0);
  const divergente = valores.some((x) => Math.abs(x - valores[0]) > 0.01);
  l.push(secao(++n, "Disposições finais"),
    divergente
      ? `[[VERIFICAR: o valor estimado difere entre as peças do processo (${[...new Set(valores.map(real))].join(" × ")}); ajuste a pesquisa de preços ou a dotação antes de concluir]]`
      : `O objeto, as quantidades e o valor deste ${nome} correspondem aos da Formalização de Demanda, do Estudo Técnico Preliminar e do Relatório de Formação de Preços que integram o processo.`,
    "Os casos omissos serão resolvidos pela Administração, com base na Lei nº 14.133/2021 e na legislação municipal aplicável.");
  l.push(c.data, assinaturaRequisitante(c), `Aprovo o presente ${nome}.`, assinaturaAutoridade(c));
  return l.join("\n\n");
}
