import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { pool } from "./db.js";
import { config } from "./config.js";
import { requireAuth, requireRoles, type AuthRequest } from "./auth.js";
import { calculateQuote } from "./domain/pricing.js";

export const apiRouter = Router();
const contactLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 5, standardHeaders: "draft-8", legacyHeaders: false });

apiRouter.get("/health", (_req, res) => res.json({ status: "ok", service: "vivaion-empresas" }));
apiRouter.get("/ready", async (_req, res) => {
  try { await pool.query("SELECT 1"); res.json({ status: "ready" }); }
  catch { res.status(503).json({ status: "database_unavailable" }); }
});

apiRouter.get("/catalog", async (_req, res, next) => {
  try {
    const [products, sync] = await Promise.all([
      pool.query<{payload: Record<string, unknown>}>("SELECT payload FROM catalog_products WHERE active=TRUE ORDER BY id"),
      pool.query<{synced_at: string}>("SELECT synced_at FROM catalog_sync_state WHERE id=1")
    ]);
    res.setHeader("Cache-Control", "public, max-age=60");
    res.json({
      schemaVersion: 1,
      source: sync.rows.length ? "institutional" : "pending",
      syncedAt: sync.rows[0]?.synced_at ?? null,
      products: products.rows.map((row) => row.payload)
    });
  } catch (error) { next(error); }
});

const contactSchema = z.object({
  name: z.string().trim().min(3).max(140),
  email: z.string().trim().email().max(254).transform((v) => v.toLowerCase()),
  company: z.string().trim().min(2).max(180),
  message: z.string().trim().min(15).max(3000),
  website: z.string().max(200).optional()
}).strict();

apiRouter.post("/contact", contactLimiter, async (req, res, next) => {
  const input = contactSchema.safeParse(req.body);
  if (!input.success) { res.status(400).json({ error: "invalid_data", message: "Confira os campos do formulário." }); return; }
  if (input.data.website) { res.status(202).json({ accepted: true }); return; }
  try {
    await pool.query("INSERT INTO contact_requests(contact_name,email,company_name,message) VALUES($1,$2,$3,$4)",
      [input.data.name, input.data.email, input.data.company, input.data.message]);
    res.status(202).json({ accepted: true });
  } catch (error) { next(error); }
});

apiRouter.get("/companies/me", requireAuth, async (req, res, next) => {
  try {
    const auth = (req as AuthRequest).auth!;
    const result = await pool.query<{cnpj:string;legal_name:string;status:string;created_at:string}>(
      "SELECT cnpj,legal_name,status,created_at FROM companies WHERE id=$1", [auth.companyId]);
    res.json({ company: result.rows[0] ?? null, role: auth.role });
  } catch (error) { next(error); }
});

apiRouter.get("/companies/me/people", requireAuth, requireRoles("administrator", "manager"), async (req, res, next) => {
  try {
    const auth = (req as AuthRequest).auth!;
    const result = await pool.query<{full_name:string;email:string;role:string}>(
      "SELECT a.full_name,a.email,m.role FROM memberships m JOIN accounts a ON a.id=m.account_id WHERE m.company_id=$1 ORDER BY m.created_at",
      [auth.companyId]);
    res.json({ people: result.rows });
  } catch (error) { next(error); }
});

apiRouter.get("/orders", requireAuth, requireRoles("administrator", "manager", "finance"), async (req, res, next) => {
  try {
    const companyId = (req as AuthRequest).auth!.companyId;
    const result = await pool.query<{id:string;status:string;created_at:string;record_type:string}>(`
      SELECT id,status,created_at,'proposal' AS record_type FROM proposals WHERE company_id=$1
      UNION ALL
      SELECT id,status,created_at,'order' AS record_type FROM orders WHERE company_id=$1
      ORDER BY created_at DESC LIMIT 100
    `, [companyId]);
    res.json({ orders: result.rows });
  } catch (error) { next(error); }
});

apiRouter.get("/seats", requireAuth, async (req, res, next) => {
  try {
    const auth = (req as AuthRequest).auth!;
    const result = await pool.query<{id:string;status:string;order_item_id:string}>(
      "SELECT id,status,order_item_id FROM seats WHERE company_id=$1 AND ($2::text <> 'collaborator' OR assigned_account_id=$3) ORDER BY created_at DESC LIMIT 500",
      [auth.companyId, auth.role, auth.accountId]);
    res.json({ seats: result.rows });
  } catch (error) { next(error); }
});

const requestedItemSchema = z.object({
  productId: z.string().regex(/^(pos|formacao|curso-livre):[a-z0-9-]+$/),
  quantity: z.number().int().min(1).max(1000)
}).strict();
const proposalSchema = z.object({
  items: z.array(requestedItemSchema).min(1).max(30),
  note: z.string().trim().max(2000).optional()
}).strict();
function distinctItems(items: {productId:string;quantity:number}[]): boolean {
  return new Set(items.map((item) => item.productId)).size === items.length;
}

apiRouter.post("/proposals", requireAuth, requireRoles("administrator", "manager", "finance"), async (req, res, next) => {
  const input = proposalSchema.safeParse(req.body);
  if (!input.success || !distinctItems(input.data.items)) {
    res.status(400).json({ error: "invalid_items", message: "Selecione cursos distintos e quantidades válidas." }); return;
  }
  try {
    const auth = (req as AuthRequest).auth!;
    if (auth.companyStatus === "rejected") { res.status(403).json({ error: "company_rejected", message: "Cadastro empresarial recusado. Contate a Vivaion." }); return; }
    const ids = input.data.items.map((item) => item.productId);
    const found = await pool.query<{id:string}>("SELECT id FROM catalog_products WHERE id = ANY($1::text[]) AND active=TRUE", [ids]);
    if (found.rows.length !== ids.length) { res.status(409).json({ error: "catalog_pending", message: "Alguns cursos não estão no catálogo institucional sincronizado." }); return; }
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query<{id:string}>(`
        INSERT INTO proposals(company_id,requested_by,items,note)
        VALUES($1,$2,$3::jsonb,$4) RETURNING id
      `, [auth.companyId, auth.accountId, JSON.stringify(input.data.items), input.data.note ?? null]);
      await client.query("INSERT INTO audit_events(company_id,actor_account_id,event_type,metadata) VALUES($1,$2,'proposal.requested',$3::jsonb)",
        [auth.companyId,auth.accountId,JSON.stringify({ proposalId: result.rows[0]!.id })]);
      await client.query("COMMIT");
      res.status(201).json({ id: result.rows[0]!.id, status: "requested", message: "Solicitação de proposta registrada, sem cobrança." });
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  } catch (error) { next(error); }
});

apiRouter.get("/pricing/status", async (_req, res) => {
  res.json({ enabled: config.corporatePricingEnabled, requiresVerifiedCompany: true, currency: "BRL",
    message: config.corporatePricingEnabled ? "Políticas aprovadas podem ser consultadas após autenticação." : "Precificação corporativa indisponível até aprovação." });
});

apiRouter.post("/pricing/quote", requireAuth, requireRoles("administrator", "manager", "finance"), async (req, res, next) => {
  const input = proposalSchema.safeParse(req.body);
  if (!input.success || !distinctItems(input.data.items)) {
    res.status(400).json({ error: "invalid_items" }); return;
  }
  const auth = (req as AuthRequest).auth!;
  if (auth.companyStatus !== "verified") { res.status(403).json({ error: "company_not_verified", message: "A empresa ainda não foi verificada." }); return; }
  if (!config.corporatePricingEnabled) { res.status(503).json({ error: "pricing_disabled", message: "Condições comerciais ainda não aprovadas." }); return; }
  try {
    const policy = await pool.query<{id:string;base_discount_bps:number}>(
      "SELECT id,base_discount_bps FROM discount_policies WHERE is_active=TRUE ORDER BY created_at DESC LIMIT 1");
    if (!policy.rows[0]) { res.status(503).json({ error: "policy_not_approved" }); return; }
    const ids = input.data.items.map((item) => item.productId);
    const prices = await pool.query<{product_id:string;unit_price_cents:number}>(`
      SELECT p.product_id,p.unit_price_cents FROM product_prices p
      JOIN catalog_products c ON c.id=p.product_id
      WHERE p.product_id=ANY($1::text[]) AND p.approved=TRUE AND p.corporate_eligible=TRUE AND c.active=TRUE
        AND c.payload->>'commercialStage'='available'
        AND (p.valid_from IS NULL OR p.valid_from<=NOW())
        AND (p.valid_until IS NULL OR p.valid_until>NOW())
    `, [ids]);
    if (prices.rows.length !== ids.length) { res.status(409).json({ error: "prices_pending", message: "Nem todos os cursos têm preço corporativo aprovado." }); return; }
    const priceByProduct = new Map(prices.rows.map((p) => [p.product_id, p.unit_price_cents]));
    const tierResult = await pool.query<{minimum_seats:number;discount_bps:number}>(
      "SELECT minimum_seats,discount_bps FROM discount_tiers WHERE policy_id=$1 ORDER BY minimum_seats",
      [policy.rows[0].id]);
    const quote = calculateQuote(input.data.items.map((i) => ({
      productId: i.productId, quantity: i.quantity, unitPriceCents: priceByProduct.get(i.productId)!
    })), policy.rows[0].base_discount_bps, tierResult.rows.map((t) => ({
      minimumSeats: t.minimum_seats, discountBps: t.discount_bps
    })));
    res.json({ ...quote, payable: false, message: "Cotação informativa. Checkout ainda não habilitado." });
  } catch (error) { next(error); }
});

apiRouter.post("/checkout", requireAuth, requireRoles("administrator", "finance"), (_req, res) =>
  res.status(503).json({ error: "integration_disabled", message: "Checkout corporativo indisponível até homologação Eduzz." }));
apiRouter.post("/seats/assign", requireAuth, requireRoles("administrator", "manager"), (_req, res) =>
  res.status(503).json({ error: "integration_disabled", message: "Atribuição de vagas depende da homologação com a Área do Aluno." }));
apiRouter.post("/companies/lookup", requireAuth, (_req, res) =>
  res.status(503).json({ error: "integration_disabled", message: "Verificação cadastral automática ainda indisponível." }));
apiRouter.post("/integrations/eduzz/webhook", (_req, res) =>
  res.status(503).json({ error: "integration_disabled", message: "Webhook empresarial não habilitado." }));
