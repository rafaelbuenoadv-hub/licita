// Pronto pagamento (Lei nº 14.133/2021, art. 95, § 2º): pedido → autorização → recebimento → pagamento.
import { Router, type Request } from "express";
import { z } from "zod";
import { q, q1, tx, auditar } from "../db.js";
import { exigeLogin, exigePapel, temPapel } from "../auth.js";
import { ErroHttp } from "../erros.js";
import { minutaParaDocx } from "../docx.js";
import { minutaParaPdf } from "../pdf.js";
import { lerTimbrado, timbradosDoOrgao } from "../timbrados.js";
import { upload, nomeEnviado } from "./processos.js";
import { localizadorDeTitulares } from "../portarias.js";
import {
  VAZIO_PP, documentoPP, titularPP, limitePP, pendenciasPagamento, pendenciasPedido, pendenciasRecebimento, totalPP,
  type DadosPP, type SituacaoPP,
} from "../../shared/pronto-pagamento.js";

const txt = (max = 4000) => z.string().max(max).optional();
const data = z.union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)]).optional();
const valor = z.number().nonnegative().max(1e9).nullable().optional();
const camposPedido = {
  secretaria: txt(200), responsavel: txt(300), tipo: z.enum(["compra", "servico"]).optional(), objeto: txt(), justificativa: txt(8000),
  itens: z.array(z.object({ descricao: z.string().max(500), unidade: z.string().max(30), quantidade: valor.transform((x) => x ?? null), valor_unitario: valor.transform((x) => x ?? null) })).max(100).optional(),
  fornecedor: txt(300), fornecedor_doc: txt(30), fornecedor_contato: txt(300), pesquisa_preco: txt(8000), dotacao: txt(2000),
};
const camposRecebimento = { nota_numero: txt(60), nota_data: data, nota_valor: valor, recebido_por: txt(300), recebido_em: data, recebimento_obs: txt(2000) };
const camposPagamento = { forma_pagamento: z.enum(["", "empenho", "suprimento"]).optional(), empenho: txt(60), pago_em: data, pagamento_obs: txt(2000) };
/** Campos que cada situação deixa editar: o pedido só antes da autorização, a nota antes do pagamento. */
const EDITAVEIS: Partial<Record<SituacaoPP, object>> = {
  pedido: camposPedido,
  autorizado: camposRecebimento,
  recebido: { ...camposRecebimento, ...camposPagamento },
};

interface PP { id: number; orgao_id: number; protocolo: string; ano: number; situacao: SituacaoPP; dados: DadosPP; valor_total: number; autorizado_por: number | null; autorizado_em: string | null }

async function prontoDo(req: Request) {
  const p = await q1<PP>("select * from pronto_pagamentos where id=$1 and orgao_id=$2", [Number(req.params.id), req.usuario!.orgao_id]);
  if (!p) throw new ErroHttp(404, "Pronto pagamento não encontrado.");
  p.dados = { ...VAZIO_PP, ...p.dados };
  return p;
}
const soDigitos = (t: string) => t.replace(/\D/g, "");

/** Outros prontos pagamentos do exercício com o mesmo fornecedor: somados, podem indicar fracionamento. */
async function alertas(p: PP) {
  const lim = limitePP(p.ano);
  const l: string[] = [];
  if (!lim.exato) l.push(`Limite de ${p.ano} ainda não cadastrado no sistema: usado o de ${lim.ano} (${lim.fonte}). Confira o decreto de atualização do ano.`);
  const doc = soDigitos(p.dados.fornecedor_doc), nome = p.dados.fornecedor.trim().toLowerCase();
  if (doc || nome) {
    const outros = await q<{ protocolo: string; valor_total: number }>(
      `select protocolo, valor_total from pronto_pagamentos where orgao_id=$1 and ano=$2 and id<>$3 and situacao<>'cancelado'
        and ((($4::text <> '') and regexp_replace(coalesce(dados->>'fornecedor_doc',''), '\\D', '', 'g') = $4) or (($5::text <> '') and lower(btrim(coalesce(dados->>'fornecedor',''))) = $5))`,
      [p.orgao_id, p.ano, p.id, doc, nome]);
    if (outros.length) {
      const soma = outros.reduce((s, o) => s + o.valor_total, 0) + totalPP(p.dados.itens);
      const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
      l.push(`O mesmo fornecedor tem outros ${outros.length} prontos pagamentos no exercício (${outros.map((o) => o.protocolo).join(", ")}). Somados a este: ${brl(soma)}.${soma > lim.valor ? " A soma passa do limite: verifique se não há fracionamento de despesa que deveria ir para dispensa ou licitação." : ""}`);
    }
  }
  return l;
}

async function timbradoDo(orgaoId: number, codigo: unknown) {
  if (!codigo) return;
  const orgao = await q1<{ nome: string; cnpj: string | null }>("select nome, cnpj from orgaos where id=$1", [orgaoId]);
  const t = await lerTimbrado(orgao, codigo);
  if (!t) throw new ErroHttp(404, "Timbrado não encontrado.");
  return t;
}

export function rotasPronto() {
  const r = Router();
  r.use("/pronto", exigeLogin);

  // Titular da Secretaria no cadastro de secretários (nome e portaria), para preencher o responsável e a assinatura.
  r.get("/pronto/titular", async (req, res) => {
    const secretaria = z.string().max(200).parse(req.query.secretaria ?? "");
    const t = secretaria.trim() ? (await localizadorDeTitulares(req.usuario!.orgao_id))(secretaria) : undefined;
    res.json({ titular: t ? { nome: t.nome, secretaria: t.secretaria, portaria: t.portaria, texto: titularPP(t) } : null });
  });

  r.get("/pronto", async (req, res) => {
    const ano = Number(req.query.ano ?? new Date().getFullYear());
    const lista = await q(
      `select id, protocolo, ano, situacao, valor_total, atualizado_em, dados->>'secretaria' as secretaria, dados->>'objeto' as objeto, dados->>'fornecedor' as fornecedor
         from pronto_pagamentos where orgao_id=$1 and ano=$2 order by atualizado_em desc`, [req.usuario!.orgao_id, ano]);
    const ativos = lista.filter((x) => x.situacao !== "cancelado");
    res.json({ ano, limite: limitePP(ano), lista, total: ativos.reduce((s, x) => s + x.valor_total, 0), pagos: ativos.filter((x) => x.situacao === "pago").length });
  });

  r.post("/pronto", exigePapel("requisitante", "contratacao"), async (req, res) => {
    const { ano, secretaria } = z.object({ ano: z.number().int().min(2021).max(2100), secretaria: z.string().max(200).default("") }).parse(req.body);
    const orgao = req.usuario!.orgao_id;
    const titular = secretaria.trim() ? (await localizadorDeTitulares(orgao))(secretaria) : undefined;
    const novo = await tx(async (c) => {
      const k = (await c.query(
        `insert into sequencias (orgao_id, ano, chave, ultimo) values ($1,$2,'pronto',1)
         on conflict (orgao_id, ano, chave) do update set ultimo = sequencias.ultimo + 1 returning ultimo`, [orgao, ano])).rows[0].ultimo as number;
      const protocolo = `PP ${ano}/${String(k).padStart(4, "0")}`;
      const dados = { ...VAZIO_PP, secretaria, responsavel: titular ? titularPP(titular) : "" };
      return (await c.query("insert into pronto_pagamentos (orgao_id, protocolo, ano, dados, criado_por) values ($1,$2,$3,$4,$5) returning id, protocolo",
        [orgao, protocolo, ano, JSON.stringify(dados), req.usuario!.id])).rows[0] as { id: number; protocolo: string };
    });
    await auditar({ orgao, usuario: req.usuario!.id, acao: "pronto.criado", detalhe: novo });
    res.status(201).json(novo);
  });

  r.get("/pronto/:id", async (req, res) => {
    const p = await prontoDo(req);
    const anexos = await q("select a.id, a.tipo, a.nome, octet_length(a.arquivo) as bytes, a.criado_em, u.nome as usuario from pronto_pagamento_anexos a left join usuarios u on u.id=a.usuario_id where a.pronto_id=$1 order by a.id", [p.id]);
    const autor = p.autorizado_por ? await q1<{ nome: string }>("select nome from usuarios where id=$1", [p.autorizado_por]) : undefined;
    const historico = await q("select a.acao, a.detalhe, a.em, u.nome as usuario from auditoria a left join usuarios u on u.id=a.usuario_id where a.orgao_id=$1 and a.acao like 'pronto.%' and (a.detalhe->>'id')::int = $2 order by a.em", [p.orgao_id, p.id]);
    const secretarias = await q<{ secretaria: string }>("select secretaria from secretarios where orgao_id=$1 order by secretaria", [p.orgao_id]);
    const orgao = await q1<{ nome: string; cnpj: string | null }>("select nome, cnpj from orgaos where id=$1", [p.orgao_id]);
    const u = req.usuario!;
    res.json({
      ...p, anexos, historico, autorizado_por_nome: autor?.nome ?? null, limite: limitePP(p.ano), alertas: await alertas(p),
      secretarias: secretarias.map((s) => s.secretaria), timbrados: timbradosDoOrgao(orgao),
      pendencias: { pedido: pendenciasPedido(p.dados, p.ano), recebimento: pendenciasRecebimento(p.dados, totalPP(p.dados.itens)), pagamento: pendenciasPagamento(p.dados) },
      pode: {
        pedido: temPapel(u, "requisitante", "contratacao"), autorizar: temPapel(u, "autoridade", "contratacao"),
        receber: temPapel(u, "requisitante", "fiscal", "contratacao"), pagar: temPapel(u, "contratacao", "autoridade"), cancelar: temPapel(u, "contratacao", "autoridade"),
      },
    });
  });

  r.put("/pronto/:id", async (req, res) => {
    const p = await prontoDo(req);
    const permitidos = EDITAVEIS[p.situacao];
    if (!permitidos) throw new ErroHttp(409, p.situacao === "cancelado" ? "Pronto pagamento cancelado." : "Pronto pagamento já pago: não pode mais ser alterado.");
    const papel = p.situacao === "pedido" ? temPapel(req.usuario!, "requisitante", "contratacao") : temPapel(req.usuario!, "requisitante", "fiscal", "contratacao", "autoridade");
    if (!papel) throw new ErroHttp(403, "Seu perfil não pode alterar esta etapa.");
    const recebido = z.object({ dados: z.record(z.string(), z.unknown()) }).parse(req.body).dados;
    const fora = Object.keys(recebido).filter((k) => !(k in permitidos));
    if (fora.length) throw new ErroHttp(409, "Esses dados não podem mais ser alterados nesta etapa.");
    const novos = z.object(permitidos as z.ZodRawShape).parse(recebido);
    const dados = { ...p.dados, ...novos } as DadosPP;
    // Secretaria informada e responsável em branco: usa o titular do cadastro de secretários.
    if (p.situacao === "pedido" && !dados.responsavel?.trim() && dados.secretaria?.trim()) {
      const t = (await localizadorDeTitulares(p.orgao_id))(dados.secretaria);
      if (t) dados.responsavel = titularPP(t);
    }
    await q("update pronto_pagamentos set dados=$1, valor_total=$2, atualizado_em=now() where id=$3", [JSON.stringify(dados), totalPP(dados.itens), p.id]);
    res.json({ ok: true });
  });

  // Avança uma etapa: pedido → autorizado → recebido → pago, conferindo o que a etapa exige.
  r.post("/pronto/:id/avancar", async (req, res) => {
    const p = await prontoDo(req);
    const u = req.usuario!;
    const passo = {
      pedido: { para: "autorizado" as const, pode: temPapel(u, "autoridade", "contratacao"), pend: () => pendenciasPedido(p.dados, p.ano), quem: "o ordenador da despesa ou o setor de contratações" },
      autorizado: { para: "recebido" as const, pode: temPapel(u, "requisitante", "fiscal", "contratacao"), pend: () => pendenciasRecebimento(p.dados, totalPP(p.dados.itens)), quem: "a Secretaria ou o fiscal" },
      recebido: { para: "pago" as const, pode: temPapel(u, "contratacao", "autoridade"), pend: () => pendenciasPagamento(p.dados), quem: "o setor de contratações ou a autoridade" },
    }[p.situacao as "pedido" | "autorizado" | "recebido"];
    if (!passo) throw new ErroHttp(409, "Não há etapa seguinte para este pronto pagamento.");
    if (!passo.pode) throw new ErroHttp(403, `Esta etapa é registrada por ${passo.quem}.`);
    const pendencias = passo.pend();
    if (pendencias.length) return res.json({ avancou: false, pendencias });
    await q(`update pronto_pagamentos set situacao=$1, atualizado_em=now()${passo.para === "autorizado" ? ", autorizado_por=$3, autorizado_em=now()" : ""} where id=$2`,
      passo.para === "autorizado" ? [passo.para, p.id, u.id] : [passo.para, p.id]);
    await auditar({ orgao: p.orgao_id, usuario: u.id, acao: `pronto.${passo.para}`, detalhe: { id: p.id } });
    res.json({ avancou: true, situacao: passo.para });
  });

  // Volta uma etapa para corrigir (ex.: pedido devolvido pelo ordenador).
  r.post("/pronto/:id/voltar", exigePapel("contratacao", "autoridade"), async (req, res) => {
    const p = await prontoDo(req);
    const anterior: Partial<Record<SituacaoPP, SituacaoPP>> = { autorizado: "pedido", recebido: "autorizado", pago: "recebido" };
    const para = anterior[p.situacao];
    if (!para) throw new ErroHttp(409, "Não há etapa anterior.");
    await q(`update pronto_pagamentos set situacao=$1, atualizado_em=now()${para === "pedido" ? ", autorizado_por=null, autorizado_em=null" : ""} where id=$2`, [para, p.id]);
    await auditar({ orgao: p.orgao_id, usuario: req.usuario!.id, acao: "pronto.devolvido", detalhe: { id: p.id, para } });
    res.json({ ok: true, situacao: para });
  });

  r.post("/pronto/:id/cancelar", exigePapel("contratacao", "autoridade"), async (req, res) => {
    const p = await prontoDo(req);
    const { cancelar } = z.object({ cancelar: z.boolean() }).parse(req.body);
    if (cancelar && p.situacao === "pago") throw new ErroHttp(409, "Pronto pagamento já pago não pode ser cancelado.");
    if (!cancelar && p.situacao !== "cancelado") throw new ErroHttp(409, "Só é possível reabrir um pronto pagamento cancelado.");
    await q("update pronto_pagamentos set situacao=$1, autorizado_por=null, autorizado_em=null, atualizado_em=now() where id=$2", [cancelar ? "cancelado" : "pedido", p.id]);
    await auditar({ orgao: p.orgao_id, usuario: req.usuario!.id, acao: cancelar ? "pronto.cancelado" : "pronto.reaberto", detalhe: { id: p.id } });
    res.json({ ok: true });
  });

  // Anexos: orçamentos, nota fiscal, comprovante de pagamento.
  const ACEITOS = /\.(pdf|jpe?g|png|docx?|xlsx?|txt|csv)$/i;
  r.post("/pronto/:id/anexos", upload.array("arquivo", 10), async (req, res) => {
    const p = await prontoDo(req);
    if (p.situacao === "cancelado") throw new ErroHttp(409, "Pronto pagamento cancelado.");
    if (!temPapel(req.usuario!, "requisitante", "fiscal", "contratacao", "autoridade")) throw new ErroHttp(403, "Seu perfil não pode anexar documentos.");
    const { tipo } = z.object({ tipo: z.enum(["orcamento", "nota", "comprovante", "outro"]).default("outro") }).parse(req.body);
    const arquivos = (req.files as Express.Multer.File[] | undefined) ?? [];
    if (!arquivos.length) throw new ErroHttp(400, "Envie ao menos um arquivo.");
    for (const f of arquivos) if (!ACEITOS.test(nomeEnviado(f))) throw new ErroHttp(415, `"${nomeEnviado(f)}": envie PDF, imagem, Word, Excel, TXT ou CSV.`);
    for (const f of arquivos) {
      await q("insert into pronto_pagamento_anexos (pronto_id, tipo, nome, arquivo, usuario_id) values ($1,$2,$3,$4,$5)", [p.id, tipo, nomeEnviado(f), f.buffer, req.usuario!.id]);
    }
    await q("update pronto_pagamentos set atualizado_em=now() where id=$1", [p.id]);
    await auditar({ orgao: p.orgao_id, usuario: req.usuario!.id, acao: "pronto.anexo", detalhe: { id: p.id, tipo, arquivos: arquivos.map(nomeEnviado) } });
    res.status(201).json({ ok: true });
  });
  r.get("/pronto/:id/anexos/:aid", async (req, res) => {
    const p = await prontoDo(req);
    const a = await q1<{ nome: string; arquivo: Buffer }>("select nome, arquivo from pronto_pagamento_anexos where id=$1 and pronto_id=$2", [Number(req.params.aid), p.id]);
    if (!a) throw new ErroHttp(404, "Arquivo não encontrado.");
    const ascii = a.nome.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^\x20-\x7e]|["\\]/g, "_");
    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Disposition", `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(a.nome)}`);
    res.send(a.arquivo);
  });
  r.delete("/pronto/:id/anexos/:aid", async (req, res) => {
    const p = await prontoDo(req);
    if (p.situacao === "pago") throw new ErroHttp(409, "Pronto pagamento já pago: os documentos ficam guardados.");
    if (!temPapel(req.usuario!, "requisitante", "fiscal", "contratacao", "autoridade")) throw new ErroHttp(403, "Seu perfil não pode remover documentos.");
    await q("delete from pronto_pagamento_anexos where id=$1 and pronto_id=$2", [Number(req.params.aid), p.id]);
    res.json({ ok: true });
  });

  r.get(["/pronto/:id/documento.pdf", "/pronto/:id/documento.docx"], async (req, res) => {
    const p = await prontoDo(req);
    const formato = req.path.endsWith(".pdf") ? "pdf" : "docx";
    const tipo = req.query.tipo === "completo" ? "completo" : "autorizacao";
    const orgao = await q1<{ nome: string; municipio: string | null; uf: string | null }>("select nome, municipio, uf from orgaos where id=$1", [p.orgao_id]);
    const autor = p.autorizado_por ? await q1<{ nome: string }>("select nome from usuarios where id=$1", [p.autorizado_por]) : undefined;
    const texto = documentoPP({
      protocolo: p.protocolo, ano: p.ano, situacao: p.situacao, dados: p.dados, orgao: orgao?.nome ?? "",
      municipio: orgao?.municipio ? `${orgao.municipio}${orgao.uf ? `/${orgao.uf}` : ""}` : "", autorizado_por: autor?.nome ?? null, autorizado_em: p.autorizado_em ? new Date(p.autorizado_em).toISOString() : null,
    }, tipo);
    const titulo = tipo === "completo" ? "Processo de pronto pagamento" : "Solicitação e autorização de pronto pagamento";
    const buf = await (formato === "pdf" ? minutaParaPdf : minutaParaDocx)(texto, titulo, await timbradoDo(p.orgao_id, req.query.timbrado));
    const nome = `${titulo} - ${p.protocolo.replace(/\//g, "-")}.${formato}`;
    res.setHeader("Content-Type", formato === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    res.setHeader("Content-Disposition", `attachment; filename="${nome.normalize("NFD").replace(/[\u0300-\u036f]/g, "")}"; filename*=UTF-8''${encodeURIComponent(nome)}`);
    res.send(buf);
  });

  return r;
}

