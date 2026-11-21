import assert from "node:assert/strict";
import test from "node:test";
import {randomUUID} from "node:crypto";
import request from "supertest";
import {pool} from "../../src/db.ts";
import {app} from "../../src/app.ts";
import {createSessionToken,hashSessionToken} from "../../src/domain/passwords.ts";

test("manager lead list supports stable cursor pagination and rejects malformed cursors",async()=>{
  const managerId=randomUUID(),token=createSessionToken(),ids:string[]=[];
  try{
    await pool.query("INSERT INTO staff_users(id,email,full_name,role) VALUES($1,$2,'Gestor Paginacao','manager')",[managerId,randomUUID()+"@example.test"]);
    await pool.query("INSERT INTO staff_sessions(token_hash,staff_id,expires_at) VALUES($1,$2,NOW()+INTERVAL '1 hour')",[hashSessionToken(token),managerId]);
    const inserted=await pool.query<{id:string}>(
      "INSERT INTO commercial_leads(request_key,payload_sha256,contact_name,company_name,contact_email,items,privacy_acknowledged_at,status,created_at) "+
      "SELECT gen_random_uuid(),repeat('b',64),'Pessoa Teste','Empresa Teste','lead@example.test','[]'::jsonb,NOW(),'received',NOW()-INTERVAL '10 minutes'+(n*INTERVAL '1 second') "+
      "FROM generate_series(1,54) AS n RETURNING id");
    ids.push(...inserted.rows.map(x=>x.id));
    const cookie="ve_staff="+token;
    const first=await request(app).get("/api/staff/leads?status=received").set("Cookie",cookie);
    assert.equal(first.status,200,JSON.stringify(first.body));
    assert.equal(first.body.leads.length,50);
    assert.equal(typeof first.body.nextCursor,"string");
    const second=await request(app).get("/api/staff/leads?status=received&cursor="+encodeURIComponent(first.body.nextCursor)).set("Cookie",cookie);
    assert.equal(second.status,200,JSON.stringify(second.body));
    const combined=[...first.body.leads,...second.body.leads] as Array<{id:string;created_at:string}>;
    const returned=new Set(combined.map(x=>x.id));
    assert.equal(returned.size,combined.length,"page boundary must not repeat leads");
    for(const id of ids)assert.ok(returned.has(id),"all fixture leads are reachable");
    for(let i=1;i<combined.length;i++)
      assert.ok(new Date(combined[i-1]!.created_at).getTime()>=new Date(combined[i]!.created_at).getTime());
    const malformed=await request(app).get("/api/staff/leads?cursor=not-valid").set("Cookie",cookie);
    assert.equal(malformed.status,400);
    const invalidStatus=await request(app).get("/api/staff/leads?status=unknown").set("Cookie",cookie);
    assert.equal(invalidStatus.status,400);
  }finally{
    if(ids.length)await pool.query("DELETE FROM commercial_leads WHERE id=ANY($1::uuid[])",[ids]);
    await pool.query("DELETE FROM staff_users WHERE id=$1",[managerId]);
  }
});
