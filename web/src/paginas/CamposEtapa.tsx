import { useEffect, useState } from "react";
import { api } from "../api";
import { consultarPca, type ItemConsultaPca } from "../../../shared/consulta-pca";
import { ETAPAS, camposFaltando, camposVisiveis, feita, temValor, type Campo, type Checks, type Etapa, type Valores } from "../../../shared/etapas";

/** Campos de preenchimento da etapa, conforme a capacitação da fase interna. */
export function CamposEtapa({ e, p, valores, editavel, sujo, gravando, sugeridos, mudar, salvar, gerar, gerando }: {
  e: Etapa; p: any; valores: Valores; editavel: boolean; sujo: boolean; gravando: boolean; sugeridos: string[];
  mudar: (v: Valores) => void; salvar: () => void;
  /** Salva os campos e mescla no modelo do documento da etapa (sem IA). */
  gerar?: () => void; gerando?: boolean;
}) {
  const visiveis = camposVisiveis(e, p, valores);
  const faltam = new Set(camposFaltando(e, p, valores).map((c) => c.id));
  const set = (id: string, v: string | string[]) => mudar({ ...valores, [id]: v });
  return (
    <div className="sec campos-etapa">
      <div className="row"><span className="lbl">Preencha os campos da etapa</span>
        <span className={"pill " + (faltam.size ? "" : "ok")}>{faltam.size ? `${faltam.size} ${faltam.size === 1 ? "campo obrigatório em branco" : "campos obrigatórios em branco"}` : "Campos obrigatórios preenchidos"}</span></div>
      {sugeridos.length > 0 && editavel && <p className="note small">Alguns campos já vieram preenchidos com o que o processo registra (PAC, cadastro de secretários, instrução do processo, itens e etapas anteriores). Confira, ajuste e salve.</p>}
      {e.id === "etp" && <p className="small muted">★ Conteúdo mínimo obrigatório (art. 18, § 2º). Os demais incisos devem constar ou ter a ausência justificada no próprio campo.</p>}
      <fieldset disabled={!editavel || gravando} className="campos-grade">
        {visiveis.map((c) => (
          <CampoEtapa key={c.id} c={c} valor={valores[c.id]} falta={faltam.has(c.id)} sugerido={sugeridos.includes(c.id)} mudar={(v) => set(c.id, v)} />
        ))}
      </fieldset>
      {editavel && <div className="tools">
        <button className={gerar ? "btn" : "btn pri"} type="button" disabled={!sujo || gravando || gerando} onClick={salvar}>{gravando && !gerando ? "Salvando…" : sujo ? "Salvar campos" : "Campos salvos"}</button>
        {gerar && <button className="btn pri" type="button" disabled={gravando || gerando} onClick={gerar}
          title="Salva os campos e mescla no modelo do documento da etapa">{gerando ? "Gerando documento…" : "📄 Salvar e gerar documento"}</button>}
        {sujo && <span className="small muted">Há alterações não salvas.{gerar ? " \"Salvar e gerar documento\" salva e monta a minuta." : " \"Concluir e avançar\" também salva."}</span>}
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

/** Etapa 1: busca no PAC pelo nome do objeto; ao escolher, vincula o item e preenche os campos da verificação. */
export function ItemPac({ p, editavel, aoVincular, setAviso }: { p: any; editavel: boolean; aoVincular: () => Promise<void>; setAviso: (a: any) => void }) {
  const i = p.pca_item;
  const [itens, setItens] = useState<ItemPlano[] | null>(null);
  const [busca, setBusca] = useState("");
  const [gravando, setGravando] = useState<number | "remover" | null>(null);
  useEffect(() => {
    Promise.all([p.ano, p.ano + 1].map((ano: number) => api.get<{ itens: ItemPlano[] }>(`/pca?ano=${ano}`).then((r) => r.itens.map((x) => ({ ...x, ano }))).catch(() => [] as ItemPlano[])))
      .then((l) => setItens(l.flat()));
  }, [p.ano]);
  const vincular = async (id: number | null) => {
    setGravando(id ?? "remover");
    try {
      await api.post(`/processos/${p.id}/pac`, { pca_item_id: id });
      await aoVincular();
      setBusca("");
      setAviso({ t: id ? "Item do PAC vinculado e campos da etapa preenchidos. Confira o mês previsto e responda se a contratação começa nele." : "Vínculo com o PAC removido.", tipo: "ok" });
    } catch (e: any) { setAviso({ t: e.message, tipo: "bad" }); }
    finally { setGravando(null); }
  };
  const termos = semAcento(busca).split(/\s+/).filter((t) => t.length >= 2);
  const sugeridos = itens && !termos.length && !i
    ? (({ vinculo, candidatos }) => (vinculo ? [vinculo] : candidatos))(consultarPca(p.objeto, p.tipo, itens)).map((x) => itens.find((y) => y.id === x.id)!).filter(Boolean)
    : [];
  const achados = itens && termos.length
    ? itens.map((x) => {
        const t = semAcento(`${x.descricao} ${x.requisitante ?? ""} ${x.modalidade_prevista ?? ""}`);
        const num = termos.some((k) => /^\d+$/.test(k) && String(x.ordem_oficial) === k);
        return { x, n: termos.filter((k) => [k, ...(SINONIMOS[k.replace(/s$/, "")] ?? [])].some((v) => t.includes(v))).length + (num ? 2 : 0) };
      }).filter((r) => r.n > 0).sort((a, b) => b.n - a.n || b.x.ano - a.x.ano).slice(0, 15).map((r) => r.x)
    : sugeridos;
  return (
    <div className="sec">
      <span className="lbl">Item do PAC</span>
      {i ? <div className="pac-item">
        <b>{`PAC ${i.ano}`}{i.ordem_oficial ? ` · item ${i.ordem_oficial}` : ""} — {i.descricao}</b>
        <span className="small muted">{[i.requisitante, i.prioridade && `Prioridade ${i.prioridade}`, i.periodo_oficial && `Início previsto: ${i.periodo_oficial}`, i.modalidade_prevista && `Modalidade prevista: ${i.modalidade_prevista}`].filter(Boolean).join(" · ")}</span>
        {editavel && <div><button className="lnk" type="button" disabled={gravando !== null} onClick={() => vincular(null)}>Remover vínculo</button></div>}
      </div> : <p className="small muted">Nenhum item vinculado. Digite parte do nome do objeto para buscar no PAC {p.ano} e {p.ano + 1}.</p>}
      {editavel && <>
        <label className="campo">Buscar no PAC
          <input type="search" value={busca} onChange={(ev) => setBusca(ev.target.value)} placeholder="ex.: merenda, pneus, combustível, transporte escolar ou nº do item" />
        </label>
        {itens === null ? <p className="small muted">Carregando o PAC…</p>
          : !itens.length ? <p className="small muted">Não há itens do PAC cadastrados para {p.ano} ou {p.ano + 1}.</p>
          : achados.length === 0 ? (termos.length || !i ? <p className="small muted">{termos.length ? "Nada encontrado com essas palavras. Tente outra palavra do objeto." : "Digite para buscar."}</p> : null)
          : <>
            {!termos.length && <p className="small muted">Itens parecidos com o objeto do processo:</p>}
            <ul className="pac-resultados">{achados.map((x) => (
              <li key={x.id} className={x.id === p.pca_item_id ? "sel" : ""}>
                <span><b>PAC {x.ano}{x.ordem_oficial ? ` · item ${x.ordem_oficial}` : ""}</b> — {x.descricao}
                  <span className="small muted"> {[x.requisitante, x.prioridade, x.periodo_oficial && `início ${x.periodo_oficial}`, x.modalidade_prevista].filter(Boolean).join(" · ")}</span></span>
                {x.id === p.pca_item_id ? <span className="pill ok">Vinculado</span>
                  : <button className="btn sm" type="button" disabled={gravando !== null} onClick={() => vincular(x.id)}>{gravando === x.id ? "Vinculando…" : "Vincular"}</button>}
              </li>))}</ul>
          </>}
      </>}
    </div>
  );
}

interface ItemPlano extends ItemConsultaPca { ano: number; requisitante?: string; prioridade?: string | null; periodo_oficial?: string | null; modalidade_prevista?: string | null }
/** Palavras do dia a dia que o PAC escreve de outro jeito. */
const SINONIMOS: Record<string, string[]> = {
  merenda: ["alimentacao escolar", "generos alimenticios"], comida: ["alimenticio", "refeic", "marmit"], alimento: ["alimenticio", "alimentacao"],
  remedio: ["medicamento", "farmac"], carro: ["veicul", "frota", "automotiv"], veiculo: ["frota", "automotiv"], onibu: ["transporte", "veicul"],
  gasolina: ["combustive"], diesel: ["combustive"], computador: ["informatica"], impressora: ["impressao", "informatica"], papel: ["expediente", "papelaria"],
  limpeza: ["higiene", "dedetiza"], obra: ["reforma", "engenharia", "pavimenta", "construc"], asfalto: ["asfaltic", "pavimenta", "recape"],
  roupa: ["uniforme", "rouparia", "enxoval"], tenis: ["calcad", "uniforme"], internet: ["comunicacao de dados"], telefone: ["telefonia"],
  festa: ["evento", "show", "palco"], show: ["atrac", "evento"], ambulancia: ["veicul"], exame: ["laborator", "diagnostico"],
  escola: ["escolar", "cmei"], saude: ["medic", "hospital", "ubs"], gas: ["glp", "p13"], pneu: ["camara"], oleo: ["lubrificante", "filtro"],
};
const semAcento = (t: string) => t.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

const numero = (x: unknown) => {
  if (typeof x !== "string" || !/\d/.test(x)) return null;
  const n = Number(x.replace(/[^\d,.-]/g, "").replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
};

/** "Confira antes de enviar ao Departamento de Licitações": situação de cada documento da fase interna. */
export function ProtocoloChecklist({ p, checks, irPara }: { p: any; checks: Checks; irPara: (aba: string) => void }) {
  const ok = (id: string) => feita(ETAPAS.find((e) => e.id === id)!, p, checks);
  const dot = p.campos?.dot ?? {};
  const fiscalCompleto = ok("fiscal");
  const linhas: [string, boolean, string][] = [
    ["Objeto consta do PAC (ou inclusão extraordinária justificada)", ok("pac"), "pac"],
    ["Instrução do processo registrada, com itens e orçamentos", ok("solicitacao"), "solicitacao"],
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
          {!feito && aba !== "protocolo" && <button className="btn sm" type="button" onClick={() => irPara(aba)}>Ir à etapa</button>}
        </li>))}</ul>
      {divergente && <p className="note">O valor da pesquisa de preços e o valor informado na dotação são diferentes. A Procuradoria confere a coerência entre os documentos: quantidade e valor devem ser os mesmos em todas as peças.</p>}
    </div>
  );
}
