import { Router } from "express";
import { z } from "zod";
import { q, q1, auditar } from "../db.js";
import { COOKIE, confereSenha, cookieOpts, criarSessao, exigeLogin, hashSenha, senhaValida } from "../auth.js";

// Limite simples de tentativas de login por e-mail+IP (memória do processo).
const tentativas = new Map<string, { n: number; ate: number }>();

export function rotasAuth() {
  const r = Router();

  r.post("/auth/entrar", async (req, res) => {
    const { email, senha } = z.object({ email: z.string().email(), senha: z.string().min(1) }).parse(req.body);
    const chave = `${email.toLowerCase()}|${req.ip}`;
    const t = tentativas.get(chave);
    if (t && t.n >= 5 && t.ate > Date.now()) return res.status(429).json({ erro: "Muitas tentativas. Aguarde 15 minutos." });
    const u = await q1("select id, orgao_id, senha_hash, ativo from usuarios where email = lower($1)", [email]);
    if (!u || !u.ativo || !(await confereSenha(senha, u.senha_hash))) {
      const n = (t && t.ate > Date.now() ? t.n : 0) + 1;
      tentativas.set(chave, { n, ate: Date.now() + 15 * 60 * 1000 });
      return res.status(401).json({ erro: "E-mail ou senha incorretos." });
    }
    tentativas.delete(chave);
    res.cookie(COOKIE, await criarSessao(u.id), cookieOpts());
    await auditar({ orgao: u.orgao_id, usuario: u.id, acao: "login" });
    res.json({ ok: true });
  });

  r.post("/auth/sair", async (req, res) => {
    const token = req.cookies?.[COOKIE];
    if (token) await q("delete from sessoes where token = $1", [token]);
    res.clearCookie(COOKIE, { path: "/" });
    res.json({ ok: true });
  });

  r.get("/auth/eu", exigeLogin, (req, res) => { res.json(req.usuario); });

  r.post("/auth/senha", exigeLogin, async (req, res) => {
    const { atual, nova } = z.object({ atual: z.string(), nova: z.string() }).parse(req.body);
    if (!senhaValida(nova)) return res.status(400).json({ erro: "A nova senha precisa ter ao menos 10 caracteres." });
    const u = await q1("select senha_hash from usuarios where id = $1", [req.usuario!.id]);
    if (!u || !(await confereSenha(atual, u.senha_hash))) return res.status(400).json({ erro: "Senha atual incorreta." });
    await q("update usuarios set senha_hash = $1 where id = $2", [await hashSenha(nova), req.usuario!.id]);
    await q("delete from sessoes where usuario_id = $1 and token <> $2", [req.usuario!.id, req.cookies[COOKIE]]);
    res.json({ ok: true });
  });

  return r;
}
