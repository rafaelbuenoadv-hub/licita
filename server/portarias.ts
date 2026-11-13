import { aplicarPendencias, pendencias } from "../shared/etapas.js";
import { ehMunicipioIbaiti } from "./municipio-ibaiti.js";
import { q, q1 } from "./db.js";

const normalizar = (texto: string) => texto.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase()
  .replace(/[^a-z0-9]+/g, " ").trim();
const area = (texto: string) => normalizar(texto).replace(/^secretaria(?: municipal)? (?:d[aeo] )?/, "");

interface Signatario {
  secretaria: string;
  nome: string;
  portaria: string | null;
  fonte_portaria: string;
}

const aliasesIbaiti: Record<string, string[]> = {
  administracao: ["semad"],
  "agricultura pecuaria meio ambiente e turismo": ["agricultura", "sapmat", "agricultura meio ambiente e turismo"],
  "assistencia social": ["seas", "sasmidir", "assistencia social da mulher da pessoa idosa da pessoa com deficiencia e da igualdade racial"],
  "assuntos institucionais": ["seai"],
  "cultura esporte e lazer": ["cultura", "esporte cultura e lazer", "sece"],
  educacao: ["seduc"],
  financas: ["sefi"],
  "obras viacao e servicos urbanos": ["obras", "sovsu"],
  "planejamento e orcamento": ["planejamento", "sempo"],
  saude: ["sesa", "semusa"],
  "trabalho e emprego": ["smte"],
};

export async function secretariosDoProcesso(p: { id: number; orgao_id: number; requisitante: string; areas_adicionais: string[] }) {
  const [solicitacoes, cadastrados, orgao] = await Promise.all([
    q<{ secretaria: string }>("select distinct secretaria from solicitacoes_processo where processo_id=$1", [p.id]),
    q<Signatario>("select secretaria, nome, portaria, fonte_portaria from secretarios where orgao_id=$1 order by id", [p.orgao_id]),
    q1<{ nome: string; cnpj: string | null }>("select nome, cnpj from orgaos where id=$1", [p.orgao_id]),
  ]);
  const ibaiti = !!orgao && ehMunicipioIbaiti(orgao);
  const procurar = (texto: string) => {
    const chave = area(texto);
    const exatos = cadastrados.filter((s) => area(s.secretaria) === chave);
    if (exatos.length === 1) return exatos[0];
    if (exatos.length || !ibaiti) return undefined;
    const candidatos = cadastrados.filter((s) => {
      const pasta = area(s.secretaria);
      return Object.entries(aliasesIbaiti).some(([oficial, aliases]) => {
        const nomes = [oficial, ...aliases];
        return nomes.includes(pasta) && (nomes.includes(chave) || aliases.some((sigla) => chave === `${oficial} ${sigla}`));
      });
    });
    return candidatos.length === 1 ? candidatos[0] : undefined;
  };

  const areas = [p.requisitante, ...p.areas_adicionais, ...solicitacoes.map((s) => s.secretaria)]
    .map((a) => a.trim()).filter(Boolean).flatMap((a) => procurar(a) ? [a] : a.split(/[;\n]+/).map((x) => x.trim()).filter(Boolean));
  const secretarios = new Set<Signatario>();
  const areasSemCadastro = new Map<string, string>();
  for (const nome of areas) {
    const titular = procurar(nome);
    if (titular) secretarios.add(titular);
    else areasSemCadastro.set(area(nome), nome);
  }
  return { secretarios: [...secretarios], todosIdentificados: !areasSemCadastro.size, areasSemCadastro: [...areasSemCadastro.values()] };
}

type CadastroProcesso = Awaited<ReturnType<typeof secretariosDoProcesso>>;

export function sugestoesPortaria(texto: string, { secretarios, todosIdentificados }: CadastroProcesso) {
  return pendencias(texto).flatMap(({ i, rotulo, trecho }) => {
    const campo = normalizar(rotulo);
    const linha = normalizar(trecho.replace("▮", ""));
    const ref = ` ${campo} ${linha} `;
    if (!/\bportaria\b/.test(ref)) return [];
    if (/\b(fiscal|gestor|agente|pregoeiro|comissao|equipe|designacao|delegacao|substituicao|ordenador)\b/.test(ref)) return [];
    const menciona = secretarios.filter((s) => {
      const pasta = area(s.secretaria);
      return ref.includes(` ${normalizar(s.nome)} `) || ref.includes(` ${pasta} `);
    });
    const claro = /\b(nomeacao|secretari[oa])\b/.test(ref) || menciona.length > 0;
    if (!claro) return [];
    const generico = /^(?:preencher )?(?:numero (?:da )?)?portaria(?: de nomeacao)?(?: d[oa] secretari[oa](?: municipal| requisitante)?)?$/.test(campo);
    const linhaGenerica = /^(?:portaria(?: de nomeacao)?(?: n[oa]?)?)?$/.test(linha);
    const nomeacaoGenerica = linhaGenerica && (generico || (campo === "numero" && /portaria de nomeacao/.test(linha)));
    const candidatos = menciona.length ? menciona : todosIdentificados && nomeacaoGenerica ? secretarios : [];
    if (candidatos.length !== 1 || !candidatos[0].portaria) return [];
    const s = candidatos[0];
    return [{ i, valor: s.portaria!, fonte: `Cadastro de secretários · ${s.nome}`, falta: "" }];
  });
}

export function preencherPortarias(texto: string, cadastro: CadastroProcesso) {
  return aplicarPendencias(texto, Object.fromEntries(sugestoesPortaria(texto, cadastro).map((s) => [s.i, s.valor]))).texto;
}

const tituloDfd = "## Titulares das áreas requisitantes";

export function inserirTitularesDfd(texto: string, cadastro: CadastroProcesso) {
  if (!cadastro.secretarios.length || texto.split("\n").some((linha) => linha.trim() === tituloDfd)) return texto;
  const linhas = cadastro.secretarios.map((s) =>
    `${s.secretaria} — ${s.nome}. Portaria de nomeação nº ${s.portaria || `[[PREENCHER: portaria de nomeação — ${s.secretaria}]]`}.`);
  const base = texto.trim() || "# DOCUMENTO DE FORMALIZAÇÃO DA DEMANDA";
  const assinatura = base.search(/^\s*@ /m);
  const antes = assinatura < 0 ? base : base.slice(0, assinatura).trimEnd();
  const depois = assinatura < 0 ? "" : base.slice(assinatura).trimStart();
  return [antes, [tituloDfd, ...linhas].join("\n"), depois].filter(Boolean).join("\n\n");
}
