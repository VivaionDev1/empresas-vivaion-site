import assert from "node:assert/strict";
import { after, test } from "node:test";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { app } from "../../src/app.ts";
import { pool } from "../../src/db.ts";

after(async () => { await pool.end(); });
const origin="http://localhost:4321";

test("public commercial interest is stored without company login and replay is idempotent", async () => {
  const id="curso-livre:public-proposal-fixture";
  const product={id,slug:"public-proposal-fixture",kind:"curso-livre",title:"Curso de teste A",
    summary:"Apenas para homologação",area:"Educação",commercialStage:"available",
    canonicalUrl:"https://vivaion.com.br/cursos-livres/iddsi-na-pratica/",audienceLabel:"Profissionais",
    audienceRestrictions:null,deliveryMode:"online",tags:[],themes:[],workload:null,imageUrl:null};
  await pool.query("INSERT INTO catalog_products(id,payload,active) VALUES($1,$2::jsonb,TRUE) ON CONFLICT(id) DO UPDATE SET payload=EXCLUDED.payload,active=TRUE",[id,JSON.stringify(product)]);
  const body={requestKey:randomUUID(),contactName:"Pessoa de Teste",companyName:"Organizacao Teste",
    email:"lead-"+randomUUID()+"@example.test",message:"Quero capacitar uma equipe.",privacyAcknowledged:true,
    items:[{productId:id,quantity:2}]};
  const first=await request(app).post("/api/public-proposals").set("Origin",origin).send(body);
  assert.equal(first.status,201,JSON.stringify(first.body));
  assert.equal(first.body.status,"received");
  assert.match(first.body.reference,/^[0-9a-f-]{36}$/);
  const second=await request(app).post("/api/public-proposals").set("Origin",origin).send(body);
  assert.equal(second.status,200);
  assert.equal(second.body.reference,first.body.reference);
  const count=await pool.query("SELECT COUNT(*)::int AS count FROM commercial_leads WHERE request_key=$1",[body.requestKey]);
  assert.equal(count.rows[0].count,1);
  const saved=await pool.query("SELECT items FROM commercial_leads WHERE id=$1",[first.body.reference]);
  assert.equal(saved.rows[0].items[0].title,"Curso de teste A");
  assert.equal(saved.rows[0].items[0].quantity,2);
  const misuse=await request(app).post("/api/public-proposals").set("Origin",origin)
    .send({...body,message:"Different values under the same key"});
  assert.equal(misuse.status,409);
  await pool.query("DELETE FROM commercial_leads WHERE id=$1",[first.body.reference]);
  await pool.query("DELETE FROM catalog_products WHERE id=$1",[id]);
});

test("public proposal rejects cross-origin, invalid quantities and unknown products", async () => {
  const body={requestKey:randomUUID(),contactName:"Pessoa de Teste",companyName:"Empresa Teste",
    email:"lead-"+randomUUID()+"@example.test",privacyAcknowledged:true,
    items:[{productId:"pos:nao-existe-no-catalogo",quantity:1}]};
  const badOrigin=await request(app).post("/api/public-proposals").set("Origin","https://wrong.example").send(body);
  assert.equal(badOrigin.status,403);
  const invalid=await request(app).post("/api/public-proposals").set("Origin",origin)
    .send({...body,items:[{productId:body.items[0].productId,quantity:51}]});
  assert.equal(invalid.status,400);
  const unknown=await request(app).post("/api/public-proposals").set("Origin",origin).send(body);
  assert.equal(unknown.status,409);
});
