import { useEffect, useRef, useState, type FormEvent } from "react";
import { api, brl } from "../api";
import { useEu } from "../main";
import { Folha } from "../comp/Folha";
import { aplicarPendencias, pendencias } from "../../../shared/etapas";
import { camposDaSolicitacao, FONTES_COTACAO, inserirItens, LIMITE_SOLICITACAO, MAX_ANEXOS_SOLICITACAO, MODELO_SOLICITACAO, TAMANHO_ANEXO_SOLICITACAO, TIPOS_ANEXOS_SOLICITACAO, totalDoItem, totalDosItens, type ItemSolicitacao } from "../../../shared/solicitacao";

import { limparNomeFornecedor, nomeFornecedorOrcamento, type OrcamentoLido } from "../../../shared/orcamentos";
import { ItensSolicitacao, lerLinhas, linhasDosItens, linhaVazia, type LinhaItem } from "./ItensSolicitacao";

interface Solicitacao {
  id: number;
  secretaria: string;
  referencia: string;
  descricao: string;
  nome_arquivo: string | null;
  apoios: { id: number; nome: string }[];
  objeto: string;
  justificativa: string;
  itens: ItemSolicitacao[];
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
    orcamentos: OrcamentoLido[];
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
  const [objeto, setObjeto] = useState("");
  const [justificativa, setJustificativa] = useState("");
  const [linhas, setLinhas] = useState<LinhaItem[]>([linhaVazia()]);
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [apoios, setApoios] = useState<File[]>([]);
  const [cotando, setCotando] = useState(false);
  const [ocupado, setOcupado] = useState<"salvar" | "ia" | null>(null);
  const [aviso, setAviso] = useState<{ texto: string; erro?: boolean } | null>(null);
  const seletor = useRef<HTMLInputElement>(null);
  const seletorApoios = useRef<HTMLInputElement>(null);
  const caminho = `/processos/${processo.id}/solicitacoes`;
  const areas = [processo.requisitante, ...processo.areas_adicionais].filter(Boolean);
  const podeAdicionar = processo.pode.editar && processo.situacao === "preparacao";

  const areaEscolhida = secretaria.trim();
  const titular = cadastro?.area === areaEscolhida ? cadastro.titular : null;
  const lidas = lerLinhas(linhas);
  const itens = lidas.itens;
  // Mesmo caminho do servidor: o quadro de itens entra no texto e os campos do modelo recebem o que foi digitado.
  const base = inserirItens(descricao, itens);
  const automaticos = camposDaSolicitacao(base, { ...processo, secretaria: areaEscolhida, referencia: referencia.trim(), titular, objeto_solicitacao: objeto, justificativa, itens });
  const faltantes = pendencias(base).filter((x) => !automaticos[x.i]);
  const previa = aplicarPendencias(base, { ...automaticos, ...valores }).texto;

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
      setObjeto("");
      setJustificativa("");
      setLinhas([linhaVazia()]);
      trocarTexto(novo === "manual" ? modelo : "");
      setArquivo(null);
      setApoios([]);
    }
    if (modo && novo === "manual" && !descricao.trim()) trocarTexto(modelo);
    setModo(novo);
    setAviso(null);
  };

  const editar = (s: Solicitacao) => {
    setEdicao(s);
    setSecretaria(s.secretaria);
    setReferencia(s.referencia);
    setObjeto(s.objeto);
    setJustificativa(s.justificativa);
    setLinhas(linhasDosItens(s.itens, processo.orcamentos));
    setArquivo(null);
    setApoios([]);
    trocarTexto(s.descricao);
    setModo("manual");
    setAviso(null);
    document.getElementById("form-solicitacao")?.scrollIntoView({ block: "start" });
  };

  const fechar = () => {
    setEdicao(null);
    setModo(null);
  };

  const selecionarApoios = (selecionados: File[]) => {
    const novos = [...apoios];
    for (const a of selecionados) {
      if (!novos.some((b) => b.name === a.name && b.size === a.size && b.lastModified === a.lastModified)) novos.push(a);
    }
    if (novos.length + (edicao?.apoios.length ?? 0) > MAX_ANEXOS_SOLICITACAO || novos.some((a) => !a.size || a.size > TAMANHO_ANEXO_SOLICITACAO)
      || novos.reduce((total, a) => total + a.size, 0) > 40 * 1024 * 1024) {
      setAviso({ erro: true, texto: `Selecione até ${MAX_ANEXOS_SOLICITACAO} documentos de apoio não vazios, de 20 MB cada e 40 MB no total.` });
      return;
    }
    setApoios(novos);
    setAviso(null);
  };

  const montarDados = (texto: string) => {
    if (arquivo && arquivo.size > 20 * 1024 * 1024) throw new Error("Selecione um documento de até 20 MB.");
    const dados = new FormData();
    dados.set("secretaria", secretaria);
    dados.set("referencia", referencia);
    dados.set("descricao", texto);
    dados.set("objeto_solicitacao", objeto);
    dados.set("justificativa", justificativa);
    dados.set("itens", JSON.stringify(lidas.itens));
    if (arquivo) dados.set("arquivo", arquivo);
    for (const apoio of apoios) dados.append("apoios", apoio);
    return dados;
  };

  const salvar = async (ev: FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    if (cotando) return;
    setOcupado("salvar");
    setAviso(null);
    try {
      if (modo === "anexo" && !arquivo) throw new Error("Selecione o documento da solicitação.");
      if (lidas.erro) throw new Error(lidas.erro);
      const texto = aplicarPendencias(base, valores).texto;
      if (edicao) {
        const dados = montarDados(texto);
        dados.set("anterior", edicao.descricao);
        dados.set("itens_anteriores", JSON.stringify(edicao.itens));
        await api.put(`${caminho}/${edicao.id}`, dados);
      }
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
      const dados = montarDados(previa);
      if (edicao) dados.set("solicitacao_id", String(edicao.id));
      const r = await api.post<{ descricao: string; objeto: string; justificativa: string; itens: ItemSolicitacao[]; avisos: string[] }>(`${caminho}/ia`, dados);
      trocarTexto(r.descricao);
      if (!edicao && !objeto.trim() && r.objeto) setObjeto(r.objeto);
      if (!edicao && !justificativa.trim() && r.justificativa) setJustificativa(r.justificativa);
      if (!itens.length && !lidas.erro && r.itens?.length) {
        setLinhas(linhasDosItens(r.itens, processo.orcamentos));
      }
      const falhas = r.avisos?.length ? ` O rascunho não inclui os arquivos que a IA não conseguiu ler: ${r.avisos.join(", ")}.` : "";
      setAviso({ texto: "Rascunho gerado. Confira o preenchimento antes de salvar." + falhas, erro: !!falhas });
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
          <button key={k} type="button" className={modo === k ? "btn pri" : "btn"} aria-pressed={modo === k} disabled={!!ocupado || cotando} onClick={() => abrir(k)}>{rotulo}</button>
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
            {!edicao && <>
              <label className="wide">Objeto genérico
                <input maxLength={4000} value={objeto} disabled={!!ocupado} placeholder={processo.objeto} onChange={(e) => setObjeto(e.target.value)} />
                <span className="small muted">Descrição resumida do que a secretaria pede, sem marca. Em branco, vale o objeto do processo.</span></label>
              <label className="wide">Justificativa
                <textarea maxLength={8000} value={justificativa} disabled={!!ocupado} placeholder="Por que a secretaria precisa desta contratação" onChange={(e) => setJustificativa(e.target.value)} /></label>
            </>}
            <fieldset className="wide itens-sol">
              <legend>Documentos de apoio da solicitação</legend>
              <div className="tools">
                <input ref={seletorApoios} hidden type="file" accept={TIPOS_ANEXOS_SOLICITACAO} multiple onChange={(e) => {
                  selecionarApoios(Array.from(e.target.files ?? []));
                  e.target.value = "";
                }} />
                <button className="btn" type="button" disabled={!!ocupado || cotando || apoios.length + (edicao?.apoios.length ?? 0) >= MAX_ANEXOS_SOLICITACAO}
                  onClick={() => seletorApoios.current?.click()}>Anexar documentos de apoio</button>
                <span className="small muted">PDF, Word, Excel (.xlsx), foto ou texto. Até {MAX_ANEXOS_SOLICITACAO} arquivos.</span>
              </div>
              {(apoios.length > 0 || !!edicao?.apoios.length) && <ul>
                {edicao?.apoios.map((a) => <li key={a.id}><a href={`/api${caminho}/${edicao.id}/apoios/${a.id}`}>{a.nome}</a></li>)}
                {apoios.map((a, i) => <li key={`${a.name}-${i}`}>{a.name}{" "}
                  <button className="lnk" type="button" disabled={!!ocupado} onClick={() => setApoios(apoios.filter((_, k) => i !== k))}>Remover</button>
                </li>)}
              </ul>}
            </fieldset>
            <ItensSolicitacao processoId={processo.id} linhas={linhas} setLinhas={setLinhas}
              orcamentos={processo.orcamentos} recarregar={recarregar} ia={ia.disponivel} ocupado={!!ocupado} setCotando={setCotando} />
            {lidas.erro && <p className="wide small muted">{lidas.erro}</p>}
            <label className="wide">{modo === "anexo" ? "Descrição complementar (opcional)" : "Descrição da solicitação"}
              <textarea required={modo !== "anexo" && !edicao?.nome_arquivo && !edicao?.apoios.length && !apoios.length} maxLength={LIMITE_SOLICITACAO} value={descricao} disabled={!!ocupado}
                placeholder={modo === "ia" ? "Informe a necessidade, as quantidades e os prazos que já conhece." : undefined}
                onChange={(e) => trocarTexto(e.target.value)} />
            </label>
          </div>
          {modo !== "anexo" && descricao.trim() && <p className="small muted">Use [[nome do campo]] no texto para criar um campo de preenchimento na prévia.</p>}
          {modo !== "anexo" && !descricao.trim() && <div><button className="btn" type="button" disabled={!!ocupado} onClick={() => trocarTexto(modelo)}>Usar modelo do órgão</button></div>}
          {!edicao && <div className="tools">
            <input ref={seletor} hidden type="file" accept={tiposArquivo} onChange={(e) => setArquivo(e.target.files?.[0] ?? null)} />
            <button className="btn" type="button" disabled={!!ocupado} onClick={() => seletor.current?.click()}>{arquivo ? "Trocar solicitação original" : "Anexar solicitação original"}</button>
            {arquivo && <>
              <span className="small" style={{ overflowWrap: "anywhere" }}>{arquivo.name}</span>
              <button className="lnk" type="button" disabled={!!ocupado} onClick={() => {
                setArquivo(null);
                if (seletor.current) seletor.current.value = "";
              }}>Remover anexo</button>
            </>}
            <span className="small muted">PDF, Word (.docx) ou texto. Até 20 MB.</span>
          </div>}
          {(modo === "ia" || !!apoios.length || !!arquivo || !!edicao?.apoios.length || !!edicao?.nome_arquivo) && <div className="stack">
            {ia.disponivel ? <>
              <div><button className="btn" type="button" disabled={!!ocupado || cotando} onClick={gerar}>{ocupado === "ia" ? "Gerando rascunho…" : "Gerar rascunho com IA"}</button></div>
              <span className="small muted">Ao gerar, o Licita usa a descrição e envia os documentos de apoio e a solicitação original anexada ao provedor de IA.</span>
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
            <button className="btn pri" disabled={!!ocupado || cotando}>{ocupado === "salvar" ? "Salvando…" : "Salvar solicitação"}</button>
            <button className="btn" type="button" disabled={!!ocupado || cotando} onClick={() => { fechar(); setAviso(null); }}>Cancelar</button>
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
                  {s.objeto && <div>{s.objeto}</div>}
                  {s.itens?.length > 0 && <div className="small muted">{s.itens.length} {s.itens.length === 1 ? "item" : "itens"}{totalDosItens(s.itens) != null ? ` · ${s.itens.some((i) => totalDoItem(i) == null) ? "subtotal dos itens com valor" : "total estimado"} ${brl(totalDosItens(s.itens))}` : ""}</div>}
                  {s.descricao && <details><summary>Ver solicitação</summary><Folha texto={s.descricao} /></details>}
                  {s.itens.some((item) => item.cotacoes?.length) && <details><summary>Cotações por item</summary>
                    <ul>{s.itens.filter((item) => item.cotacoes?.length).map((item, i) => <li key={i}>{item.descricao}
                      <ul>{item.cotacoes?.map((c, j) => <li key={c.orcamento_id != null ? `orcamento-${c.orcamento_id}` : `manual-${j}`}>
                        {c.orcamento_id != null ? <a href={`/api/processos/${processo.id}/orcamentos/${c.orcamento_id}/arquivo`}>{limparNomeFornecedor(c.fornecedor) || nomeFornecedorOrcamento(processo.orcamentos.find((o) => o.id === c.orcamento_id)) || "Fornecedor a identificar"}</a>
                          : <>{c.fornecedor} · Anexo pendente</>} · {brl(c.valor_unitario)}
                        {c.fonte && c.fonte !== "fornecedor" && <> · {FONTES_COTACAO[c.fonte]}</>}
                        {c.link && <> · <a href={c.link} target="_blank" rel="noreferrer">Abrir fonte</a></>}
                      </li>)}</ul>
                    </li>)}</ul>
                  </details>}
                  <div className="tools">
                    {podeAdicionar && <button type="button" className="btn sm" disabled={!!ocupado || !!modo} onClick={() => editar(s)}>Editar</button>}
                    {s.descricao && <a className="btn sm" href={`/api${caminho}/${s.id}/docx${timbrado ? `?timbrado=${encodeURIComponent(timbrado)}` : ""}`}>Baixar Word</a>}
                  </div>
                </td>
                <td>
                  {s.nome_arquivo && <div><a href={`/api${caminho}/${s.id}/arquivo`} download>{s.nome_arquivo}</a></div>}
                  {s.apoios.map((a) => <div key={a.id}><a href={`/api${caminho}/${s.id}/apoios/${a.id}`} download>{a.nome}</a></div>)}
                  {!s.nome_arquivo && !s.apoios.length && "—"}
                </td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </section>
  );
}
