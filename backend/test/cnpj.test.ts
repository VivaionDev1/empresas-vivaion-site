import assert from "node:assert/strict";
import test from "node:test";
import { isValidCnpj, normalizeCnpj } from "../src/domain/cnpj.ts";

test("normalizes numeric and alphanumeric CNPJ", () => {
  assert.equal(normalizeCnpj("11.222.333/0001-81"), "11222333000181");
  assert.equal(normalizeCnpj("ab.cd1.234/0001-00"), "ABCD1234000100");
});
test("validates numeric check digits", () => {
  assert.equal(isValidCnpj("11.222.333/0001-81"), true);
  assert.equal(isValidCnpj("11.222.333/0001-82"), false);
  assert.equal(isValidCnpj("00.000.000/0000-00"), false);
});
test("validates calculated alphanumeric digits", () => {
  const raw = "ABCD12340001";
  const weights1 = [5,4,3,2,9,8,7,6,5,4,3,2];
  const weights2 = [6,5,4,3,2,9,8,7,6,5,4,3,2];
  const calc = (s: string,w: number[]) => { const r = w.reduce((v,x,i)=>v+(s.charCodeAt(i)-48)*x,0)%11;return r<2?0:11-r; };
  const first = calc(raw,weights1);
  const second = calc(raw+first,weights2);
  assert.equal(isValidCnpj(raw+first+second), true);
  assert.equal(isValidCnpj(raw+first+((second+1)%10)), false);
});
