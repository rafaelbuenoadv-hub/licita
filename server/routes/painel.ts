import { Router } from "express";
import { q } from "../db.js";
import { exigeLogin } from "../auth.js";
import { resumoFracionamento } from "./pca.js";
import { TRILHA_PROCESSO, concluido, atual, trilhaDoProcesso, type Checks } from "../../shared/etapas.js";

export function rotasPainel() {
  const r = Router();
  r.get("/painel", exigeLogin, async (req, res) => {
    const orgao = req.usuario!.orgao_id;
    const ano = new Date().getFullYear();
    const procs = await q(
      `select p.id, p.protocolo, p.numero, p.objeto, p.tipo, p.via, p.situacao, p.atualizado_em,
              coalesce((select array_agg(item) from checagens c where c.processo_id = p.id), '{}') as itens
         from processos p where p.orgao_id=$1 and p.excluido_em is null and p.situacao <> 'cancelado' order by p.atualizado_em`, [orgao]);
    const ativos = procs.map(({ itens, ...p }) => {
      const c: Checks = Object.fromEntries((itens as string[]).map((i) => [i, true]));
      const { atual: etapa } = trilhaDoProcesso(p, c);
      return { ...p, concluido: concluido(p, c), etapa: etapa.nome, etapa_ix: atual(p, c), etapa_id: etapa.id, etapa_numero: etapa.numero,
        parado_dias: Math.floor((Date.now() - new Date(p.atualizado_em).getTime()) / 86400000) };
    });
    const emPreparo = ativos.filter((p) => !p.concluido);
    const porEtapa = TRILHA_PROCESSO.map((e) => ({ id: e.id, etapa: e.nome, numero: e.numero,
      total: emPreparo.filter((p) => p.etapa_id === e.id).length }));

    const frac = await resumoFracionamento(orgao, ano);

    res.json({
      ano,
      processos: { em_preparo: emPreparo.length, concluidos: ativos.filter((p) => p.concluido).length, por_etapa: porEtapa, parados: emPreparo.filter((p) => p.parado_dias >= 15).sort((a, b) => b.parado_dias - a.parado_dias).slice(0, 10) },
      fracionamento: frac.resumo.filter((x) => x.alerta),
      limites: frac.limites,
    });
  });
  return r;
}
