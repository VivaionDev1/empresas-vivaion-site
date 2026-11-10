import assert from "node:assert/strict";
import { after, test } from "node:test";
import { randomInt, randomUUID } from "node:crypto";
import { pool } from "../../src/db.ts";

after(async () => { await pool.end(); });

function makeCnpj(): string {
  const stem = Array.from({ length: 12 }, () => String(randomInt(0, 10))).join("");
  const firstWeights = [5,4,3,2,9,8,7,6,5,4,3,2];
  const secondWeights = [6,5,4,3,2,9,8,7,6,5,4,3,2];
  const digit = (str: string, weights: number[]) => {
    const remainder = weights.reduce((sum, weight, idx) => sum + (str.charCodeAt(idx) - 48) * weight, 0) % 11;
    return remainder < 2 ? 0 : 11 - remainder;
  };
  const first = digit(stem, firstWeights);
  return stem + first + digit(stem + first, secondWeights);
}

test("composite foreign keys reject cross-tenant order items, seats and assignments", async () => {
  // Run in a transaction so the CI database remains clean.
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const companyA = (await client.query<{ id: string }>(
      "INSERT INTO companies(cnpj,legal_name) VALUES($1,$2) RETURNING id",
      [makeCnpj(), "Empresa de Integridade A"]
    )).rows[0]!.id;
    const companyB = (await client.query<{ id: string }>(
      "INSERT INTO companies(cnpj,legal_name) VALUES($1,$2) RETURNING id",
      [makeCnpj(), "Empresa de Integridade B"]
    )).rows[0]!.id;
    const memberB = (await client.query<{ id: string }>(
      "INSERT INTO accounts(email,full_name,password_hash) VALUES($1,$2,$3) RETURNING id",
      [randomUUID()+"@example.test", "Membro B", "test-only-hash"]
    )).rows[0]!.id;
    await client.query("INSERT INTO memberships(company_id,account_id,role) VALUES($1,$2,'collaborator')", [companyB, memberB]);
    const productId = "curso-livre:test-integrity-" + randomUUID();
    await client.query(
      "INSERT INTO catalog_products(id,payload) VALUES($1,'{}'::jsonb)", [productId]
    );
    const orderA = (await client.query<{ id: string }>(
      "INSERT INTO orders(company_id,status) VALUES($1,'draft') RETURNING id", [companyA]
    )).rows[0]!.id;
    await client.query("SAVEPOINT before_wrong_item");
    await assert.rejects(
      client.query("INSERT INTO order_items(order_id,company_id,product_id,quantity,unit_price_cents) VALUES($1,$2,$3,1,10000)",
        [orderA,companyB,productId]),
      (error: unknown) => (error as { code?: string }).code === "23503"
    );
    await client.query("ROLLBACK TO SAVEPOINT before_wrong_item");
    const itemA = (await client.query<{ id: string }>(
      "INSERT INTO order_items(order_id,company_id,product_id,quantity,unit_price_cents) VALUES($1,$2,$3,1,10000) RETURNING id",
      [orderA,companyA,productId]
    )).rows[0]!.id;
    await client.query("SAVEPOINT before_wrong_seat");
    await assert.rejects(
      client.query("INSERT INTO seats(company_id,order_item_id,status) VALUES($1,$2,'available')", [companyB,itemA]),
      (error: unknown) => (error as { code?: string }).code === "23503"
    );
    await client.query("ROLLBACK TO SAVEPOINT before_wrong_seat");
    await client.query("SAVEPOINT before_wrong_member");
    await assert.rejects(
      client.query("INSERT INTO seats(company_id,order_item_id,assigned_account_id,status) VALUES($1,$2,$3,'assigned')",
        [companyA,itemA,memberB]),
      (error: unknown) => (error as { code?: string }).code === "23503"
    );
    await client.query("ROLLBACK TO SAVEPOINT before_wrong_member");
    await client.query("SAVEPOINT before_missing_member");
    await assert.rejects(
      client.query("INSERT INTO seats(company_id,order_item_id,status) VALUES($1,$2,'enrolled')", [companyA,itemA]),
      (error: unknown) => (error as { code?: string }).code === "23514"
    );
    await client.query("ROLLBACK TO SAVEPOINT before_missing_member");
    const seat = await client.query<{ id: string }>(
      "INSERT INTO seats(company_id,order_item_id,status) VALUES($1,$2,'available') RETURNING id", [companyA,itemA]
    );
    assert.equal(seat.rows.length,1);
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
});
