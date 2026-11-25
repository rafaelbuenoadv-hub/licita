import { useEffect, useState, type FormEvent } from "react";
import { api, brl } from "../api";
import { ItensSolicitacao, lerLinhas, linhasDosItens, linhaVazia, type LinhaItem } from "./ItensSolicitacao";
import { TAMANHO_ANEXO_SOLICITACAO, TIPOS_ANEXOS_SOLICITACAO, totalDosItens, type ItemSolicitacao, type TopicoSolicitacao } from "../../../shared/solicitacao";
import type { OrcamentoLido } from "../../../shared/orcamentos";

interface Registro {
  id: number; secretaria: string; referencia: string; objeto: string; justificativa: string; informacoes: string;
  descricao: string; itens: ItemSolicitacao[]; topicos_adicionais?: TopicoSolicitacao[]; orcamentos_ocultos?: number[];
  nome_arquivo: string | null; apoios: { id: number; nome: string }[];
}
interface Props {
  processo: { id: number; objeto: string; requisitante: string; areas_adicionais: string[]; situacao: string;
    pode: { editar: boolean }; solicitacoes: Registro[]; orcamentos: OrcamentoLido[]; secretarias: string[] };
  recarregar: () => Promise<unknown>;
}

export function InstrucaoProcesso({ processo, recarregar }: Props) {
  const [aberto, setAberto] = useState(false), [edicao, setEdicao] = useState<Registro | null>(null);
  const [chave, setChave] = useState("");
  const [secretaria, setSecretaria] = useState(""), [referencia, setReferencia] = useState("");
  const [objeto, setObjeto] = useState(""), [justificativa, setJustificativa] = useState(""), [informacoes, setInformacoes] = useState("");
  const [topicos, setTopicos] = useState<TopicoSolicitacao[]>([]);
  const [linhas, setLinhas] = useState<LinhaItem[]>([linhaVazia()]);
  const [ocultos, setOcultos] = useState<number[]>([]);
  const [arquivo, setArquivo] = useState<File | null>(null), [apoios, setApoios] = useState<File[]>([]);
  const [ocupado, setOcupado] = useState(false), [cotando, setCotando] = useState(false), [progresso, setProgresso] = useState("");
  const [aviso, setAviso] = useState<{ texto: string; erro?: boolean }>();
  const [titular, setTitular] = useState<{ area: string; nome: string; portaria: string } | null>(null);
  const caminho = `/processos/${processo.id}/solicitacoes`;
  const pode = processo.pode.editar && processo.situacao === "preparacao";
  const areas = [...new Set([processo.requisitante, ...processo.areas_adicionais, ...processo.secretarias].filter(Boolean))];
  useEffect(() => {
    if (!aberto || secretaria.trim().length < 2) return;
    let ativo = true;
    const t = setTimeout(() => { api.post<{ titular: { nome: string; portaria: string } | null }[]>("/secretarios/titulares", { areas: [secretaria.trim()] })
      .then((r) => { if (ativo) setTitular(r[0]?.titular ? { area: secretaria.trim(), ...r[0].titular } : null); }).catch(() => { if (ativo) setTitular(null); }); }, 250);
    return () => { ativo = false; clearTimeout(t); };
  }, [aberto, secretaria]);
  const abrir = (s?: Registro) => {
    setEdicao(s ?? null); setChave(crypto.randomUUID()); setSecretaria(s?.secretaria ?? areas[0] ?? ""); setReferencia(s?.referencia ?? "");
    setObjeto(s?.objeto || processo.objeto); setJustificativa(s?.justificativa ?? ""); setInformacoes(s?.informacoes ?? "");
    setTopicos(s?.topicos_adicionais ?? []); setLinhas(s ? linhasDosItens(s.itens, processo.orcamentos) : [linhaVazia()]); setOcultos(s?.orcamentos_ocultos ?? []);
    setArquivo(null); setApoios([]); setAberto(true); setAviso(undefined);
  };
  const salvar = async (ev: FormEvent) => {
    ev.preventDefault(); if (ocupado || cotando) return;
    setOcupado(true); setAviso(undefined);
    try {
      const lidas = lerLinhas(linhas); if (lidas.erro) throw new Error(lidas.erro);
      if (objeto.trim().length < 5) throw new Error("Informe o objeto da contratação.");
      if ([...(arquivo ? [arquivo] : []), ...apoios].some((a) => !a.size || a.size > TAMANHO_ANEXO_SOLICITACAO)) throw new Error("Anexe arquivos não vazios, de até 20 MB cada.");
      const dados = new FormData();
      dados.set("cadastro", "true"); dados.set("secretaria", secretaria); dados.set("referencia", referencia);
      dados.set("objeto_solicitacao", objeto); dados.set("justificativa", justificativa); dados.set("informacoes", informacoes);
      // Registros antigos ficam preservados; novos cadastros não montam texto de solicitação.
      dados.set("descricao", edicao?.descricao ?? ""); dados.set("itens", JSON.stringify(lidas.itens));
      dados.set("topicos_adicionais", JSON.stringify(topicos)); dados.set("orcamentos_ocultos", JSON.stringify(ocultos));
      if (arquivo) dados.set("arquivo", arquivo);
      const ids: number[] = [];
      for (const [i, a] of apoios.entries()) {
        setProgresso(`Enviando documento de apoio ${i + 1} de ${apoios.length}…`);
        const envio = new FormData(); envio.set("chave", chave); envio.set("apoios", a);
        const r = await api.post<{ ids: number[] }>(`${caminho}/apoios`, envio); ids.push(...r.ids);
      }
      if (ids.length) { dados.set("chave_apoios", chave); dados.set("apoios_ids", JSON.stringify(ids)); }
      if (edicao) {
        dados.set("anterior", edicao.descricao); dados.set("itens_anteriores", JSON.stringify(edicao.itens));
        dados.set("topicos_anteriores", JSON.stringify(edicao.topicos_adicionais ?? [])); dados.set("orcamentos_ocultos_anteriores", JSON.stringify(edicao.orcamentos_ocultos ?? []));
        dados.set("dados_anteriores", JSON.stringify({ objeto: edicao.objeto, justificativa: edicao.justificativa, informacoes: edicao.informacoes ?? "" }));
        await api.put(`${caminho}/${edicao.id}`, dados);
      } else { dados.set("chave_envio", chave); await api.post(caminho, dados); }
      await recarregar(); setAberto(false); setEdicao(null);
      setAviso({ texto: "Dados da instrução salvos. As informações estão disponíveis para o DFD e o ETP." });
    } catch (e) { setAviso({ texto: e instanceof Error ? e.message : "Não foi possível salvar os dados.", erro: true }); }
    finally { setOcupado(false); setProgresso(""); }
  };
  return <section className="sec stack" id="instrucao-processo">
    <div><h3>Instrução do processo</h3><p className="small muted">Cadastre as informações da contratação. Os dados serão usados no DFD e no ETP; esta etapa não gera documento próprio.</p></div>
    {pode && !aberto && <div><button type="button" className="btn pri" onClick={() => abrir()}>Adicionar informações de uma secretaria</button></div>}
    {pode && aberto && <form className="stack" onSubmit={salvar}>
      <fieldset className="form" disabled={ocupado} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
        <label>Secretaria<input list="areas-instrucao" required minLength={2} maxLength={200} value={secretaria} disabled={!!edicao} onChange={(e) => setSecretaria(e.target.value)} /></label>
        <datalist id="areas-instrucao">{areas.map((a) => <option key={a} value={a} />)}</datalist>
        <label>Memorando ou referência (opcional)<input maxLength={120} value={referencia} disabled={!!edicao} onChange={(e) => setReferencia(e.target.value)} /></label>
        {titular?.area === secretaria.trim() && <div className="wide small muted">Secretário(a): <strong>{titular.nome}</strong>{titular.portaria && ` · Portaria ${titular.portaria}`}</div>}
        <label className="wide">Objeto da contratação<input required minLength={5} maxLength={4000} value={objeto} onChange={(e) => setObjeto(e.target.value)} /></label>
        <label className="wide">Justificativa da necessidade<textarea maxLength={8000} rows={4} value={justificativa} onChange={(e) => setJustificativa(e.target.value)} placeholder="Qual necessidade a contratação vai atender?" /></label>
        <label className="wide">Informações complementares (opcional)<textarea maxLength={8000} rows={4} value={informacoes} onChange={(e) => setInformacoes(e.target.value)} placeholder="Prazo, local de atendimento, condições de entrega e outras informações para o DFD e o ETP." /></label>
        <fieldset className="wide itens-sol stack"><legend>Tópicos adicionais (opcional)</legend>
          <p className="small muted">Os tópicos preenchidos serão aproveitados no DFD e no ETP.</p>
          {topicos.map((t, i) => <div className="panel box pad stack" key={i}>
            <label>Título do tópico {i + 1}<input maxLength={200} value={t.titulo} onChange={(e) => setTopicos(topicos.map((v, k) => i === k ? { ...v, titulo: e.target.value } : v))} /></label>
            <label>Conteúdo do tópico {i + 1}<textarea maxLength={8000} rows={3} value={t.conteudo} onChange={(e) => setTopicos(topicos.map((v, k) => i === k ? { ...v, conteudo: e.target.value } : v))} /></label>
            <div><button type="button" className="lnk" onClick={() => setTopicos(topicos.filter((_, k) => i !== k))}>Remover tópico {i + 1}</button></div>
          </div>)}
          <div><button type="button" className="btn" disabled={topicos.length >= 20} onClick={() => setTopicos([...topicos, { titulo: "", conteudo: "" }])}>Adicionar tópico</button></div>
        </fieldset>
        <fieldset className="wide itens-sol stack"><legend>Documentos de apoio</legend>
          <label>Anexar documentos de apoio<input type="file" multiple accept={TIPOS_ANEXOS_SOLICITACAO} onChange={(e) => { const selecionados = Array.from(e.target.files ?? []); setApoios((atuais) => [...atuais, ...selecionados]); e.target.value = ""; }} /></label>
          {edicao?.apoios.map((a) => <a key={a.id} href={`/api${caminho}/${edicao.id}/apoios/${a.id}`}>{a.nome}</a>)}
          {apoios.map((a, i) => <div key={`${a.name}-${i}`}>{a.name} <button type="button" className="lnk" onClick={() => setApoios(apoios.filter((_, k) => i !== k))}>Remover arquivo</button></div>)}
          {!edicao && <label>Documento de origem (opcional)<input type="file" accept=".pdf,.docx,.txt,.md,.csv" onChange={(e) => setArquivo(e.target.files?.[0] ?? null)} /></label>}
          <p className="small muted">Até 20 MB por arquivo. Os anexos acompanham o processo completo.</p>
        </fieldset>
        <details className="wide subtopico-orcamentos" open><summary>Itens e orçamentos da instrução</summary><div className="pad stack">
          <ItensSolicitacao processoId={processo.id} linhas={linhas} setLinhas={setLinhas} orcamentos={processo.orcamentos}
            orcamentosOcultos={ocultos} setOrcamentosOcultos={setOcultos} recarregar={recarregar} ia={false} ocupado={ocupado} setCotando={setCotando} />
        </div></details>
      </fieldset>
      {progresso && <p className="small muted" role="status">{progresso}</p>}
      <div className="tools"><button className="btn pri" disabled={ocupado || cotando}>{ocupado ? "Salvando…" : "Salvar dados da instrução"}</button>
        <button type="button" className="btn" disabled={ocupado || cotando} onClick={() => { setAberto(false); setEdicao(null); }}>Cancelar</button></div>
    </form>}
    {aviso && <p className={`note ${aviso.erro ? "bad" : "ok"}`} role={aviso.erro ? "alert" : "status"}>{aviso.texto}</p>}
    {processo.solicitacoes.map((s) => <article key={s.id} className="panel pad stack">
      <div className="row"><h4>{s.secretaria}{s.referencia ? ` · ${s.referencia}` : ""}</h4>{pode && !aberto && <button type="button" className="btn sm" onClick={() => abrir(s)}>Editar dados da instrução</button>}</div>
      <p><strong>Objeto:</strong> {s.objeto || processo.objeto}</p>
      {s.justificativa && <p style={{ whiteSpace: "pre-wrap" }}><strong>Justificativa:</strong> {s.justificativa}</p>}
      {s.informacoes && <p style={{ whiteSpace: "pre-wrap" }}><strong>Informações complementares:</strong> {s.informacoes}</p>}
      <p className="small muted">{s.itens.length} itens{totalDosItens(s.itens) != null ? ` · Estimativa: ${brl(totalDosItens(s.itens))}` : ""} · Dados de apoio ao DFD e ao ETP.</p>
      {(s.topicos_adicionais ?? []).map((t, i) => <p key={i} style={{ whiteSpace: "pre-wrap" }}><strong>{t.titulo}</strong>{t.conteudo && `\n${t.conteudo}`}</p>)}
      {s.nome_arquivo && <a href={`/api${caminho}/${s.id}/arquivo`}>{s.nome_arquivo}</a>}
      {s.apoios.map((a) => <a key={a.id} href={`/api${caminho}/${s.id}/apoios/${a.id}`}>{a.nome}</a>)}
      {s.descricao && <details><summary>Registro anterior preservado</summary><pre style={{ whiteSpace: "pre-wrap", fontFamily: "inherit" }}>{s.descricao}</pre></details>}
    </article>)}
  </section>;
}
