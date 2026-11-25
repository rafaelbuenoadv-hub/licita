import { createHash } from "node:crypto";
import type { ProcessoCentral, RegistrosCentrais } from "../../../shared/processo-central.js";

/** Ordena chaves JSON, mantendo a ordem dos arrays retornados pelo repositório. */
function canonico(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonico);
  if (v !== null && typeof v === "object") {
    return Object.fromEntries(Object.entries(v).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,x])=>[k,canonico(x)]));
  }
  return v;
}

/** Projeção pura do legado. Itens não são mesclados nem preços são recalculados nesta entrega. */
export function projetarProcessoCentral(registros: RegistrosCentrais): ProcessoCentral {
  const nomes = [registros.identificacao.requisitante,
    ...registros.identificacao.areas_adicionais,
    ...registros.demandas.map(d=>d.secretaria)];
  const secretarias = [...new Set(nomes.map(s=>s.trim()).filter(Boolean))];
  const itens = registros.demandas.flatMap(d=>(Array.isArray(d.itens)?d.itens:[]).map((dado,indice)=>({
    solicitacao_id:d.id, secretaria:d.secretaria, indice, dado
  })));
  const versaoDados=createHash("sha256").update(JSON.stringify(canonico(registros))).digest("hex");
  return {...registros,secretarias,itens,versaoDados,modo:"leitura_legado"};
}
