import express, { type ErrorRequestHandler } from "express";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import { config } from "./config.js";
import { authRouter } from "./auth.js";
import { apiRouter } from "./api.js";

export const app = express();
// Apache or equivalent reverse proxy can be trusted only on the loopback interface.
app.set("trust proxy", "loopback");
app.disable("x-powered-by");
app.use(helmet());
app.use(express.json({ limit: "32kb" }));
app.use("/api", (_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});
app.use((req, res, next) => {
  if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    const origin = req.get("origin");
    // The browser must send the exact corporate site origin for cookie-authenticated writes.
    if (origin !== config.appOrigin) {
      res.status(403).json({ error: "origin_not_allowed", message: "Origem da requisição não autorizada." });
      return;
    }
  }
  next();
});
const generalLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 180, standardHeaders: "draft-8", legacyHeaders: false });
const authLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 20, standardHeaders: "draft-8", legacyHeaders: false });
app.use("/api", generalLimiter);
app.use("/api/auth", authLimiter, authRouter);
app.use("/api", apiRouter);
app.use("/api", (_req, res) => res.status(404).json({ error: "not_found" }));
const onError: ErrorRequestHandler = (error, _req, res, _next) => {
  console.error("[vivaion-empresas-api]", error instanceof Error ? error.message : "unhandled_error");
  if (res.headersSent) return;
  res.status(500).json({ error: "internal_error", message: "O serviço não conseguiu concluir a solicitação." });
};
app.use(onError);
