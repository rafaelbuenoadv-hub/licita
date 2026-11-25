import { test } from "node:test";
import assert from "node:assert/strict";
import { ETAPAS, itensDe, atual, concluido, trilhaDoProcesso } from "../../shared/etapas.js";
import { proximaEtapa } from "../conferencia.js";

test("fase interna encerra no Protocolo para todas as formas de contratação", () => {
  assert.deepEqual(ETAPAS.map((e) => e.id), ["pac", "solicitacao", "dfd", "etp", "precos", "tr", "dot", "fiscal", "protocolo"]);
  assert.ok(ETAPAS.every((e) => e.fase === "interna"));
  assert.equal(proximaEtapa(ETAPAS.at(-1)!), undefined);
  for (const tipo of ["bens", "servicos", "obra"] as const) for (const via of ["licitacao", "dispensa", "inexigibilidade"] as const) {
    const p = { tipo, via };
    const checks = Object.fromEntries(ETAPAS.flatMap((e) => itensDe(e, p).map((i) => [i.id, true])));
    assert.equal(concluido(p, checks), true);
    assert.equal(atual(p, checks), 8);
    const trilha = trilhaDoProcesso(p, checks);
    assert.equal(trilha.atual.id, "protocolo");
    assert.equal(trilha.etapas.length, 9);
    assert.ok(trilha.etapas.every((e) => e.estado === "concluida"));
  }
});
