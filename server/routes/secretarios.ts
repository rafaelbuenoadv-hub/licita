import { Router } from "express";
import { z } from "zod";
import { exigePapel } from "../auth.js";
import { auditar, q, q1, tx } from "../db.js";
import { podeImportarIbaiti, secretariosIbaiti } from "../secretarios-ibaiti.js";

const dadosSecretario = z.object({
  secretaria: z.string().trim().min(2).max(180),
  nome: z.string().trim().min(2).max(180),
  email: z.string().trim().max(254).pipe(z.union([z.email(), z.literal("")])).default(""),
  telefone: z.string().trim().max(80).default(""),
  fonte: z.string().trim().max(1200).pipe(z.union([z.url({ protocol: /^https?$/ }), z.literal("")])).default(""),
});
const campos = "id, secretaria, nome, email, telefone, fonte";

export function rotasSecretarios() {
  const r = Router();
  r.use("/admin/secretarios", exigePapel("admin"));

  r.get("/admin/secretarios", async (req, res) => {
    const orgao = req.usuario!.orgao_id;
    const lista = await q(`select ${campos} from secretarios where orgao_id=$1 order by secretaria`, [orgao]);
    const identidade = await q1<{ nome: string; cnpj: string | null }>("select nome, cnpj from orgaos where id=$1", [orgao]);
    res.json({ lista, pode_importar_ibaiti: !!identidade && podeImportarIbaiti(identidade) });
  });

  r.post("/admin/secretarios", async (req, res) => {
    const { orgao_id, id: usuario } = req.usuario!;
    const d = dadosSecretario.parse(req.body);
    const registro = await tx(async (c) => {
      const resultado = await c.query(
        `insert into secretarios (orgao_id, secretaria, nome, email, telefone, fonte)
         values ($1,$2,$3,$4,$5,$6) on conflict do nothing returning ${campos}`,
        [orgao_id, d.secretaria, d.nome, d.email, d.telefone, d.fonte],
      );
      const salvo = resultado.rows[0];
      if (salvo) await auditar({ orgao: orgao_id, usuario, acao: "secretario.criado", detalhe: { id: salvo.id } }, c);
      return salvo;
    });
    if (!registro) return res.status(409).json({ erro: "Já existe um cadastro para essa secretaria." });
    res.status(201).json(registro);
  });

  r.put("/admin/secretarios/:id", async (req, res) => {
    const { orgao_id, id: usuario } = req.usuario!;
    const id = z.coerce.number().int().min(1).max(2147483647).parse(req.params.id);
    const d = dadosSecretario.parse(req.body);
    const registro = await tx(async (c) => {
      const resultado = await c.query(
        `update secretarios set secretaria=$1, nome=$2, email=$3, telefone=$4, fonte=$5
         where orgao_id=$6 and id=$7 returning ${campos}`,
        [d.secretaria, d.nome, d.email, d.telefone, d.fonte, orgao_id, id],
      );
      const salvo = resultado.rows[0];
      if (salvo) await auditar({ orgao: orgao_id, usuario, acao: "secretario.alterado", detalhe: { id } }, c);
      return salvo;
    }).catch((e: unknown) => {
      if (e instanceof Error && "constraint" in e && e.constraint === "secretarios_orgao_secretaria") return null;
      throw e;
    });
    if (registro === null) return res.status(409).json({ erro: "Já existe um cadastro para essa secretaria." });
    if (!registro) return res.status(404).json({ erro: "Cadastro não encontrado." });
    res.json(registro);
  });

  r.post("/admin/secretarios/importar-ibaiti", async (req, res) => {
    const { orgao_id, id: usuario } = req.usuario!;
    const inseridos = await tx(async (c) => {
      const identidade = await c.query<{ nome: string; cnpj: string | null }>(
        "select nome, cnpj from orgaos where id=$1 for share", [orgao_id],
      );
      if (!identidade.rows[0] || !podeImportarIbaiti(identidade.rows[0])) return null;
      const resultado = await c.query(
        `insert into secretarios (orgao_id, codigo_portal, secretaria, nome, email, telefone, fonte)
         select $1, codigo, secretaria, nome, email, telefone, fonte
         from jsonb_to_recordset($2::jsonb)
           as dados(codigo text, secretaria text, nome text, email text, telefone text, fonte text)
         on conflict do nothing`,
        [orgao_id, JSON.stringify(secretariosIbaiti)],
      );
      const total = resultado.rowCount ?? 0;
      if (total) await auditar({ orgao: orgao_id, usuario, acao: "secretarios.importados", detalhe: { total } }, c);
      return total;
    });
    if (inseridos === null) return res.status(403).json({ erro: "A lista oficial só está disponível para o Município de Ibaiti." });
    res.json({ inseridos });
  });

  return r;
}
