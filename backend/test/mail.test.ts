import assert from "node:assert/strict";
import test from "node:test";
import { getTestMail, mailConfigured, sendActionMail } from "../src/mail.ts";

test("test-only mail dispatch keeps one-time tokens off HTTP responses", async () => {
  assert.equal(mailConfigured(), true);
  await sendActionMail("test@example.test", "verify_email", "only-for-unit-test");
  const message = getTestMail("test@example.test", "verify_email");
  assert.equal(message?.token, "only-for-unit-test");
  assert.ok(message?.url.includes("/confirmar-email/?token="));
});
