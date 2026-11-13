import assert from "node:assert/strict";
import test from "node:test";
import { assertIsolatedDatabaseUrl } from "../src/domain/dbTarget.ts";

test("allows only isolated Vivaion Empresas databases", () => {
  assert.doesNotThrow(() => assertIsolatedDatabaseUrl("postgresql://user:password@127.0.0.1:5432/vivaion_empresas"));
  assert.doesNotThrow(() => assertIsolatedDatabaseUrl("postgresql://user:password@127.0.0.1:5432/vivaion_empresas_dev"));
  assert.doesNotThrow(() => assertIsolatedDatabaseUrl("postgresql://user:password@127.0.0.1:5432/vivaion_empresas_test"));
});
test("refuses legacy production database names", () => {
  assert.throws(() => assertIsolatedDatabaseUrl("postgresql://x:y@localhost/unyomdb"));
  assert.throws(() => assertIsolatedDatabaseUrl("postgresql://x:y@localhost/vivaion"));
  assert.throws(() => assertIsolatedDatabaseUrl("postgresql://x:y@localhost/postgres"));
  assert.throws(() => assertIsolatedDatabaseUrl("https://example.org/vivaion_empresas"));
});
