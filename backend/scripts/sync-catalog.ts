import "dotenv/config";
import { createHash } from "node:crypto";
import { catalogFeedSchema } from "@vivaion/empresas-contracts";
import { config } from "../src/config.js";
import { pool } from "../src/db.js";
import { assertIsolatedDatabaseUrl } from "../src/domain/dbTarget.js";

if (!config.databaseUrl) throw new Error("DATABASE_URL is required before syncing catalog");
assertIsolatedDatabaseUrl(config.databaseUrl);
const feedUrl = new URL(config.catalogFeedUrl);
const trusted = feedUrl.protocol === "https:" && ["vivaion.com.br", "www.vivaion.com.br"].includes(feedUrl.hostname);
const localDev = config.allowLocalCatalog && !config.isProduction && ["localhost","127.0.0.1"].includes(feedUrl.hostname);
if (!trusted && !localDev) throw new Error("CATALOG_FEED_URL must use the official Vivaion HTTPS host");
const client = await pool.connect();
try {
  const previous = await client.query<{etag:string|null}>("SELECT etag FROM catalog_sync_state WHERE id=1");
  const headers = new Headers({ Accept: "application/json", "User-Agent": "VivaionEmpresasCatalogSync/1.0" });
  if (previous.rows[0]?.etag) headers.set("If-None-Match", previous.rows[0].etag);
  const response = await fetch(feedUrl.toString(), { headers, redirect: "error", signal: AbortSignal.timeout(10_000) });
  if (response.status === 304) { console.info("Catalog not modified"); process.exitCode = 0; }
  else {
    if (!response.ok) throw new Error("Catalog endpoint HTTP " + response.status);
    const raw = await response.text();
    if (raw.length > 3_000_000) throw new Error("Catalog response too large");
    const parsed = catalogFeedSchema.parse(JSON.parse(raw));
    if (parsed.products.length === 0) {
      const existing = await client.query<{count:number}>("SELECT COUNT(*)::integer AS count FROM catalog_products WHERE active=TRUE");
      if ((existing.rows[0]?.count ?? 0) > 0) throw new Error("Refusing to deactivate the entire catalog from an empty feed");
    }
    const ids = parsed.products.map((p) => p.id);
    const digest = createHash("sha256").update(raw).digest("hex");
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(783245112)");
    for (const product of parsed.products) {
      await client.query(`
        INSERT INTO catalog_products(id,payload,active,last_seen_at)
        VALUES($1,$2::jsonb,TRUE,NOW())
        ON CONFLICT(id) DO UPDATE SET payload=EXCLUDED.payload,active=TRUE,last_seen_at=NOW()
      `, [product.id, JSON.stringify(product)]);
    }
    await client.query("UPDATE catalog_products SET active=FALSE WHERE NOT(id=ANY($1::text[]))", [ids]);
    await client.query(`
      INSERT INTO catalog_sync_state(id,etag,content_hash,synced_at)
      VALUES(1,$1,$2,NOW())
      ON CONFLICT(id) DO UPDATE SET etag=EXCLUDED.etag,content_hash=EXCLUDED.content_hash,synced_at=NOW()
    `, [response.headers.get("etag"), digest]);
    await client.query("COMMIT");
    console.info("Catalog synchronized: " + ids.length + " public products");
  }
} catch (error) {
  try { await client.query("ROLLBACK"); } catch { /* no transaction may be active */ }
  throw error;
} finally {
  client.release();
  await pool.end();
}
