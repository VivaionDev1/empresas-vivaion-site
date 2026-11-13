import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

test("official price sync does not self-authorize commercial policy or new price rows", () => {
  const source=readFileSync(resolve(import.meta.dirname, "../scripts/sync-prices-local.ts"),"utf8");
  assert.match(source,/VALUES\(\$1,\$2,'BRL',FALSE,NULL,NOW\(\),\$3,FALSE/);
  assert.match(source,/approved=CASE WHEN product_prices\.unit_price_cents/);
  assert.doesNotMatch(source,/base_discount_bps=1000|VALUES\('Vivaion Empresas volume 2026'/);
});
