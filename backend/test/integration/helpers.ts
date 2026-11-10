import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import request from "supertest";
import { app } from "../../src/app.ts";
import { getTestMail } from "../../src/mail.ts";

export const origin = "http://localhost:4321";

export function makeCnpj(): string {
  const raw = Array.from({length:12}, () => String(randomInt(0,10))).join("");
  const d = (digits: string, weights: number[]) => {
    const r = weights.reduce((sum, weight, idx) => sum + (digits.charCodeAt(idx) - 48) * weight, 0) % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const first = d(raw, [5,4,3,2,9,8,7,6,5,4,3,2]);
  return raw + first + d(raw + first, [6,5,4,3,2,9,8,7,6,5,4,3,2]);
}

export async function register(companyName: string) {
  const email = randomUUID() + "@example.test";
  const response = await request(app).post("/api/auth/register").set("Origin", origin).send({
    companyName, cnpj: makeCnpj(), fullName: "Pessoa Responsavel",
    email, password: "UmaSenhaForte123456!?"
  });
  assert.equal(response.status, 201, JSON.stringify(response.body));
  assert.equal(response.body.status, "pending");
  assert.equal(response.headers["set-cookie"], undefined, "Unverified accounts receive no session cookie");
  const before = await request(app).post("/api/auth/login").set("Origin", origin)
    .send({email, password:"UmaSenhaForte123456!?"});
  assert.equal(before.status,403);
  assert.equal(before.body.error,"email_unverified");
  const mail = getTestMail(email,"verify_email");
  assert.ok(mail?.token, "A test verification message must be generated");
  const confirmed = await request(app).post("/api/auth/verify-email").set("Origin",origin).send({token:mail.token});
  assert.equal(confirmed.status,200,JSON.stringify(confirmed.body));
  const replay = await request(app).post("/api/auth/verify-email").set("Origin",origin).send({token:mail.token});
  assert.equal(replay.status,400);
  const login = await request(app).post("/api/auth/login").set("Origin",origin)
    .send({email, password:"UmaSenhaForte123456!?"});
  assert.equal(login.status,200,JSON.stringify(login.body));
  const cookies = login.headers["set-cookie"];
  assert.ok(Array.isArray(cookies) && cookies.length > 0);
  return { cookie: String(cookies[0]).split(";")[0], email, companyName };
}

