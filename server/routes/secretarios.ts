import { Router } from "express";
import { z } from "zod";
import { exigePapel } from "../auth.js";
import { auditar, q, q1, tx } from "../db.js";
import { secretariosIbaitiComAtos } from "../secretarios-ibaiti.js";
import { ehMunicipioIbaiti } from "../municipio-ibaiti.js";

const link = z.string().trim().max(1200).pipe(z.union([z.url({ protocol: /^https?$/ }), z.literal("")]));

const dadosSecretario = z.object({
  secretaria: z.string().trim().min(2).max(180),
  nome: z.string().trim().min(2).max(180),
  email: z.string().trim().max(254).pipe(z.union([z.email(), z.literal("")])).default(""),
  telefone: z.string().trim().max(80).default(""),
  fonte: link.default(""),
  portaria: z.string().trim().regex(/^(?:[0-9]{1,8}\s*\/\s*[0-9]{4})?$/, "Use o formato número/ano, como 008/2025.").optional().transform((v) => v?.replace(/\s/g, "")),
  fonte_portaria: link.optional(),
});
const campos = "id, secretaria, nome, email, telefone, fonte, coalesce(portaria, '') as portaria, fonte_portaria";

export function rotasSecretarios() {
  const r = Router();
  r.use("/admin/secretarios", exigePapel("admin"));

  r.get("/admin/secretarios", async (req, res) => {
    const orgao = req.usuario!.orgao_id;
    const lista = await q(`select ${campos} from secretarios where orgao_id=$1 order by secretaria`, [orgao]);
    const identidade = await q1<{ nome: string; cnpj: string | null }>("select nome, cnpj from orgaos where id=$1", [orgao]);
    res.json({ lista, pode_importar_ibaiti: !!identidade && ehMunicipioIbaiti(identidade) });
  });

  r.post("/admin/secretarios", async (req, res) => {
    const { orgao_id, id: usuario } = req.usuario!;
    const d = dadosSecretario.parse(req.body);
    const registro = await tx(async (c) => {
      const resultado = await c.query(
        `insert into secretarios (orgao_id, secretaria, nome, email, telefone, fonte, portaria, fonte_portaria)
         values ($1,$2,$3,$4,$5,$6,$7,$8) on conflict do nothing returning ${campos}`,
        [orgao_id, d.secretaria, d.nome, d.email, d.telefone, d.fonte, d.portaria ?? null, d.portaria ? d.fonte_portaria ?? "" : ""],
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
        `update secretarios set secretaria=$1, nome=$2, email=$3, telefone=$4, fonte=$5,
           portaria=case when lower(nome)<>lower($2) or lower(secretaria)<>lower($1) then coalesce(nullif($8,portaria),'') else coalesce($8,portaria) end,
           fonte_portaria=case when ($8='' or ((lower(nome)<>lower($2) or lower(secretaria)<>lower($1)) and ($8 is null or $8=portaria))) then ''
             when $8 is not null and $8 is distinct from portaria then coalesce($9,'') else coalesce($9,fonte_portaria) end
         where orgao_id=$6 and id=$7 returning ${campos}`,
        [d.secretaria, d.nome, d.email, d.telefone, d.fonte, orgao_id, id, d.portaria ?? null, d.fonte_portaria ?? null],
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
      if (!identidade.rows[0] || !ehMunicipioIbaiti(identidade.rows[0])) return null;
      const resultado = await c.query(
        `insert into secretarios (orgao_id, codigo_portal, secretaria, nome, email, telefone, fonte, portaria, fonte_portaria)
         select $1, codigo, secretaria, nome, email, telefone, fonte, portaria, fonte_portaria
         from jsonb_to_recordset($2::jsonb)
           as dados(codigo text, secretaria text, nome text, email text, telefone text, fonte text, portaria text, fonte_portaria text)
         on conflict do nothing`,
        [orgao_id, JSON.stringify(secretariosIbaitiComAtos)],
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
