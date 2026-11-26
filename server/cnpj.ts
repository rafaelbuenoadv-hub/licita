// Consulta de fornecedor pelo CNPJ, sem chave de acesso:
// - cadastro na Receita Federal (situação cadastral, porte, CNAE, endereço) pela BrasilAPI;
// - certidão consolidada do TCU (Licitantes Inidôneos/TCU, CNIA/CNJ, CEIS e CNEP/Portal da Transparência).
// Os endereços podem ser trocados por variável de ambiente (testes ou espelho).
import { ErroHttp } from "./erros.js";
import type { ConsultaCnpj, CertidaoSancao } from "../shared/cnpj.js";

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === "object" ? (v as Obj) : {});
const str = (v: unknown) => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "");
const URL_CADASTRO = () => process.env.CNPJ_API_URL ?? "https://brasilapi.com.br/api/cnpj/v1/";
const URL_TCU = () => process.env.TCU_CERTIDOES_URL ?? "https://certidoes-apf.apps.tcu.gov.br/api/rest/publico/certidoes/";

export function soDigitosCnpj(cnpj: string) {
  const d = cnpj.replace(/\D/g, "");
  if (d.length !== 14 || /^(\d)\1+$/.test(d)) throw new ErroHttp(400, "Informe um CNPJ com 14 dígitos.");
  const dv = (base: string) => {
    const pesos = base.length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const r = [...base].reduce((s, c, i) => s + Number(c) * pesos[i], 0) % 11;
    return r < 2 ? 0 : 11 - r;
  };
  if (dv(d.slice(0, 12)) !== Number(d[12]) || dv(d.slice(0, 13)) !== Number(d[13])) throw new ErroHttp(400, "CNPJ inválido (dígito verificador não confere).");
  return d;
}

async function buscar(url: string, carregar: typeof fetch) {
  const r = await carregar(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(25_000) });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json() as Promise<unknown>;
}

/** Situação da certidão: "Nada consta" ou "Consta" (sanção ou registro), lendo os rótulos que o TCU usa. */
function situacaoDe(c: Obj): CertidaoSancao["situacao"] {
  const t = [c.situacao, c.codigoSituacao, c.resultado, c.descricaoSituacao, c.descricao].map(str).join(" ").toUpperCase().replace(/_/g, " ");
  if (/NADA CONSTA|NAO CONSTA|NÃO CONSTA|NEGATIVA/.test(t)) return "nada_consta";
  if (/CONSTA|POSITIVA/.test(t)) return "consta";
  return "indefinida";
}

export function lerCadastro(dados: unknown): ConsultaCnpj["cadastro"] {
  const d = obj(dados);
  if (!str(d.cnpj) && !str(d.razao_social)) return null;
  return {
    razao_social: str(d.razao_social), nome_fantasia: str(d.nome_fantasia),
    situacao: str(d.descricao_situacao_cadastral) || str(d.situacao_cadastral),
    data_situacao: str(d.data_situacao_cadastral) || null,
    porte: str(d.porte) || str(d.descricao_porte),
    simples: d.opcao_pelo_simples === true ? true : d.opcao_pelo_simples === false ? false : null,
    cnae: [str(d.cnae_fiscal), str(d.cnae_fiscal_descricao)].filter(Boolean).join(" — "),
    municipio: [str(d.municipio), str(d.uf)].filter(Boolean).join("/"),
    abertura: str(d.data_inicio_atividade) || null,
  };
}

export function lerCertidoesTcu(dados: unknown): { certidoes: CertidaoSancao[]; codigo: string | null; pdf: string | null } {
  const d = obj(dados);
  const lista = Array.isArray(d.certidoes) ? d.certidoes : Array.isArray(dados) ? (dados as unknown[]) : [];
  const certidoes = lista.map((x) => {
    const c = obj(x);
    return {
      cadastro: [str(c.emissor), str(c.tipo) || str(c.nome) || str(c.cadastro)].filter(Boolean).join(" — ") || "Certidão",
      situacao: situacaoDe(c),
      observacao: str(c.observacao) || str(c.descricao) || null,
    };
  });
  return { certidoes, codigo: str(d.codigoControle) || str(d.codigo) || null, pdf: str(d.certidaoPDF) || str(d.pdf) || null };
}

/** Consulta cadastro e sanções. Uma fonte fora do ar não impede a outra: o erro vai em `falhas`. */
export async function consultarCnpj(cnpj: string, carregar: typeof fetch = fetch): Promise<ConsultaCnpj> {
  const d = soDigitosCnpj(cnpj);
  const falhas: string[] = [];
  const [cad, tcu] = await Promise.all([
    buscar(URL_CADASTRO() + d, carregar).catch((e) => { falhas.push(`Cadastro da Receita indisponível (${(e as Error).message}).`); return undefined; }),
    buscar(`${URL_TCU()}${d}?seEmitirPDF=false`, carregar).catch((e) => { falhas.push(`Certidão consolidada do TCU indisponível (${(e as Error).message}).`); return undefined; }),
  ]);
  const cadastro = cad === undefined ? null : lerCadastro(cad);
  if (cad === null) falhas.push("CNPJ não encontrado no cadastro da Receita.");
  const sancoes = tcu ? lerCertidoesTcu(tcu) : null;
  return {
    cnpj: d, consultado_em: new Date().toISOString(), cadastro,
    certidoes: sancoes?.certidoes ?? null, codigo_tcu: sancoes?.codigo ?? null, falhas,
  };
}

/** Emite a certidão consolidada do TCU em PDF (para juntar ao processo). */
export async function certidaoTcuPdf(cnpj: string, carregar: typeof fetch = fetch) {
  const d = soDigitosCnpj(cnpj);
  let dados: unknown;
  try { dados = await buscar(`${URL_TCU()}${d}?seEmitirPDF=true`, carregar); }
  catch (e) { throw new ErroHttp(502, `O serviço de certidões do TCU não respondeu (${(e as Error).message}). Tente de novo em instantes.`); }
  const { pdf, certidoes, codigo } = lerCertidoesTcu(dados);
  if (!pdf) throw new ErroHttp(502, "O TCU não devolveu o PDF da certidão. Emita pelo site do TCU e anexe o arquivo.");
  return { pdf: Buffer.from(pdf, "base64"), certidoes, codigo };
}
