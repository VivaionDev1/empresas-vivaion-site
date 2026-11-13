import "dotenv/config";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { config } from "../src/config.js";
import { pool } from "../src/db.js";
import { assertIsolatedDatabaseUrl } from "../src/domain/dbTarget.js";

if (!config.databaseUrl) throw new Error("DATABASE_URL is required before syncing prices");
assertIsolatedDatabaseUrl(config.databaseUrl);
const file = resolve(process.cwd(), "../data/prices-v1.json");
const snapshot = JSON.parse(await readFile(file, "utf8")) as {
  schemaVersion: number; sourceCheckedAt: string;
  prices: Array<{productId:string;unitPriceCents:number;priceLabel:string;sourceUrl:string;validUntil:string}>;
};
if (snapshot.schemaVersion !== 1 || !Number.isFinite(Date.parse(snapshot.sourceCheckedAt)) || !snapshot.prices.length) throw new Error("Invalid price snapshot");
const ids = new Set<string>();
for (const price of snapshot.prices) {
  if (ids.has(price.productId) || !/^(pos|formacao|curso-livre):[a-z0-9-]+$/.test(price.productId) ||
      !Number.isSafeInteger(price.unitPriceCents) || price.unitPriceCents <= 0 ||
      new URL(price.sourceUrl).origin !== "https://vivaion.com.br" || !Number.isFinite(Date.parse(price.validUntil))) throw new Error("Invalid price row: " + price.productId);
  ids.add(price.productId);
}
const client = await pool.connect();
try {
  await client.query("BEGIN");
  await client.query("SELECT pg_advisory_xact_lock(783245113)");
  const catalog = await client.query<{id:string}>("SELECT id FROM catalog_products WHERE active=TRUE AND payload->>'commercialStage'='available' AND id=ANY($1::text[])",[[...ids]]);
  if (catalog.rows.length !== ids.size) throw new Error("Price snapshot contains products not present in the available catalog");
  await client.query(`UPDATE product_prices SET approved=FALSE,corporate_eligible=FALSE WHERE NOT(product_id=ANY($1::text[]))`,[[...ids]]);
  for (const price of snapshot.prices) await client.query(`
    INSERT INTO product_prices(product_id,unit_price_cents,currency,approved,approved_at,valid_from,valid_until,corporate_eligible,source_url,source_checked_at,price_label)
    VALUES($1,$2,'BRL',TRUE,NOW(),NOW(),$3,TRUE,$4,$5,$6)
    ON CONFLICT(product_id) DO UPDATE SET unit_price_cents=EXCLUDED.unit_price_cents,currency='BRL',approved=TRUE,
      approved_at=NOW(),valid_from=NOW(),valid_until=EXCLUDED.valid_until,corporate_eligible=TRUE,
      source_url=EXCLUDED.source_url,source_checked_at=EXCLUDED.source_checked_at,price_label=EXCLUDED.price_label
  `,[price.productId,price.unitPriceCents,price.validUntil,price.sourceUrl,snapshot.sourceCheckedAt,price.priceLabel]);
  const existingPolicy = await client.query<{id:string}>("SELECT id FROM discount_policies WHERE name='Vivaion Empresas volume 2026' ORDER BY created_at DESC LIMIT 1");
  const policy = existingPolicy.rows[0]
    ? await client.query<{id:string}>("UPDATE discount_policies SET base_discount_bps=1000,is_active=TRUE WHERE id=$1 RETURNING id",[existingPolicy.rows[0].id])
    : await client.query<{id:string}>("INSERT INTO discount_policies(name,base_discount_bps,is_active) VALUES('Vivaion Empresas volume 2026',1000,TRUE) RETURNING id");
  await client.query("UPDATE discount_policies SET is_active=FALSE WHERE id<>$1",[policy.rows[0]!.id]);
  await client.query("DELETE FROM discount_tiers WHERE policy_id=$1",[policy.rows[0]!.id]);
  for (const [minimum,bps] of [[2,1500],[5,2000],[10,3000],[30,4000]] as const)
    await client.query("INSERT INTO discount_tiers(policy_id,minimum_seats,discount_bps) VALUES($1,$2,$3)",[policy.rows[0]!.id,minimum,bps]);
  await client.query("COMMIT");
  console.info(`Synchronized ${snapshot.prices.length} approved official price rows and volume tiers.`);
} catch (error) {
  try { await client.query("ROLLBACK"); } catch { /* no transaction may be active */ }
  throw error;
} finally { client.release(); await pool.end(); }
