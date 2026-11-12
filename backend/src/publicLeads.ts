import { createHash } from "node:crypto";
import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { pool } from "./db.js";

export const publicLeadsRouter = Router();
const limiter = rateLimit({
  windowMs: 15 * 60_000, limit: 5, standardHeaders: "draft-8", legacyHeaders: false,
  skip: () => process.env.NODE_ENV === "test"
});
const itemSchema = z.object({
  productId: z.string().regex(/^(pos|formacao|curso-livre):[a-z0-9-]+$/),
  quantity: z.number().int().min(1).max(50)
}).strict();
const proposalSchema = z.object({
  requestKey: z.string().uuid(),
  contactName: z.string().trim().min(3).max(140),
  companyName: z.string().trim().min(2).max(180),
  email: z.string().trim().email().max(254).transform(v => v.toLowerCase()),
  phone: z.string().trim().min(8).max(30).optional(),
  message: z.string().trim().max(2000).optional(),
  items: z.array(itemSchema).min(1).max(30),
  privacyAcknowledged: z.literal(true),
  website: z.string().max(200).optional()
}).strict().refine(value =>
  new Set(value.items.map(item => item.productId)).size === value.items.length
  && value.items.reduce((sum,item)=>sum+item.quantity,0)<=50,
  {message:"invalid_items"}
);

publicLeadsRouter.post("/public-proposals", limiter, async (req, res, next) => {
  const parsed = proposalSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({error:"invalid_data",message:"Revise os campos e quantidades da solicitação."});
    return;
  }
  const input = parsed.data;
  // Honeypot intentionally mimics acceptance without persisting spam.
  if (input.website) { res.status(202).json({accepted:true}); return; }

  const ids = input.items.map(item => item.productId);
  const fingerprint = createHash("sha256").update(JSON.stringify({
    contactName:input.contactName, companyName:input.companyName, email:input.email,
    phone:input.phone??null, message:input.message??null, items:input.items
  })).digest("hex");

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const found = await client.query<{id:string;title:string}>(`
      SELECT id, payload->>'title' AS title FROM catalog_products
      WHERE id=ANY($1::text[]) AND active=TRUE
    `,[ids]);
    if (found.rows.length !== ids.length) {
      await client.query("ROLLBACK");
      res.status(409).json({error:"catalog_updated",message:"Algumas formações não estão mais disponíveis no catálogo."});
      return;
    }
    const titles = new Map(found.rows.map(x=>[x.id,x.title]));
    const snapshot = input.items.map(item=>({
      productId:item.productId, title:titles.get(item.productId), quantity:item.quantity
    }));
    const inserted=await client.query<{id:string}>(`
      INSERT INTO commercial_leads
        (request_key,payload_sha256,contact_name,company_name,contact_email,contact_phone,
         message,items,privacy_acknowledged_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,NOW())
      ON CONFLICT (request_key) DO NOTHING
      RETURNING id
    `,[input.requestKey,fingerprint,input.contactName,input.companyName,input.email,
      input.phone??null,input.message??null,JSON.stringify(snapshot)]);
    let reference=inserted.rows[0]?.id;
    if(reference){
      await client.query("INSERT INTO commercial_lead_events(lead_id,event_type) VALUES($1,'received')",[reference]);
    }else{
      const existing=await client.query<{id:string;payload_sha256:string}>(
        "SELECT id,payload_sha256 FROM commercial_leads WHERE request_key=$1",[input.requestKey]);
      if(existing.rows[0]?.payload_sha256!==fingerprint){
        await client.query("ROLLBACK");
        res.status(409).json({error:"request_key_conflict",message:"Esta solicitação já foi utilizada com outros dados. Recarregue o formulário."});
        return;
      }
      reference=existing.rows[0]?.id;
    }
    await client.query("COMMIT");
    res.status(inserted.rows.length?201:200).json({
      accepted:true,reference,status:"received",
      message:"Solicitação registrada. Nossa equipe analisará a disponibilidade e as condições comerciais."
    });
  } catch(error) {
    try { await client.query("ROLLBACK"); } catch { /* connection may be closed */ }
    next(error);
  } finally { client.release(); }
});
