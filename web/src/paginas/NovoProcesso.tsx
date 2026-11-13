import { useEffect, useState, type FormEvent, type Dispatch, type SetStateAction } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, fmtNum, numBR } from "../api";
import { TIPOS, VIAS } from "../../../shared/etapas";
import { consultarPca, type ItemConsultaPca } from "../../../shared/consulta-pca";
import { useEu } from "../main";
import { AjudaCampo } from "./AjudaCampo";

export interface DadosProc {
  requisitante: string; areas_adicionais: string[]; objeto: string; tipo: string; via: string;
  valor: string; classe: string; ano: string; pca_item_id: string; normas: string; obs: string;
}
export const vazio = (): DadosProc => ({ requisitante: "", areas_adicionais: [], objeto: "", tipo: "bens", via: "licitacao", valor: "", classe: "", ano: String(new Date().getFullYear()), pca_item_id: "auto", normas: "", obs: "" });
export function paraApi(d: DadosProc) {
  const v = numBR(d.valor);
  if (Number.isNaN(v)) throw new Error("Valor estimado inválido. Use, por exemplo, 114.969,14.");
  return { requisitante: d.requisitante, areas_adicionais: d.areas_adicionais.map((a) => a.trim()).filter(Boolean), objeto: d.objeto, tipo: d.tipo, via: d.via, valor_estimado: v, classe: d.classe, ano: Number(d.ano), pca_item_id: d.pca_item_id && d.pca_item_id !== "auto" ? Number(d.pca_item_id) : null, pca_automatico: d.pca_item_id === "auto", normas: d.normas, obs: d.obs };
}

export interface PlanoConsulta {
  ano: number;
  itens: ItemConsultaPca[];
  documento: { titulo: string; url: string } | null;
}
export function CamposProcesso({ d, set, plano, novo = false, podeEditar = true }: { d: DadosProc; set: Dispatch<SetStateAction<DadosProc>>; plano: PlanoConsulta | null; novo?: boolean; podeEditar?: boolean }) {
  const planoAno = plano?.ano === Number(d.ano) ? plano : null;
  const itens = planoAno?.itens ?? [];
  const consulta = consultarPca(d.objeto, d.tipo, itens);
  const escolhido = itens.find((i) => String(i.id) === d.pca_item_id);
  const vinculo = escolhido ?? (d.pca_item_id === "auto" ? consulta.vinculo : null);
  const [analisando, setAnalisando] = useState(false);
  const [avisoNormas, setAvisoNormas] = useState("");
  const { ia } = useEu();
  const analisarNormas = async () => {
    setAnalisando(true);
    setAvisoNormas("");
    try {
      const r = await api.post<{ normas: string; observacao: string }>("/ia/regulamentos", {
        objeto: d.objeto, tipo: d.tipo, via: d.via, classe: d.classe, obs: d.obs,
      });
      if (r.normas) set((atual) => {
        if (atual.objeto !== d.objeto || atual.tipo !== d.tipo || atual.via !== d.via || atual.classe !== d.classe || atual.obs !== d.obs) return atual;
        const linhas = r.normas.split("\n\n").filter((linha) => !atual.normas.includes(linha.split(" — ")[0]));
        return { ...atual, normas: [atual.normas.trim(), ...linhas].filter(Boolean).join("\n\n") };
      });
      setAvisoNormas(r.observacao || (r.normas ? "Confira as normas sugeridas antes de salvar." : "Nenhuma norma aplicável foi identificada."));
    } catch (e) {
      setAvisoNormas(e instanceof Error ? e.message : "Não foi possível analisar os regulamentos.");
    } finally { setAnalisando(false); }
  };
  const c = (k: Exclude<keyof DadosProc, "areas_adicionais">) => ({ id: "p-" + k, "data-campo-ajuda": k, value: d[k], onChange: (e: any) => set({ ...d, [k]: e.target.value, ...(k === "ano" ? { pca_item_id: novo ? "auto" : "" } : {}) }) });
  return (
    <div className="form">
      {podeEditar && <AjudaCampo disponivel={ia.disponivel} contexto={{
        objeto: d.objeto, tipo: d.tipo, via: d.via, ano: d.ano, valor: d.valor, classe: d.classe,
        requisitantes: [d.requisitante, ...d.areas_adicionais].filter(Boolean),
        normas: d.normas, obs: d.obs,
        pca: vinculo ? { descricao: vinculo.descricao, item: vinculo.ordem_oficial } : null,
      }} />}
      <div className="stack" style={{ gap: 8 }}>
        <label>Área requisitante<input {...c("requisitante")} maxLength={200} /></label>
        {d.areas_adicionais.map((area, indice) => (
          <div className="stack" style={{ gap: 4 }} key={indice}>
            <label>Área requisitante {indice + 2}
              <input data-campo-ajuda="requisitante" value={area} maxLength={200} onChange={(ev) => set({
                ...d, areas_adicionais: d.areas_adicionais.map((nome, i) => i === indice ? ev.target.value : nome),
              })} />
            </label>
            <button className="lnk" type="button" onClick={() => set({
              ...d, areas_adicionais: d.areas_adicionais.filter((_, i) => i !== indice),
            })}>Remover área {indice + 2}</button>
          </div>
        ))}
        {d.areas_adicionais.length < 30 && <div>
          <button className="btn sm" type="button" onClick={() => set({ ...d, areas_adicionais: [...d.areas_adicionais, ""] })}>
            Adicionar área requisitante
          </button>
        </div>}
      </div>
      <label>Exercício<input {...c("ano")} inputMode="numeric" /></label>
      <label>Tipo de objeto<select {...c("tipo")}>{Object.entries(TIPOS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
      <label>Forma de contratação<select {...c("via")}>{Object.entries(VIAS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
      <label>Valor estimado (R$)<input {...c("valor")} inputMode="decimal" placeholder="0,00" /></label>
      <label>Natureza / ramo<input {...c("classe")} placeholder="ex.: obras de construção civil" /></label>
      <div className="wide stack" style={{ gap: 6 }}>
        <label>Item do plano de contratações<select {...c("pca_item_id")}>
          {novo && <option value="auto">Verificar e vincular automaticamente</option>}
          <option value="">Sem vínculo confirmado</option>
          {itens.map((i) => <option key={i.id} value={i.id}>{i.ordem_oficial ? `Item ${i.ordem_oficial} — ` : ""}{i.descricao}</option>)}
        </select></label>
        {planoAno?.documento && <a href={planoAno.documento.url} target="_blank" rel="noreferrer">Abrir PCA completo (PDF)</a>}
        {d.objeto.trim().length >= 5 && <div role="status" className="small">
          {vinculo ? <strong>{escolhido ? "Vinculado ao PCA" : "Correspondência encontrada. Será vinculada ao criar"}{vinculo.ordem_oficial ? ` · item ${vinculo.ordem_oficial} · página ${vinculo.pagina_oficial}` : ""}</strong>
            : !planoAno ? "Consultando o PCA do exercício…"
            : !itens.length ? "Nenhum item cadastrado no PCA deste exercício."
            : consulta.candidatos.length ? "Possível correspondência. Confira o escopo e selecione o item."
            : "Nenhuma correspondência encontrada para o objeto no PCA deste exercício."}
          {!vinculo && consulta.candidatos.length > 0 && <ul>{consulta.candidatos.map((i) => <li key={i.id}>
            <button type="button" className="lnk" onClick={() => set({ ...d, pca_item_id: String(i.id) })}>
              {i.ordem_oficial ? `Item ${i.ordem_oficial} · ` : ""}{i.descricao}
            </button></li>)}</ul>}
        </div>}
      </div>
      <label className="wide">Objeto<textarea {...c("objeto")} required minLength={5} maxLength={4000} /></label>
      <div className="wide stack" style={{ gap: 6 }}>
        <label>Regulamentos citados neste processo<textarea {...c("normas")} maxLength={20000} readOnly={analisando} placeholder="Decretos e leis aplicáveis a esta contratação" /></label>
        <div><button type="button" className="btn sm" onClick={analisarNormas} disabled={!ia.disponivel || analisando || d.objeto.trim().length < 5}>
          {analisando ? "Analisando regulamentos…" : "Analisar regulamentos com IA"}
        </button></div>
        {avisoNormas && <p className="small" role="status">{avisoNormas}</p>}
        {!ia.disponivel && <p className="small muted">IA não configurada neste servidor.</p>}
      </div>
      <label className="wide">Observações<textarea {...c("obs")} maxLength={20000} placeholder="Prazos, quantidades, local e outros dados úteis para o ETP e o Termo de Referência" /></label>
    </div>
  );
}

export function NovoProcesso() {
  const { ia } = useEu();
  const [d, setD] = useState<DadosProc>(vazio());
  const [plano, setPlano] = useState<PlanoConsulta | null>(null);
  const [fonte, setFonte] = useState("");
  const [arq, setArq] = useState<File | null>(null);
  const [msg, setMsg] = useState<{ t: string; tipo?: string } | null>(null);
  const [busy, setBusy] = useState<"" | "ia" | "salvar">("");
  const [textoOrigem, setTextoOrigem] = useState<{ nome: string; texto: string } | null>(null);
  const nav = useNavigate();
  useEffect(() => {
    let ativo = true;
    api.get<PlanoConsulta>(`/pca?ano=${d.ano}`).then((r) => { if (ativo) setPlano(r); }).catch(() => { if (ativo) setPlano(null); });
    return () => { ativo = false; };
  }, [d.ano]);

  const extrair = async () => {
    setBusy("ia"); setMsg(null);
    try {
      const fd = new FormData();
      if (arq) fd.append("arquivo", arq); else fd.append("texto", fonte);
      const r = await api.post("/ia/extrair", fd);
      const x = r.dados; let n = 0;
      const novo = { ...d };
      for (const k of ["requisitante", "objeto", "classe", "normas", "obs", "tipo", "via"] as const) if (x[k]) { (novo as any)[k] = x[k]; n++; }
      if (x.valor_estimado != null) { novo.valor = fmtNum(x.valor_estimado); n++; }
      setD(novo);
      setTextoOrigem({ nome: arq?.name ?? "Texto de origem.txt", texto: r.texto });
      setMsg({ t: n ? `A IA preencheu ${n} campos. Confira cada um antes de criar o processo.` : "Não encontrei dados do processo nesse documento.", tipo: n ? "ok" : "" });
    } catch (e: any) { setMsg({ t: e.message, tipo: "bad" }); }
    finally { setBusy(""); }
  };

  const criar = async (e: FormEvent) => {
    e.preventDefault(); setBusy("salvar"); setMsg(null);
    try {
      const { id } = await api.post("/processos", paraApi(d));
      if (textoOrigem) {
        const fd = new FormData();
        fd.append("arquivo", new File([textoOrigem.texto], textoOrigem.nome.replace(/\.[^.]+$/, "") + ".txt", { type: "text/plain" }));
        await api.post(`/processos/${id}/anexos`, fd).catch(() => {});
      }
      nav(`/processos/${id}`);
    } catch (er: any) { setMsg({ t: er.message, tipo: "bad" }); setBusy(""); }
  };

  return (
    <>
      <div className="row"><div><span className="lbl">Novo processo</span><h1>Dados da contratação</h1></div><Link className="btn" to="/processos">Voltar</Link></div>
      <section className="panel pad stack">
        <div><span className="lbl">Preencher com IA</span><h3>Comece pelo documento que já existe</h3>
          <p className="small muted">Cole o memorando ou o pedido da área, ou anexe o arquivo (.docx, .pdf ou .txt). A IA preenche os campos abaixo e você confere antes de criar. O documento fica anexado ao processo como fonte para as minutas.</p></div>
        <textarea id="fonte" value={fonte} onChange={(e) => { setFonte(e.target.value); setArq(null); }} placeholder="Cole aqui o texto do memorando ou do pedido" style={{ minHeight: 110 }} />
        <div className="tools">
          <label className="btn" htmlFor="arq">Anexar documento</label>
          <input id="arq" type="file" accept=".docx,.pdf,.txt,.md" hidden onChange={(e) => { setArq(e.target.files?.[0] ?? null); }} />
          {arq && <span className="small muted">{arq.name}</span>}
          <button className="btn pri" type="button" onClick={extrair} disabled={!ia.disponivel || busy !== "" || (!fonte.trim() && !arq)}>{busy === "ia" ? "Lendo o documento…" : "Preencher com IA"}</button>
          {!ia.disponivel && <span className="small muted">IA não configurada neste servidor.</span>}
        </div>
      </section>
      {msg && <p className={"note " + (msg.tipo ?? "")}>{msg.t}</p>}
      <form className="panel pad stack" onSubmit={criar}>
        <CamposProcesso d={d} set={setD} plano={plano} novo />
        <p className="small muted">O processo recebe um protocolo automático ao ser criado. O nº do processo administrativo e o do procedimento são gerados por último, quando a trilha chega à etapa de autorização e publicação.</p>
        <div><button className="btn pri" disabled={busy !== ""}>{busy === "salvar" ? "Criando…" : "Criar e abrir a trilha"}</button></div>
      </form>
    </>
  );
}
