import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, fmtNum, numBR } from "../api";
import { TIPOS, VIAS } from "../../../shared/etapas";
import { useEu } from "../main";

export interface DadosProc {
  requisitante: string; objeto: string; tipo: string; via: string;
  valor: string; classe: string; ano: string; pca_item_id: string; normas: string; obs: string;
}
export const vazio = (): DadosProc => ({ requisitante: "", objeto: "", tipo: "bens", via: "licitacao", valor: "", classe: "", ano: String(new Date().getFullYear()), pca_item_id: "", normas: "", obs: "" });
export function paraApi(d: DadosProc) {
  const v = numBR(d.valor);
  if (Number.isNaN(v)) throw new Error("Valor estimado inválido. Use, por exemplo, 114.969,14.");
  return { requisitante: d.requisitante, objeto: d.objeto, tipo: d.tipo, via: d.via, valor_estimado: v, classe: d.classe, ano: Number(d.ano), pca_item_id: d.pca_item_id ? Number(d.pca_item_id) : null, normas: d.normas, obs: d.obs };
}

export function CamposProcesso({ d, set, pca }: { d: DadosProc; set: (d: DadosProc) => void; pca: any[] }) {
  const c = (k: keyof DadosProc) => ({ id: "p-" + k, value: d[k], onChange: (e: any) => set({ ...d, [k]: e.target.value }) });
  return (
    <div className="form">
      <label>Área requisitante<input {...c("requisitante")} /></label>
      <label>Exercício<input {...c("ano")} inputMode="numeric" /></label>
      <label>Tipo de objeto<select {...c("tipo")}>{Object.entries(TIPOS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
      <label>Forma de contratação<select {...c("via")}>{Object.entries(VIAS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
      <label>Valor estimado (R$)<input {...c("valor")} inputMode="decimal" placeholder="0,00" /></label>
      <label>Natureza / ramo<input {...c("classe")} placeholder="ex.: obras de construção civil" /></label>
      <label className="wide">Item do plano de contratações<select {...c("pca_item_id")}>
        <option value="">Não consta do PCA</option>{pca.map((i) => <option key={i.id} value={i.id}>{i.descricao} ({i.ano})</option>)}</select></label>
      <label className="wide">Objeto<textarea {...c("objeto")} required minLength={5} /></label>
      <label className="wide">Regulamentos citados neste processo<textarea {...c("normas")} placeholder="Decretos e leis locais específicos deste processo (os gerais do órgão ficam em Configurações)" /></label>
      <label className="wide">Observações<textarea {...c("obs")} placeholder="Prazos, quantidades, local e outros dados úteis para o ETP e o Termo de Referência" /></label>
    </div>
  );
}

export function NovoProcesso() {
  const { ia } = useEu();
  const [d, setD] = useState<DadosProc>(vazio());
  const [pca, setPca] = useState<any[]>([]);
  const [fonte, setFonte] = useState("");
  const [arq, setArq] = useState<File | null>(null);
  const [msg, setMsg] = useState<{ t: string; tipo?: string } | null>(null);
  const [busy, setBusy] = useState<"" | "ia" | "salvar">("");
  const [textoOrigem, setTextoOrigem] = useState<{ nome: string; texto: string } | null>(null);
  const nav = useNavigate();
  useEffect(() => { api.get(`/pca?ano=${d.ano}`).then((r) => setPca(r.itens)).catch(() => setPca([])); }, [d.ano]);

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
        <CamposProcesso d={d} set={setD} pca={pca} />
        <p className="small muted">O processo recebe um protocolo automático ao ser criado. O nº do processo administrativo e o do procedimento são gerados por último, quando a trilha chega à etapa de autorização e publicação.</p>
        <div><button className="btn pri" disabled={busy !== ""}>{busy === "salvar" ? "Criando…" : "Criar e abrir a trilha"}</button></div>
      </form>
    </>
  );
}
