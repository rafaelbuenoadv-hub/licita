// Documento de Formalização da Demanda completo, montado sem IA com os campos do DFD, a verificação no PAC,
// os itens da Solicitação e o cadastro de secretários (nome, cargo e portaria do titular).
import { resumoDaInstrucao, complementosDaInstrucao, type DadosInstrucao } from "../shared/instrucao.js";
import { verificacaoPacDoProcesso } from "../shared/solicitacao.js";
import { q, q1 } from "./db.js";
import { secretariosDoProcesso } from "./portarias.js";
import { ehMunicipioIbaiti } from "./municipio-ibaiti.js";
import { quadroDeItens, totalDosItens, type ItemSolicitacao } from "../shared/solicitacao.js";
import { planejamentoDoProcesso } from "../shared/solicitacao.js";
import { reaisPorExtenso } from "../shared/extenso.js";
import { TIPOS, VIAS, type Tipo, type Valores, type Via } from "../shared/etapas.js";

interface Proc {
  id: number; orgao_id: number; tipo: Tipo; via: Via; objeto: string; protocolo: string; requisitante: string; areas_adicionais: string[];
  valor_estimado: number | null; ano: number; pca_item_id: number | null; classe?: string;
}
const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const real = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const txt = (v: Valores | undefined, k: string) => (typeof v?.[k] === "string" ? (v[k] as string).trim() : "");
const formatarCnpj = (c: string) => { const d = c.replace(/\D/g, ""); return d.length === 14 ? d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5") : c; };
const falta = (o: string) => `[[PREENCHER: ${o}]]`;
const celula = (t: string) => t.replace(/\s*\n\s*/g, " ").replace(/\|/g, "/").trim() || "—";

/** Linhas de assinatura: nome, cargo e portaria de nomeação (quando o responsável veio do cadastro de secretários). */
export function assinatura(responsavel: string, padrao: { nome: string; cargo: string }) {
  const [nome, resto] = responsavel.includes(" — ") ? responsavel.split(" — ", 2) : [responsavel || padrao.nome, padrao.cargo];
  const m = /^(.*?)\s*\(Portaria nº ([^)]+)\)\s*$/.exec(resto ?? "");
  return [`@ ${nome.trim()}`, (m ? m[1] : resto)?.trim() && `@ ${(m ? m[1] : resto)!.trim()}`, m && `@ Portaria de nomeação nº ${m[2].trim()}`].filter(Boolean).join("\n");
}

/**
 * Formalização de Demanda no padrão do Departamento de Licitações e Contratos de Ibaiti:
 * preâmbulo com a legislação aplicável, informações gerais (objeto, justificativa, secretarias contempladas,
 * estimativa de valor, necessidade do ETP e da matriz de riscos, soluções sugeridas, modalidade) e disposições finais.
 */
export async function documentoDfd(p: Proc, campos: Record<string, Valores>, autor: { nome: string; cargo: string }) {
  const dfd = campos.dfd ?? {};
  const [orgao, cad, solicitacoes] = await Promise.all([
    q1<{ nome: string; cnpj: string | null; municipio: string | null; uf: string | null }>("select nome, cnpj, municipio, uf from orgaos where id=$1", [p.orgao_id]),
    secretariosDoProcesso(p),
    q<DadosInstrucao>("select secretaria, referencia, nome_arquivo, objeto, justificativa, informacoes, itens, topicos_adicionais from solicitacoes_processo where processo_id=$1 order by id", [p.id]),
  ]);
  const instrucao = resumoDaInstrucao(solicitacoes);
  const complementos = complementosDaInstrucao(solicitacoes);
  const ibaiti = !!orgao && ehMunicipioIbaiti(orgao);
  const municipio = orgao?.municipio || (ibaiti ? "Ibaiti" : "");
  const titular = cad.secretarios[0];
  const itens = solicitacoes.flatMap((s) => s.itens ?? []).filter((i) => i.descricao?.trim());

  // Secretarias contempladas: o nome oficial do cadastro quando a área foi reconhecida.
  const areas = [...new Set([p.requisitante, ...p.areas_adicionais, ...solicitacoes.map((s) => s.secretaria)].map((a) => a.trim()).filter(Boolean))];
  const oficiais = [...new Set([...cad.secretarios.map((s) => `Secretaria Municipal de ${s.secretaria}`), ...cad.areasSemCadastro])];
  const contempladas = oficiais.length ? oficiais : areas;
  const lista = contempladas.length > 1 ? `${contempladas.slice(0, -1).join("; ")}; e ${contempladas.at(-1)}` : contempladas[0] ?? "";

  // Valor: o da pesquisa de preços, se já feita; senão, a estimativa preliminar das cotações da Solicitação.
  const doRelatorio = typeof campos.precos?.valor_total === "string" ? Number((campos.precos.valor_total as string).replace(/\./g, "").replace(",", ".")) : NaN;
  const preliminar = itens.length ? totalDosItens(itens) : p.valor_estimado;
  const valor = Number.isFinite(doRelatorio) && doRelatorio > 0 ? doRelatorio : preliminar;
  const textoValor = valor == null ? falta("valor estimado da contratação")
    : Number.isFinite(doRelatorio) && doRelatorio > 0
      ? `O valor estimado da contratação é de ${real(valor)} (${reaisPorExtenso(valor)}), conforme apurado no Relatório de Formação de Preços, considerando os valores unitários pesquisados e os quantitativos demandados pelo Município${municipio ? ` de ${municipio}` : ""}.`
      : `O valor estimado da contratação é de ${real(valor)} (${reaisPorExtenso(valor)}), conforme estimativa preliminar apurada nas cotações da instrução do processo, a ser confirmada no Relatório de Formação de Preços, considerando os quantitativos demandados pelo Município${municipio ? ` de ${municipio}` : ""}.`;

  const etp = txt(dfd, "etp") === "dispensado"
    ? "Por se tratar de obra ou serviço comum de engenharia, sem prejuízo técnico, a especificação do objeto constará do Termo de Referência ou do Projeto Básico, dispensada a elaboração de Estudo Técnico Preliminar (Lei nº 14.133/2021, art. 18, § 3º" + (ibaiti ? "; Decreto Municipal nº 2.533/2024, art. 8º" : "") + "), sem prejuízo da análise dos riscos inerentes à contratação."
    : "A fase preparatória do presente procedimento identificou considerações técnicas, operacionais e mercadológicas relevantes, as quais exigiram a elaboração de Estudo Técnico Preliminar, nos termos do § 1º do art. 18 da Lei nº 14.133/2021, bem como a análise dos riscos inerentes à contratação.";

  const objeto = txt(dfd, "objeto") || instrucao.objeto || p.objeto;
  // Nas disposições finais vai o objeto resumido do processo (o do DFD costuma ser longo).
  const resumo = p.objeto.length && p.objeto.length < objeto.length ? p.objeto : objeto;
  const responsavel = txt(dfd, "responsavel");
  const [nomeResp, restoResp] = responsavel.includes(" — ") ? responsavel.split(" — ", 2) : [responsavel, ""];
  const cargoResp = restoResp.replace(/\s*\(Portaria.*$/, "") || (titular ? `Secretário(a) Municipal de ${titular.secretaria}` : "");
  const portaria = /\(Portaria nº ([^)]+)\)/.exec(restoResp)?.[1] ?? titular?.portaria ?? "";
  const hoje = new Date();
  const decretos = ibaiti ? ", bem como dos Decretos Municipais nº 2.532/2024, nº 2.533/2024, nº 2.548/2024 e nº 2.549/2024" : ", bem como da legislação municipal aplicável";

  const l: string[] = [
    "# DEPARTAMENTO DE LICITAÇÕES E CONTRATOS",
    "# FORMALIZAÇÃO DE DEMANDA",
    `Protocolo ${p.protocolo} · Exercício ${p.ano}`,
    `Em análise do objeto a ser contratado, averiguando também a metodologia aplicada nas últimas aquisições, atendendo ainda de maneira ampla à aplicação da Constituição Federal, da Lei Federal nº 14.133/2021, da Lei Complementar nº 123/2006, alterada pela Lei Complementar nº 147/2014${decretos}, a presente formalização de demanda tem por finalidade assegurar a seleção da proposta mais vantajosa para a Administração Pública, inclusive no que se refere ao ciclo de vida do objeto, nos termos do art. 11, inciso I, da Lei nº 14.133/2021.`,
    "## INFORMAÇÕES GERAIS",
    "**Objeto:**", objeto,
    "**Justificativa da necessidade:**", txt(dfd, "justificativa") || instrucao.justificativa || falta("justificativa da necessidade"),
  ];
  if (txt(dfd, "quantidade") && (!itens.length || txt(dfd, "quantidade") !== instrucao.quantidades)) l.push("**Quantidade estimada:**", txt(dfd, "quantidade"));
  if (itens.length) l.push("**Itens da contratação:**", quadroDeItens(itens));
  if (txt(dfd, "data_pretendida")) l.push("**Prazo pretendido:**", txt(dfd, "data_pretendida"));
  l.push(
    "**Secretarias Contempladas:**", lista ? `${lista}.` : falta("secretarias contempladas"),
    "**Estimativa de Valor:**", textoValor,
    "**Necessidade do Estudo Técnico Preliminar e Matriz de riscos:**", etp,
    "**Soluções sugeridas para contratação:**", txt(dfd, "solucoes") || falta("soluções sugeridas para a contratação"),
    "**Modalidade de Contratação:**", txt(dfd, "modalidade") || falta("modalidade de contratação"),
    "**Disposições finais:**",
    `Com a ${/^(aquisi|contrata|presta|loca|execu|ades)/i.test(resumo) ? "" : "contratação de "}${resumo.charAt(0).toLowerCase()}${resumo.slice(1).replace(/[.;]\s*$/, "")}${txt(dfd, "modalidade") ? `, por meio de ${txt(dfd, "modalidade").charAt(0).toLowerCase()}${txt(dfd, "modalidade").slice(1)}` : ""}, a Administração Pública Municipal busca atender de forma eficiente e tempestiva às demandas das secretarias contempladas, assegurando a continuidade dos serviços públicos.`,
    "A presente contratação demonstra o comprometimento do Município com o planejamento, a economicidade, a transparência e a boa gestão dos recursos públicos, promovendo a utilização racional dos instrumentos legais disponíveis e a observância dos princípios que regem a Administração Pública.",
    `${municipio ? `${municipio}, ` : ""}${hoje.getDate()} de ${MESES[hoje.getMonth()]} de ${hoje.getFullYear()}.`,
    [`@ ${nomeResp || titular?.nome || autor.nome}`, `@ ${cargoResp || autor.cargo}`, portaria && `@ Portaria de nomeação nº ${portaria}`].filter((x) => x && x !== "@ ").join("\n"),
  );
  const pac = verificacaoPacDoProcesso(campos);
  return [...l.slice(0, -2), pac ? `## Verificação no Plano Anual de Contratações (PAC)\n\n${pac}` : "", complementos, ...l.slice(-2)].filter(Boolean).join("\n\n");
}
