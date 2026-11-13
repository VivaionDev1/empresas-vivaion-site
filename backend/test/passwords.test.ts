import assert from "node:assert/strict";
import test from "node:test";
import { hashPassword, verifyPassword, createSessionToken, hashSessionToken } from "../src/domain/passwords.ts";

test("hashes, salts and verifies passwords", async () => {
  const a = await hashPassword("uma senha longa de teste 1234");
  const b = await hashPassword("uma senha longa de teste 1234");
  assert.notEqual(a,b);
  assert.equal(await verifyPassword("uma senha longa de teste 1234",a),true);
  assert.equal(await verifyPassword("senha errada",a),false);
});
test("session tokens are random and only hashes should be persisted", () => {
  const token1 = createSessionToken(); const token2 = createSessionToken();
  assert.notEqual(token1,token2);
  assert.equal(hashSessionToken(token1).length,64);
  assert.notEqual(hashSessionToken(token1),token1);
});
