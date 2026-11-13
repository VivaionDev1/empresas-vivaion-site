import assert from "node:assert/strict";
import { after, test } from "node:test";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { app } from "../../src/app.ts";
import { pool } from "../../src/db.ts";
import { getTestMail } from "../../src/mail.ts";
import { register, origin } from "./helpers.ts";

after(async () => { await pool.end(); });

test("password recovery is generic, single-use and revokes all sessions", async () => {
  const created = await register("Empresa com Redefinicao de Senha");
  const unknown = await request(app).post("/api/auth/forgot-password").set("Origin",origin)
    .send({email:randomUUID()+"@example.test"});
  assert.equal(unknown.status,202);
  const start = await request(app).post("/api/auth/forgot-password").set("Origin",origin)
    .send({email:created.email});
  assert.equal(start.status,202);
  assert.deepEqual(Object.keys(start.body),Object.keys(unknown.body));
  const mail = getTestMail(created.email,"reset_password");
  assert.ok(mail?.token);
  const invalidOrigin = await request(app).post("/api/auth/reset-password").set("Origin","https://evil.invalid")
    .send({token:mail.token,password:"UmaSenhaNova123456!?"});
  assert.equal(invalidOrigin.status,403);
  const reset = await request(app).post("/api/auth/reset-password").set("Origin",origin)
    .send({token:mail.token,password:"UmaSenhaNova123456!?"});
  assert.equal(reset.status,200);
  const again = await request(app).post("/api/auth/reset-password").set("Origin",origin)
    .send({token:mail.token,password:"OutraSenhaNova123456!?"});
  assert.equal(again.status,400);
  const expiredSession = await request(app).get("/api/auth/me").set("Cookie",created.cookie);
  assert.equal(expiredSession.status,401);
  const oldLogin = await request(app).post("/api/auth/login").set("Origin",origin)
    .send({email:created.email,password:"UmaSenhaForte123456!?"});
  assert.equal(oldLogin.status,401);
  const newLogin = await request(app).post("/api/auth/login").set("Origin",origin)
    .send({email:created.email,password:"UmaSenhaNova123456!?"});
  assert.equal(newLogin.status,200);
});
