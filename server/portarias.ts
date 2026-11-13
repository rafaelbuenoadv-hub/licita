import { aplicarPendencias, pendencias } from "../shared/etapas.js";
import { q } from "./db.js";

const normalizar = (texto: string) => texto.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase()
  .replace(/[^a-z0-9]+/g, " ").trim();
const area = (texto: string) => normalizar(texto).replace(/^secretaria(?: municipal)? (?:d[aeo] )?/, "");

interface Signatario {
  secretaria: string;
  nome: string;
  portaria: string | null;
  fonte_portaria: string;
}

export async function secretariosDoProcesso(p: { id: number; orgao_id: number; requisitante: string; areas_adicionais: string[] }) {
  const solicitacoes = await q<{ secretaria: string }>(
    "select distinct secretaria from solicitacoes_processo where processo_id=$1", [p.id],
  );
  const areas = new Set([p.requisitante, ...p.areas_adicionais, ...solicitacoes.map((s) => s.secretaria)].map(area).filter(Boolean));
  const cadastrados = await q<Signatario>("select secretaria, nome, portaria, fonte_portaria from secretarios where orgao_id=$1", [p.orgao_id]);
  const secretarios = cadastrados.filter((s) => areas.has(area(s.secretaria)));
  return { secretarios, todosIdentificados: areas.size === secretarios.length };
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
