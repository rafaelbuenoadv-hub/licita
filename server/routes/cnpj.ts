import { Router } from "express";
import { z } from "zod";
import { q1, auditar } from "../db.js";
import { exigeLogin, temPapel } from "../auth.js";
import { ErroHttp } from "../erros.js";
import { etapaPorId } from "../../shared/etapas.js";
import { formatarCnpj } from "../../shared/cnpj.js";
import { certidaoTcuPdf, consultarCnpj } from "../cnpj.js";
import { processoDo } from "./processos.js";

export function rotasCnpj() {
  const r = Router();
  // Cadastro na Receita e certidão consolidada do TCU (sanções), sem gravar nada.
  r.get("/cnpj/:cnpj", exigeLogin, async (req, res) => {
    res.set("Cache-Control", "private, no-store");
    res.json(await consultarCnpj(String(req.params.cnpj)));
  });
  // Emite a certidão consolidada do TCU em PDF e junta ao processo, na peça indicada.
  r.post("/processos/:id/certidao-tcu", exigeLogin, async (req, res) => {
    const p = await processoDo(req);
    if (!temPapel(req.usuario!, "requisitante", "contratacao", "juridico")) throw new ErroHttp(403, "Seu perfil não pode anexar documentos.");
    const { cnpj, etapa, fornecedor } = z.object({
      cnpj: z.string().trim().min(14).max(20),
      etapa: z.string().default("precos").refine((x) => !x || !!etapaPorId(x), "Peça de referência inválida."),
      fornecedor: z.string().trim().max(200).default(""),
    }).parse(req.body ?? {});
    const { pdf, certidoes, codigo } = await certidaoTcuPdf(cnpj);
    const nome = `Certidão consolidada TCU — ${fornecedor ? `${fornecedor.replace(/[\\/:*?"<>|]/g, " ").slice(0, 80)} — ` : ""}${formatarCnpj(cnpj).replace(/\//g, "-")}.pdf`;
    const texto = [`Certidão consolidada de pessoa jurídica (TCU) — CNPJ ${formatarCnpj(cnpj)}${codigo ? ` — código de controle ${codigo}` : ""}`,
      ...certidoes.map((c) => `${c.cadastro}: ${c.situacao === "nada_consta" ? "nada consta" : c.situacao === "consta" ? "CONSTA" : "verificar"}`)].join("\n");
    const a = await q1<{ id: number }>("insert into anexos (processo_id, nome, texto, usuario_id, arquivo, etapa) values ($1,$2,$3,$4,$5,$6) returning id", [p.id, nome, texto, req.usuario!.id, pdf, etapa]);
    await auditar({ orgao: p.orgao_id, usuario: req.usuario!.id, processo: p.id, acao: "anexo.incluido", detalhe: { nome, etapa, origem: "certidao-tcu" } });
    res.status(201).json({ id: a!.id, nome, certidoes });
  });
  return r;
}
