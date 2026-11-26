import { useState } from "react";
import { api } from "../api";
import { CERTIDOES_REGULARIDADE, formatarCnpj, resumoDaConsulta, type ConsultaCnpj as Consulta, type VerificacaoFornecedor } from "../../../shared/cnpj";

const dataBR = (iso?: string | null) => (iso ? iso.slice(0, 10).split("-").reverse().join("/") : "—");

/**
 * Consulta do fornecedor pelo CNPJ: cadastro na Receita (situação, porte, CNAE) e certidão consolidada do TCU
 * (inidôneos, CNIA, CEIS e CNEP). O resultado pode ser registrado na cotação e a certidão do TCU juntada ao processo.
 */
export function ConsultaCnpj({ cnpjInicial, fornecedor, processoId, registrar, aoJuntar }: {
  cnpjInicial?: string; fornecedor?: string; processoId: number;
  registrar?: (v: VerificacaoFornecedor, cnpj: string) => void; aoJuntar?: () => void;
}) {
  const [cnpj, setCnpj] = useState(cnpjInicial ?? "");
  const [r, setR] = useState<Consulta | null>(null);
  const [ocupado, setOcupado] = useState<"" | "consulta" | "tcu">("");
  const [msg, setMsg] = useState("");
  const consultar = async () => {
    setOcupado("consulta"); setMsg(""); setR(null);
    try { setR(await api.get<Consulta>(`/cnpj/${cnpj.replace(/\D/g, "")}`)); }
    catch (e) { setMsg(e instanceof Error ? e.message : "Não foi possível consultar."); }
    finally { setOcupado(""); }
  };
  const juntarTcu = async () => {
    setOcupado("tcu"); setMsg("");
    try {
      const j = await api.post<{ nome: string }>(`/processos/${processoId}/certidao-tcu`, { cnpj, fornecedor: r?.cadastro?.razao_social || fornecedor || "" });
      setMsg(`Certidão juntada ao processo: ${j.nome}`); aoJuntar?.();
    } catch (e) { setMsg(e instanceof Error ? e.message : "Não foi possível emitir a certidão."); }
    finally { setOcupado(""); }
  };
  const ativa = r?.cadastro && /^ativa$/i.test(r.cadastro.situacao);
  const consta = r?.certidoes?.filter((c) => c.situacao === "consta") ?? [];
  return (
    <section className="orc-bloco consulta-cnpj">
      <h3 className="orc-tit">Consulta do fornecedor (CNPJ)</h3>
      <div className="tools">
        <input aria-label="CNPJ" value={cnpj} onChange={(e) => setCnpj(e.target.value)} placeholder="00.000.000/0000-00" maxLength={20} />
        <button type="button" className="btn" disabled={!!ocupado || cnpj.replace(/\D/g, "").length !== 14} onClick={consultar}>{ocupado === "consulta" ? "Consultando…" : "Consultar"}</button>
      </div>
      {r && <div className="stack small">
        {r.cadastro ? <div>
          <strong>{r.cadastro.razao_social}</strong>{r.cadastro.nome_fantasia && ` (${r.cadastro.nome_fantasia})`} — CNPJ {formatarCnpj(r.cnpj)}<br />
          Situação na Receita: <strong className={ativa ? "ok" : "perigo"}>{r.cadastro.situacao || "—"}</strong>{r.cadastro.data_situacao && ` desde ${dataBR(r.cadastro.data_situacao)}`}
          {" · "}Porte: {r.cadastro.porte || "—"}{r.cadastro.simples != null && ` · Simples: ${r.cadastro.simples ? "sim" : "não"}`}<br />
          Atividade principal: {r.cadastro.cnae || "—"} · {r.cadastro.municipio}
        </div> : null}
        {r.certidoes && <div>
          <strong>Certidão consolidada do TCU:</strong>{" "}
          {consta.length ? <span className="perigo">consta registro em {consta.map((c) => c.cadastro).join(", ")}</span> : <span className="ok">nada consta</span>}
          <ul>{r.certidoes.map((c, i) => <li key={i}>{c.cadastro}: {c.situacao === "nada_consta" ? "nada consta" : c.situacao === "consta" ? "CONSTA" : "verificar"}{c.observacao && c.situacao !== "nada_consta" ? ` — ${c.observacao}` : ""}</li>)}</ul>
        </div>}
        {r.falhas.map((f, i) => <p key={i} className="aviso-anexo">{f}</p>)}
        <div className="tools">
          {registrar && <button type="button" className="btn pri" onClick={() => { registrar(resumoDaConsulta(r), formatarCnpj(r.cnpj)); setMsg("Consulta registrada na cotação. Salve os itens para gravar."); }}>Registrar na cotação</button>}
          <button type="button" className="btn" disabled={!!ocupado} onClick={juntarTcu}>{ocupado === "tcu" ? "Emitindo…" : "Emitir certidão do TCU e juntar ao processo"}</button>
        </div>
      </div>}
      {msg && <p className="small" role="status">{msg}</p>}
      <details className="small"><summary>Certidões de regularidade (emissão no site oficial)</summary>
        <p className="muted">Estas certidões exigem verificação no próprio site do órgão emissor. Emita, confira a validade e anexe o PDF ao processo.</p>
        <ul>{CERTIDOES_REGULARIDADE.map((c) => <li key={c.id}>{c.url ? <a href={c.url} target="_blank" rel="noopener noreferrer">{c.nome}</a> : `${c.nome}: no site da prefeitura do fornecedor`}</li>)}</ul>
      </details>
    </section>
  );
}
