import { ETAPAS, camposFaltando, camposVisiveis, feita, temValor, type Campo, type Checks, type Etapa, type Valores } from "../../../shared/etapas";

/** Campos de preenchimento da etapa, conforme a capacitação da fase interna. */
export function CamposEtapa({ e, p, valores, editavel, sujo, gravando, sugeridos, mudar, salvar }: {
  e: Etapa; p: any; valores: Valores; editavel: boolean; sujo: boolean; gravando: boolean; sugeridos: string[];
  mudar: (v: Valores) => void; salvar: () => void;
}) {
  const visiveis = camposVisiveis(e, p, valores);
  const faltam = new Set(camposFaltando(e, p, valores).map((c) => c.id));
  const set = (id: string, v: string | string[]) => mudar({ ...valores, [id]: v });
  return (
    <div className="sec campos-etapa">
      <div className="row"><span className="lbl">Preencha os campos da etapa</span>
        <span className={"pill " + (faltam.size ? "" : "ok")}>{faltam.size ? `${faltam.size} ${faltam.size === 1 ? "campo obrigatório em branco" : "campos obrigatórios em branco"}` : "Campos obrigatórios preenchidos"}</span></div>
      {sugeridos.length > 0 && editavel && <p className="note small">Alguns campos já vieram preenchidos com o que o processo registra (PAC, cadastro de secretários, pedidos, itens e etapas anteriores). Confira, ajuste e salve.</p>}
      {e.id === "etp" && <p className="small muted">★ Conteúdo mínimo obrigatório (art. 18, § 2º). Os demais incisos devem constar ou ter a ausência justificada no próprio campo.</p>}
      <fieldset disabled={!editavel || gravando} className="campos-grade">
        {visiveis.map((c) => (
          <CampoEtapa key={c.id} c={c} valor={valores[c.id]} falta={faltam.has(c.id)} sugerido={sugeridos.includes(c.id)} mudar={(v) => set(c.id, v)} />
        ))}
      </fieldset>
      {editavel && <div className="tools">
        <button className="btn pri" type="button" disabled={!sujo || gravando} onClick={salvar}>{gravando ? "Salvando…" : sujo ? "Salvar campos" : "Campos salvos"}</button>
        {sujo && <span className="small muted">Há alterações não salvas. "Concluir e avançar" também salva.</span>}
      </div>}
    </div>
  );
}

function CampoEtapa({ c, valor, falta, sugerido, mudar }: { c: Campo; valor?: string | string[]; falta: boolean; sugerido: boolean; mudar: (v: string | string[]) => void }) {
  const id = `campo-${c.id}`;
  const texto = typeof valor === "string" ? valor : "";
  const marcas = Array.isArray(valor) ? valor : [];
  const cabeca = (
    <span className="campo-cab">
      <span className="campo-rot">{c.minimo && <span title="Conteúdo mínimo obrigatório" aria-label="Conteúdo mínimo obrigatório">★ </span>}{c.rotulo}</span>
      {c.opcional ? <span className="small muted">opcional</span> : falta ? <span className="small falta">obrigatório</span> : null}
      {sugerido && <span className="pill sm">sugerido</span>}
    </span>
  );
  const ajuda = c.ajuda && <span className="small muted campo-ajuda">{c.ajuda}</span>;
  if (c.tipo === "opcao" || c.tipo === "marcas") {
    return (
      <fieldset className={"campo-etapa" + (falta ? " falta" : "")} id={id} tabIndex={-1}>
        <legend>{cabeca}</legend>{ajuda}
        <div className="opcoes">{c.opcoes!.map(([k, t]) => (
          <label key={k} className="opcao">
            {c.tipo === "opcao"
              ? <input type="radio" name={id} checked={texto === k} onChange={() => mudar(k)} />
              : <input type="checkbox" checked={marcas.includes(k)} onChange={(ev) => mudar(ev.target.checked ? [...marcas, k] : marcas.filter((x) => x !== k))} />}
            <span>{t}</span>
          </label>))}</div>
      </fieldset>
    );
  }
  return (
    <label className={"campo-etapa" + (falta ? " falta" : "") + (c.tipo === "area" ? " largo" : "")} htmlFor={id}>
      {cabeca}{ajuda}
      {c.tipo === "area"
        ? <textarea id={id} value={texto} rows={Math.min(12, Math.max(3, texto.split("\n").length + 1))} maxLength={20000} onChange={(ev) => mudar(ev.target.value)} />
        : <input id={id} value={texto} maxLength={c.tipo === "valor" ? 30 : 2000} inputMode={c.tipo === "valor" ? "decimal" : undefined}
            placeholder={c.tipo === "valor" ? "ex.: 12.500,00" : undefined} onChange={(ev) => mudar(ev.target.value)} />}
    </label>
  );
}

/** Item do PAC vinculado ao processo, com prioridade, início previsto e modalidade (PAC 2027). */
export function ItemPac({ p }: { p: any }) {
  const i = p.pca_item;
  const abrirDados = () => {
    const d = document.getElementById("dados-processo") as HTMLDetailsElement | null;
    if (d) { d.open = true; d.scrollIntoView({ behavior: "smooth", block: "start" }); }
  };
  return (
    <div className="sec">
      <span className="lbl">Item do PAC vinculado</span>
      {i ? <div className="pac-item">
        <b>{i.ordem_oficial ? `Item ${i.ordem_oficial} — ` : ""}{i.descricao}</b>
        <span className="small muted">{[`PAC ${i.ano}`, i.requisitante, i.prioridade && `Prioridade ${i.prioridade}`, i.periodo_oficial && `Início previsto: ${i.periodo_oficial}`, i.modalidade_prevista && `Modalidade prevista: ${i.modalidade_prevista}`].filter(Boolean).join(" · ")}</span>
      </div> : <p className="small muted">Nenhum item do PAC vinculado. Se o objeto consta do plano, vincule o item nos Dados do processo; se não consta, registre abaixo a justificativa e a autorização do Prefeito.</p>}
      <button className="btn sm" type="button" onClick={abrirDados}>{i ? "Alterar vínculo nos Dados do processo" : "Vincular item nos Dados do processo"}</button>
    </div>
  );
}

const numero = (x: unknown) => {
  if (typeof x !== "string" || !/\d/.test(x)) return null;
  const n = Number(x.replace(/[^\d,.-]/g, "").replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
};

/** "Confira antes de enviar ao Departamento de Licitações": situação de cada documento da fase interna. */
export function ProtocoloChecklist({ p, checks, irPara }: { p: any; checks: Checks; irPara: (aba: string) => void }) {
  const ok = (id: string) => feita(ETAPAS.find((e) => e.id === id)!, p, checks);
  const dot = p.campos?.dot ?? {};
  const fiscalCompleto = Boolean(checks["fiscal.campos"]);
  const linhas: [string, boolean, string][] = [
    ["Objeto consta do PAC (ou há autorização do Prefeito para contratação fora do PAC)", ok("pac"), "pac"],
    ["DFD assinado pelo responsável da Secretaria", ok("dfd"), "dfd"],
    ["ETP com os elementos mínimos obrigatórios e memória de cálculo de quantidades", ok("etp"), "etp"],
    ["Pesquisa de preços com parâmetros do art. 23 (ao menos 2, ou justificativa de fonte única) e memória de cálculo", ok("precos"), "precos"],
    ["Termo de Referência / Projeto Básico completo, com análise de riscos e matriz quando cabível", ok("tr"), "tr"],
    ["Indicação de dotação orçamentária solicitada à Contabilidade e indicada", ok("dot") && temValor(dot.dotacao), "dot"],
    ["Fiscal de contrato designado", fiscalCompleto, "fiscal"],
  ];
  const vPrecos = numero(p.campos?.precos?.valor_total), vDot = numero(dot.valor_total);
  const divergente = vPrecos != null && vDot != null && Math.abs(vPrecos - vDot) > 0.009;
  return (
    <div className="sec">
      <span className="lbl">Checklist antes de protocolar</span>
      <ul className="pends protocolo">{linhas.map(([t, feito, aba]) => (
        <li key={t} className={feito ? "ok" : ""}>
          <span>{feito ? "✓ " : "○ "}{t}</span>
          {!feito && aba !== "fiscal" && <button className="btn sm" type="button" onClick={() => irPara(aba)}>Ir à etapa</button>}
        </li>))}</ul>
      {divergente && <p className="note">O valor da pesquisa de preços e o valor informado na dotação são diferentes. A Procuradoria confere a coerência entre os documentos: quantidade e valor devem ser os mesmos em todas as peças.</p>}
    </div>
  );
}
