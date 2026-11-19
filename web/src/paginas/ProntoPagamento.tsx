import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, brl, dataHora, fmtNum, numBR } from "../api";
import { tem, useEu } from "../main";
import { ETAPAS_PP, FORMAS_PAGAMENTO, ORDEM_SITUACAO, SITUACOES, totalItemPP, type DadosPP, type ItemPP, type SituacaoPP } from "../../../shared/pronto-pagamento";

const CHAVES: Record<string, (keyof DadosPP)[]> = {
  pedido: ["secretaria", "responsavel", "tipo", "objeto", "justificativa", "itens", "fornecedor", "fornecedor_doc", "fornecedor_contato", "pesquisa_preco", "dotacao"],
  recebimento: ["nota_numero", "nota_data", "nota_valor", "recebido_por", "recebido_em", "recebimento_obs"],
  pagamento: ["forma_pagamento", "empenho", "pago_em", "pagamento_obs"],
};
const EDITA: Partial<Record<SituacaoPP, (keyof DadosPP)[]>> = {
  pedido: CHAVES.pedido, autorizado: CHAVES.recebimento, recebido: [...CHAVES.recebimento, ...CHAVES.pagamento],
};
const ACAO: Partial<Record<SituacaoPP, string>> = { pedido: "Autorizar pronto pagamento", autorizado: "Registrar recebimento e atesto", recebido: "Registrar pagamento" };
const ACOES_HIST: Record<string, string> = {
  "pronto.criado": "abriu o pedido", "pronto.autorizado": "autorizou", "pronto.recebido": "registrou o recebimento e o atesto", "pronto.pago": "registrou o pagamento",
  "pronto.devolvido": "devolveu para correção", "pronto.cancelado": "cancelou", "pronto.reaberto": "reabriu", "pronto.anexo": "anexou documento",
};
const TIPOS_ANEXO: Record<string, string> = { orcamento: "Orçamento", nota: "Nota fiscal", comprovante: "Comprovante de pagamento", outro: "Outro documento" };

type ItemTela = { descricao: string; unidade: string; quantidade: string; valor_unitario: string };
const itemTela = (i: ItemPP): ItemTela => ({ descricao: i.descricao, unidade: i.unidade, quantidade: i.quantidade == null ? "" : fmtNum(i.quantidade).replace(/,00$/, ""), valor_unitario: i.valor_unitario == null ? "" : fmtNum(i.valor_unitario) });
const itemApi = (i: ItemTela): ItemPP => {
  const n = (t: string) => { const v = numBR(t); return v == null || Number.isNaN(v) ? null : v; };
  return { descricao: i.descricao.trim(), unidade: i.unidade.trim(), quantidade: n(i.quantidade), valor_unitario: n(i.valor_unitario) };
};

export function ProntoPagamentoPg() {
  const { id } = useParams();
  const { eu } = useEu();
  const nav = useNavigate();
  const [p, setP] = useState<any>(null);
  const [d, setD] = useState<DadosPP | null>(null);
  const [itens, setItens] = useState<ItemTela[]>([]);
  const [notaValor, setNotaValor] = useState("");
  const [sujo, setSujo] = useState(false);
  const [busy, setBusy] = useState("");
  const [aviso, setAviso] = useState<{ t: string; tipo?: string } | null>(null);
  const [pend, setPend] = useState<{ campo: string; texto: string }[]>([]);
  const [timbrado, setTimbrado] = useState("");
  const [tipoAnexo, setTipoAnexo] = useState("orcamento");

  const carregar = useCallback(async () => {
    try {
      const r = await api.get(`/pronto/${id}`);
      setP(r); setD(r.dados); setItens(r.dados.itens.map(itemTela)); setNotaValor(r.dados.nota_valor == null ? "" : fmtNum(r.dados.nota_valor)); setSujo(false);
      return r;
    } catch (e: any) { setAviso({ t: e.message, tipo: "bad" }); }
  }, [id]);
  useEffect(() => { void carregar(); }, [carregar]);
  if (!p || !d) return aviso ? <p className="note bad">{aviso.t}</p> : <p className="muted">Carregando…</p>;

  const sit = p.situacao as SituacaoPP;
  const editaveis = EDITA[sit] ?? [];
  const podeEditar = editaveis.length > 0 && (sit === "pedido" ? p.pode.pedido : p.pode.receber || p.pode.pagar);
  const editavel = (k: keyof DadosPP) => podeEditar && editaveis.includes(k);
  const set = (k: keyof DadosPP, v: any) => { setD({ ...d, [k]: v }); setSujo(true); };
  const itensApi = itens.map(itemApi);
  const total = Math.round(itensApi.reduce((s, i) => s + (totalItemPP(i) ?? 0), 0) * 100) / 100;
  const passou = total > p.limite.valor;

  const salvar = async (silencioso = false) => {
    const dados: Record<string, unknown> = {};
    for (const k of editaveis) dados[k] = k === "itens" ? itensApi : k === "nota_valor" ? (notaValor.trim() ? numBR(notaValor) : null) : d[k];
    if (dados.nota_valor !== undefined && Number.isNaN(dados.nota_valor)) { setAviso({ t: "Valor da nota inválido. Use, por exemplo, 1.250,00.", tipo: "bad" }); return false; }
    setBusy("salvar");
    try { await api.put(`/pronto/${p.id}`, { dados }); await carregar(); if (!silencioso) setAviso({ t: "Dados salvos.", tipo: "ok" }); return true; }
    catch (e: any) { setAviso({ t: e.message, tipo: "bad" }); return false; }
    finally { setBusy(""); }
  };
  const avancar = async () => {
    if (sujo && podeEditar && !(await salvar(true))) return;
    setBusy("avancar");
    try {
      const r = await api.post(`/pronto/${p.id}/avancar`);
      if (!r.avancou) { setPend(r.pendencias); setAviso({ t: "Complete o que falta antes de seguir.", tipo: "bad" }); return; }
      setPend([]); await carregar();
      setAviso({ t: { autorizado: "Pronto pagamento autorizado. A Secretaria já pode comprar ou contratar o serviço.", recebido: "Recebimento e atesto registrados.", pago: "Pagamento registrado. Processo concluído." }[r.situacao as string] ?? "Etapa concluída.", tipo: "ok" });
    } catch (e: any) { setAviso({ t: e.message, tipo: "bad" }); }
    finally { setBusy(""); }
  };
  const acao = async (url: string, corpo: object, msg: string) => {
    setBusy("acao");
    try { await api.post(url, corpo); await carregar(); setAviso({ t: msg, tipo: "ok" }); }
    catch (e: any) { setAviso({ t: e.message, tipo: "bad" }); }
    finally { setBusy(""); }
  };
  const anexar = async (files: FileList | null) => {
    if (!files?.length) return;
    const fd = new FormData();
    fd.append("tipo", tipoAnexo);
    for (const f of Array.from(files)) fd.append("arquivo", f);
    setBusy("anexo");
    try { await api.post(`/pronto/${p.id}/anexos`, fd); await carregar(); setAviso({ t: "Documento anexado.", tipo: "ok" }); }
    catch (e: any) { setAviso({ t: e.message, tipo: "bad" }); }
    finally { setBusy(""); }
  };
  const podeAvancar = { pedido: p.pode.autorizar, autorizado: p.pode.receber, recebido: p.pode.pagar }[sit as "pedido"] ?? false;
  const falta = (campo: string) => pend.some((x) => x.campo === campo) ? " falta" : "";
  const campo = (k: keyof DadosPP, rotulo: string, extra: { area?: boolean; tipo?: string; ajuda?: string; largo?: boolean; lista?: string } = {}) => (
    <label className={"campo-etapa" + (extra.area || extra.largo ? " largo" : "") + falta(k)} htmlFor={"pp-" + k}>
      <span className="campo-cab"><span className="campo-rot">{rotulo}</span></span>
      {extra.ajuda && <span className="small muted campo-ajuda">{extra.ajuda}</span>}
      {extra.area
        ? <textarea id={"pp-" + k} value={String(d[k] ?? "")} disabled={!editavel(k)} rows={3} onChange={(e) => set(k, e.target.value)} />
        : <input id={"pp-" + k} type={extra.tipo ?? "text"} list={extra.lista} value={String(d[k] ?? "")} disabled={!editavel(k)} onChange={(e) => set(k, e.target.value)} />}
    </label>
  );
  const atual = ORDEM_SITUACAO[sit];

  return (
    <>
      <div className="row">
        <div className="stack" style={{ gap: 2 }}>
          <span className="lbl mono">{p.protocolo} · Pronto pagamento</span>
          <h1>{d.objeto || "Novo pedido de pronto pagamento"}</h1>
          <span className="small muted">{[d.secretaria, d.fornecedor, brl(total)].filter(Boolean).join(" · ")}</span>
        </div>
        <div className="tools">
          <span className={"pill " + (sit === "cancelado" ? "bad" : sit === "pago" ? "ok" : "cur")}>{SITUACOES[sit]}</span>
          <Link className="btn" to="/pronto">Todos</Link>
        </div>
      </div>
      {aviso && <p className={"note " + (aviso.tipo ?? "")}>{aviso.t} <button className="lnk" onClick={() => setAviso(null)}>Fechar</button></p>}

      <ol className="passos-pp" aria-label="Etapas do pronto pagamento">
        {ETAPAS_PP.map((e, i) => (
          <li key={e.id} className={sit === "cancelado" ? "" : i < atual || sit === "pago" ? "ok" : i === atual ? "cur" : ""}>
            <span className="n">{i + 1}</span><span><b>{e.nome}</b><br /><span className="small muted">{e.quem}</span></span>
          </li>))}
      </ol>

      <div className={"note" + (passou ? " bad" : "")}>
        Limite do pronto pagamento em {p.ano}: <b>{brl(p.limite.valor)}</b> ({p.limite.fonte}, art. 95, § 2º, da Lei nº 14.133/2021). Total deste pedido: <b>{brl(total)}</b>.
        {passou && " Acima do limite: abra um processo de dispensa ou licitação."}
      </div>
      {p.alertas.map((a: string) => <p key={a} className="note">{a}</p>)}

      <section className="panel">
        <div className="sec"><span className="lbl">1. Pedido da Secretaria</span>
          <div className="campos-grade">
            {campo("secretaria", "Secretaria solicitante", { lista: "pp-secretarias" })}
            <datalist id="pp-secretarias">{p.secretarias.map((s: string) => <option key={s} value={s} />)}</datalist>
            {campo("responsavel", "Responsável pelo pedido", { ajuda: "Nome e cargo de quem solicita e assina." })}
            <fieldset className="campo-etapa largo">
              <legend><span className="campo-rot">Tipo</span></legend>
              <div className="opcoes" style={{ flexDirection: "row", gap: 16 }}>
                {(["compra", "servico"] as const).map((t) => <label key={t} className="opcao"><input type="radio" name="pp-tipo" checked={d.tipo === t} disabled={!editavel("tipo")} onChange={() => set("tipo", t)} /><span>{t === "compra" ? "Pequena compra" : "Serviço de pronto pagamento"}</span></label>)}
              </div>
            </fieldset>
            {campo("objeto", "Objeto", { area: true, ajuda: "O que será comprado ou contratado, sem indicar marca." })}
            {campo("justificativa", "Justificativa", { area: true, ajuda: "Por que é necessário agora e por que cabe o pronto pagamento: valor pequeno, entrega ou execução imediata, sem obrigações futuras." })}
          </div>
        </div>
        <div className={"sec" + (pend.some((x) => x.campo === "itens") ? " falta" : "")}>
          <span className="lbl">Itens</span>
          <div className="tw"><table className="t itens-pp">
            <thead><tr><th>Descrição</th><th style={{ width: 80 }}>Un.</th><th className="r" style={{ width: 100 }}>Qtd.</th><th className="r" style={{ width: 130 }}>Valor unitário</th><th className="r" style={{ width: 120 }}>Total</th>{editavel("itens") && <th />}</tr></thead>
            <tbody>{itens.map((it, k) => {
              const muda = (campo: keyof ItemTela, v: string) => { setItens(itens.map((x, j) => (j === k ? { ...x, [campo]: v } : x))); setSujo(true); };
              const t = totalItemPP(itemApi(it));
              return (
                <tr key={k}>
                  <td><input aria-label={`Descrição do item ${k + 1}`} value={it.descricao} disabled={!editavel("itens")} onChange={(e) => muda("descricao", e.target.value)} /></td>
                  <td><input aria-label={`Unidade do item ${k + 1}`} value={it.unidade} disabled={!editavel("itens")} onChange={(e) => muda("unidade", e.target.value)} /></td>
                  <td><input aria-label={`Quantidade do item ${k + 1}`} inputMode="decimal" style={{ textAlign: "right" }} value={it.quantidade} disabled={!editavel("itens")} onChange={(e) => muda("quantidade", e.target.value)} /></td>
                  <td><input aria-label={`Valor unitário do item ${k + 1}`} inputMode="decimal" style={{ textAlign: "right" }} value={it.valor_unitario} disabled={!editavel("itens")} onChange={(e) => muda("valor_unitario", e.target.value)} /></td>
                  <td className="r num">{t == null ? "—" : brl(t)}</td>
                  {editavel("itens") && <td className="r"><button className="lnk" onClick={() => { setItens(itens.filter((_, j) => j !== k)); setSujo(true); }}>Remover</button></td>}
                </tr>);
            })}</tbody>
            <tfoot><tr><td colSpan={4} className="r"><b>Total</b></td><td className="r num"><b>{brl(total)}</b></td>{editavel("itens") && <td />}</tr></tfoot>
          </table></div>
          {editavel("itens") && <button className="btn sm" onClick={() => { setItens([...itens, { descricao: "", unidade: "un", quantidade: "1", valor_unitario: "" }]); setSujo(true); }}>+ Incluir item</button>}
        </div>
        <div className="sec"><span className="lbl">Fornecedor e preço</span>
          <div className="campos-grade">
            {campo("fornecedor", "Fornecedor")}
            {campo("fornecedor_doc", "CNPJ ou CPF")}
            {campo("fornecedor_contato", "Contato do fornecedor", { largo: true })}
            {campo("pesquisa_preco", "Como o preço foi verificado", { area: true, ajuda: "Ex.: três orçamentos anexados, preço de tabela, consulta ao PNCP ou a sites, com a data." })}
            {campo("dotacao", "Dotação orçamentária", { area: true, ajuda: "Se já conhecida." })}
          </div>
        </div>

        <div className="sec"><span className="lbl">2. Autorização</span>
          {p.autorizado_por_nome ? <p>Autorizado por <b>{p.autorizado_por_nome}</b> em {dataHora(p.autorizado_em)}.</p>
            : <p className="small muted">{sit === "pedido" ? "Quando o pedido estiver completo, o ordenador da despesa (ou o setor de contratações) clica em \"Autorizar pronto pagamento\"." : "—"}</p>}
        </div>

        {atual >= 1 && <div className="sec"><span className="lbl">3. Recebimento e atesto</span>
          <div className="campos-grade">
            {campo("nota_numero", "Nota fiscal nº")}
            {campo("nota_data", "Data da nota", { tipo: "date" })}
            <label className={"campo-etapa" + falta("nota_valor")} htmlFor="pp-nota_valor"><span className="campo-rot">Valor da nota (R$)</span>
              <input id="pp-nota_valor" inputMode="decimal" value={notaValor} disabled={!editavel("nota_valor")} onChange={(e) => { setNotaValor(e.target.value); setSujo(true); }} placeholder="ex.: 1.250,00" /></label>
            {campo("recebido_por", "Recebido e atestado por", { ajuda: "Servidor que conferiu a entrega ou o serviço." })}
            {campo("recebido_em", "Data do recebimento", { tipo: "date" })}
            {campo("recebimento_obs", "Observações do recebimento", { area: true })}
          </div>
        </div>}

        {atual >= 2 && <div className="sec"><span className="lbl">4. Pagamento</span>
          <div className="campos-grade">
            <fieldset className={"campo-etapa largo" + falta("forma_pagamento")}>
              <legend><span className="campo-rot">Forma de pagamento</span></legend>
              <div className="opcoes">{Object.entries(FORMAS_PAGAMENTO).map(([k, t]) => <label key={k} className="opcao"><input type="radio" name="pp-forma" checked={d.forma_pagamento === k} disabled={!editavel("forma_pagamento")} onChange={() => set("forma_pagamento", k)} /><span>{t}</span></label>)}</div>
            </fieldset>
            {campo("empenho", "Nota de empenho nº")}
            {campo("pago_em", "Data do pagamento", { tipo: "date" })}
            {campo("pagamento_obs", "Observações do pagamento", { area: true })}
          </div>
        </div>}

        {pend.length > 0 && <div className="sec" role="status"><span className="lbl">O que falta</span>
          <ul className="pends">{pend.map((x) => <li key={x.texto}><span>{x.texto}</span></li>)}</ul></div>}

        <div className="sec row">
          <div className="tools">
            {podeEditar && <button className="btn" disabled={!sujo || busy !== ""} onClick={() => salvar()}>{busy === "salvar" ? "Salvando…" : sujo ? "Salvar" : "Salvo"}</button>}
            {ACAO[sit] && podeAvancar && <button className="btn pri" disabled={busy !== "" || (sit === "pedido" && passou)} onClick={avancar}>{busy === "avancar" ? "Conferindo…" : ACAO[sit]}</button>}
            {ACAO[sit] && !podeAvancar && <span className="small muted">Aguardando {ETAPAS_PP[atual + 1]?.quem.toLowerCase()}.</span>}
          </div>
          <div className="tools">
            {p.pode.cancelar && ["autorizado", "recebido", "pago"].includes(sit) && <button className="btn sm" disabled={busy !== ""} onClick={() => acao(`/pronto/${p.id}/voltar`, {}, "Devolvido para a etapa anterior.")}>Voltar uma etapa</button>}
            {p.pode.cancelar && sit !== "pago" && sit !== "cancelado" && <button className="btn sm danger" disabled={busy !== ""} onClick={() => acao(`/pronto/${p.id}/cancelar`, { cancelar: true }, "Pronto pagamento cancelado.")}>Cancelar</button>}
            {p.pode.cancelar && sit === "cancelado" && <button className="btn sm" disabled={busy !== ""} onClick={() => acao(`/pronto/${p.id}/cancelar`, { cancelar: false }, "Reaberto como pedido.")}>Reabrir</button>}
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="sec"><span className="lbl">Documentos</span>
          <div className="tools">
            {p.timbrados?.length > 0 && <label>Timbrado<select value={timbrado} onChange={(e) => setTimbrado(e.target.value)}><option value="">Sem timbrado</option>{p.timbrados.map((t: any) => <option key={t.codigo} value={t.codigo}>{t.nome}</option>)}</select></label>}
            {[["autorizacao", "Solicitação e autorização"], ["completo", "Processo completo"]].map(([t, nome]) => (
              <span key={t} className="tools">
                <a className="btn" href={`/api/pronto/${p.id}/documento.pdf?tipo=${t}${timbrado ? `&timbrado=${timbrado}` : ""}`}>{nome} (PDF)</a>
                <a className="btn" href={`/api/pronto/${p.id}/documento.docx?tipo=${t}${timbrado ? `&timbrado=${timbrado}` : ""}`}>Word</a>
              </span>))}
          </div>
          {sujo && <p className="small muted">Salve antes de baixar: o documento usa os dados gravados.</p>}
        </div>
        <div className="sec"><span className="lbl">Anexos</span>
          <p className="small muted">Orçamentos, nota fiscal e comprovante de pagamento.</p>
          {sit !== "cancelado" && tem(eu, "requisitante", "fiscal", "contratacao", "autoridade") && <div className="tools">
            <label>Tipo<select value={tipoAnexo} onChange={(e) => setTipoAnexo(e.target.value)}>{Object.entries(TIPOS_ANEXO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
            <label className="btn">{busy === "anexo" ? "Enviando…" : "Anexar arquivos"}<input type="file" multiple hidden disabled={busy !== ""} onChange={(e) => { void anexar(e.target.files); e.target.value = ""; }} /></label>
          </div>}
          {p.anexos.length === 0 ? <p className="muted">Nenhum documento anexado.</p> :
            <div className="tw"><table className="t"><tbody>{p.anexos.map((a: any) => (
              <tr key={a.id}><td><a href={`/api/pronto/${p.id}/anexos/${a.id}`} download>{a.nome}</a></td><td className="small">{TIPOS_ANEXO[a.tipo]}</td>
                <td className="small muted">{a.usuario ?? "—"} · {dataHora(a.criado_em)}</td>
                <td className="r">{sit !== "pago" && <button className="lnk" onClick={async () => { try { await api.del(`/pronto/${p.id}/anexos/${a.id}`); await carregar(); } catch (e: any) { setAviso({ t: e.message, tipo: "bad" }); } }}>Remover</button>}</td></tr>))}</tbody></table></div>}
        </div>
        <details className="sec"><summary className="lbl">Histórico</summary>
          <ul className="small">{p.historico.map((h: any, i: number) => <li key={i}>{dataHora(h.em)} · {h.usuario ?? "—"} {ACOES_HIST[h.acao] ?? h.acao}</li>)}</ul>
        </details>
      </section>
      <p className="small muted"><button className="lnk" onClick={() => nav("/pronto")}>← Voltar à lista</button></p>
    </>
  );
}

export function ProntoPagamentos() {
  const { eu } = useEu();
  const nav = useNavigate();
  const [ano, setAno] = useState(new Date().getFullYear());
  const [r, setR] = useState<any>(null);
  const [erro, setErro] = useState("");
  useEffect(() => { api.get(`/pronto?ano=${ano}`).then(setR).catch((e) => setErro(e.message)); }, [ano]);
  const novo = async () => {
    try { const x = await api.post("/pronto", { ano }); nav(`/pronto/${x.id}`); }
    catch (e: any) { setErro(e.message); }
  };
  return (
    <>
      <div className="row">
        <div><h1>Pronto pagamento</h1>
          <p className="small muted">Pequenas compras e serviços de pronto pagamento, com contrato verbal e pagamento imediato (Lei nº 14.133/2021, art. 95, § 2º).</p></div>
        <div className="tools">
          <label>Exercício<select value={ano} onChange={(e) => setAno(Number(e.target.value))}>{[ano - 1, ano, ano + 1].map((a) => <option key={a}>{a}</option>)}</select></label>
          {tem(eu, "requisitante", "contratacao") && <button className="btn pri" onClick={novo}>Novo pronto pagamento</button>}
        </div>
      </div>
      {erro && <p className="note bad">{erro}</p>}
      {r && <>
        <p className="note">Limite por pronto pagamento em {r.ano}: <b>{brl(r.limite.valor)}</b> ({r.limite.fonte}). No exercício: {r.lista.length} {r.lista.length === 1 ? "pedido" : "pedidos"}, {brl(r.total)} no total, {r.pagos} {r.pagos === 1 ? "pago" : "pagos"}.</p>
        <section className="panel">
          {r.lista.length === 0 ? <p className="pad muted">Nenhum pronto pagamento neste exercício.</p> :
            <div className="tw"><table className="t">
              <thead><tr><th>Nº</th><th>Objeto</th><th>Secretaria</th><th>Fornecedor</th><th className="r">Valor</th><th>Situação</th></tr></thead>
              <tbody>{r.lista.map((x: any) => (
                <tr key={x.id} className="clicavel" onClick={() => nav(`/pronto/${x.id}`)}>
                  <td className="mono"><Link to={`/pronto/${x.id}`}>{x.protocolo}</Link></td><td>{x.objeto || <span className="muted">(sem objeto)</span>}</td>
                  <td>{x.secretaria || "—"}</td><td>{x.fornecedor || "—"}</td><td className="r num">{brl(x.valor_total)}</td>
                  <td><span className={"pill " + (x.situacao === "pago" ? "ok" : x.situacao === "cancelado" ? "bad" : "cur")}>{SITUACOES[x.situacao as SituacaoPP]}</span></td>
                </tr>))}</tbody>
            </table></div>}
        </section>
      </>}
    </>
  );
}
