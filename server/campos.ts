// Campos de preenchimento das etapas: gravação, sugestões com o que o processo já tem e documento montado sem IA.
import { q, q1 } from "./db.js";
import { secretariosDoProcesso } from "./portarias.js";
import { documentoDfd } from "./modelo-dfd.js";
import { totalDosItens, type ItemSolicitacao } from "../shared/solicitacao.js";
import {
  ETAPAS, TIPOS, VIAS, camposFaltando, camposVisiveis, itemDosCampos, itensDe, textoDoCampo, temValor,
  type Etapa, type Tipo, type Valores, type Via,
} from "../shared/etapas.js";

interface Proc {
  id: number; orgao_id: number; tipo: Tipo; via: Via; objeto: string; protocolo: string; requisitante: string; areas_adicionais: string[];
  valor_estimado: number | null; ano: number; pca_item_id: number | null;
}

export async function camposDo(processoId: number): Promise<Record<string, Valores>> {
  const rows = await q<{ etapa: string; valores: Valores }>("select etapa, valores from campos_etapa where processo_id=$1", [processoId]);
  return Object.fromEntries(rows.map((r) => [r.etapa, r.valores]));
}

/** Marca (ou desmarca) o item automático "Campos da etapa preenchidos" conforme os campos gravados. */
export async function sincronizarCampos(p: Proc, usuario: number, etapas: Etapa[] = ETAPAS, campos?: Record<string, Valores>) {
  const todos = campos ?? await camposDo(p.id);
  for (const e of etapas) {
    const item = itemDosCampos(e);
    if (!item || !itensDe(e, p).includes(item)) continue;
    const completo = e.id === "solicitacao"
      ? Boolean((await q1<{ n: number }>("select count(*)::int as n from solicitacoes_processo where processo_id=$1", [p.id]))?.n)
      : camposFaltando(e, p, todos[e.id] ?? {}).length === 0;
    if (completo) await q("insert into checagens (processo_id, item, usuario_id) values ($1,$2,$3) on conflict do nothing", [p.id, item.id, usuario]);
    else await q("delete from checagens where processo_id=$1 and item=$2", [p.id, item.id]);
  }
}

const moeda = (v: number | null | undefined) => v == null ? "" : v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const primeiro = (...xs: (string | undefined | null)[]) => xs.find((x) => x?.trim())?.trim() ?? "";

/**
 * Valores sugeridos para os campos ainda em branco, tirados do que o processo já registra:
 * item do PAC, cadastro de secretários, solicitações, itens e orçamentos, e campos de etapas anteriores.
 */
export async function sugestoesDosCampos(p: Proc, campos: Record<string, Valores>): Promise<Record<string, Valores>> {
  const [itemPca, cad, solicitacoes, nOrcamentos] = await Promise.all([
    p.pca_item_id ? q1<{ descricao: string; ordem_oficial: number | null; periodo_oficial: string | null; prioridade: string | null; modalidade_prevista: string | null }>(
      "select descricao, ordem_oficial, periodo_oficial, prioridade, modalidade_prevista from pca_itens where id=$1 and orgao_id=$2", [p.pca_item_id, p.orgao_id]) : undefined,
    secretariosDoProcesso(p),
    q<{ objeto: string; justificativa: string; itens: ItemSolicitacao[] }>("select objeto, justificativa, itens from solicitacoes_processo where processo_id=$1 order by id", [p.id]),
    q1<{ n: number }>("select count(*)::int as n from orcamentos where processo_id=$1", [p.id]),
  ]);
  const titular = cad.secretarios[0];
  const contato = titular ? await q1<{ email: string; telefone: string }>(
    "select email, telefone from secretarios where orgao_id=$1 and secretaria=$2 limit 1", [p.orgao_id, titular.secretaria]) : undefined;
  const itens = solicitacoes.flatMap((s) => s.itens ?? []);
  const total = totalDosItens(itens) ?? p.valor_estimado;
  const v = (etapa: string, campo: string) => { const x = campos[etapa]?.[campo]; return typeof x === "string" ? x : ""; };
  const pacTexto = itemPca
    ? `Contratação prevista no PAC ${p.ano}${itemPca.ordem_oficial ? `, item ${itemPca.ordem_oficial}` : ""}: ${itemPca.descricao}${itemPca.periodo_oficial ? `. Início previsto: ${itemPca.periodo_oficial}` : ""}.`
    : v("pac", "justificativa_inclusao") ? `Contratação fora do PAC, com justificativa de inclusão extraordinária: ${v("pac", "justificativa_inclusao")}` : "";
  const quantidades = itens.length
    ? itens.map((i) => `- ${i.descricao}: ${i.quantidade ?? "?"} ${i.unidade || ""}`.trimEnd()).join("\n")
    : "";
  const valorTexto = total != null ? `Valor estimado: R$ ${moeda(total)}${itens.length ? `, conforme os preços unitários dos ${itens.length} itens da solicitação` : ""}.` : "";
  const sug: Record<string, Valores> = {
    pac: {
      consta: p.pca_item_id ? "sim" : "",
      item_pac: itemPca ? `${itemPca.ordem_oficial ? `Item ${itemPca.ordem_oficial} — ` : ""}${itemPca.descricao}` : "",
      mes_planejado: itemPca?.periodo_oficial ?? "",
    },
    dfd: {
      responsavel: titular ? `${titular.nome} — Secretário(a) Municipal de ${titular.secretaria}${titular.portaria ? ` (Portaria nº ${titular.portaria})` : ""}` : "",
      contato: [contato?.telefone, contato?.email].filter(Boolean).join(" · "),
      objeto: primeiro(...solicitacoes.map((s) => s.objeto), p.objeto),
      justificativa: primeiro(solicitacoes.map((s) => s.justificativa).filter((x) => x?.trim()).join("\n\n"), v("pac", "justificativa_inclusao")),
      quantidade: quantidades,
      data_pretendida: v("pac", "mes_planejado") ? `Início previsto no PAC: ${v("pac", "mes_planejado")}.` : "",
    },
    etp: {
      i: primeiro(v("dfd", "justificativa"), ...solicitacoes.map((s) => s.justificativa)),
      ii: pacTexto,
      iv: primeiro(v("dfd", "quantidade"), quantidades),
      vi: valorTexto,
    },
    precos: {
      parametros: (nOrcamentos?.n ?? 0) > 0 && p.tipo !== "obra" ? ["fornecedores"] : [],
      valor_total: total != null ? moeda(total) : "",
    },
    tr: p.tipo === "obra" ? {} : {
      a: [primeiro(v("dfd", "objeto"), p.objeto), v("etp", "iv")].filter(Boolean).join("\n"),
      b: v("etp", "i") ? `Conforme o Estudo Técnico Preliminar: ${v("etp", "i")}` : "",
      c: v("etp", "vii"),
      d: v("etp", "iii"),
      i: [v("precos", "valor_total") && `Valor estimado: R$ ${v("precos", "valor_total")}.`, v("precos", "memoria")].filter(Boolean).join("\n"),
    },
    dot: {
      valor_total: primeiro(v("precos", "valor_total"), total != null ? moeda(total) : ""),
    },
    fiscal: {},
    protocolo: { responsavel: v("dfd", "responsavel") },
  };
  // Só sugere onde o campo ainda está em branco.
  for (const [etapa, valores] of Object.entries(sug)) {
    for (const [campo, valor] of Object.entries(valores)) {
      if (!temValor(valor) || temValor(campos[etapa]?.[campo])) delete valores[campo];
    }
  }
  return sug;
}

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const dataExtenso = (d = new Date()) => `${d.getDate()} de ${MESES[d.getMonth()]} de ${d.getFullYear()}`;

/** Documento da etapa montado só com os campos preenchidos, no formato das minutas (# título, ## seções, @ assinatura). */
export async function documentoDosCampos(p: Proc, e: Etapa, campos: Record<string, Valores>, autor: { nome: string; cargo: string }) {
  if (e.id === "dfd") return documentoDfd(p, campos, autor);
  const valores = campos[e.id] ?? {};
  const orgao = await q1<{ nome: string; municipio: string | null; uf: string | null }>("select nome, municipio, uf from orgaos where id=$1", [p.orgao_id]);
  const titulo = (e.doc ?? e.nome).replace(/\s*\(.*\)$/, "").toUpperCase();
  const areas = [p.requisitante, ...p.areas_adicionais].map((a) => a.trim()).filter(Boolean);
  const l = [
    `# ${titulo}`,
    `Protocolo ${p.protocolo} · ${orgao?.nome ?? ""}`,
    `Objeto: ${p.objeto}`,
    `Secretaria demandante: ${areas.join("; ") || "não informada"} · ${TIPOS[p.tipo]} · ${VIAS[p.via]}`,
  ];
  let n = 0;
  for (const c of camposVisiveis(e, p, valores)) {
    const texto = textoDoCampo(c, valores[c.id]);
    if (!texto || c.foraDoDocumento) continue;
    l.push(`## ${++n}. ${c.rotulo.replace(/^[a-z]\)\s*|^[IVX]+\s*—\s*/, "")}`, texto);
  }
  if (e.id === "protocolo") {
    l.push(`## ${++n}. Encaminhamento`,
      "Encaminha-se o processo, com os documentos da fase interna (verificação no PAC, solicitação das secretarias, DFD, ETP, pesquisa de preços e memória de cálculo, Termo de Referência ou Projeto Básico com análise de riscos, indicação de dotação orçamentária e indicação do fiscal do contrato), ao Departamento de Licitações e Contratos, para as providências da fase externa.");
  }
  if (e.id === "dot") {
    l.push(`## ${++n}. Pedido`, "Solicita-se à Contabilidade a reserva e a indicação da dotação orçamentária compatível com o objeto, para as parcelas que vencem no exercício (Lei nº 14.133/2021, art. 150).");
  }
  const resp = (etapa: string) => typeof campos[etapa]?.responsavel === "string" ? campos[etapa].responsavel as string : "";
  const assinante = e.id === "dfd" || e.id === "pac" ? primeiro(resp("dfd"), autor.nome) : e.id === "protocolo" ? primeiro(resp("protocolo"), resp("dfd"), autor.nome) : autor.nome;
  const [nome, cargo] = assinante.includes(" — ") ? assinante.split(" — ") : [assinante, autor.cargo];
  l.push(`${orgao?.municipio ?? ""}${orgao?.uf ? `/${orgao.uf}` : ""}, ${dataExtenso()}.`.replace(/^, /, ""));
  l.push([`@ ${nome}`, cargo && `@ ${cargo}`].filter(Boolean).join("\n"));
  return l.join("\n\n");
}

/** Campos de todas as etapas em texto, para o contexto da IA. */
export function camposParaIA(p: Proc, campos: Record<string, Valores>) {
  const l: string[] = [];
  for (const e of ETAPAS) {
    const v = campos[e.id];
    if (!v) continue;
    const linhas = camposVisiveis(e, p, v).map((c) => [c, textoDoCampo(c, v[c.id])] as const).filter(([, t]) => t);
    if (!linhas.length) continue;
    l.push(`${e.nome}:`, ...linhas.map(([c, t]) => `- ${c.rotulo}: ${t.replace(/\n/g, "\n  ")}`));
  }
  return l.join("\n");
}
