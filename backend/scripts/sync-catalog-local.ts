import "dotenv/config";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { catalogFeedSchema } from "@vivaion/empresas-contracts";
import { config } from "../src/config.js";
import { pool } from "../src/db.js";
import { assertIsolatedDatabaseUrl } from "../src/domain/dbTarget.js";

if (!config.databaseUrl) throw new Error("DATABASE_URL is required before syncing catalog");
assertIsolatedDatabaseUrl(config.databaseUrl);
// npm executes workspace scripts from backend/, while the approved artifacts
// are kept at the repository root alongside the frontend.
const officialFile = resolve(process.cwd(), "../data/catalog-v1.json");
const raw = await readFile(officialFile, "utf8");
if (raw.length > 3_000_000) throw new Error("Catalog response too large");
const sourceFeed = JSON.parse(raw) as { products?: Array<Record<string, unknown>> };
// The published institutional feed omits nullable/unknown fields. Normalize
// those omissions to the contract's explicit null/unspecified values.
const normalized = {
  ...(JSON.parse(raw) as Record<string, unknown>),
  products: (sourceFeed.products ?? []).map((product) => ({
    ...product,
    audienceRestrictions: product.audienceRestrictions ?? null,
    workload: product.workload ?? null,
    imageUrl: product.imageUrl ?? null,
    deliveryMode: product.deliveryMode ?? "unspecified",
  })),
};
const feed = catalogFeedSchema.parse(normalized);
if (!feed.products.length) throw new Error("Refusing to sync an empty official catalog");
const ids = feed.products.map((product) => product.id);
const digest = createHash("sha256").update(raw).digest("hex");
const client = await pool.connect();
try {
  await client.query("BEGIN");
  await client.query("SELECT pg_advisory_xact_lock(783245112)");
  for (const product of feed.products) {
    await client.query(`
      INSERT INTO catalog_products(id,payload,active,last_seen_at)
      VALUES($1,$2::jsonb,TRUE,NOW())
      ON CONFLICT(id) DO UPDATE SET payload=EXCLUDED.payload,active=TRUE,last_seen_at=NOW()
    `, [product.id, JSON.stringify(product)]);
  }
  await client.query("UPDATE catalog_products SET active=FALSE WHERE NOT(id=ANY($1::text[]))", [ids]);
  await client.query(`
    INSERT INTO catalog_sync_state(id,etag,content_hash,synced_at)
    VALUES(1,NULL,$1,NOW())
    ON CONFLICT(id) DO UPDATE SET etag=NULL,content_hash=EXCLUDED.content_hash,synced_at=NOW()
  `, [digest]);
  await client.query("COMMIT");
  console.info("Catalog synchronized from the approved local Vivaion feed: " + ids.length + " products");
} catch (error) {
  try { await client.query("ROLLBACK"); } catch { /* no transaction may be active */ }
  throw error;
} finally {
  client.release();
  await pool.end();
}
