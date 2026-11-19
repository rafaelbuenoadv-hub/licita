// "Concluir e avançar": confere a etapa, aponta o que falta e prepara a peça seguinte com o que já foi informado.
// Tudo aqui é regra fixa; funciona mesmo com a IA indisponível.
import { q, q1 } from "./db.js";
import { secretariosDoProcesso } from "./portarias.js";
import { consultarPca, type ItemConsultaPca } from "../shared/consulta-pca.js";
import { ETAPAS, camposFaltando, itensDe, pendencias, temValor, type Checks, type Etapa, type Tipo, type Via, type Valores } from "../shared/etapas.js";

export interface Pendencia {
  codigo: string;
  texto: string;
  /** Onde o usuário resolve: campo dos dados do processo, item da conferência, minuta da etapa ou Configurações. */
  onde: "dados" | "conferencia" | "minuta" | "config" | "campos";
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

export async function conferirEtapa(p: Proc, e: Etapa, checks: Checks, campos: Record<string, Valores>): Promise<Pendencia[]> {
  const l: Pendencia[] = [];
  const v = campos[e.id] ?? {};
  for (const c of camposFaltando(e, p, v)) {
    l.push({ codigo: "campo", texto: c.tipo === "marcas" && e.id === "fiscal" ? `Marque as declarações sobre o fiscal: ${c.rotulo.toLowerCase()}.` : `Preencha o campo "${c.rotulo}".`, onde: "campos", alvo: c.id, bloqueia: true });
  }
  if (e.id === "pac") {
    if (v.consta === "sim" && !p.pca_item_id) {
      const itens = await q<ItemConsultaPca>("select id, descricao, tipo, tipo_oficial, ordem_oficial, pagina_oficial from pca_itens where orgao_id=$1 and ano=$2", [p.orgao_id, p.ano]);
      const { vinculo, candidatos } = consultarPca(p.objeto, p.tipo, itens);
      const rotulo = (i: ItemConsultaPca) => `${i.ordem_oficial ? `item ${i.ordem_oficial}${i.pagina_oficial ? `, página ${i.pagina_oficial}` : ""} — ` : ""}${i.descricao}`;
      const opcoes = vinculo ? [vinculo] : candidatos;
      l.push({
        codigo: "pca", onde: "dados", alvo: "pca_item_id", bloqueia: true,
        texto: `Vincule o item do PAC ${p.ano} nos dados do processo.${opcoes.length === 1 ? ` Sugestão: ${rotulo(opcoes[0])}.` : opcoes.length ? ` Itens parecidos: ${opcoes.map(rotulo).join("; ")}.` : ""}`,
      });
    }
  }
  if (e.id === "dfd") {
    if (!p.requisitante.trim()) l.push({ codigo: "area", texto: "Informe a área requisitante nos dados do processo.", onde: "dados", alvo: "requisitante", bloqueia: true });
    if (p.valor_estimado == null) l.push({ codigo: "valor", texto: "Informe o valor estimado preliminar nos dados do processo.", onde: "dados", alvo: "valor", bloqueia: true });
    const cad = await secretariosDoProcesso(p);
    for (const a of cad.areasSemCadastro) l.push({ codigo: "secretario", texto: `Não há secretário cadastrado para "${a}". Cadastre em Configurações ou ajuste o nome da área.`, onde: "config", bloqueia: true });
    for (const s of cad.secretarios) if (!s.portaria) l.push({ codigo: "portaria", texto: `Falta a portaria de nomeação de ${s.nome} (${s.secretaria}). Cadastre em Configurações, no cadastro de secretários.`, onde: "config", bloqueia: true });
  }
  if (e.id === "tr" && v.matriz_obrigatoria === "sim" && v.matriz !== "sim") {
    l.push({ codigo: "matriz", texto: "Em obra de grande vulto ou contratação integrada ou semi-integrada a matriz de alocação de riscos é obrigatória (art. 22, § 3º).", onde: "campos", alvo: "matriz", bloqueia: true });
  }
  if (e.id === "protocolo") {
    if (!temValor(campos.dot?.dotacao)) l.push({ codigo: "dotacao", texto: "A dotação indicada pela Contabilidade ainda não foi registrada na etapa \"Dotação orçamentária\". Sem ela o processo não é protocolado.", onde: "campos", alvo: "dotacao", bloqueia: true });
    const pedidos = await q1<{ n: number }>("select count(*)::int as n from solicitacoes_processo where processo_id=$1", [p.id]);
    if (!pedidos?.n) l.push({ codigo: "solicitacao", texto: "Registre a Solicitação das secretarias, com os itens e os orçamentos, antes de protocolar.", onde: "campos", alvo: "solicitacao", bloqueia: true });
  }
  if (e.id === "fiscal") {
    const nome = (x: unknown) => typeof x === "string" ? x.trim().toLowerCase() : "";
    if (nome(v.fiscal_nome) && nome(v.fiscal_nome) === nome(v.substituto_nome)) l.push({ codigo: "substituto", texto: "O fiscal substituto deve ser outra pessoa.", onde: "campos", alvo: "substituto_nome", bloqueia: true });
  }
  if (e.modelo) {
    const m = await minutaDe(p.id, e.id);
    if (!m) { if (!e.docOpcional) l.push({ codigo: "minuta", texto: `O documento da etapa (${e.doc ?? e.nome}) ainda não foi montado. Use "Montar com os campos" ou a IA.`, onde: "minuta", bloqueia: true }); }
    else {
      const n = pendencias(m.texto).length;
      if (n) l.push({ codigo: "campos", texto: `A minuta tem ${n} ${n === 1 ? "campo pendente" : "campos pendentes"} (trechos realçados em amarelo).`, onde: "minuta", bloqueia: true });
    }
  }
  for (const i of itensDe(e, p)) if (!checks[i.id] && !i.auto) l.push({ codigo: "item", texto: `Conferência obrigatória: ${i.texto}`, onde: "conferencia", alvo: i.id, bloqueia: true });
  return l;
}

export const proximaEtapa = (e: Etapa) => ETAPAS[ETAPAS.indexOf(e) + 1] as Etapa | undefined;
