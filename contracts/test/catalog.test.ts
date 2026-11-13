import assert from "node:assert/strict";
import test from "node:test";
import { catalogFeedSchema } from "../src/index.ts";

const product = {
  id: "pos:posfati", slug: "posfati", kind: "pos",
  title: "Curso demonstrativo", summary: "Apenas para validacao tecnica",
  canonicalUrl: "https://vivaion.com.br/pos-graduacao/posfati/",
  area: "Saude", audienceLabel: "Profissionais", audienceRestrictions: null,
  deliveryMode: "recorded", commercialStage: "available", tags: [], themes: [],
  workload: "480h", imageUrl: null
} as const;

test("accepts official, versioned public catalog", () => {
  assert.equal(catalogFeedSchema.safeParse({ schemaVersion: 1, generatedAt: new Date().toISOString(), products: [product] }).success, true);
});

test("rejects duplicate products and prices in editorial feed", () => {
  assert.equal(catalogFeedSchema.safeParse({ schemaVersion: 1, generatedAt: new Date().toISOString(), products: [product, product] }).success, false);
  assert.equal(catalogFeedSchema.safeParse({ schemaVersion: 1, generatedAt: new Date().toISOString(), products: [{ ...product, price: 199 }] }).success, false);
});

test("rejects foreign canonical domains", () => {
  assert.equal(catalogFeedSchema.safeParse({ schemaVersion: 1, generatedAt: new Date().toISOString(), products: [{ ...product, canonicalUrl: "https://external.invalid/x" }] }).success, false);
});
