import assert from "node:assert/strict";
import { after, test } from "node:test";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { app } from "../../src/app.ts";
import { pool } from "../../src/db.ts";
import { hashSessionToken } from "../../src/domain/passwords.ts";
import { getTestMail } from "../../src/mail.ts";
import { makeCnpj, origin } from "./helpers.ts";

after(async () => { await pool.end(); });

async function unverifiedRegistration() {
  const email = randomUUID() + "@example.test";
  const result = await request(app).post("/api/auth/register").set("Origin",origin).send({
    companyName:"Empresa aguardando confirmacao",cnpj:makeCnpj(),
    fullName:"Representante Pendente",email,password:"SenhaForteDeTeste123!?"
  });
  assert.equal(result.status,201,JSON.stringify(result.body));
  const first = getTestMail(email,"verify_email");
  assert.ok(first?.token);
  return { email, token:first.token };
}

test("resending confirmation invalidates the previous token without exposing account state", async () => {
  const account = await unverifiedRegistration();
  const oldHash = hashSessionToken(account.token);
  await pool.query(
    "UPDATE account_action_tokens SET created_at=NOW()-INTERVAL '2 minutes' WHERE token_hash=$1",
    [oldHash]
  );
  const resend = await request(app).post("/api/auth/request-verification").set("Origin",origin).send({email:account.email});
  assert.equal(resend.status,202);
  const latest = getTestMail(account.email,"verify_email");
  assert.ok(latest?.token);
  assert.notEqual(latest.token,account.token);
  assert.equal((await request(app).post("/api/auth/verify-email").set("Origin",origin)
    .send({token:account.token})).status,400);
  assert.equal((await request(app).post("/api/auth/verify-email").set("Origin",origin)
    .send({token:latest.token})).status,200);
  const verifiedAgain = await request(app).post("/api/auth/request-verification").set("Origin",origin)
    .send({email:account.email});
  const nonExistent = await request(app).post("/api/auth/request-verification").set("Origin",origin)
    .send({email:randomUUID()+"@example.test"});
  assert.equal(verifiedAgain.status,202);
  assert.equal(nonExistent.status,202);
  assert.deepEqual(verifiedAgain.body,nonExistent.body);
});

test("expired confirmation is rejected and does not authenticate the applicant", async () => {
  const account = await unverifiedRegistration();
  await pool.query("UPDATE account_action_tokens SET expires_at=NOW()-INTERVAL '1 second' WHERE token_hash=$1",
    [hashSessionToken(account.token)]);
  const reply = await request(app).post("/api/auth/verify-email").set("Origin",origin).send({token:account.token});
  assert.equal(reply.status,400);
  const login = await request(app).post("/api/auth/login").set("Origin",origin)
    .send({email:account.email,password:"SenhaForteDeTeste123!?"});
  assert.equal(login.status,403);
  assert.equal(login.headers["set-cookie"],undefined);
});
