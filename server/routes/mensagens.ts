import { Router } from "express";
import { z } from "zod";
import { q, q1, tx } from "../db.js";
import { exigeLogin } from "../auth.js";
import { ErroHttp } from "../erros.js";

// Caixa de mensagens entre usuários do mesmo órgão. Cada destinatário recebe a sua linha;
// só o remetente e o destinatário leem a mensagem.
export function rotasMensagens() {
  const r = Router();
  r.use("/mensagens", exigeLogin);

  const CAMPOS = `m.id, m.assunto, m.texto, m.criado_em, m.lida_em, m.processo_id, p.protocolo as processo_protocolo,
    m.de_id, de.nome as de_nome, de.cargo as de_cargo, m.para_id, pa.nome as para_nome, pa.cargo as para_cargo`;
  const JUNTA = `from mensagens m join usuarios de on de.id = m.de_id join usuarios pa on pa.id = m.para_id
    left join processos p on p.id = m.processo_id`;

  // Usuários ativos do órgão para quem se pode escrever.
  r.get("/mensagens/destinatarios", async (req, res) => {
    res.json(await q("select id, nome, cargo from usuarios where orgao_id=$1 and ativo and id<>$2 order by nome", [req.usuario!.orgao_id, req.usuario!.id]));
  });

  r.get("/mensagens/nao-lidas", async (req, res) => {
    const x = await q1<{ n: number }>("select count(*)::int as n from mensagens where para_id=$1 and lida_em is null", [req.usuario!.id]);
    res.json({ total: x?.n ?? 0 });
  });

  r.get("/mensagens", async (req, res) => {
    const enviadas = req.query.caixa === "enviadas";
    res.json(await q(
      `select ${CAMPOS} ${JUNTA} where m.orgao_id=$1 and ${enviadas ? "m.de_id" : "m.para_id"}=$2 order by m.criado_em desc, m.id desc limit 300`,
      [req.usuario!.orgao_id, req.usuario!.id]));
  });

  r.post("/mensagens", async (req, res) => {
    const d = z.object({
      para: z.array(z.number().int()).min(1, "Escolha ao menos um destinatário.").max(100),
      assunto: z.string().trim().min(1).max(200),
      texto: z.string().trim().min(1).max(20000),
      processo_id: z.number().int().nullable().default(null),
    }).parse(req.body);
    const eu = req.usuario!;
    const para = [...new Set(d.para)];
    if (para.includes(eu.id)) throw new ErroHttp(400, "Não é possível enviar mensagem para si mesmo.");
    const ok = await q("select id from usuarios where orgao_id=$1 and ativo and id = any($2)", [eu.orgao_id, para]);
    if (ok.length !== para.length) throw new ErroHttp(400, "Destinatário não encontrado.");
    if (d.processo_id && !(await q1("select 1 from processos where id=$1 and orgao_id=$2", [d.processo_id, eu.orgao_id]))) throw new ErroHttp(400, "Processo não encontrado.");
    await tx(async (c) => {
      for (const id of para) {
        await c.query("insert into mensagens (orgao_id, de_id, para_id, processo_id, assunto, texto) values ($1,$2,$3,$4,$5,$6)", [eu.orgao_id, eu.id, id, d.processo_id, d.assunto, d.texto]);
      }
    });
    res.status(201).json({ enviadas: para.length });
  });

  // Marca como lida: só o destinatário.
  r.post("/mensagens/:id/lida", async (req, res) => {
    const m = await q1("update mensagens set lida_em = coalesce(lida_em, now()) where id=$1 and para_id=$2 returning id", [Number(req.params.id), req.usuario!.id]);
    if (!m) throw new ErroHttp(404, "Mensagem não encontrada.");
    res.json({ ok: true });
  });

  return r;
}
