// Documento de Formalização da Demanda completo, montado sem IA com os campos do DFD, a verificação no PAC,
// os itens da Solicitação e o cadastro de secretários (nome, cargo e portaria do titular).
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
const celula = (t: string) => t.replace(/\s*\n\s*/g, " ").replace(/\|/g, "/").trim() || "—";

/** Linhas de assinatura: nome, cargo e portaria de nomeação (quando o responsável veio do cadastro de secretários). */
export function assinatura(responsavel: string, padrao: { nome: string; cargo: string }) {
  const [nome, resto] = responsavel.includes(" — ") ? responsavel.split(" — ", 2) : [responsavel || padrao.nome, padrao.cargo];
  const m = /^(.*?)\s*\(Portaria nº ([^)]+)\)\s*$/.exec(resto ?? "");
  return [`@ ${nome.trim()}`, (m ? m[1] : resto)?.trim() && `@ ${(m ? m[1] : resto)!.trim()}`, m && `@ Portaria de nomeação nº ${m[2].trim()}`].filter(Boolean).join("\n");
}

export async function documentoDfd(p: Proc, campos: Record<string, Valores>, autor: { nome: string; cargo: string }) {
  const dfd = campos.dfd ?? {}, pac = campos.pac ?? {};
  const [orgao, cad, solicitacoes, itemPca] = await Promise.all([
    q1<{ nome: string; cnpj: string | null; municipio: string | null; uf: string | null }>("select nome, cnpj, municipio, uf from orgaos where id=$1", [p.orgao_id]),
    secretariosDoProcesso(p),
    q<{ secretaria: string; itens: ItemSolicitacao[] }>("select secretaria, itens from solicitacoes_processo where processo_id=$1 order by id", [p.id]),
    p.pca_item_id ? q1<{ ano: number; descricao: string; ordem_oficial: number | null; periodo_oficial: string | null; prioridade: string | null; modalidade_prevista: string | null }>(
      "select ano, descricao, ordem_oficial, periodo_oficial, prioridade, modalidade_prevista from pca_itens where id=$1", [p.pca_item_id]) : undefined,
  ]);
  const ibaiti = !!orgao && ehMunicipioIbaiti(orgao);
  const titular = cad.secretarios[0];
  const areas = [...new Set([p.requisitante, ...p.areas_adicionais, ...solicitacoes.map((s) => s.secretaria)].map((a) => a.trim()).filter(Boolean))];
  const itens = solicitacoes.flatMap((s) => s.itens ?? []).filter((i) => i.descricao?.trim());
  const total = totalDosItens(itens) ?? p.valor_estimado;
  const nCotacoes = itens.reduce((n, i) => n + (i.cotacoes?.filter((c) => c.valor_unitario != null).length ?? 0), 0);
  const responsavel = txt(dfd, "responsavel");
  const [nomeResp, restoResp] = responsavel.includes(" — ") ? responsavel.split(" — ", 2) : [responsavel, ""];
  const cargoResp = restoResp.replace(/\s*\(Portaria.*$/, "") || (titular ? `Secretário(a) Municipal de ${titular.secretaria}` : "");
  const portaria = /\(Portaria nº ([^)]+)\)/.exec(restoResp)?.[1] ?? titular?.portaria ?? "";
  const hoje = new Date();
  const local = `${orgao?.municipio ?? ""}${orgao?.uf ? `/${orgao.uf}` : ""}`;

  const l: string[] = [
    "# DOCUMENTO DE FORMALIZAÇÃO DA DEMANDA — DFD",
    `${orgao?.nome ?? ""}${orgao?.cnpj ? ` · CNPJ ${formatarCnpj(orgao.cnpj)}` : ""}`,
    `Protocolo ${p.protocolo} · Exercício ${p.ano}`,
    `Fundamento: Lei nº 14.133/2021, arts. 12, VII, e 18, caput e inciso I${ibaiti ? "; Decreto Municipal nº 2.533/2024, art. 6º" : ""}.`,

    "## 1. Identificação da área requisitante",
    [
      "| Informação | Dados |",
      "|---|---|",
      `| Secretaria requisitante | ${celula(areas[0] ?? "")} |`,
      ...(areas.length > 1 ? [`| Áreas participantes | ${celula(areas.slice(1).join("; "))} |`] : []),
      `| Responsável pela demanda | ${celula(nomeResp || autor.nome)} |`,
      `| Cargo | ${celula(cargoResp || autor.cargo)} |`,
      ...(portaria ? [`| Ato de nomeação | Portaria nº ${celula(portaria)} |`] : []),
      `| Contato | ${celula(txt(dfd, "contato"))} |`,
    ].join("\n"),

    "## 2. Objeto",
    txt(dfd, "objeto") || p.objeto,
    `Natureza do objeto: ${TIPOS[p.tipo]}. Forma de contratação prevista: ${VIAS[p.via]}.${p.classe?.trim() ? ` Ramo de atividade: ${p.classe.trim()}.` : ""}`,
    "A especificação descreve o objeto pelas suas características e desempenho, sem indicação de marca e sem direcionar a contratação a fornecedor determinado.",

    "## 3. Justificativa da necessidade",
    txt(dfd, "justificativa") || "[[PREENCHER: justificativa da necessidade — qual problema público a contratação resolve]]",
    "A necessidade acima, descrita sob a perspectiva do interesse público, fundamenta o início da fase preparatória da contratação (Lei nº 14.133/2021, art. 18, I) e servirá de base ao Estudo Técnico Preliminar.",

    "## 4. Quantidades e especificações",
    txt(dfd, "quantidade") || "[[PREENCHER: quantidade estimada e a lógica do cálculo]]",
  ];
  if (itens.length) l.push(quadroDeItens(itens));
  l.push("As quantidades acima correspondem à necessidade estimada para o período indicado, conforme a memória de cálculo informada pela área requisitante.");

  l.push("## 5. Estimativa preliminar do valor");
  if (total != null) {
    l.push(`Valor total estimado preliminar: **${real(total)}** (${reaisPorExtenso(total)}).`,
      nCotacoes
        ? `Estimativa apurada a partir de ${nCotacoes} ${nCotacoes === 1 ? "cotação ou referência registrada" : "cotações e referências registradas"} na Solicitação. O valor definitivo será fixado na pesquisa de preços, com memória de cálculo (Lei nº 14.133/2021, art. 23).`
        : "Estimativa preliminar informada pela área requisitante. O valor definitivo será fixado na pesquisa de preços, com memória de cálculo (Lei nº 14.133/2021, art. 23).");
  } else l.push("[[PREENCHER: valor estimado preliminar]]");

  l.push("## 6. Prazo pretendido", txt(dfd, "data_pretendida") || "[[PREENCHER: quando o objeto é necessário e por quê]]");

  l.push("## 7. Alinhamento com o Plano Anual de Contratações");
  const plano = planejamentoDoProcesso(campos);
  if (itemPca) {
    l.push(`A contratação está prevista no Plano Anual de Contratações de ${itemPca.ano}${itemPca.ordem_oficial ? `, item ${itemPca.ordem_oficial}` : ""} — ${itemPca.descricao}${itemPca.periodo_oficial ? `, com início previsto para ${itemPca.periodo_oficial}` : ""}${itemPca.prioridade ? ` (prioridade ${itemPca.prioridade})` : ""}${itemPca.modalidade_prevista ? `, modalidade prevista: ${itemPca.modalidade_prevista}` : ""}.`);
    if (txt(pac, "no_prazo") === "nao" && txt(pac, "motivo_prazo")) l.push(`Alteração do cronograma previsto: ${txt(pac, "motivo_prazo")}`);
  } else l.push(plano || "[[PREENCHER: item do PAC ou justificativa da inclusão extraordinária]]");

  l.push("## 8. Próximas etapas da fase preparatória",
    [
      "a) Estudo Técnico Preliminar, com a análise das alternativas e a viabilidade da contratação (art. 18, § 1º);",
      "b) Pesquisa de preços e memória de cálculo do valor estimado (art. 23);",
      `c) ${p.tipo === "obra" ? "Projeto Básico" : "Termo de Referência"}, com a análise de riscos (art. 6º, ${p.tipo === "obra" ? "XXV" : "XXIII"}, e art. 18, X);`,
      "d) Indicação da dotação orçamentária (art. 150);",
      "e) Indicação do fiscal do contrato (arts. 7º e 117).",
    ].join("\n"));

  l.push("## 9. Declarações da área requisitante",
    [
      "a) As informações deste documento correspondem à necessidade real da Secretaria e são de sua responsabilidade;",
      "b) A demanda não foi fracionada para fugir da modalidade de licitação adequada ao valor total;",
      "c) A especificação não indica marca nem contém exigências desnecessárias que restrinjam a competição.",
    ].join("\n"));

  l.push(`${local}${local ? ", " : ""}${hoje.getDate()} de ${MESES[hoje.getMonth()]} de ${hoje.getFullYear()}.`);
  l.push([`@ ${nomeResp || autor.nome}`, `@ ${cargoResp || autor.cargo}`, portaria && `@ Portaria de nomeação nº ${portaria}`].filter((x) => x && x !== "@ ").join("\n"));
  return l.join("\n\n");
}
