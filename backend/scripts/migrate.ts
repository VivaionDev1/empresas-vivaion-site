import "dotenv/config";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pool } from "../src/db.js";
import { config } from "../src/config.js";

if (!config.databaseUrl) throw new Error("DATABASE_URL is required for migrations");
const files = (await readdir(resolve(process.cwd(), "migrations"))).filter((f) => /^\d+_.*\.sql$/.test(f)).sort();
const client = await pool.connect();
try {
  await client.query("BEGIN");
  await client.query("SELECT pg_advisory_xact_lock(783245111)");
  await client.query("CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
  const applied = await client.query<{name:string}>("SELECT name FROM schema_migrations");
  const done = new Set(applied.rows.map((r) => r.name));
  for (const filename of files) {
    if (done.has(filename)) continue;
    const sql = await readFile(resolve(process.cwd(), "migrations", filename), "utf8");
    await client.query(sql);
    await client.query("INSERT INTO schema_migrations(name) VALUES($1)", [filename]);
    process.stdout.write("Applied " + filename + "\n");
  }
  await client.query("COMMIT");
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await pool.end();
}
