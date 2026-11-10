import "dotenv/config";
import { z } from "zod";
import { pool } from "../src/db.js";
import { config } from "../src/config.js";
import { assertIsolatedDatabaseUrl } from "../src/domain/dbTarget.js";

/**
 * Offline administrative operation only: no public HTTP endpoint exists for verifying companies.
 * Reviewer MUST inspect official registration and representative authorization evidence separately.
 */
const args = new Map<string,string>();
for (let index = 2; index < process.argv.length; index += 2) {
  const key = process.argv[index];
  const value = process.argv[index + 1];
  if (!key?.startsWith("--") || !value || value.startsWith("--")) throw new Error("Expected --key value pairs");
  if (args.has(key)) throw new Error("Duplicate argument: " + key);
  args.set(key, value);
}
const inputSchema = z.object({
  companyId: z.string().uuid(),
  status: z.enum(["verified", "rejected", "suspended"]),
  operator: z.string().trim().min(4).max(120),
  evidenceRef: z.string().trim().min(8).max(200),
  reason: z.string().trim().min(12).max(500)
});
const input = inputSchema.parse({
  companyId: args.get("--company-id"),
  status: args.get("--status"),
  operator: args.get("--operator"),
  evidenceRef: args.get("--evidence-ref"),
  reason: args.get("--reason")
});
if (process.env.COMPANY_REVIEW_ENABLED !== "true") {
  throw new Error("Manual company reviews are disabled. COMPANY_REVIEW_ENABLED=true is required.");
}
if (!config.databaseUrl) throw new Error("DATABASE_URL required");
assertIsolatedDatabaseUrl(config.databaseUrl);

const client = await pool.connect();
try {
  await client.query("BEGIN");
  const company = await client.query<{id:string;status:string}>(
    "SELECT id,status FROM companies WHERE id=$1 FOR UPDATE", [input.companyId]
  );
  if (!company.rows[0]) throw new Error("Company not found");
  if (input.status === "verified") {
    const admin = await client.query<{exists:boolean}>(`
      SELECT EXISTS(
        SELECT 1 FROM memberships m JOIN accounts a ON a.id=m.account_id
        WHERE m.company_id=$1 AND m.role='administrator' AND a.is_active=TRUE
          AND a.email_verified_at IS NOT NULL
      ) AS exists
    `, [input.companyId]);
    if (!admin.rows[0]?.exists) throw new Error("Cannot verify company without a verified administrator email");
  }
  await client.query("UPDATE companies SET status=$1,verified_at=CASE WHEN $1='verified' THEN NOW() ELSE NULL END WHERE id=$2",
    [input.status,input.companyId]);
  await client.query("INSERT INTO audit_events(company_id,event_type,metadata) VALUES($1,$2,$3::jsonb)", [
    input.companyId,
    "company.reviewed",
    JSON.stringify({
      previousStatus:company.rows[0].status,
      newStatus:input.status,
      operator:input.operator,
      evidenceReference:input.evidenceRef,
      reason:input.reason
    })
  ]);
  await client.query("COMMIT");
  console.info("Company reviewed:", input.companyId, "->", input.status);
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await pool.end();
}
