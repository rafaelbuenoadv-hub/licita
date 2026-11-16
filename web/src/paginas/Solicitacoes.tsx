import { useEffect, useRef, useState, type FormEvent } from "react";
import { api } from "../api";
import { useEu } from "../main";
import { Folha } from "../comp/Folha";
import { aplicarPendencias, pendencias } from "../../../shared/etapas";
import { camposDaSolicitacao, MODELO_SOLICITACAO } from "../../../shared/solicitacao";

interface Solicitacao {
  id: number;
  secretaria: string;
  referencia: string;
  descricao: string;
  nome_arquivo: string | null;
}

interface Props {
  processo: {
    id: number;
    objeto: string;
    protocolo: string;
    timbrados: { codigo: string; nome: string }[];
    requisitante: string;
    areas_adicionais: string[];
    situacao: string;
    pode: { editar: boolean };
    solicitacoes: Solicitacao[];
    secretarias: string[];
  };
  recarregar: () => Promise<unknown>;
}

const modos = {
  manual: "Criar manualmente",
  ia: "Criar com ajuda da IA",
  anexo: "Anexar solicitação existente",
};
type Modo = keyof typeof modos;
type Titular = { nome: string; portaria: string; fonte_portaria: string };
const tiposArquivo = ".pdf,.docx,.txt,.md,.csv";

export function Solicitacoes({ processo, recarregar }: Props) {
  const { ia } = useEu();
  const [modo, setModo] = useState<Modo | null>(null);
  const [chave, setChave] = useState("");
  const [edicao, setEdicao] = useState<Solicitacao | null>(null);
  const [timbrado, setTimbrado] = useState("");
  const [valores, setValores] = useState<Record<string, string>>({});
  const [cadastro, setCadastro] = useState<{ area: string; titular: Titular | null }>();
  const [modelo, setModelo] = useState(MODELO_SOLICITACAO.modelo);
  const [secretaria, setSecretaria] = useState("");
  const [referencia, setReferencia] = useState("");
  const [descricao, setDescricao] = useState("");
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [ocupado, setOcupado] = useState<"salvar" | "ia" | null>(null);
  const [aviso, setAviso] = useState<{ texto: string; erro?: boolean } | null>(null);
  const seletor = useRef<HTMLInputElement>(null);
  const caminho = `/processos/${processo.id}/solicitacoes`;
  const areas = [processo.requisitante, ...processo.areas_adicionais].filter(Boolean);
  const podeAdicionar = processo.pode.editar && processo.situacao === "preparacao";

  const areaEscolhida = secretaria.trim();
  const titular = cadastro?.area === areaEscolhida ? cadastro.titular : null;
  const automaticos = camposDaSolicitacao(descricao, { ...processo, secretaria: areaEscolhida, referencia: referencia.trim(), titular });
  const faltantes = pendencias(descricao).filter((x) => !automaticos[x.i]);
  const previa = aplicarPendencias(descricao, { ...automaticos, ...valores }).texto;

  useEffect(() => {
    let ativo = true;
    api.get<{ texto: string }>(`${caminho}/modelo`).then((r) => { if (ativo) setModelo(r.texto); }).catch(() => {});
    return () => { ativo = false; };
  }, [caminho]);

  useEffect(() => {
    if (!modo || areaEscolhida.length < 2) return;
    let ativo = true;
    const espera = setTimeout(() => {
      api.post<{ titular: Titular | null }[]>("/secretarios/titulares", { areas: [areaEscolhida] })
        .then((r) => { if (ativo) setCadastro({ area: areaEscolhida, titular: r[0]?.titular ?? null }); })
        .catch(() => { if (ativo) setCadastro(undefined); });
    }, 250);
    return () => { ativo = false; clearTimeout(espera); };
  }, [modo, areaEscolhida]);

  const trocarTexto = (texto: string) => {
    setDescricao(texto);
    setValores({});
  };

  const abrir = (novo: Modo) => {
    if (!modo) {
      setChave(crypto.randomUUID());
      setSecretaria(areas[0] ?? "");
      setReferencia("");
      trocarTexto(novo === "manual" ? modelo : "");
      setArquivo(null);
    }
    if (modo && novo === "manual" && !descricao.trim()) trocarTexto(modelo);
    setModo(novo);
    setAviso(null);
  };

  const editar = (s: Solicitacao) => {
    setEdicao(s);
    setSecretaria(s.secretaria);
    setReferencia(s.referencia);
    setArquivo(null);
    trocarTexto(s.descricao);
    setModo("manual");
    setAviso(null);
    document.getElementById("form-solicitacao")?.scrollIntoView({ block: "start" });
  };

  const fechar = () => {
    setEdicao(null);
    setModo(null);
  };

  const montarDados = (texto: string) => {
    if (arquivo && arquivo.size > 20 * 1024 * 1024) throw new Error("Selecione um documento de até 20 MB.");
    const dados = new FormData();
    dados.set("secretaria", secretaria);
    dados.set("referencia", referencia);
    dados.set("descricao", texto);
    if (arquivo) dados.set("arquivo", arquivo);
    return dados;
  };

  const salvar = async (ev: FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    setOcupado("salvar");
    setAviso(null);
    try {
      if (modo === "anexo" && !arquivo) throw new Error("Selecione o documento da solicitação.");
      const texto = aplicarPendencias(descricao, valores).texto;
      if (edicao) await api.put(`${caminho}/${edicao.id}`, { descricao: texto, anterior: edicao.descricao });
      else {
        const dados = montarDados(texto);
        dados.set("chave_envio", chave);
        await api.post(caminho, dados);
      }
      fechar();
      await recarregar();
      setAviso({ texto: edicao ? "Solicitação atualizada." : "Solicitação adicionada ao processo." });
    } catch (erro) {
      setAviso({ texto: erro instanceof Error ? erro.message : "Não foi possível salvar a solicitação.", erro: true });
    } finally {
      setOcupado(null);
    }
  };

  const gerar = async () => {
    if (secretaria.trim().length < 2) {
      setAviso({ texto: "Informe a secretaria antes de gerar o rascunho.", erro: true });
      return;
    }
    setOcupado("ia");
    setAviso(null);
    try {
      const r = await api.post<{ descricao: string }>(`${caminho}/ia`, montarDados(previa));
      trocarTexto(r.descricao);
      setAviso({ texto: "Rascunho gerado. Confira o texto e salve a solicitação." });
    } catch (erro) {
      setAviso({ texto: erro instanceof Error ? erro.message : "Não foi possível gerar o rascunho.", erro: true });
    } finally {
      setOcupado(null);
    }
  };

  return (
    <section className="sec stack" id="form-solicitacao">
      <h3>Solicitações das secretarias</h3>
      {areas.length > 0 && <p><strong>Áreas requisitantes</strong> · {areas.join("; ")}</p>}
      {podeAdicionar && !edicao && <div className="tools">
        {(Object.entries(modos) as [Modo, string][]).map(([k, rotulo]) => (
          <button key={k} type="button" className={modo === k ? "btn pri" : "btn"} aria-pressed={modo === k} disabled={!!ocupado} onClick={() => abrir(k)}>{rotulo}</button>
        ))}
      </div>}
      {podeAdicionar && modo && (
        <form className="stack" onSubmit={salvar}>
          {edicao && <h4>Editar solicitação · {edicao.secretaria}</h4>}
          <div className="form">
            <label>Secretaria<input list="secretarias-solicitacao" required minLength={2} maxLength={200} value={secretaria} disabled={!!ocupado || !!edicao} onChange={(e) => setSecretaria(e.target.value)} /></label>
            <datalist id="secretarias-solicitacao">{[...new Set([...areas, ...processo.secretarias])].map((nome) => <option key={nome} value={nome} />)}</datalist>
            <label>Memorando ou referência<input maxLength={120} value={referencia} disabled={!!ocupado || !!edicao} onChange={(e) => setReferencia(e.target.value)} /></label>
            {areaEscolhida.length >= 2 && <div className="titular wide" aria-live="polite">
              <label>Secretário(a)<input readOnly value={titular?.nome ?? ""} /></label>
              <label>Portaria de nomeação<input readOnly value={titular?.portaria ?? ""} /></label>
              {titular?.fonte_portaria && <span className="small"><a href={titular.fonte_portaria} target="_blank" rel="noopener noreferrer">Ver portaria cadastrada</a></span>}
              {cadastro?.area === areaEscolhida && !titular && <span className="small muted">Confira o cadastro de secretários para esta área.</span>}
            </div>}
            <label className="wide">{modo === "anexo" ? "Descrição complementar (opcional)" : "Descrição da solicitação"}
              <textarea required={modo !== "anexo" && !edicao?.nome_arquivo} maxLength={10000} value={descricao} disabled={!!ocupado}
                placeholder={modo === "ia" ? "Informe a necessidade, as quantidades e os prazos que já conhece." : undefined}
                onChange={(e) => trocarTexto(e.target.value)} />
            </label>
          </div>
          {modo !== "anexo" && descricao.trim() && <p className="small muted">Use [[nome do campo]] no texto para criar um campo de preenchimento na prévia.</p>}
          {modo !== "anexo" && !descricao.trim() && <div><button className="btn" type="button" disabled={!!ocupado} onClick={() => trocarTexto(modelo)}>Usar modelo do órgão</button></div>}
          {!edicao && <div className="tools">
            <input ref={seletor} hidden type="file" accept={tiposArquivo} onChange={(e) => setArquivo(e.target.files?.[0] ?? null)} />
            <button className="btn" type="button" disabled={!!ocupado} onClick={() => seletor.current?.click()}>{arquivo ? "Trocar documento" : "Anexar documento"}</button>
            {arquivo && <>
              <span className="small" style={{ overflowWrap: "anywhere" }}>{arquivo.name}</span>
              <button className="lnk" type="button" disabled={!!ocupado} onClick={() => {
                setArquivo(null);
                if (seletor.current) seletor.current.value = "";
              }}>Remover anexo</button>
            </>}
            <span className="small muted">PDF, Word (.docx) ou texto. Até 20 MB.</span>
          </div>}
          {modo === "ia" && <div className="stack">
            {ia.disponivel ? <>
              <div><button className="btn" type="button" disabled={!!ocupado} onClick={gerar}>{ocupado === "ia" ? "Gerando rascunho…" : "Gerar rascunho com IA"}</button></div>
              <span className="small muted">Ao gerar, o Licita usa a descrição e envia o documento selecionado ao provedor de IA.</span>
            </> : <p className="note">IA indisponível no servidor. Você pode preencher e salvar a solicitação nesta tela.</p>}
          </div>}
          {descricao.trim() && <div className="stack">
            <h4>Prévia da solicitação</h4>
            <Folha texto={previa} />
          </div>}
          {faltantes.length > 0 && <div className="pend">
            <div className="row"><h4>Campos pendentes</h4>
              <button type="button" className="btn sm" disabled={!!ocupado || !Object.values(valores).some((v) => v.trim())}
                onClick={() => trocarTexto(aplicarPendencias(descricao, valores).texto)}>Aplicar no texto</button>
            </div>
            {faltantes.map((x) => {
              const [antes, depois] = x.trecho.split("▮");
              return <div className="pf" key={x.i}>
                <label htmlFor={`solicitacao-campo-${x.i}`}>{antes}<mark>{x.rotulo}</mark>{depois}</label>
                <input id={`solicitacao-campo-${x.i}`} value={valores[x.i] ?? ""} maxLength={2000} disabled={!!ocupado}
                  onChange={(e) => setValores({ ...valores, [x.i]: e.target.value })} />
              </div>;
            })}
          </div>}
          <div className="tools">
            <button className="btn pri" disabled={!!ocupado}>{ocupado === "salvar" ? "Salvando…" : "Salvar solicitação"}</button>
            <button className="btn" type="button" disabled={!!ocupado} onClick={() => { fechar(); setAviso(null); }}>Cancelar</button>
          </div>
        </form>
      )}
      {aviso && <p className={`note ${aviso.erro ? "bad" : "ok"}`} role={aviso.erro ? "alert" : "status"}>{aviso.texto}</p>}
      {processo.solicitacoes.some((s) => s.descricao) && processo.timbrados.length > 0 && <label className="campo" style={{ maxWidth: 320 }}>Timbrado do Word
        <select value={timbrado} onChange={(e) => setTimbrado(e.target.value)}>
          <option value="">Sem timbrado</option>
          {processo.timbrados.map((t) => <option key={t.codigo} value={t.codigo}>{t.nome}</option>)}
        </select>
      </label>}
      {processo.solicitacoes.length > 0 && (
        <div className="tw">
          <table className="t">
            <thead><tr><th>Secretaria</th><th>Solicitação</th><th>Documento</th></tr></thead>
            <tbody>{processo.solicitacoes.map((s) => (
              <tr key={s.id}>
                <td>{s.secretaria}</td>
                <td>{s.referencia && <strong>{s.referencia}</strong>}
                  {s.descricao && <details><summary>Ver solicitação</summary><Folha texto={s.descricao} /></details>}
                  <div className="tools">
                    {podeAdicionar && <button type="button" className="btn sm" disabled={!!ocupado || !!modo} onClick={() => editar(s)}>Editar</button>}
                    {s.descricao && <a className="btn sm" href={`/api${caminho}/${s.id}/docx${timbrado ? `?timbrado=${encodeURIComponent(timbrado)}` : ""}`}>Baixar Word</a>}
                  </div>
                </td>
                <td>{s.nome_arquivo ? <a href={`/api${caminho}/${s.id}/arquivo`} download>{s.nome_arquivo}</a> : "—"}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </section>
  );
}
