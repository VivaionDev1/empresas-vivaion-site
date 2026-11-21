import assert from "node:assert/strict";
import test from "node:test";
import {randomUUID} from "node:crypto";
import request from "supertest";
import {pool} from "../../src/db.ts";
import {app} from "../../src/app.ts";
import {createSessionToken,hashSessionToken} from "../../src/domain/passwords.ts";

test("staff lead pagination preserves PostgreSQL microseconds with 123 identical timestamps",async()=>{
  const staffId=randomUUID(),token=createSessionToken(),ids:string[]=[];
  try{
    await pool.query("INSERT INTO staff_users(id,email,full_name,role) VALUES($1,$2,'Atendente Paginacao','sales')",[staffId,randomUUID()+"@example.test"]);
    await pool.query("INSERT INTO staff_sessions(token_hash,staff_id,expires_at) VALUES($1,$2,NOW()+INTERVAL '1 hour')",[hashSessionToken(token),staffId]);
    const inserted=await pool.query<{id:string}>(
      "INSERT INTO commercial_leads(request_key,payload_sha256,contact_name,company_name,contact_email,items,privacy_acknowledged_at,status,created_at,assigned_staff_id) "+
       "SELECT gen_random_uuid(),repeat('b',64),'Pessoa Teste','Empresa Teste','lead@example.test','[]'::jsonb,NOW(),'received',"+
      "date_trunc('second',NOW())-INTERVAL '10 minutes'+INTERVAL '123456 microseconds',$1 "+
      "FROM generate_series(1,123) AS n RETURNING id",[staffId]);
    ids.push(...inserted.rows.map(x=>x.id));
    const cookie="ve_staff="+token;
    const pages:Array<Array<{id:string;created_at:string}>>=[];
    let cursor:string|null=null;
    for(let index=0;index<4;index++){
      const url="/api/staff/leads?status=received"+
        (cursor?"&cursor="+encodeURIComponent(cursor):"");
      const response=await request(app).get(url).set("Cookie",cookie);
      assert.equal(response.status,200,JSON.stringify(response.body));
      const rows=response.body.leads as Array<{id:string;created_at:string}>;
      pages.push(rows);
      for(const row of rows)assert.match(row.created_at,/\.123456Z$/);
      cursor=response.body.nextCursor as string|null;
      if(index<2){
        assert.equal(typeof cursor,"string");
        const parsed=JSON.parse(Buffer.from(cursor!,"base64url").toString("utf8"));
        assert.match(parsed.t,/\.123456Z$/,"cursor must retain six fractional digits");
      }
      if(!cursor)break;
    }
    assert.deepEqual(pages.map(page=>page.length),[50,50,23],
      "a 50-row boundary must not drop rows sharing a microsecond timestamp");
    assert.equal(cursor,null,"pagination must terminate");
    const combined=pages.flat();
    assert.equal(combined.length,ids.length);
    const returned=new Set(combined.map(x=>x.id));
    assert.equal(returned.size,combined.length,"no duplicate leads across pages");
    assert.deepEqual([...returned].sort(),[...ids].sort(),"every fixture lead must be reachable");
    for(let i=1;i<combined.length;i++)
      assert.ok(combined[i-1]!.id>combined[i]!.id,"UUID descending tie-breaker must be stable");
    const malformed=await request(app).get("/api/staff/leads?cursor=not-valid").set("Cookie",cookie);
    assert.equal(malformed.status,400);
    const invalidStatus=await request(app).get("/api/staff/leads?status=unknown").set("Cookie",cookie);
    assert.equal(invalidStatus.status,400);
  }finally{
    if(ids.length)await pool.query("DELETE FROM commercial_leads WHERE id=ANY($1::uuid[])",[ids]);
    await pool.query("DELETE FROM staff_users WHERE id=$1",[staffId]);
  }
});
