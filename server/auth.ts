import { randomBytes, scrypt as _scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type { NextFunction, Request, Response } from "express";
import { q, q1 } from "./db.js";
import type { Papel } from "../shared/etapas.js";

const scrypt = promisify(_scrypt) as (s: string, salt: Buffer, len: number) => Promise<Buffer>;
export const COOKIE = "licita_sessao";
const DIAS = 12 * 60 * 60 * 1000; // sessão de 12 horas

export async function hashSenha(senha: string) {
  const salt = randomBytes(16);
  const h = await scrypt(senha, salt, 64);
  return `scrypt$${salt.toString("hex")}$${h.toString("hex")}`;
}
export async function confereSenha(senha: string, guardado: string) {
  const [alg, s, h] = guardado.split("$");
  if (alg !== "scrypt" || !s || !h) return false;
  const calc = await scrypt(senha, Buffer.from(s, "hex"), 64);
  const ref = Buffer.from(h, "hex");
  return ref.length === calc.length && timingSafeEqual(ref, calc);
}
export function senhaValida(s: unknown): s is string {
  return typeof s === "string" && s.length >= 10;
}

export async function criarSessao(usuarioId: number) {
  const token = randomBytes(32).toString("base64url");
  await q("insert into sessoes (token, usuario_id, expira_em) values ($1,$2,$3)", [token, usuarioId, new Date(Date.now() + DIAS)]);
  await q("delete from sessoes where expira_em < now()");
  return token;
}
export function cookieOpts() {
  return { httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", maxAge: DIAS, path: "/" };
}

export interface Usuario { id: number; orgao_id: number; nome: string; email: string; cargo: string; papeis: Papel[]; orgao_nome: string }
declare global {
  namespace Express { interface Request { usuario?: Usuario } }
}

export async function carregarUsuario(req: Request, _res: Response, next: NextFunction) {
  const token = req.cookies?.[COOKIE];
  if (typeof token === "string" && token) {
    const u = await q1<Usuario>(
      `select u.id, u.orgao_id, u.nome, u.email, u.cargo, u.papeis, o.nome as orgao_nome
         from sessoes s join usuarios u on u.id = s.usuario_id join orgaos o on o.id = u.orgao_id
        where s.token = $1 and s.expira_em > now() and u.ativo`,
      [token],
    );
    if (u) req.usuario = u;
  }
  next();
}

export function exigeLogin(req: Request, res: Response, next: NextFunction) {
  if (!req.usuario) return res.status(401).json({ erro: "Entre no sistema para continuar." });
  next();
}
export function exigePapel(...papeis: Papel[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const u = req.usuario;
    if (!u) return res.status(401).json({ erro: "Entre no sistema para continuar." });
    if (u.papeis.includes("admin") || papeis.some((p) => u.papeis.includes(p))) return next();
    res.status(403).json({ erro: "Seu perfil não tem permissão para esta ação." });
  };
}
export const temPapel = (u: Usuario, ...p: Papel[]) => u.papeis.includes("admin") || p.some((x) => u.papeis.includes(x));
