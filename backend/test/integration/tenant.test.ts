import assert from "node:assert/strict";
import { after, test } from "node:test";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { app } from "../../src/app.ts";
import { pool } from "../../src/db.ts";
import { makeCnpj, origin, register } from "./helpers.ts";

after(async () => { await pool.end(); });

test("companies cannot see each other's membership, orders or sessions", async () => {
  const a = await register("Empresa A Desenvolvimento");
  const b = await register("Empresa B Desenvolvimento");
  const unauth = await request(app).get("/api/orders");
  assert.equal(unauth.status,401);

  const aProfile = await request(app).get("/api/auth/me").set("Cookie",a.cookie);
  const bProfile = await request(app).get("/api/auth/me").set("Cookie",b.cookie);
  assert.equal(aProfile.status,200);
  assert.equal(bProfile.status,200);
  assert.equal(aProfile.body.company.name,a.companyName);
  assert.equal(bProfile.body.company.name,b.companyName);
  assert.notEqual(aProfile.body.company.id,bProfile.body.company.id);
  assert.equal(aProfile.body.company.status,"pending");

  const aPeople = await request(app).get("/api/companies/me/people").set("Cookie",a.cookie);
  const bPeople = await request(app).get("/api/companies/me/people").set("Cookie",b.cookie);
  assert.deepEqual(aPeople.body.people.map((p: {email:string})=>p.email),[a.email]);
  assert.deepEqual(bPeople.body.people.map((p: {email:string})=>p.email),[b.email]);

  const product = {
    id:"pos:posfati",slug:"posfati",kind:"pos",title:"Produto de integração",
    summary:"Item apenas para testes",canonicalUrl:"https://vivaion.com.br/pos-graduacao/posfati/",
    area:"Fonoaudiologia",audienceLabel:"Profissionais",audienceRestrictions:null,
    deliveryMode:"recorded",commercialStage:"available",tags:[],themes:[],workload:null,imageUrl:null
  };
  await pool.query("INSERT INTO catalog_products(id,payload,active) VALUES($1,$2::jsonb,TRUE) ON CONFLICT(id) DO UPDATE SET payload=EXCLUDED.payload,active=TRUE",
    [product.id,JSON.stringify(product)]);
  const proposal = await request(app).post("/api/proposals").set("Origin",origin).set("Cookie",a.cookie)
    .send({items:[{productId:product.id,quantity:3}],note:"Plano de treinamento"});
  assert.equal(proposal.status,201,JSON.stringify(proposal.body));
  const ordersA = await request(app).get("/api/orders").set("Cookie",a.cookie);
  const ordersB = await request(app).get("/api/orders").set("Cookie",b.cookie);
  assert.equal(ordersA.body.orders.length,1);
  assert.equal(ordersB.body.orders.length,0);

  // Even company members with collaborator role cannot read all orders or members.
  await pool.query("UPDATE memberships SET role='collaborator' WHERE company_id=$1", [bProfile.body.company.id]);
  const bOrdersForbidden = await request(app).get("/api/orders").set("Cookie",b.cookie);
  const bPeopleForbidden = await request(app).get("/api/companies/me/people").set("Cookie",b.cookie);
  assert.equal(bOrdersForbidden.status,403);
  assert.equal(bPeopleForbidden.status,403);
  const bOwnSeats = await request(app).get("/api/seats").set("Cookie",b.cookie);
  assert.equal(bOwnSeats.status,200);

  const wrongOrigin = await request(app).post("/api/proposals").set("Origin","https://evil.example").set("Cookie",a.cookie)
    .send({items:[{productId:product.id,quantity:1}]});
  assert.equal(wrongOrigin.status,403);
  const quotePending = await request(app).post("/api/pricing/quote").set("Origin",origin).set("Cookie",a.cookie)
    .send({items:[{productId:product.id,quantity:3}]});
  assert.equal(quotePending.status,403);
  const checkout = await request(app).post("/api/checkout").set("Origin",origin).set("Cookie",a.cookie).send({});
  assert.equal(checkout.status,503);
  const seatsA = await request(app).get("/api/seats").set("Cookie",a.cookie);
  assert.equal(seatsA.status,200);
  assert.deepEqual(seatsA.body.seats,[]);

  const logout = await request(app).post("/api/auth/logout").set("Origin",origin).set("Cookie",a.cookie);
  assert.equal(logout.status,200);
  const expired = await request(app).get("/api/auth/me").set("Cookie",a.cookie);
  assert.equal(expired.status,401);
});

test("rejects invalid CNPJ and cross-origin registration", async () => {
  const body = {companyName:"Empresa Invalida",cnpj:"00000000000000",fullName:"Responsavel Teste",
    email:randomUUID()+"@example.test",password:"UmaSenhaForte123456!?"};
  const invalid = await request(app).post("/api/auth/register").set("Origin",origin).send(body);
  assert.equal(invalid.status,400);
  assert.equal(invalid.body.error,"invalid_cnpj");
  const forbidden = await request(app).post("/api/auth/register").set("Origin","https://bad.example").send({...body,cnpj:makeCnpj()});
  assert.equal(forbidden.status,403);
});

