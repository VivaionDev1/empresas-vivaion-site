import "dotenv/config";
import { pool } from "../src/db.js";
import { config } from "../src/config.js";
import { assertIsolatedDatabaseUrl } from "../src/domain/dbTarget.js";

if (!config.databaseUrl) throw new Error("DATABASE_URL required");
assertIsolatedDatabaseUrl(config.databaseUrl);
try {
  const expired = await pool.query(
    "DELETE FROM account_action_tokens WHERE expires_at < NOW() - INTERVAL '7 days' OR consumed_at < NOW() - INTERVAL '7 days'"
  );
  const sessions = await pool.query("DELETE FROM sessions WHERE expires_at < NOW()");
  console.info("Expired tokens removed:", expired.rowCount, "Expired sessions:", sessions.rowCount);
} finally {
  await pool.end();
}
