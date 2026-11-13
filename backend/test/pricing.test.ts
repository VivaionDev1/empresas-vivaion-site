import assert from "node:assert/strict";
import test from "node:test";
import { calculateQuote } from "../src/domain/pricing.ts";

test("uses the better discount instead of adding base and volume", () => {
  const quote = calculateQuote([{productId:"pos:posfati",quantity:5,unitPriceCents:10000}],1000,[{minimumSeats:5,discountBps:2000}]);
  assert.equal(quote.discountBps,2000);
  assert.equal(quote.totalCents,40000);
  assert.equal(quote.quantity,5);
});
test("applies discounts to total seats across distinct programs", () => {
  const quote = calculateQuote([{productId:"pos:posfati",quantity:2,unitPriceCents:10000},{productId:"formacao:neurociencia-afetiva",quantity:3,unitPriceCents:20000}],500,[{minimumSeats:5,discountBps:1500}]);
  assert.equal(quote.quantity,5);
  assert.equal(quote.totalCents,68000);
});
test("rounds each discounted seat in cents", () => {
  const quote = calculateQuote([{productId:"curso-livre:iddsi-na-pratica",quantity:2,unitPriceCents:1999}],0,[{minimumSeats:2,discountBps:2500}]);
  assert.equal(quote.lines[0]?.discountedUnitCents,1499);
  assert.equal(quote.totalCents,2998);
});
test("rejects negative costs and impossible discounts", () => {
  assert.throws(() => calculateQuote([{productId:"x",quantity:1,unitPriceCents:-1}],0,[]));
  assert.throws(() => calculateQuote([{productId:"x",quantity:1,unitPriceCents:1000}],11000,[]));
});
