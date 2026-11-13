import { Router } from "express";
import { q } from "../db.js";
import { exigeLogin } from "../auth.js";
import { calcular } from "./contratos.js";
import { resumoFracionamento } from "./pca.js";
import { ETAPAS, atual, type Checks } from "../../shared/etapas.js";

export function rotasPainel() {
  const r = Router();
  r.get("/painel", exigeLogin, async (req, res) => {
    const orgao = req.usuario!.orgao_id;
    const ano = new Date().getFullYear();
    const procs = await q(
      `select p.id, p.numero, p.objeto, p.tipo, p.via, p.situacao, p.atualizado_em,
              coalesce((select array_agg(item) from checagens c where c.processo_id = p.id), '{}') as itens
         from processos p where p.orgao_id=$1 and p.situacao = 'preparacao' order by p.atualizado_em`, [orgao]);
    const emPreparo = procs.map(({ itens, ...p }) => {
      const c: Checks = Object.fromEntries((itens as string[]).map((i) => [i, true]));
      const ix = atual(p, c);
      return { ...p, etapa: ETAPAS[ix].nome, etapa_ix: ix, parado_dias: Math.floor((Date.now() - new Date(p.atualizado_em).getTime()) / 86400000) };
    });
    const porEtapa = ETAPAS.map((e, i) => ({ etapa: e.nome, total: emPreparo.filter((p) => p.etapa_ix === i).length }));

    const cs = await q("select * from contratos where orgao_id=$1 and situacao='vigente'", [orgao]);
    const ids = cs.map((c) => c.id);
    const ad = ids.length ? await q("select * from aditivos where contrato_id = any($1)", [ids]) : [];
    const me = ids.length ? await q("select * from medicoes where contrato_id = any($1)", [ids]) : [];
    const contratos = cs.map((c) => ({ id: c.id, numero: c.numero, objeto: c.objeto, contratada: c.contratada, ...calcular(c, ad.filter((a) => a.contrato_id === c.id), me.filter((m) => m.contrato_id === c.id)) }));
    const frac = await resumoFracionamento(orgao, ano);

    res.json({
      ano,
      processos: { em_preparo: emPreparo.length, por_etapa: porEtapa, parados: emPreparo.filter((p) => p.parado_dias >= 15).sort((a, b) => b.parado_dias - a.parado_dias).slice(0, 10) },
      contratos: {
        vigentes: contratos.length,
        alertas: contratos.flatMap((c) => c.alertas.map((a) => ({ ...a, contrato_id: c.id, numero: c.numero, contratada: c.contratada }))).sort((a, b) => (a.nivel === b.nivel ? 0 : a.nivel === "alto" ? -1 : 1)),
      },
      fracionamento: frac.resumo.filter((x) => x.alerta),
      limites: frac.limites,
    });
  });
  return r;
}
