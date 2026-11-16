import { Fragment, useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { compararOrcamentos, nomeFornecedorOrcamento, type DadosOrcamento } from "../../../shared/orcamentos";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { api, brl, dataBR, dataHora, fluxo, fmtNum, numBR } from "../api";
import { Folha } from "../comp/Folha";
import { ETAPAS, TIPOS, VIAS, feita, feitos, itensDe, liberada, pendencias, podeMarcar, type Checks } from "../../../shared/etapas";
import { tem, useEu } from "../main";
import { CamposProcesso, paraApi, type DadosProc, type PlanoConsulta } from "./NovoProcesso";
import { Solicitacoes } from "./Solicitacoes";

const ACOES: Record<string, string> = {
  "processo.criado": "abriu o processo", "processo.alterado": "alterou os dados", "processo.situacao": "mudou a situação", "processo.numerado": "gerou o nº do processo e do procedimento", "etapa.concluida": "conferiu e concluiu a etapa",
  "item.marcado": "conferiu item", "item.desmarcado": "desmarcou item", "minuta.salva": "salvou minuta", "minuta.ia": "gerou minuta com IA",
  "minuta.pendencias": "preencheu campos pendentes", "anexo.incluido": "anexou documento", "orcamento.incluido": "anexou orçamento", "orcamento.removido": "removeu orçamento", "orcamento.lido": "pediu a leitura de orçamento à IA", "orcamento.fornecedor": "identificou o fornecedor do orçamento", "orcamento.valor": "informou valor de orçamento", "anexo.removido": "removeu documento",
  "minuta.titulares": "incluiu os titulares no DFD",
  "solicitacao.incluida": "adicionou solicitação de secretaria", "solicitacao.alterada": "editou solicitação de secretaria",
  "ia.sugestoes": "pediu sugestões à IA", "contrato.criado": "registrou contrato",
};

export function ProcessoPg() {
  const { id } = useParams();
  const { eu, ia } = useEu();
  const [p, setP] = useState<any>(null);
  const [erro, setErro] = useState("");
  const [params, setParams] = useSearchParams();
  const irPara = (aba: string) => {
    const proxima = new URLSearchParams(params);
    proxima.set("aba", aba);
    setParams(proxima, { preventScrollReset: true });
  };
  const [aviso, setAviso] = useState<{ t: string; tipo?: string } | null>(null);

  const carregar = useCallback(async () => {
    try { const r = await api.get(`/processos/${id}`); setP(r); return r; }
    catch (e: any) { setErro(e.message); }
  }, [id]);
  useEffect(() => { void carregar(); }, [carregar]);

  if (erro) return <p className="note bad">{erro}</p>;
  if (!p) return <p className="muted">Carregando processo…</p>;
  const checks: Checks = Object.fromEntries(p.checagens.map((c: { item: string }) => [c.item, true]));
  const aba = params.get("aba");
  const etapaPedida = ETAPAS.findIndex((e) => e.id === aba);
  const abriuDfd = p.minutas.some((m: { etapa: string }) => m.etapa === "dfd") || feitos(ETAPAS[0], p, checks) > 0;
  const mostrarSolicitacao = aba === "solicitacao" || (etapaPedida < 0 && p.etapa_atual === 0 && !abriuDfd);
  const ix = etapaPedida >= 0 ? etapaPedida : p.etapa_atual;
  const e = ETAPAS[ix];

  return (
    <>
      <div className="row">
        <div className="stack" style={{ gap: 2 }}>
          <span className="lbl mono">{[`Protocolo ${p.protocolo}`, p.numero && `PA ${p.numero}`, p.procedimento].filter(Boolean).join(" · ")}</span>
          <h1>{p.objeto}</h1>
          <span className="small muted">{[TIPOS[p.tipo as keyof typeof TIPOS], VIAS[p.via as keyof typeof VIAS], brl(p.valor_estimado), `Exercício ${p.ano}`].join(" · ")}</span>
        </div>
        <div className="tools">
          {p.situacao !== "preparacao" && <span className={"pill " + (p.situacao === "cancelado" ? "bad" : "ok")}>{{ publicado: "Publicado", contratado: "Contratado", cancelado: "Cancelado" }[p.situacao as string]}</span>}
          <Link className="btn" to="/processos">Todos os processos</Link>
        </div>
      </div>
      {aviso && <p className={"note " + (aviso.tipo ?? "")}>{aviso.t} <button className="lnk" onClick={() => setAviso(null)}>Fechar</button></p>}
      <p className="small"><strong>PCA</strong> · {p.pca_item_id ? "Vinculado ao plano do exercício" : "Sem vínculo confirmado. Consulte Dados do processo para conferir o objeto."}</p>
      <Dados p={p} recarregar={carregar} setAviso={setAviso} abrir={params.get("editar") === "1"} />
      <Numeracao key={`n${p.numero}|${p.procedimento}`} p={p} recarregar={carregar} setAviso={setAviso} />

      <div className="mesa">
        <nav className="panel trilha" aria-label="Solicitação e etapas do processo">
          <button type="button" className={`et${mostrarSolicitacao ? " sel" : ""}`}
            aria-current={mostrarSolicitacao ? "page" : undefined} onClick={() => irPara("solicitacao")}>
            <span className="n">1</span><span className="tx"><span className="nm">Solicitação</span><br /><span className="st">Pedidos, itens e orçamentos</span></span>
          </button>
          {ETAPAS.map((x, i) => {
            const f = feita(x, p, checks), l = liberada(i, p, checks);
            const c = f ? "ok" : i === p.etapa_atual ? "cur" : l ? "" : "lock";
            const selecionada = !mostrarSolicitacao && i === ix;
            return (
              <button key={x.id} type="button" className={`et ${c}${selecionada ? " sel" : ""}`} onClick={() => irPara(x.id)} title={x.nome} aria-current={selecionada ? "step" : undefined}>
                <span className="n">{i + 2}</span>
                <span className="tx"><span className="nm">{x.nome}</span><br /><span className="st">{f ? "Concluída" : l ? `${feitos(x, p, checks)} de ${itensDe(x, p).length} itens` : "Bloqueada"}</span></span>
              </button>);
          })}
        </nav>
        {mostrarSolicitacao ? (
          <section className="panel" style={{ minWidth: 0 }} aria-labelledby="aba-solicitacao">
            <div className="sec row">
              <div><span className="lbl">Etapa 1 de {ETAPAS.length + 1}</span><h2 id="aba-solicitacao">Solicitação</h2></div>
              <button className="btn" type="button" onClick={() => irPara("dfd")}>Abrir DFD →</button>
            </div>
            <Solicitacoes key={p.id} processo={p} recarregar={carregar} />
          </section>
        ) : <Etapa key={e.id} p={p} e={e} ix={ix} checks={checks} recarregar={carregar} setAviso={setAviso} irPara={irPara} />}
        <Assistente key={`${p.id}-${mostrarSolicitacao ? "solicitacao" : "etapas"}`} p={p} etapa={mostrarSolicitacao ? "solicitacao" : e.id} disponivel={ia.disponivel} />
      </div>

      <Anexos p={p} recarregar={carregar} podeIncluir={tem(eu, "requisitante", "contratacao", "juridico")} />
      <Historico id={p.id} versao={p.checagens.length + (p.minutas?.length ?? 0) + (p.orcamentos?.length ?? 0) + p.solicitacoes.length} atualizado={p.atualizado_em} />
    </>
  );
}

/* ---------- numeração final ---------- */
function Numeracao({ p, recarregar, setAviso }: { p: any; recarregar: () => Promise<any>; setAviso: (a: any) => void }) {
  const tem = Boolean(p.numero || p.procedimento);
  const [f, setF] = useState({ numero: p.numeracao.sugestao.numero as string, procedimento: p.numeracao.sugestao.procedimento as string });
  const [busy, setBusy] = useState(false);
  const pode = p.pode.numerar && p.numeracao.liberada && p.situacao !== "cancelado";
  const gravar = async (ev: FormEvent) => {
    ev.preventDefault(); setBusy(true);
    try { await api.post(`/processos/${p.id}/numeracao`, f); await recarregar(); setAviso({ t: "Nº do processo e do procedimento gravados.", tipo: "ok" }); }
    catch (e: any) { setAviso({ t: e.message, tipo: "bad" }); }
    finally { setBusy(false); }
  };
  return (
    <details className="panel box" open={p.numeracao.liberada && !tem}>
      <summary>Nº do processo e do procedimento{tem ? "" : " (gerados por último)"}</summary>
      <form className="pad stack" onSubmit={gravar}>
        <p className="small muted">
          {!p.numeracao.liberada ? `Até o fim da preparação o processo é identificado só pelo protocolo ${p.protocolo}. A numeração é liberada quando a trilha chega à etapa de autorização e publicação.`
            : tem ? "Numeração gravada. Quem atua em contratações pode corrigir, se necessário."
            : "A trilha chegou à última etapa. O sistema sugere os próximos números do exercício; confira com a numeração oficial do órgão e ajuste antes de gravar."}
        </p>
        {(p.numeracao.liberada || tem) && <fieldset disabled={!pode} style={{ border: 0, padding: 0, margin: 0 }}><div className="form">
          <label>Processo administrativo nº<input id="n-numero" value={f.numero} onChange={(e) => setF({ ...f, numero: e.target.value })} required maxLength={60} /></label>
          <label>Procedimento e nº<input id="n-procedimento" value={f.procedimento} onChange={(e) => setF({ ...f, procedimento: e.target.value })} required maxLength={120} /></label>
        </div></fieldset>}
        {pode && <div><button className="btn pri" disabled={busy}>{busy ? "Gravando…" : tem ? "Corrigir numeração" : "Gerar numeração"}</button></div>}
        {p.numeracao.liberada && !p.pode.numerar && !tem && <p className="small muted">A numeração é gravada pelo setor de contratações ou pela autoridade competente.</p>}
      </form>
    </details>
  );
}

/* ---------- dados do processo ---------- */
function Dados({ p, recarregar, setAviso, abrir }: { p: any; recarregar: () => Promise<any>; setAviso: (a: any) => void; abrir: boolean }) {
  const painel = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (!abrir || !painel.current) return;
    painel.current.open = true;
    painel.current.scrollIntoView({ block: "start" });
    painel.current.querySelector<HTMLElement>("input")?.focus({ preventScroll: true });
  }, [abrir, p.id]);
  const { eu } = useEu();
  const [d, setD] = useState<DadosProc>(() => ({
    requisitante: p.requisitante, areas_adicionais: p.areas_adicionais, objeto: p.objeto, tipo: p.tipo, via: p.via,
    valor: fmtNum(p.valor_estimado), classe: p.classe, ano: String(p.ano), pca_item_id: p.pca_item_id ? String(p.pca_item_id) : "", normas: p.normas, obs: p.obs,
  }));
  const [plano, setPlano] = useState<PlanoConsulta | null>(null);
  const [confirma, setConfirma] = useState(false);
  useEffect(() => { api.get<PlanoConsulta>(`/pca?ano=${d.ano}`).then(setPlano).catch(() => setPlano(null)); }, [d.ano]);
  const salvar = async (ev: FormEvent) => {
    ev.preventDefault();
    try { await api.put(`/processos/${p.id}`, paraApi(d)); await recarregar(); setAviso({ t: "Dados do processo salvos.", tipo: "ok" }); }
    catch (e: any) { setAviso({ t: e.message, tipo: "bad" }); }
  };
  const situacao = async (s: string) => {
    try { await api.post(`/processos/${p.id}/situacao`, { situacao: s }); setConfirma(false); await recarregar(); }
    catch (e: any) { setAviso({ t: e.message, tipo: "bad" }); }
  };
  const pode = tem(eu, "requisitante", "contratacao");
  return (
    <details ref={painel} className="panel box" id="dados-processo">
      <summary>Dados do processo</summary>
      <form className="pad stack" onSubmit={salvar}>
        <fieldset disabled={!pode} style={{ border: 0, padding: 0, margin: 0 }}><CamposProcesso d={d} set={setD} plano={plano} podeEditar={pode} /></fieldset>
        <p className="small muted">Mudar o tipo de objeto ou a forma de contratação altera os itens de conferência; marcações que deixarem de existir são removidas.</p>
        <div className="tools">
          {pode && <button className="btn pri">Salvar dados</button>}
          {tem(eu, "contratacao", "autoridade") && p.concluido && p.situacao === "preparacao" && <button type="button" className="btn" onClick={() => situacao("publicado")}>Marcar como publicado</button>}
          {tem(eu, "contratacao", "autoridade") && p.situacao !== "cancelado" && (confirma
            ? <><button type="button" className="btn danger" onClick={() => situacao("cancelado")}>Confirmar cancelamento</button><button type="button" className="btn" onClick={() => setConfirma(false)}>Voltar</button></>
            : <button type="button" className="btn danger sm" onClick={() => setConfirma(true)}>Cancelar processo</button>)}
          {tem(eu, "contratacao", "autoridade") && p.situacao === "cancelado" && <button type="button" className="btn" onClick={() => situacao("preparacao")}>Reabrir processo</button>}
        </div>
      </form>
    </details>
  );
}

/* ---------- etapa aberta ---------- */
function Etapa({ p, e, ix, checks, recarregar, setAviso, irPara }: any) {
  const { eu } = useEu();
  const lib = liberada(ix, p, checks), ok = feita(e, p, checks), its = itensDe(e, p), nf = feitos(e, p, checks);
  const atua = podeMarcar(eu.papeis, e);
  const quem = Object.fromEntries(p.checagens.map((c: any) => [c.item, c]));
  const [salvando, setSalvando] = useState<string | null>(null);
  const marcar = async (item: string, marcado: boolean) => {
    setSalvando(item);
    try { await api.post(`/processos/${p.id}/checagens`, { item, marcado }); await recarregar(); }
    catch (er: any) { setAviso({ t: er.message, tipo: "bad" }); }
    finally { setSalvando(null); }
  };
  const prox = ETAPAS[ix + 1];
  const [conf, setConf] = useState<{ codigo: string; texto: string; onde: string; alvo?: string; bloqueia: boolean }[] | null>(null);
  const [conferindo, setConferindo] = useState(false);
  const concluir = async () => {
    setConferindo(true);
    try {
      const r = await api.post(`/processos/${p.id}/etapas/${e.id}/concluir`);
      await recarregar();
      if (!r.concluida) { setConf(r.pendencias); return; }
      setConf(null);
      const avisos = (r.pendencias as { texto: string }[]).map((x) => x.texto).join(" ");
      setAviso({ t: `${e.nome}: etapa conferida e concluída.${r.proxima?.rascunho ? ` A minuta de "${r.proxima.nome}" foi aberta com objeto, justificativa, quantidades e área requisitante aproveitados.` : ""}${avisos ? ` Atenção: ${avisos}` : ""}`, tipo: avisos ? "" : "ok" });
      if (r.proxima) irPara(r.proxima.id);
    } catch (er: any) { setAviso({ t: er.message, tipo: "bad" }); }
    finally { setConferindo(false); }
  };
  const irAte = (x: { onde: string; alvo?: string }) => {
    const mostra = (el: HTMLElement | null) => { el?.scrollIntoView({ behavior: "smooth", block: "center" }); el?.focus({ preventScroll: true }); };
    if (x.onde === "conferencia") mostra(document.getElementById("c-" + x.alvo));
    else if (x.onde === "minuta") document.getElementById("minuta-etapa")?.scrollIntoView({ behavior: "smooth", block: "start" });
    else if (x.onde === "dados") {
      const d = document.getElementById("dados-processo") as HTMLDetailsElement | null;
      if (d) d.open = true;
      setTimeout(() => mostra(document.getElementById("p-" + x.alvo)), 60);
    }
  };
  return (
    <section className="panel" style={{ minWidth: 0 }}>
      <div className="sec">
        <div className="row"><div><span className="lbl">Etapa {ix + 2} de {ETAPAS.length + 1}</span><h2>{e.nome}</h2></div>
          <span className={"pill " + (ok ? "ok" : lib ? "cur" : "")}>{ok ? "Concluída" : lib ? `${nf} de ${its.length} itens` : "Bloqueada"}</span></div>
        {e.doc && <p className="small muted">Documento da etapa: {e.doc}</p>}
        <p style={{ maxWidth: "72ch" }}>{e.oque}</p>
        <div className="base">{e.base.map((b: any) => b.url ? <a key={b.rotulo} href={b.url} target="_blank" rel="noopener">{b.rotulo}</a> : <span key={b.rotulo}>{b.rotulo}</span>)}</div>
        {!lib && <p className="note">Conclua a etapa "{ETAPAS[p.etapa_atual].nome}" para liberar esta.</p>}
        {lib && !atua && <p className="note">Seu perfil acompanha esta etapa, mas quem marca os itens é: {e.papeis.join(", ")}.</p>}
      </div>
      <div className="sec"><span className="lbl">Conferência obrigatória</span>
        <ul className="chk">{its.map((i: any) => {
          const q = quem[i.id];
          return (
            <li key={i.id} className={q ? "done" : ""}>
              <input type="checkbox" id={"c-" + i.id} checked={!!q} disabled={!lib || !atua || salvando !== null || p.situacao === "cancelado"} onChange={(ev) => marcar(i.id, ev.target.checked)} />
              <label htmlFor={"c-" + i.id}><span>{i.texto}</span>
                <span className="b">{[i.base, q && `conferido por ${q.usuario ?? "—"} em ${dataHora(q.em)}`].filter(Boolean).join(" · ")}</span></label>
            </li>);
        })}</ul>
      </div>
      {e.id === "precos" && <Orcamentos p={p} recarregar={recarregar} setAviso={setAviso} irAosItens={() => irPara("solicitacao")} />}
      {e.id === "precos" && p.via === "dispensa" && <Fracionamento id={p.id} />}
      <div className="sec"><span className="lbl">Erros que costumam voltar do jurídico</span>
        <ul className="aten">{e.atencao.map((a: string) => <li key={a}>{a}</li>)}</ul></div>
      {e.modelo && <Minuta p={p} e={e} editavel={lib && atua && p.situacao !== "cancelado"} setAviso={setAviso} />}
      {conf && conf.length > 0 && <div className="sec" role="status" aria-live="polite"><span className="lbl">Pendências da etapa</span>
        <p className="small muted">{conf.filter((x) => x.bloqueia).length} {conf.filter((x) => x.bloqueia).length === 1 ? "ajuste impede" : "ajustes impedem"} a conclusão. Resolva e clique de novo em "Concluir e avançar".</p>
        <ul className="pends">{conf.map((x, i) => (
          <li key={i} className={x.bloqueia ? "" : "aviso"}>
            <span>{x.bloqueia ? "" : "Aviso: "}{x.texto}</span>
            {x.onde === "config" ? <Link className="btn sm" to="/config">Abrir Configurações</Link>
              : <button className="btn sm" onClick={() => irAte(x)}>{x.onde === "conferencia" ? "Ir ao item" : x.onde === "minuta" ? "Ir à minuta" : "Ir ao campo"}</button>}
          </li>))}</ul>
      </div>}
      <div className="sec row">
        {ix > 0 ? <button className="btn" onClick={() => irPara(ETAPAS[ix - 1].id)}>← {ETAPAS[ix - 1].nome}</button> : <button className="btn" type="button" onClick={() => irPara("solicitacao")}>← Solicitação</button>}
        <div className="tools">
          {lib && atua && p.situacao !== "cancelado" && <button className="btn pri" disabled={conferindo} onClick={concluir}>{conferindo ? "Conferindo…" : prox ? "Concluir e avançar" : "Conferir e concluir"}</button>}
          {prox ? <button className="btn" disabled={!ok} onClick={() => irPara(prox.id)}>{ok ? "" : `Faltam ${its.length - nf} · `}{prox.nome} →</button>
            : <span className={"pill " + (ok ? "ok" : "")}>{ok ? "Fase preparatória concluída" : "Última etapa"}</span>}
        </div>
      </div>
    </section>
  );
}

/* Consulta e comparação dos orçamentos do processo na etapa de preços. */
function Orcamentos({ p, recarregar, setAviso, irAosItens }: { p: any; recarregar: () => Promise<any>; setAviso: (a: any) => void; irAosItens: () => void }) {
  const { eu, ia } = useEu();
  const pode = tem(eu, "requisitante", "contratacao") && p.situacao !== "cancelado";
  const [lendo, setLendo] = useState<number[]>([]);
  const lista: any[] = p.orcamentos ?? [];
  const legivel = (nome: string) => /\.(pdf|jpe?g|png|docx|xlsx|txt|csv)$/i.test(nome);
  const alertas = compararOrcamentos(lista, new Date().toLocaleDateString("sv-SE"));
  /** Pede à IA a leitura de cada orçamento, um por vez, e mostra o que não pôde ser lido. */
  const ler = async (ids: number[]) => {
    const falhas: string[] = [];
    for (const id of ids) {
      setLendo((l) => [...l, id]);
      try { await api.post(`/processos/${p.id}/orcamentos/${id}/ler`); }
      catch (e: any) { falhas.push(e.message); }
      finally { setLendo((l) => l.filter((x) => x !== id)); await recarregar(); }
    }
    if (falhas.length) setAviso({ t: `Não foi possível ler ${falhas.length === 1 ? "um orçamento" : `${falhas.length} orçamentos`}: ${falhas[0]}`, tipo: "bad" });
  };
  const remover = async (o: any) => {
    try { await api.del(`/processos/${p.id}/orcamentos/${o.id}`); await recarregar(); }
    catch (e: any) { setAviso({ t: e.message, tipo: "bad" }); }
  };
  const gravarValor = async (o: any, txt: string) => {
    const v = numBR(txt);
    if (Number.isNaN(v)) return setAviso({ t: "Valor do orçamento inválido. Use, por exemplo, 12.500,00.", tipo: "bad" });
    if (v === o.valor) return;
    try { await api.put(`/processos/${p.id}/orcamentos/${o.id}`, { valor: v }); await recarregar(); }
    catch (e: any) { setAviso({ t: e.message, tipo: "bad" }); }
  };
  const gravarFornecedor = async (o: { id: number; nome: string; fornecedor?: string; fornecedor_manual?: string | null; dados: DadosOrcamento | null }, texto: string) => {
    const fornecedor = texto.trim();
    if (fornecedor === nomeFornecedorOrcamento(o)) return;
    try { await api.put(`/processos/${p.id}/orcamentos/${o.id}`, { fornecedor }); await recarregar(); }
    catch (e) { setAviso({ t: e instanceof Error ? e.message : "Não foi possível salvar o fornecedor.", tipo: "bad" }); }
  };
  const inclusao = (v: string) => v === "incluso" ? "incluído" : v === "nao_incluso" ? "não incluído" : "não informado";
  return (
    <div className="sec"><span className="lbl">Orçamentos</span>
      <p className="small muted">Consulte as propostas do processo e registre as cotações na Solicitação.</p>
      {lista.length === 0 ? <p className="muted">Nenhum orçamento anexado.</p> :
        <div className="tw"><table className="t">
          <thead><tr><th>Orçamento</th><th>Fornecedor</th><th className="r">Valor (R$)</th><th /></tr></thead>
          <tbody>{lista.map((o) => {
            const d = o.dados as DadosOrcamento | null;
            const fornecedor = nomeFornecedorOrcamento(o);
            return (<Fragment key={o.id}>
            <tr className={d ? "com-leitura" : ""}>
              <td><a href={`/api/processos/${p.id}/orcamentos/${o.id}/arquivo`} download>{o.nome}</a>
                <div className="small muted">{o.usuario ?? "—"} · {dataHora(o.criado_em)}</div>
                {lendo.includes(o.id) && <div className="small" role="status">A IA está lendo este orçamento…</div>}</td>
              <td>{pode ? <input key={`${o.id}-${fornecedor}`} aria-label={`Fornecedor do orçamento ${o.nome}`} maxLength={200}
                defaultValue={fornecedor} placeholder="Identifique o fornecedor" onBlur={(e) => gravarFornecedor(o, e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }} /> : (fornecedor || "A identificar")}</td>
              <td className="r" style={{ width: 150 }}>{pode
                ? <input key={`${o.id}-${o.valor}`} aria-label={`Valor do orçamento ${o.nome}`} defaultValue={fmtNum(o.valor)} placeholder="informar" inputMode="decimal" style={{ textAlign: "right" }}
                    onBlur={(e) => gravarValor(o, e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
                : brl(o.valor)}</td>
              <td className="r">{pode && <div className="stack" style={{ gap: 4, alignItems: "flex-end" }}>
                {ia.disponivel && legivel(o.nome) && <button className="lnk" disabled={lendo.length > 0} onClick={() => ler([o.id])}>{d ? "Ler de novo" : "Ler com IA"}</button>}
                <button className="lnk" onClick={() => remover(o)}>Remover</button></div>}</td></tr>
            {d && <tr><td colSpan={4}>
                <details className="lido">
                  <summary>{fornecedor || "Fornecedor a identificar"}{d.cnpj ? ` · ${d.cnpj}` : ""}{d.data ? ` · ${dataBR(d.data)}` : ""} · {d.itens.length} {d.itens.length === 1 ? "item" : "itens"}</summary>
                  <p className="small muted">Lido pela IA em {dataHora(o.lido_em)}. Validade: {d.validade ? dataBR(d.validade) : "não consta"} · Frete: {inclusao(d.frete)} · Instalação: {inclusao(d.instalacao)}{d.prazo_entrega ? ` · Entrega: ${d.prazo_entrega}` : ""}</p>
                  {d.itens.length > 0 && <div className="tw"><table className="t">
                    <thead><tr><th>Item</th><th className="r">Qtd.</th><th>Un.</th><th className="r">Unitário</th><th className="r">Total</th></tr></thead>
                    <tbody>{d.itens.map((it, k) => <tr key={k}><td>{it.descricao}</td><td className="r">{it.quantidade ?? "—"}</td><td>{it.unidade ?? "—"}</td><td className="r">{brl(it.valor_unitario)}</td><td className="r">{brl(it.valor_total)}</td></tr>)}</tbody>
                    <tfoot><tr><td colSpan={4} className="r"><b>Total da proposta</b></td><td className="r"><b>{brl(d.valor_total)}</b></td></tr></tfoot>
                  </table></div>}
                  {d.observacoes && <p className="small">{d.observacoes}</p>}
                </details></td></tr>}
            </Fragment>);
          })}</tbody>
        </table></div>}
      {alertas.length > 0 && <div role="status"><span className="lbl">Pontos de atenção na comparação</span>
        <ul className="pends">{alertas.map((a, k) => <li key={k} className="aviso"><span>{a.texto}</span></li>)}</ul></div>}
      <button className="btn sm" type="button" onClick={irAosItens}>Ir aos itens da Solicitação</button>
    </div>
  );
}

function Fracionamento({ id }: { id: number }) {
  const [d, setD] = useState<any>(null);
  useEffect(() => { api.get(`/processos/${id}/fracionamento`).then(setD).catch(() => {}); }, [id]);
  if (!d?.classe) return null;
  const c = d.classe;
  return (
    <div className="sec"><span className="lbl">Somatório do exercício (art. 75, § 1º)</span>
      <p>Dispensas por valor de "{c.classe}" no exercício: <b className="num">{brl(c.dispensas)}</b>
        {c.limite != null ? <> · limite do inciso {c.inciso}: <b className="num">{brl(c.limite)}</b> <span className="small muted">({c.limite_fonte})</span></> : <> · limite do inciso {c.inciso} não cadastrado para o exercício</>}</p>
      {c.alerta === "excede" && <p className="note bad">O somatório passa do limite: há risco de fracionamento. Reavalie a forma de contratação.</p>}
      {c.alerta === "planejado_excede" && <p className="note">O planejado no PCA para esta natureza passa do limite. Justifique por que esta contratação não fraciona a despesa.</p>}
      {d.outros.length > 0 && <p className="small muted">Outras dispensas da mesma natureza: {d.outros.map((o: any) => `${o.numero ? `PA ${o.numero}` : o.protocolo} (${brl(o.valor_estimado)})`).join("; ")}.</p>}
    </div>
  );
}

/* ---------- minuta ---------- */
function Minuta({ p, e, editavel, setAviso }: { p: any; e: any; editavel: boolean; setAviso: (a: any) => void }) {
  const [timbrado, setTimbrado] = useState("");
  const { ia } = useEu();
  const [m, setM] = useState<{ vigente: any; versoes: any[]; titulares_dfd: { pode_inserir: boolean; total: number; areas_sem_cadastro: string[]; areas_sem_portaria: string[] } | null } | null>(null);
  const [modo, setModo] = useState<"ver" | "editar">("ver");
  const [rascunho, setRascunho] = useState("");
  const [vendo, setVendo] = useState<any>(null); // versão antiga em exibição
  const [gerando, setGerando] = useState("");
  const [busy, setBusy] = useState<"" | "redigir" | "salvar" | "sugerir" | "aplicar">("");
  const [confirma, setConfirma] = useState(false);
  const [orient, setOrient] = useState("");
  const [vals, setVals] = useState<Record<string, string>>({});
  const [sug, setSug] = useState<Record<string, any>>({});
  const ctl = useRef<AbortController | null>(null);

  const areasDfd = e.id === "dfd" ? JSON.stringify([p.requisitante, p.areas_adicionais, p.solicitacoes?.map((s: { secretaria: string }) => s.secretaria)]) : "";

  const carregar = useCallback(async () => {
    const r = await api.get(`/processos/${p.id}/minutas/${e.id}`);
    const cadastro = r.sugestoes_cadastro as { i: number; valor: string; fonte: string }[];
    setM(r); setRascunho(r.vigente?.texto ?? ""); setVendo(null);
    setVals(Object.fromEntries(cadastro.map((x) => [x.i, x.valor])));
    setSug(Object.fromEntries(cadastro.map((x) => [x.i, { ...x, cadastro: true }])));
  }, [p.id, e.id, areasDfd]);
  useEffect(() => { carregar(); return () => ctl.current?.abort(); }, [carregar]);
  if (!m) return <div className="sec"><p className="muted">Carregando minuta…</p></div>;

  const texto = m.vigente?.texto ?? "";
  const pend = pendencias(texto);
  const redigir = async () => {
    setConfirma(false); setBusy("redigir"); setGerando(""); setModo("ver");
    ctl.current = new AbortController();
    try {
      const r = await fluxo(`/processos/${p.id}/ia/redigir`, { etapa: e.id, orientacao: orient }, setGerando, ctl.current.signal);
      await carregar();
      setAviso(r.truncado ? { t: "A minuta foi cortada pelo limite de tamanho. Peça ao assistente a continuação das seções finais." } : { t: `Minuta redigida pela IA e salva como versão ${r.versao}. Revise antes de usar.`, tipo: "ok" });
    } catch (er: any) { if (er.name !== "AbortError") setAviso({ t: er.message, tipo: "bad" }); }
    finally { setBusy(""); setGerando(""); }
  };
  const salvar = async (t: string, msg: string) => {
    setBusy("salvar");
    try { const r = await api.post(`/processos/${p.id}/minutas/${e.id}`, { texto: t }); await carregar(); setModo("ver"); setAviso({ t: r.nova ? `${msg} (versão ${r.versao}).` : "Nada mudou desde a última versão.", tipo: "ok" }); }
    catch (er: any) { setAviso({ t: er.message, tipo: "bad" }); }
    finally { setBusy(""); }
  };
  const sugerir = async () => {
    setBusy("sugerir");
    try {
      const r = await api.post(`/processos/${p.id}/ia/sugerir`, { etapa: e.id });
      if (r.versao !== m.vigente.versao) { await carregar(); throw new Error("A minuta mudou enquanto a IA trabalhava. Peça as sugestões de novo."); }
      const s: Record<string, any> = { ...sug }, v = { ...vals };
      let n = 0;
      for (const x of r.sugestoes) { if (s[x.i]?.cadastro) continue; s[x.i] = x; if (x.valor) { n++; if (!v[x.i]?.trim()) v[x.i] = x.valor; } }
      setSug(s); setVals(v);
      setAviso({ t: `A IA sugeriu ${n} de ${pend.length} campos. Confira cada sugestão e clique em "Aplicar na minuta".`, tipo: "ok" });
    } catch (er: any) { setAviso({ t: er.message, tipo: "bad" }); }
    finally { setBusy(""); }
  };
  const aplicar = async () => {
    setBusy("aplicar");
    try { const r = await api.post(`/processos/${p.id}/minutas/${e.id}/pendencias`, { versao: m.vigente.versao, valores: vals }); await carregar(); setAviso({ t: `${r.aplicados} ${r.aplicados > 1 ? "campos aplicados" : "campo aplicado"} (versão ${r.versao}).`, tipo: "ok" }); }
    catch (er: any) { setAviso({ t: er.message, tipo: "bad" }); }
    finally { setBusy(""); }
  };
  const inserirTitulares = async () => {
    setBusy("aplicar");
    try {
      const r = await api.post(`/processos/${p.id}/minutas/dfd/titulares`, { versao: m.vigente?.versao ?? 0 });
      await carregar();
      setAviso({ t: r.nova ? "Titulares e portarias inseridos no DFD. Revise o documento antes de usar." : "Os titulares já constam nesta versão.", tipo: "ok" });
    } catch (erro) {
      setAviso({ t: erro instanceof Error ? erro.message : "Não foi possível incluir os titulares.", tipo: "bad" });
    } finally { setBusy(""); }
  };
  const verVersao = async (v: string) => {
    if (!v || Number(v) === m.vigente?.versao) return setVendo(null);
    setVendo(await api.get(`/processos/${p.id}/minutas/${e.id}/versoes/${v}`));
  };

  const exibido = busy === "redigir" ? gerando : vendo ? vendo.texto : texto;
  return (
    <div className="sec" id="minuta-etapa">
      <div className="row"><span className="lbl">Minuta · {e.doc}</span>
        {m.vigente && <span className="small muted">Versão {m.vigente.versao} · {m.vigente.origem === "ia" ? "redigida pela IA" : m.vigente.origem === "pendencias" ? "campos preenchidos" : m.vigente.origem === "aproveitado" ? "rascunho com dados aproveitados da etapa anterior" : "edição manual"} · {m.vigente.autor ?? "—"} · {dataHora(m.vigente.criado_em)}</span>}</div>
      <div className="tools">
        {busy === "redigir" ? <><span className="small muted">Redigindo no layout do órgão…</span><button className="btn" onClick={() => ctl.current?.abort()}>Parar</button></>
          : confirma ? <><button className="btn pri" onClick={redigir}>Confirmar: gerar nova versão</button><button className="btn" onClick={() => setConfirma(false)}>Cancelar</button></>
          : <button className="btn pri" disabled={!editavel || !ia.disponivel || busy !== ""} onClick={() => (texto ? setConfirma(true) : redigir())}>{texto ? "Redigir de novo com IA" : "Redigir minuta com IA"}</button>}
        {busy !== "redigir" && <>
          <button className="btn" disabled={!editavel || !!vendo} onClick={() => { setModo(modo === "ver" ? "editar" : "ver"); setRascunho(texto); }}>{modo === "ver" ? "Editar texto" : "Ver na folha"}</button>
          {texto && p.timbrados?.length > 0 && (
            <label>Timbrado do Word
              <select value={timbrado} onChange={(ev) => setTimbrado(ev.target.value)}>
                <option value="">Sem timbrado</option>
                {p.timbrados.map((t: { codigo: string; nome: string }) => <option key={t.codigo} value={t.codigo}>{t.nome}</option>)}
              </select>
            </label>
          )}
          {texto && <a className="btn" href={`/api/processos/${p.id}/minutas/${e.id}/docx?${new URLSearchParams({
            ...(vendo ? { versao: String(vendo.versao) } : {}),
            ...(timbrado ? { timbrado } : {}),
          })}`}>Baixar Word</a>}
          {m.versoes.length > 1 && <label className="campo" style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>Versão
            <select id="versao" value={vendo?.versao ?? m.vigente?.versao} onChange={(ev) => verVersao(ev.target.value)} style={{ width: "auto" }}>
              {m.versoes.map((v: any) => <option key={v.versao} value={v.versao}>{v.versao} · {dataBR(v.criado_em)}</option>)}</select></label>}
        </>}
      </div>
      {m.titulares_dfd && !vendo && modo === "ver" && busy !== "redigir" && <div className="stack">
        {editavel && m.titulares_dfd.pode_inserir && <div>
          <button className="btn" disabled={busy !== ""} onClick={inserirTitulares}>Inserir titulares e portarias</button>
        </div>}
        {!m.titulares_dfd.total && !m.titulares_dfd.areas_sem_cadastro.length && <p className="small muted">Informe a área requisitante nos dados do processo.</p>}
        {m.titulares_dfd.areas_sem_cadastro.length > 0 && <p className="small muted">Confira o cadastro de secretários para {m.titulares_dfd.areas_sem_cadastro.join(", ")}.</p>}
        {m.titulares_dfd.areas_sem_portaria.length > 0 && <p className="small muted">Portaria pendente no cadastro de {m.titulares_dfd.areas_sem_portaria.join(", ")}.</p>}
      </div>}
      {confirma && <label className="campo">Orientação para a IA (opcional)<input id="orient" value={orient} onChange={(ev) => setOrient(ev.target.value)} placeholder="ex.: incluir quadro de alternativas com pré-moldado" /></label>}
      {vendo && <p className="note">Você está vendo a versão {vendo.versao}. {editavel && <button className="lnk" onClick={() => salvar(vendo.texto, "Versão restaurada")}>Restaurar como versão atual</button>}</p>}
      {modo === "editar" && busy !== "redigir" ? <>
        <textarea className="edit" id="minuta-edit" value={rascunho} onChange={(ev) => setRascunho(ev.target.value)} spellCheck aria-label="Texto da minuta" />
        <p className="small muted">Marcação: "# " título, "## " seção, "| a | b |" quadro, "@ " assinatura, [[texto]] campo pendente.</p>
        <div className="tools"><button className="btn pri" disabled={busy !== ""} onClick={() => salvar(rascunho, "Minuta salva")}>Salvar nova versão</button>
          <button className="btn" onClick={() => { setModo("ver"); setRascunho(texto); }}>Descartar alterações</button></div>
      </> : <Folha texto={exibido} vazio={busy === "redigir" ? "Redigindo a minuta…" : "Nenhuma minuta ainda. Peça à IA para redigir ou escreva em \"Editar texto\"."} />}

      {!vendo && busy !== "redigir" && modo === "ver" && (pend.length > 0 ? (
        <div className="pend">
          <div className="row"><div><h3>{pend.length} {pend.length > 1 ? "campos pendentes" : "campo pendente"}</h3></div>
            <div className="tools">
              <button className="btn sm" disabled={!editavel || !ia.disponivel || busy !== ""} onClick={sugerir}>{busy === "sugerir" ? "Procurando nas peças…" : "Sugerir com IA"}</button>
              <button className="btn sm pri" disabled={!editavel || busy !== ""} onClick={aplicar}>Aplicar na minuta</button></div></div>
          <p className="small muted">Confira os dados do cadastro e as sugestões das peças do processo antes de aplicar.</p>
          {pend.map((x) => {
            const s = sug[x.i];
            const [a, b] = x.trecho.split("▮");
            return (
              <div className="pf" key={x.i}>
                <label htmlFor={"pend-" + x.i}>{a}<mark>{x.rotulo}</mark>{b}</label>
                <input id={"pend-" + x.i} value={vals[x.i] ?? ""} onChange={(ev) => setVals({ ...vals, [x.i]: ev.target.value })} placeholder="Texto que substitui o campo" disabled={!editavel} autoComplete="off" />
                {s && (s.valor ? <span className="b sg">{s.cadastro ? s.fonte : `Sugestão da IA · ${s.fonte || "dados do processo"}`}</span> : <span className="b falta">Não consta nos documentos · {s.falta || "informar"}</span>)}
              </div>);
          })}
        </div>) : texto ? <p className="small" style={{ color: "var(--accent)" }}>Nenhum campo pendente nesta minuta.</p> : null)}
    </div>
  );
}

/* ---------- assistente ---------- */
function Assistente({ p, etapa, disponivel }: { p: any; etapa: string; disponivel: boolean }) {
  const [msgs, setMsgs] = useState<{ role: "user" | "assistant"; content: string; err?: boolean }[]>([]);
  const [rasc, setRasc] = useState("");
  const [busy, setBusy] = useState(false);
  const ctl = useRef<AbortController | null>(null);
  const caixa = useRef<HTMLDivElement>(null);
  useEffect(() => { caixa.current?.scrollTo(0, caixa.current.scrollHeight); }, [msgs]);
  useEffect(() => () => ctl.current?.abort(), []);
  const enviar = async (texto: string) => {
    if (!texto.trim() || busy) return;
    const hist = [...msgs.filter((m) => !m.err), { role: "user" as const, content: texto.trim() }].slice(-20);
    setMsgs([...msgs, { role: "user", content: texto.trim() }, { role: "assistant", content: "" }]);
    setRasc(""); setBusy(true);
    ctl.current = new AbortController();
    const atualiza = (t: string, err = false) => setMsgs((ms) => [...ms.slice(0, -1), { role: "assistant", content: t, err }]);
    try {
      const r = await fluxo(`/processos/${p.id}/ia/chat`, { etapa, mensagens: hist }, (t) => atualiza(t), ctl.current.signal);
      atualiza(r.texto + (r.truncado ? "\n\n(Resposta cortada pelo limite de tamanho. Peça a continuação.)" : ""));
    } catch (er: any) {
      if (er.name === "AbortError") setMsgs((ms) => (ms.at(-1)?.content ? ms : ms.slice(0, -1)));
      else atualiza((er.texto ? er.texto + "\n\n" : "") + er.message, true);
    } finally { setBusy(false); }
  };
  const sub = (ev: FormEvent) => { ev.preventDefault(); enviar(rasc); };
  return (
    <aside className="panel chat" aria-label="Assistente">
      <div><h3>Assistente</h3><p className="small muted">Responde com os dados do processo, a etapa aberta, as minutas e os documentos anexados.</p></div>
      {!disponivel && <p className="note">A IA não está configurada neste servidor.</p>}
      <div className="msgs" ref={caixa} aria-live="polite">
        {msgs.map((m, i) => <div key={i} className={`msg ${m.role}${m.err ? " err" : ""}`}>{m.content || "Pensando…"}</div>)}
      </div>
      <div className="chips">{(etapa === "solicitacao" ? [
        ["Conferir a solicitação", "Confira os pedidos das secretarias, os itens e as cotações da Solicitação e indique o que falta."],
        ["Conferir os orçamentos", "Verifique quais itens estão sem cotação e quais preços precisam de conferência."],
      ] : [
        ["O que falta nesta etapa?", "O que falta nesta etapa?"],
        ["Conferir a minuta", "Confira a minuta desta etapa contra o checklist e aponte incoerências com as outras peças."],
        ["Que documentos preciso juntar agora?", "Que documentos preciso juntar agora?"],
      ]).map(([rotulo, pergunta]) =>
        <button key={rotulo} className="chip" disabled={!disponivel || busy} onClick={() => enviar(pergunta)}>{rotulo}</button>)}</div>
      <form className="chatform" onSubmit={sub}>
        <textarea id="chat-in" value={rasc} onChange={(ev) => setRasc(ev.target.value)} placeholder="Pergunte ou cole um trecho para conferir" aria-label="Mensagem para o assistente"
          onKeyDown={(ev) => { if (ev.key === "Enter" && !ev.shiftKey) { ev.preventDefault(); enviar(rasc); } }} disabled={!disponivel} />
        {busy ? <button type="button" className="btn" onClick={() => ctl.current?.abort()}>Parar</button> : <button className="btn pri" disabled={!disponivel}>Enviar</button>}
      </form>
    </aside>
  );
}

/* ---------- anexos e histórico ---------- */
function Anexos({ p, recarregar, podeIncluir }: { p: any; recarregar: () => Promise<any>; podeIncluir: boolean }) {
  const [msg, setMsg] = useState<{ t: string; tipo?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const enviar = async (f: File | undefined) => {
    if (!f) return;
    setBusy(true); setMsg(null);
    try { const fd = new FormData(); fd.append("arquivo", f); const r = await api.post(`/processos/${p.id}/anexos`, fd); await recarregar(); setMsg({ t: `"${f.name}" anexado (${r.caracteres.toLocaleString("pt-BR")} caracteres lidos).`, tipo: "ok" }); }
    catch (e: any) { setMsg({ t: e.message, tipo: "bad" }); }
    finally { setBusy(false); }
  };
  const remover = async (aid: number) => { await api.del(`/processos/${p.id}/anexos/${aid}`); await recarregar(); };
  return (
    <section className="panel">
      <div className="pad-s row"><div><h2>Documentos de apoio</h2><p className="small muted">Memorandos, planilhas, levantamentos e peças antigas. A IA usa o texto deles nas minutas, nas sugestões e no assistente.</p></div>
        {podeIncluir && <><label className="btn" htmlFor="anexo">{busy ? "Lendo…" : "Anexar documento"}</label>
          <input id="anexo" type="file" accept=".docx,.pdf,.txt,.md,.csv" hidden disabled={busy} onChange={(e) => { enviar(e.target.files?.[0]); e.target.value = ""; }} /></>}</div>
      {msg && <p className={"note " + (msg.tipo ?? "")} style={{ margin: "0 12px 12px" }}>{msg.t}</p>}
      {p.anexos.length === 0 ? <p className="pad-s muted">Nenhum documento anexado.</p> :
        <div className="tw"><table className="t"><tbody>{p.anexos.map((a: any) => (
          <tr key={a.id}><td>{a.nome}</td><td className="small muted">{a.caracteres.toLocaleString("pt-BR")} caracteres</td><td className="small muted">{dataHora(a.criado_em)}</td>
            <td className="r">{podeIncluir && <button className="lnk" onClick={() => remover(a.id)}>Remover</button>}</td></tr>))}</tbody></table></div>}
    </section>
  );
}

function Historico({ id, versao, atualizado }: { id: number; versao: number; atualizado?: string }) {
  const [h, setH] = useState<any[] | null>(null);
  const [aberto, setAberto] = useState(false);
  useEffect(() => { if (aberto) api.get(`/processos/${id}/historico`).then(setH); }, [aberto, id, versao, atualizado]);
  return (
    <details className="panel box" onToggle={(e) => setAberto((e.target as HTMLDetailsElement).open)}>
      <summary>Histórico do processo</summary>
      {!h ? <p className="pad muted">Carregando…</p> :
        <div className="tw"><table className="t"><tbody>{h.map((x, i) => (
          <tr key={i}><td className="small muted" style={{ whiteSpace: "nowrap" }}>{dataHora(x.em)}</td><td>{x.usuario ?? "—"}</td>
            <td>{ACOES[x.acao] ?? x.acao}{x.detalhe?.item ? ` ${x.detalhe.item}` : ""}{x.detalhe?.etapa ? ` · ${ETAPAS.find((e) => e.id === x.detalhe.etapa)?.nome ?? x.detalhe.etapa}` : ""}{x.detalhe?.versao ? ` · versão ${x.detalhe.versao}` : ""}{x.detalhe?.situacao ? ` · ${x.detalhe.situacao}` : ""}</td></tr>))}</tbody></table></div>}
    </details>
  );
}
