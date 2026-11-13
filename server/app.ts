import express, { type NextFunction, type Request, type Response } from "express";
import cookieParser from "cookie-parser";
import path from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ZodError } from "zod";
import { carregarUsuario } from "./auth.js";
import { rotasAuth } from "./routes/auth.js";
import { rotasAdmin } from "./routes/admin.js";
import { rotasProcessos } from "./routes/processos.js";
import { rotasIA } from "./routes/ia.js";
import { rotasPca } from "./routes/pca.js";
import { rotasContratos } from "./routes/contratos.js";
import { rotasPainel } from "./routes/painel.js";

import { ErroHttp } from "./erros.js";
export { ErroHttp };

export function criarApp() {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  app.use(express.json({ limit: "4mb" }));
  app.use(cookieParser());
  app.use(carregarUsuario);
  app.use((req, res, next) => {
    // Proteção contra CSRF: alterações só por fetch da própria aplicação (cabeçalho customizado).
    if (req.path.startsWith("/api/") && !["GET", "HEAD", "OPTIONS"].includes(req.method) && req.get("x-licita") !== "1") {
      return res.status(403).json({ erro: "Requisição recusada." });
    }
    next();
  });

  const api = express.Router();
  api.get("/saude", (_req, res) => { res.json({ ok: true }); });
  api.use(rotasAuth());
  api.use(rotasAdmin());
  api.use(rotasProcessos());
  api.use(rotasIA());
  api.use(rotasPca());
  api.use(rotasContratos());
  api.use(rotasPainel());
  api.use((_req, res) => { res.status(404).json({ erro: "Rota não encontrada." }); });
  app.use("/api", api);

  // Interface web compilada (vite build -> dist/web)
  const here = path.dirname(fileURLToPath(import.meta.url));
  const web = [path.join(here, "../web"), path.join(here, "../dist/web")].find((p) => existsSync(path.join(p, "index.html")));
  if (web) {
    app.use(express.static(web, { index: false, maxAge: "1h" }));
    app.get(/^\/(?!api\/).*/, (_req, res) => { res.sendFile(path.join(web, "index.html")); });
  }

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ErroHttp) return res.status(err.status).json({ erro: err.message });
    if (err instanceof ZodError) {
      const c = err.issues[0];
      return res.status(400).json({ erro: `Dado inválido${c?.path.length ? ` em "${c.path.join(".")}"` : ""}: ${c?.message ?? ""}` });
    }
    console.error(err);
    res.status(500).json({ erro: "Erro interno. Tente de novo; se persistir, avise o administrador." });
  });
  return app;
}
