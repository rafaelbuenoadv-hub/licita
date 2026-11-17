import { useEffect, useRef, useState, type FormEvent } from "react";
import { api, brl } from "../api";
import { useEu } from "../main";
import { Folha } from "../comp/Folha";
import { aplicarPendencias, pendencias } from "../../../shared/etapas";
import { camposDaSolicitacao, documentoDaSolicitacao, inserirItens, LIMITE_SOLICITACAO, MODELO_SOLICITACAO, TAMANHO_ANEXO_SOLICITACAO, TIPOS_ANEXOS_SOLICITACAO, totalDoItem, totalDosItens, type ItemSolicitacao } from "../../../shared/solicitacao";

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
  const [rascunhoPrevia, setRascunhoPrevia] = useState<string | null>(null);
  const [objeto, setObjeto] = useState("");
  const [justificativa, setJustificativa] = useState("");
  const [linhas, setLinhas] = useState<LinhaItem[]>([linhaVazia()]);
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [apoios, setApoios] = useState<File[]>([]);
  const [progresso, setProgresso] = useState("");
  const [cotando, setCotando] = useState(false);
  const [ocupado, setOcupado] = useState<"salvar" | "ia" | null>(null);
  const [aviso, setAviso] = useState<{ texto: string; erro?: boolean } | null>(null);
  const painelPrevia = useRef<HTMLDetailsElement>(null);
  const editorPrevia = useRef<HTMLTextAreaElement>(null);
  const seletor = useRef<HTMLInputElement>(null);
  const seletorApoios = useRef<HTMLInputElement>(null);
  const caminho = `/processos/${processo.id}/solicitacoes`;
  const areas = [processo.requisitante, ...processo.areas_adicionais].filter(Boolean);
  const podeAdicionar = processo.pode.editar && processo.situacao === "preparacao";

  const areaEscolhida = secretaria.trim();
  const titular = cadastro?.area === areaEscolhida ? cadastro.titular : null;
  const lidas = lerLinhas(linhas);
  const itens = lidas.itens;
  const temOrcamento = itens.some((item) => item.cotacoes?.some((cotacao) => cotacao.orcamento_id != null));
  // Mesmo caminho do servidor: o quadro de itens entra no texto e os campos do modelo recebem o que foi digitado.
  const base = inserirItens(rascunhoPrevia ?? descricao, itens);
  const automaticos = camposDaSolicitacao(base, { ...processo, secretaria: areaEscolhida, referencia: referencia.trim(), titular, objeto_solicitacao: objeto, justificativa, itens });
  const faltantes = pendencias(base).filter((x) => !automaticos[x.i]);
  const previa = aplicarPendencias(base, { ...automaticos, ...(rascunhoPrevia === null ? valores : {}) }).texto;
  const editandoPrevia = rascunhoPrevia !== null;

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
    setRascunhoPrevia(null);
    setValores({});
  };

  useEffect(() => {
    if (!editandoPrevia) return;
    if (painelPrevia.current) painelPrevia.current.open = true;
    editorPrevia.current?.focus();
  }, [editandoPrevia]);

  const editarPrevia = () => {
    setRascunhoPrevia(inserirItens(previa, itens, "marcador"));
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

  const editar = (s: Solicitacao, pelaPrevia = false) => {
    setEdicao(s);
    setChave(crypto.randomUUID());
    setSecretaria(s.secretaria);
    setReferencia(s.referencia);
    setObjeto(s.objeto);
    setJustificativa(s.justificativa);
    setLinhas(linhasDosItens(s.itens, processo.orcamentos));
    setArquivo(null);
    setApoios([]);
    const texto = inserirItens(s.descricao, s.itens, "marcador");
    trocarTexto(texto);
    if (pelaPrevia) setRascunhoPrevia(texto);
    setModo("manual");
    setAviso(null);
    document.getElementById("form-solicitacao")?.scrollIntoView({ block: "start" });
  };

  const fechar = () => {
    setEdicao(null);
    setModo(null);
    setRascunhoPrevia(null);
  };

  const selecionarApoios = (selecionados: File[]) => {
    const novos = [...apoios];
    for (const a of selecionados) {
      if (!novos.some((b) => b.name === a.name && b.size === a.size && b.lastModified === a.lastModified)) novos.push(a);
    }
    if (novos.some((a) => !a.size || a.size > TAMANHO_ANEXO_SOLICITACAO)) {
      setAviso({ erro: true, texto: "Selecione documentos de apoio não vazios, de até 20 MB cada." });
      return;
    }
    setApoios(novos);
    setAviso(null);
  };

  const enviarApoios = async (dados: FormData) => {
    const ids: number[] = [];
    for (const [i, arquivo] of apoios.entries()) {
      setProgresso(`Enviando anexo ${i + 1} de ${apoios.length}…`);
      const envio = new FormData();
      envio.set("chave", chave);
      envio.append("apoios", arquivo);
      const r = await api.post<{ ids: number[] }>(`${caminho}/apoios`, envio);
      ids.push(...r.ids);
    }
    if (ids.length) {
      dados.set("chave_apoios", chave);
      dados.set("apoios_ids", JSON.stringify(ids));
    }
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
      const texto = previa;
      const dados = montarDados(texto);
      await enviarApoios(dados);
      setProgresso("Salvando a solicitação…");
      if (edicao) {
        dados.set("anterior", edicao.descricao);
        dados.set("itens_anteriores", JSON.stringify(edicao.itens));
        await api.put(`${caminho}/${edicao.id}`, dados);
      }
      else {
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
      setProgresso("");
    }
  };

  const gerar = async () => {
    if (secretaria.trim().length < 2) {
      setAviso({ texto: "Informe a secretaria antes de gerar o rascunho.", erro: true });
      return;
    }
    if (lidas.erro) {
      setAviso({ texto: lidas.erro, erro: true });
      return;
    }
    setOcupado("ia");
    setAviso(null);
    try {
      const dados = montarDados(previa);
      await enviarApoios(dados);
      setProgresso("Analisando os documentos de apoio e os orçamentos dos itens…");
      if (edicao) dados.set("solicitacao_id", String(edicao.id));
      const r = await api.post<{ descricao: string; objeto: string; justificativa: string; itens: ItemSolicitacao[]; avisos: string[] }>(`${caminho}/ia`, dados);
      trocarTexto(inserirItens(r.descricao, itens.length ? itens : r.itens ?? [], "marcador"));
      if (!objeto.trim() && r.objeto) setObjeto(r.objeto);
      if (!justificativa.trim() && r.justificativa) setJustificativa(r.justificativa);
      if (!itens.length && r.itens?.length) {
        setLinhas(linhasDosItens(r.itens, processo.orcamentos));
      }
      const falhas = r.avisos?.length ? ` O rascunho não inclui os arquivos que a IA não conseguiu ler: ${r.avisos.join(", ")}.` : "";
      setAviso({ texto: "Rascunho gerado. Confira o preenchimento antes de salvar." + falhas, erro: !!falhas });
    } catch (erro) {
      setAviso({ texto: erro instanceof Error ? erro.message : "Não foi possível gerar o rascunho.", erro: true });
    } finally {
      setOcupado(null);
      setProgresso("");
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
          {edicao && <h4>Alterar solicitação · {edicao.secretaria}</h4>}
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
                <button className="btn" type="button" disabled={!!ocupado || cotando}
                  onClick={() => seletorApoios.current?.click()}>Anexar documentos de apoio</button>
                <span className="small muted">Selecione vários arquivos e volte a anexar quando precisar. Até 20 MB por arquivo.</span>
              </div>
              {progresso && <p className="small muted" role="status">{progresso}</p>}
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
          {(modo === "ia" || !!apoios.length || !!arquivo || !!edicao?.apoios.length || !!edicao?.nome_arquivo || temOrcamento) && <div className="stack">
            {ia.disponivel ? <>
              <div><button className="btn" type="button" disabled={!!ocupado || cotando} onClick={gerar}>{ocupado === "ia" ? "Gerando rascunho…" : "Gerar rascunho com IA"}</button></div>
              <span className="small muted">A IA usa os dados preenchidos, os anexos desta solicitação e os orçamentos vinculados aos itens. Essas fontes são enviadas ao provedor de IA para gerar o rascunho.</span>
            </> : <p className="note">IA indisponível no servidor. Você pode preencher e salvar a solicitação nesta tela.</p>}
          </div>}
          {descricao.trim() && <details ref={painelPrevia} className="panel box">
            <summary>Prévia da solicitação</summary>
            <div className="pad stack">
              {rascunhoPrevia === null
                ? <div><button type="button" className="btn sm" disabled={!!ocupado || cotando} onClick={editarPrevia}>Editar manualmente</button></div>
                : <>
                  <label className="campo">Texto da solicitação
                    <textarea ref={editorPrevia} aria-label="Editar texto da prévia" rows={16} maxLength={LIMITE_SOLICITACAO}
                      value={rascunhoPrevia} disabled={!!ocupado || cotando} onChange={(ev) => setRascunhoPrevia(ev.target.value)} />
                  </label>
                  <p className="small muted">Edite o texto e confira a folha abaixo. O campo [[Itens]] recebe a tabela preenchida acima.</p>
                  <div className="tools">
                    <button type="button" className="btn sm" disabled={!!ocupado || cotando} onClick={() => trocarTexto(rascunhoPrevia)}>Aplicar edição</button>
                    <button type="button" className="btn sm" disabled={!!ocupado || cotando} onClick={() => setRascunhoPrevia(null)}>Cancelar edição</button>
                  </div>
                </>}
              <p className="small muted">Use {edicao ? "Salvar alterações" : "Salvar solicitação"} para gravar as alterações.</p>
            </div>
            <Folha texto={documentoDaSolicitacao(previa, itens)} />
          </details>}
          {faltantes.length > 0 && !editandoPrevia && <div className="pend">
            <div className="row"><h4>Campos pendentes</h4>
              <button type="button" className="btn sm" disabled={!!ocupado || !Object.values(valores).some((v) => v.trim())}
                onClick={() => trocarTexto(inserirItens(aplicarPendencias(base, valores).texto, itens, "marcador"))}>Aplicar no texto</button>
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
            <button className="btn pri" disabled={!!ocupado || cotando}>{ocupado === "salvar" ? "Salvando…" : edicao ? "Salvar alterações" : "Salvar solicitação"}</button>
            <button className="btn" type="button" disabled={!!ocupado || cotando} onClick={() => { fechar(); setAviso(null); }}>Cancelar</button>
          </div>
        </form>
      )}
      {aviso && <p className={`note ${aviso.erro ? "bad" : "ok"}`} role={aviso.erro ? "alert" : "status"}>{aviso.texto}</p>}
      {processo.solicitacoes.some((s) => s.descricao) && processo.timbrados.length > 0 && <label className="campo" style={{ maxWidth: 320 }}>Timbrado do documento
        <select value={timbrado} onChange={(e) => setTimbrado(e.target.value)}>
          <option value="">Sem timbrado</option>
          {processo.timbrados.map((t) => <option key={t.codigo} value={t.codigo}>{t.nome}</option>)}
        </select>
      </label>}
      {processo.solicitacoes.length > 0 && (
        <div className="tw">
          <table className="t">
            <thead><tr><th>Secretaria</th><th>Solicitação</th><th>Documento</th></tr></thead>
            <tbody>{processo.solicitacoes.map((s) => {
              const comprovantes = new Map<number, string>();
              const fontes = new Map<string, string>();
              for (const item of s.itens) for (const c of item.cotacoes ?? []) {
                const orcamento = processo.orcamentos.find((o) => o.id === c.orcamento_id);
                const fornecedor = limparNomeFornecedor(c.fornecedor) || nomeFornecedorOrcamento(orcamento) || "Fornecedor a identificar";
                if (c.orcamento_id != null) comprovantes.set(c.orcamento_id, orcamento?.nome ?? fornecedor);
                if (c.link) fontes.set(c.link, fornecedor);
              }
              return <tr key={s.id}>
                <td>{s.secretaria}</td>
                <td>{s.referencia && <strong>{s.referencia}</strong>}
                  {s.objeto && <div>{s.objeto}</div>}
                  {s.itens?.length > 0 && <div className="small muted">{s.itens.length} {s.itens.length === 1 ? "item" : "itens"}{totalDosItens(s.itens) != null ? ` · ${s.itens.some((i) => totalDoItem(i) == null) ? "subtotal dos itens com valor" : "total estimado"} ${brl(totalDosItens(s.itens))}` : ""}</div>}
                  {s.descricao && <details><summary>Ver solicitação</summary>
                    {podeAdicionar && <div className="tools">
                      <button type="button" className="btn sm" disabled={!!ocupado || cotando || !!modo} onClick={() => editar(s, true)}>Editar manualmente</button>
                    </div>}
                    <Folha texto={documentoDaSolicitacao(s.descricao, s.itens)} />
                  </details>}
                  {(comprovantes.size > 0 || fontes.size > 0) && <details><summary>Comprovantes e fontes das cotações</summary>
                    <ul>
                      {[...comprovantes].map(([id, nome]) => <li key={id}><a href={`/api/processos/${processo.id}/orcamentos/${id}/arquivo`}>{nome}</a></li>)}
                      {[...fontes].map(([link, fornecedor]) => <li key={link}><a href={link} target="_blank" rel="noreferrer">{fornecedor} · Abrir fonte</a></li>)}
                    </ul>
                  </details>}
                  <div className="tools">
                    {podeAdicionar && <button type="button" className="btn sm" disabled={!!ocupado || !!modo} onClick={() => editar(s, true)}>Alterar solicitação</button>}
                    {s.descricao && <>
                      <a className="btn sm" href={`/api${caminho}/${s.id}/docx${timbrado ? `?timbrado=${encodeURIComponent(timbrado)}` : ""}`}>Baixar Word</a>
                      <a className="btn sm" href={`/api${caminho}/${s.id}/pdf${timbrado ? `?timbrado=${encodeURIComponent(timbrado)}` : ""}`}>Baixar PDF</a>
                    </>}
                  </div>
                </td>
                <td>
                  {s.nome_arquivo && <div><a href={`/api${caminho}/${s.id}/arquivo`} download>{s.nome_arquivo}</a></div>}
                  {s.apoios.map((a) => <div key={a.id}><a href={`/api${caminho}/${s.id}/apoios/${a.id}`} download>{a.nome}</a></div>)}
                  {!s.nome_arquivo && !s.apoios.length && "—"}
                </td>
              </tr>;
            })}</tbody>
          </table>
        </div>
      )}
    </section>
  );
}
