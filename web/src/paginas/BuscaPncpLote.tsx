import { useEffect, useRef, useState } from "react";
import type { ResultadoPncp } from "../../../shared/pncp";
import { ErroApi } from "../api";
import { buscarPrecosPncp, FiltrosPncp, ReferenciasPncp, SEM_REFERENCIAS_PNCP } from "./BuscaPncpItem";

type Retorno = Awaited<ReturnType<typeof buscarPrecosPncp>> | { erro: string };

export function BuscaPncpLote({ descricoes, ocupado, usar }: {
  descricoes: string[];
  ocupado: boolean;
  usar: (indice: number, resultado: ResultadoPncp) => Promise<void>;
}) {
  const [uf, setUf] = useState("PR");
  const [situacao, setSituacao] = useState("todos");
  const [retornos, setRetornos] = useState<Record<number, Retorno>>({});
  const [atual, setAtual] = useState<number>();
  const [aviso, setAviso] = useState("");
  const controle = useRef<AbortController | undefined>(undefined);

  useEffect(() => () => {
    controle.current?.abort();
    controle.current = undefined;
  }, []);

  const itens = descricoes.flatMap((descricao, indice) => {
    const termo = descricao.trim().slice(0, 220);
    return termo ? [{ descricao, termo, indice }] : [];
  });
  const consultaveis = itens.filter((item) => item.termo.length >= 3);
  const pendentes = consultaveis.filter(({ indice }) => !retornos[indice] || "erro" in retornos[indice]);
  const buscando = atual !== undefined;

  function limpar() {
    setRetornos({});
    setAviso("");
  }

  async function pesquisar(repetirPendentes = false) {
    if (ocupado || controle.current) return;
    const fila = repetirPendentes ? pendentes : consultaveis;
    if (!fila.length) return;
    const ctl = new AbortController();
    controle.current = ctl;
    setAviso("");
    if (!repetirPendentes) setRetornos({});

    const cache = new Map<string, Awaited<ReturnType<typeof buscarPrecosPncp>>>();
    let falhasSeguidas = 0;
    try {
      for (const [posicao, { termo, indice }] of fila.entries()) {
        setAtual(indice);
        try {
          const retorno = cache.get(termo) ?? await buscarPrecosPncp(termo, uf, situacao, ctl.signal);
          if (ctl.signal.aborted) break;
          cache.set(termo, retorno);
          setRetornos((lista) => ({ ...lista, [indice]: retorno }));
          falhasSeguidas = 0;
        } catch (e) {
          if (ctl.signal.aborted) break;
          setRetornos((lista) => ({ ...lista, [indice]: { erro: e instanceof Error ? e.message : "Não foi possível consultar o PNCP." } }));
          if (e instanceof ErroApi && e.status === 401) break;
          falhasSeguidas++;
          if (falhasSeguidas >= 3 && posicao + 1 < fila.length) {
            setAviso("Pesquisa pausada após três falhas consecutivas. Você pode retomar pelos itens pendentes.");
            break;
          }
        }
      }
    } finally {
      if (controle.current === ctl) {
        controle.current = undefined;
        setAtual(undefined);
        if (ctl.signal.aborted) setAviso("Pesquisa interrompida. Os resultados já recebidos estão disponíveis abaixo.");
      }
    }
  }

  return <details className="cotacao-pncp">
    <summary>Pesquisa em lote no PNCP</summary>
    <div className="stack">
      <div className="form">
        <FiltrosPncp uf={uf} situacao={situacao} inativo={ocupado || buscando}
          setUf={(valor) => { setUf(valor); limpar(); }}
          setSituacao={(valor) => { setSituacao(valor); limpar(); }} />
      </div>
      <div className="tools">
        <button type="button" className="btn sm" disabled={ocupado || buscando || !consultaveis.length}
          onClick={() => void pesquisar()}>Pesquisar todos os itens no PNCP</button>
        {buscando && <button type="button" className="btn sm" onClick={() => controle.current?.abort()}>Parar pesquisa</button>}
        {!buscando && Object.keys(retornos).length > 0 && pendentes.length > 0 && <button type="button" className="btn sm" disabled={ocupado}
          onClick={() => void pesquisar(true)}>Pesquisar itens pendentes ({pendentes.length})</button>}
      </div>
      <p className="small" role="status">{buscando
        ? `Consultando item ${atual + 1} (${consultaveis.length} itens na pesquisa).`
        : aviso || (consultaveis.length ? `${consultaveis.length} de ${itens.length} itens com descrição podem ser consultados. Use ao menos 3 caracteres por item.`
          : "Preencha a descrição de pelo menos um item para pesquisar.")}</p>
      {itens.map(({ indice, descricao }) => {
        const retorno = retornos[indice];
        if (!retorno) return null;
        const prefixo = `Item ${indice + 1} · ${descricao}`;
        if ("erro" in retorno) return <p className="small" key={indice}><strong>{prefixo}</strong> · {retorno.erro}</p>;
        return <details className="cotacao-pncp" key={indice}>
          <summary>{prefixo} · {retorno.resultados.length} referência(s){retorno.incompleta ? " · consulta parcial" : ""}</summary>
          {retorno.incompleta
            ? <p className="small">O PNCP deixou de responder para parte das contratações.</p>
            : !retorno.resultados.length && <p className="small">{SEM_REFERENCIAS_PNCP}</p>}
          <ReferenciasPncp resultados={retorno.resultados} inativo={ocupado || buscando} usar={(r) => usar(indice, r)} />
        </details>;
      })}
    </div>
  </details>;
}
