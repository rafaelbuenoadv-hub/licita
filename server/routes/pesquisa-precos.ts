import { Router } from "express";
import { z } from "zod";
import { exigeLogin, exigePapel } from "../auth.js";
import { tx, auditar } from "../db.js";
import { processoDo, exigeEtapaEditavel, checksDo, calcularItens } from "./processos.js";
import { ErroHttp } from "../erros.js";
import { documentoDaPesquisaDePrecos, inserirItens, totalDosItens, LIMITE_SOLICITACAO, type ItemSolicitacao } from "../../shared/solicitacao.js";

const descarte = z.object({ motivo: z.enum(["inexequivel", "elevado"]), justificativa: z.string().trim().min(1, "Justifique cada preço descartado.").max(2000) });
const cotacao = z.object({ indice: z.number().int().nonnegative(), uso: z.enum(["calculo", "referencia", "descartado"]), descarte: descarte.optional() })
  .refine((c) => c.uso === "descartado" ? !!c.descarte : !c.descarte, "Informe motivo e justificativa somente nos preços descartados.");
const dadosPesquisa = z.object({ solicitacoes: z.array(z.object({
  id: z.number().int().positive(), itens_anteriores: z.array(z.unknown()).max(200),
  analises: z.array(z.object({ indice: z.number().int().nonnegative(), criterio: z.enum(["media", "mediana", "menor"]), cotacoes: z.array(cotacao).max(20) })).max(200),
})).min(1).max(100) }).refine((d) => new Set(d.solicitacoes.map((s) => s.id)).size === d.solicitacoes.length, "Cada solicitação deve aparecer uma única vez.");

export function rotasPesquisaPrecos() {
  const r = Router(); r.use(exigeLogin);
  r.put("/processos/:id/pesquisa-precos", exigePapel("requisitante", "contratacao"), async (req, res) => {
    const p = await processoDo(req);
    exigeEtapaEditavel(req, p, await checksDo(p.id), "precos");
    const dados = dadosPesquisa.parse(req.body);
    const derivados = await tx(async (c) => {
      const { rows: [proc] } = await c.query("select situacao from processos where id=$1 and orgao_id=$2 and excluido_em is null for update", [p.id, p.orgao_id]);
      if (proc?.situacao !== "preparacao") throw new ErroHttp(409, "Reabra a fase interna para alterar a pesquisa de preços.");
      let mudou = false;
      for (const s of dados.solicitacoes) {
        const { rows: [salva] } = await c.query<{ descricao: string; itens: ItemSolicitacao[]; iguais: boolean }>(
          "select descricao,itens,itens=$3::jsonb as iguais from solicitacoes_processo where processo_id=$1 and id=$2 for update", [p.id, s.id, JSON.stringify(s.itens_anteriores)]);
        if (!salva) throw new ErroHttp(404, "Solicitação não encontrada neste processo.");
        if (!salva.iguais) throw new ErroHttp(409, "Os itens ou preços mudaram. Recarregue as cotações antes de salvar a análise.");
        if (s.analises.length !== salva.itens.length) throw new ErroHttp(400, "Confira todos os itens da solicitação.");
        const itens = calcularItens(salva.itens.map((item, i) => {
          const analise = s.analises[i];
          if (analise.indice !== i || analise.cotacoes.length !== (item.cotacoes?.length ?? 0)) throw new ErroHttp(400, "A análise deve manter todos os itens e preços cadastrados.");
          return { ...item, criterio: analise.criterio, ...(item.cotacoes ? { cotacoes: item.cotacoes.map((original, j) => {
            const a = analise.cotacoes[j];
            if (a.indice !== j) throw new ErroHttp(400, "Mantenha a ordem das cotações na análise.");
            if (a.uso !== "calculo" && original.valor_unitario == null) throw new ErroHttp(400, "Informe o preço na Solicitação antes de classificá-lo.");
            const { descarte: anterior, apenas_referencia: referenciaAnterior, ...base } = original;
            return { ...base, ...(a.uso === "referencia" ? { apenas_referencia: true } : {}), ...(a.uso === "descartado" ? { descarte: a.descarte! } : {}) };
          }) } : {}) };
        }));
        const { rows: [igual] } = await c.query<{ igual: boolean }>("select $1::jsonb=$2::jsonb as igual", [JSON.stringify(itens), JSON.stringify(salva.itens)]);
        if (igual.igual) continue;
        const descricao = inserirItens(salva.descricao, itens, true);
        if (descricao.length > LIMITE_SOLICITACAO) throw new ErroHttp(400, "As justificativas deixam a solicitação muito longa. Reduza os textos antes de salvar.");
        await c.query("update solicitacoes_processo set itens=$1::jsonb,descricao=$2 where id=$3", [JSON.stringify(itens), descricao, s.id]);
        mudou = true;
      }
      const todas = (await c.query<{ itens: ItemSolicitacao[] }>("select itens from solicitacoes_processo where processo_id=$1 order by id", [p.id])).rows.flatMap((s) => s.itens);
      const total = totalDosItens(todas);
      const criterios = new Set(todas.filter((i) => i.cotacoes?.length).map((i) => i.criterio ?? "media"));
      const campos = { valor_total: total == null ? "" : total.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }), ...(criterios.size ? { metodo: criterios.size === 1 ? [...criterios][0] : "outro" } : {}) };
      if (mudou) {
        const { rows: [minuta] } = await c.query<{ texto: string; versao: number }>("select texto,versao from minutas where processo_id=$1 and etapa='precos' order by versao desc limit 1 for update", [p.id]);
        if (minuta) {
          const texto = documentoDaPesquisaDePrecos(minuta.texto, todas);
          if (texto !== minuta.texto) await c.query("insert into minutas (processo_id,etapa,versao,texto,origem,usuario_id) values ($1,'precos',$2,$3,'campos',$4)", [p.id, minuta.versao + 1, texto, req.usuario!.id]);
        }
        await c.query("insert into campos_etapa (processo_id,etapa,valores,usuario_id) values ($1,'precos',$2::jsonb,$3) on conflict (processo_id,etapa) do update set valores=campos_etapa.valores || excluded.valores, usuario_id=excluded.usuario_id,atualizado_em=now()", [p.id, JSON.stringify(campos), req.usuario!.id]);
        // Uma alteração de preços pede nova conferência do relatório e da pasta antes do protocolo.
        await c.query("delete from checagens where processo_id=$1 and item=any($2::text[])", [p.id, ["p1", "p7", "f2"]]);
        await c.query("update processos set atualizado_em=now() where id=$1", [p.id]);
        await auditar({ orgao: p.orgao_id, usuario: req.usuario!.id, processo: p.id, acao: "precos.analisados", detalhe: { solicitacoes: dados.solicitacoes.map((s) => s.id), referencia: todas.flatMap((i) => i.cotacoes ?? []).filter((x) => x.apenas_referencia).length, descartados: todas.flatMap((i) => i.cotacoes ?? []).filter((x) => x.descarte).length } }, c);
      }
      return campos;
    });
    res.json({ ok: true, campos: derivados });
  });
  return r;
}
