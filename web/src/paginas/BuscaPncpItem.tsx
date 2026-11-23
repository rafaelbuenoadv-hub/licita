import { useEffect, useRef, useState } from "react";
import { SITUACOES_PNCP, UFS_PNCP, type ResultadoPncp } from "../../../shared/pncp";
import { api, brl } from "../api";
import { pncpDate, pncpProcedure } from "../comp/comprovantePncp";

export function BuscaPncpItem({ descricao, ocupado, usar, aberto = false }: {
  descricao: string;
  ocupado: boolean;
  usar: (r: ResultadoPncp) => Promise<void>;
  /** Mostra a busca já aberta (na janela própria do PNCP) e busca pelo nome do item ao abrir. */
  aberto?: boolean;
}) {
  const [consulta, setConsulta] = useState<string | null>(null);
  const [uf, setUf] = useState("PR");
  const [situacao, setSituacao] = useState("todos");
  const [buscando, setBuscando] = useState(false);
  const [resultados, setResultados] = useState<ResultadoPncp[]>([]);
  const [aviso, setAviso] = useState("");

  const buscar = async () => {
    const q = (consulta ?? descricao).trim().slice(0, 220);
    if (q.length < 3 || buscando) return;
    setBuscando(true);
    setAviso("");
    setResultados([]);
    try {
      const r = await buscarPrecosPncp(q, uf, situacao);
      setResultados(r.resultados);
      if (r.incompleta) setAviso("O PNCP deixou de responder para parte das contratações.");
      else if (!r.resultados.length) setAviso(SEM_REFERENCIAS_PNCP);
    } catch (e) {
      setAviso(e instanceof Error ? e.message : "Não foi possível consultar o PNCP.");
    } finally {
      setBuscando(false);
    }
  };

  const jaBuscou = useRef(false);
  useEffect(() => {
    if (aberto && !jaBuscou.current && descricao.trim().length >= 3) { jaBuscou.current = true; void buscar(); }
  }, [aberto]);

  const corpo = <div className="stack">
      <div className="form">
        <label className="wide">Descrição para busca<input maxLength={220} disabled={ocupado || buscando}
          value={consulta ?? descricao.slice(0, 220)} onChange={(e) => setConsulta(e.target.value)} onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); void buscar(); }
          }} /></label>
        <FiltrosPncp uf={uf} setUf={setUf} situacao={situacao} setSituacao={setSituacao} inativo={ocupado || buscando} />
      </div>
      <div><button className="btn sm" type="button" disabled={ocupado || buscando || (consulta ?? descricao).trim().length < 3} onClick={buscar}>
        {buscando ? "Buscando no PNCP…" : "Buscar no PNCP"}</button></div>
      {aviso && <p className="small" role="status">{aviso}</p>}
      {buscando && <p className="small muted" role="status">Buscando "{(consulta ?? descricao).trim()}" no PNCP…</p>}
      <ReferenciasPncp resultados={resultados} inativo={ocupado || buscando} usar={usar} />
    </div>;
  return aberto ? corpo : <details className="cotacao-pncp">
    <summary>Consultar preços no PNCP</summary>
    {corpo}
  </details>;
}

export const SEM_REFERENCIAS_PNCP = "Nenhum item com preço unitário foi localizado para esse termo e filtros.";

export function buscarPrecosPncp(q: string, uf: string, situacao: string, sinal?: AbortSignal) {
  return api.get<{ resultados: ResultadoPncp[]; incompleta: boolean }>(
    `/pncp-search?${new URLSearchParams({ q, uf, status: situacao })}`, sinal,
  );
}

export function FiltrosPncp({ uf, setUf, situacao, setSituacao, inativo }: {
  uf: string;
  setUf: (v: string) => void;
  situacao: string;
  setSituacao: (v: string) => void;
  inativo: boolean;
}) {
  return <>
    <label>UF<select disabled={inativo} value={uf} onChange={(e) => setUf(e.target.value)}>
      <option value="BR">Brasil</option>
      {UFS_PNCP.map((sigla) => <option key={sigla} value={sigla}>{sigla}</option>)}
    </select></label>
    <label>Situação do processo<select disabled={inativo} value={situacao} onChange={(e) => setSituacao(e.target.value)}>
      {Object.entries(SITUACOES_PNCP).map(([valor, rotulo]) => <option key={valor} value={valor}>{rotulo}</option>)}
    </select></label>
  </>;
}

export function ReferenciasPncp({ resultados, inativo, usar }: {
  resultados: ResultadoPncp[];
  inativo: boolean;
  usar: (r: ResultadoPncp) => Promise<void>;
}) {
  return resultados.length > 0 && <ul className="pncp-resultados">{resultados.map((r) => (
    <li className="cotacao-fornecedor stack" key={`${r.control}-${r.itemNumber}`}>
      <strong>{r.description}</strong>
      <span className="small">{[pncpProcedure(r), r.organization, [r.municipality, r.state].filter(Boolean).join("/"), r.statusName,
        r.publicationDate && `Publicado em ${pncpDate(r.publicationDate)}`].filter(Boolean).join(" · ")}</span>
      {r.processNumber && <span className="small">Processo nº {r.processNumber}</span>}
      <div className="tools">
        <strong>{brl(r.unitValue)}{r.unit ? ` / ${r.unit}` : ""}</strong>
        {r.itemNumber > 0 && <span className="small">Item {r.itemNumber}{r.quantity > 0 ? ` · Qtd. ${r.quantity.toLocaleString("pt-BR")}` : ""}</span>}
        <a href={r.sourceUrl} target="_blank" rel="noreferrer">Abrir no PNCP</a>
        <button className="btn sm" type="button" disabled={inativo} onClick={() => usar(r)}>Usar valor e anexar comprovante</button>
      </div>
    </li>
  ))}</ul>;
}
