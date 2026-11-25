import { useState } from "react";

export function ExportarProcesso({ processo, salvarPendentes }: {
  processo: { id: number; protocolo: string; timbrados?: { codigo: string; nome: string }[] };
  salvarPendentes: () => Promise<boolean>;
}) {
  const [timbrado, setTimbrado] = useState("");
  const [gerando, setGerando] = useState<"pdf" | "docx" | null>(null);
  const [erro, setErro] = useState("");
  const gerar = async (formato: "pdf" | "docx") => {
    if (gerando) return;
    setGerando(formato); setErro("");
    try {
      if (!(await salvarPendentes())) return;
      const r = await fetch(`/api/processos/${processo.id}/completo.${formato}${timbrado ? `?timbrado=${encodeURIComponent(timbrado)}` : ""}`, { credentials: "same-origin", headers: { "x-licita": "1" } });
      if (!r.ok) { const dados = await r.json().catch(() => null); throw new Error(dados?.erro || "Não foi possível gerar o processo completo."); }
      const url = URL.createObjectURL(await r.blob());
      const a = document.createElement("a");
      a.href = url; a.download = `processo-completo-${processo.protocolo.replace(/[^0-9a-z-]/gi, "-")}.${formato}`;
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) { setErro(e instanceof Error ? e.message : "Não foi possível gerar o processo completo."); }
    finally { setGerando(null); }
  };
  return <section className="sec stack" aria-busy={!!gerando}>
    <div><h3>Gerar processo completo</h3>
      <p className="small muted">Reúne as últimas versões salvas, orçamentos, comprovantes, documentos de apoio e demais anexos, com capa e índice.</p></div>
    {(processo.timbrados?.length ?? 0) > 0 && <label className="campo" style={{ maxWidth: 360 }}>Timbrado do processo completo
      <select value={timbrado} disabled={!!gerando} onChange={(e) => setTimbrado(e.target.value)}>
        <option value="">Sem timbrado</option>
        {processo.timbrados!.map((t) => <option key={t.codigo} value={t.codigo}>{t.nome}</option>)}
      </select></label>}
    <p className="small muted">Ordem: Encaminhamento → DFD → Pesquisa de preços → ETP → Termo de Referência → Dotação → Fiscal do contrato. Anexos ao final.</p>
    <div className="tools">
      <button type="button" className="btn pri" disabled={!!gerando} onClick={() => gerar("pdf")}>Gerar processo completo em PDF</button>
      <button type="button" className="btn" disabled={!!gerando} onClick={() => gerar("docx")}>Gerar processo completo em Word</button>
    </div>
    <p className="small muted">No PDF, os anexos mantêm suas páginas e os originais ficam incorporados. No Word, os documentos do sistema são editáveis e os anexos entram como páginas de imagem. Anexos antigos guardados somente em texto são incluídos em texto.</p>
    <p className="small muted">Salve as edições antes de exportar. Gerar o arquivo não protocola nem conclui o processo.</p>
    {gerando && <p className="note" role="status">Preparando os documentos e todas as páginas dos anexos… Aguarde o download.</p>}
    {erro && <p className="note bad" role="alert">{erro}</p>}
  </section>;
}
