import assert from "node:assert/strict";
import { test } from "node:test";
import request from "supertest";
import { app } from "../../src/app.ts";
import { config } from "../../src/config.ts";

test("unapproved commercial pricing is not publicly exposed, even with stored policies",async()=>{
  if (config.corporatePricingEnabled) return; // Used only in pre-approval environments.
  const catalog=await request(app).get("/api/commercial/catalog");
  assert.equal(catalog.status,503);
  assert.equal(catalog.body.error,"pricing_disabled");
  const preview=await request(app).post("/api/pricing/preview")
    .set("Origin",config.appOrigin)
    .send({items:[{productId:"pos:any",quantity:1}]});
  assert.equal(preview.status,503);
  assert.equal(preview.body.error,"pricing_disabled");
});
