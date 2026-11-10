import { Router, type Request, type Response, type NextFunction, type RequestHandler } from "express";
import { z } from "zod";
import { pool } from "./db.js";
import { config } from "./config.js";
import { isValidCnpj, normalizeCnpj } from "./domain/cnpj.js";
import { createSessionToken, hashPassword, hashSessionToken, verifyPassword } from "./domain/passwords.js";

export type AuthContext = {
  accountId: string;
  companyId: string;
  role: "administrator" | "manager" | "finance" | "collaborator";
  companyStatus: "pending" | "verified" | "rejected" | "suspended";
};
export type AuthRequest = Request & { auth?: AuthContext };

type AuthRow = {
  account_id: string;
  company_id: string;
  role: AuthContext["role"];
  company_status: AuthContext["companyStatus"];
  full_name: string;
  email: string;
  legal_name: string;
  cnpj: string;
  password_hash?: string;
};

const sessionName = config.isProduction ? "__Host-ve_sid" : "ve_sid";
const sessionMaxAgeMs = config.sessionDays * 24 * 60 * 60 * 1000;
const sessionOptions = { httpOnly: true, sameSite: "lax" as const, secure: config.isProduction, path: "/", maxAge: sessionMaxAgeMs };

function readCookie(req: Request, key: string): string | null {
  const match = (req.headers.cookie ?? "").split(";").map((part) => part.trim()).find((part) => part.startsWith(key + "="));
  if (!match) return null;
  try { return decodeURIComponent(match.slice(key.length + 1)); } catch { return null; }
}
function setSessionCookie(res: Response, token: string) { res.cookie(sessionName, token, sessionOptions); }
function clearSessionCookie(res: Response) { res.clearCookie(sessionName, { httpOnly: true, secure: config.isProduction, sameSite: "lax", path: "/" }); }
function publicProfile(row: AuthRow) {
  return {
    user: { id: row.account_id, fullName: row.full_name, email: row.email, role: row.role },
    company: { id: row.company_id, name: row.legal_name, cnpj: row.cnpj, status: row.company_status }
  };
}

export const requireAuth: RequestHandler = async (req, res, next) => {
  try {
    const token = readCookie(req, sessionName);
    if (!token || !/^[A-Za-z0-9_-]{35,64}$/.test(token)) {
      res.status(401).json({ error: "not_authenticated", message: "Acesso não autenticado." }); return;
    }
    const result = await pool.query<AuthRow>(`
      SELECT a.id AS account_id, c.id AS company_id, m.role, c.status AS company_status,
             a.full_name, a.email, c.legal_name, c.cnpj
      FROM sessions s
      JOIN accounts a ON a.id=s.account_id AND a.is_active=TRUE
      JOIN companies c ON c.id=s.company_id
      JOIN memberships m ON m.account_id=a.id AND m.company_id=c.id
      WHERE s.token_hash=$1 AND s.expires_at>NOW() LIMIT 1
    `, [hashSessionToken(token)]);
    if (!result.rows.length) { res.status(401).json({ error: "session_expired", message: "Sessão expirada." }); return; }
    const row = result.rows[0]!;
    if (row.company_status === "suspended") { res.status(403).json({ error: "company_suspended", message: "Acesso empresarial suspenso." }); return; }
    (req as AuthRequest).auth = { accountId: row.account_id, companyId: row.company_id, role: row.role, companyStatus: row.company_status };
    next();
  } catch (error) { next(error); }
};

export function requireRoles(...roles: AuthContext["role"][]): RequestHandler {
  return (req, res, next) => {
    const auth = (req as AuthRequest).auth;
    if (!auth || !roles.includes(auth.role)) { res.status(403).json({ error: "forbidden", message: "Permissão insuficiente." }); return; }
    next();
  };
}

const registerSchema = z.object({
  companyName: z.string().trim().min(3).max(180),
  cnpj: z.string().trim().min(14).max(22),
  fullName: z.string().trim().min(3).max(140),
  email: z.string().trim().email().max(254).transform((e) => e.toLowerCase()),
  password: z.string().min(12).max(128),
}).strict();
const loginSchema = z.object({
  email: z.string().trim().email().max(254).transform((e) => e.toLowerCase()),
  password: z.string().min(1).max(128)
}).strict();

export const authRouter = Router();
authRouter.post("/register", async (req, res, next) => {
  const validation = registerSchema.safeParse(req.body);
  if (!validation.success) { res.status(400).json({ error: "invalid_data", message: "Revise os dados informados." }); return; }
  const { companyName, cnpj: rawCnpj, fullName, email, password } = validation.data;
  const cnpj = normalizeCnpj(rawCnpj);
  if (!isValidCnpj(cnpj)) { res.status(400).json({ error: "invalid_cnpj", message: "CNPJ inválido. Confira o número e os dígitos verificadores." }); return; }
  const passwordHash = await hashPassword(password);
  const token = createSessionToken();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const company = await client.query<{id:string}>(`INSERT INTO companies(cnpj,legal_name,status) VALUES($1,$2,'pending') RETURNING id`, [cnpj, companyName]);
    const account = await client.query<{id:string}>(`INSERT INTO accounts(email,full_name,password_hash) VALUES($1,$2,$3) RETURNING id`, [email, fullName, passwordHash]);
    const companyId = company.rows[0]!.id;
    const accountId = account.rows[0]!.id;
    await client.query(`INSERT INTO memberships(company_id,account_id,role) VALUES($1,$2,'administrator')`, [companyId, accountId]);
    await client.query(`INSERT INTO sessions(account_id,company_id,token_hash,expires_at) VALUES($1,$2,$3,NOW()+INTERVAL '7 days')`, [accountId, companyId, hashSessionToken(token)]);
    await client.query(`INSERT INTO audit_events(company_id,actor_account_id,event_type) VALUES($1,$2,'company.registered')`, [companyId, accountId]);
    await client.query("COMMIT");
    setSessionCookie(res, token);
    res.status(201).json({ message: "Cadastro recebido. A empresa aguarda validação.", status: "pending" });
  } catch (error) {
    await client.query("ROLLBACK");
    if ((error as {code?:string}).code === "23505") { res.status(409).json({ error: "already_exists", message: "Já existe um cadastro para um dos dados informados. Entre em contato com a Vivaion." }); return; }
    next(error);
  } finally { client.release(); }
});

authRouter.post("/login", async (req, res, next) => {
  const validation = loginSchema.safeParse(req.body);
  if (!validation.success) { res.status(400).json({ error: "invalid_data", message: "Informe e-mail e senha." }); return; }
  try {
    const result = await pool.query<AuthRow>(`
      SELECT a.id AS account_id,a.email,a.full_name,a.password_hash,c.id AS company_id,c.cnpj,
             c.legal_name,c.status AS company_status,m.role
      FROM accounts a JOIN memberships m ON m.account_id=a.id
      JOIN companies c ON c.id=m.company_id
      WHERE a.email=$1 AND a.is_active=TRUE
      ORDER BY m.created_at ASC LIMIT 1
    `, [validation.data.email]);
    const account = result.rows[0];
    // Run a real password hash even for unknown accounts, reducing timing leaks.
    const fallbackHash = "scrypt$7f7e6f7e5f7e6f7e5f7e6f7e5f7e6f7e$" + "00".repeat(64);
    const valid = await verifyPassword(validation.data.password, account?.password_hash ?? fallbackHash);
    if (!account || !valid) { res.status(401).json({ error: "invalid_credentials", message: "E-mail ou senha inválidos." }); return; }
    if (account.company_status === "suspended") { res.status(403).json({ error: "company_suspended", message: "Acesso empresarial suspenso." }); return; }
    const token = createSessionToken();
    await pool.query(`INSERT INTO sessions(account_id,company_id,token_hash,expires_at) VALUES($1,$2,$3,NOW()+INTERVAL '7 days')`, [account.account_id, account.company_id, hashSessionToken(token)]);
    setSessionCookie(res, token);
    res.json(publicProfile(account));
  } catch (error) { next(error); }
});

authRouter.post("/logout", async (req, res, next) => {
  try {
    const token = readCookie(req, sessionName);
    if (token) await pool.query("DELETE FROM sessions WHERE token_hash=$1", [hashSessionToken(token)]);
    clearSessionCookie(res);
    res.json({ ok: true });
  } catch (error) { next(error); }
});

authRouter.get("/me", requireAuth, async (req, res, next) => {
  try {
    const auth = (req as AuthRequest).auth!;
    const result = await pool.query<AuthRow>(`
      SELECT a.id AS account_id,a.email,a.full_name,c.id AS company_id,c.cnpj,
             c.legal_name,c.status AS company_status,m.role
      FROM accounts a JOIN memberships m ON m.account_id=a.id
      JOIN companies c ON c.id=m.company_id
      WHERE a.id=$1 AND c.id=$2 LIMIT 1
    `, [auth.accountId, auth.companyId]);
    if (!result.rows[0]) { res.status(401).json({ error: "session_expired" }); return; }
    res.json(publicProfile(result.rows[0]));
  } catch (error) { next(error); }
});
