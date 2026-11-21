import assert from "node:assert/strict";
import test from "node:test";
import {randomUUID} from "node:crypto";
import request from "supertest";
import {pool} from "../../src/db.ts";
import {app} from "../../src/app.ts";
import {createSessionToken,hashSessionToken} from "../../src/domain/passwords.ts";

const origin="http://localhost:4321";
const makeBody=(requestKey:string)=>({
  requestKey,name:"Pessoa de Contato",email:"ficticio@example.test",company:"Empresa Ficticia",
  message:"Necessidade de capacitacao para equipe com 12 profissionais.",
  website:"",privacyAcknowledged:true
});

test("general contact intake requires privacy acknowledgement, deduplicates and audits",async()=>{
  const key=randomUUID();
  let id:string|undefined;
  try{
    const missing=await request(app).post("/api/contact").set("Origin",origin)
      .send({...makeBody(key),privacyAcknowledged:false});
    assert.equal(missing.status,400);
    const created=await request(app).post("/api/contact").set("Origin",origin).send(makeBody(key));
    assert.equal(created.status,202,JSON.stringify(created.body));
    id=created.body.reference;
    assert.match(id!,/^[0-9a-f-]{36}$/);
    const replay=await request(app).post("/api/contact").set("Origin",origin).send(makeBody(key));
    assert.equal(replay.status,200);
    assert.equal(replay.body.reference,id);
    const conflict=await request(app).post("/api/contact").set("Origin",origin)
      .send({...makeBody(key),message:"Mensagem diferente enviada com protocolo duplicado."});
    assert.equal(conflict.status,409);
    const malicious=await request(app).post("/api/contact").set("Origin",origin)
      .send({...makeBody(randomUUID()),website:"https://spam.invalid"});
    assert.equal(malicious.status,202);
    assert.equal(malicious.body.reference,undefined);
    const stored=await pool.query<{count:number;privacy_acknowledged_at:string|null}>(
      "SELECT COUNT(*)::integer AS count,MAX(privacy_acknowledged_at)::text AS privacy_acknowledged_at "+
      "FROM contact_requests WHERE request_key=$1",[key]);
    assert.equal(stored.rows[0]?.count,1);
    assert.ok(stored.rows[0]?.privacy_acknowledged_at);
    const events=await pool.query<{event_type:string}>(
      "SELECT event_type FROM contact_request_events WHERE contact_id=$1",[id]);
    assert.deepEqual(events.rows.map(e=>e.event_type),["received"]);
  }finally{
    if(id)await pool.query("DELETE FROM contact_requests WHERE id=$1",[id]);
  }
});

test("manager-only contact queue: microsecond pagination, audit, role isolation and terminal states",async()=>{
  const managerId=randomUUID(),sellerId=randomUUID(),ids:string[]=[];
  const cookies:Record<string,string>={};
  try{
    await pool.query(
      "INSERT INTO staff_users(id,email,full_name,role) VALUES($1,$3,'Gestora Contatos','manager'),($2,$4,'Vendedor Contatos','sales')",
      [managerId,sellerId,managerId+"@example.test",sellerId+"@example.test"]);
    for(const id of [managerId,sellerId]){
      const token=createSessionToken();
      await pool.query(
        "INSERT INTO staff_sessions(token_hash,staff_id,expires_at) VALUES($1,$2,NOW()+INTERVAL '1 hour')",
        [hashSessionToken(token),id]);
      cookies[id]="ve_staff="+token;
    }
    const created=await pool.query<{id:string}>(
      "INSERT INTO contact_requests(contact_name,email,company_name,message,status,created_at) "+
      "SELECT 'Teste de Contato','contact@example.test','Empresa de Teste','Conteudo de teste',"+
      "'new',date_trunc('second',NOW())-INTERVAL '15 minutes'+INTERVAL '654321 microseconds' "+
      "FROM generate_series(1,61) RETURNING id");
    ids.push(...created.rows.map(x=>x.id));
    const contactId=ids[0]!;
    assert.equal((await request(app).get("/api/staff/contacts")).status,401);
    assert.equal((await request(app).get("/api/staff/contacts")
      .set("Cookie",cookies[sellerId]!)).status,403);
    assert.equal((await request(app).get("/api/staff/contacts/"+contactId)
      .set("Cookie",cookies[sellerId]!)).status,403);
    assert.equal((await request(app).post("/api/staff/contacts/"+contactId+"/activities")
      .set("Cookie",cookies[sellerId]!).set("Origin",origin)
      .send({kind:"note",note:"Vendedor nao pode ler caixa de entrada."})).status,403);

    const pages:string[][]=[];
    let cursor:string|null=null;
    for(let i=0;i<3;i++){
      const url="/api/staff/contacts?status=new"+(cursor?"&cursor="+encodeURIComponent(cursor):"");
      const res=await request(app).get(url).set("Cookie",cookies[managerId]!);
      assert.equal(res.status,200);
      const entries=res.body.contacts as Array<{id:string;created_at:string}>;
      for(const item of entries)assert.match(item.created_at,/\.654321Z$/);
      pages.push(entries.map(e=>e.id));
      cursor=res.body.nextCursor??null;
      if(cursor){
        const t=JSON.parse(Buffer.from(cursor,"base64url").toString("utf8")).t;
        assert.match(t,/\.654321Z$/);
      }else break;
    }
    assert.deepEqual(pages.map(x=>x.length),[50,11],"all 61 contacts across page boundary");
    assert.deepEqual(pages.flat().sort(),ids.sort(),"cursor must not omit or duplicate contacts");
    assert.equal((await request(app).get("/api/staff/contacts?cursor=invalid")
      .set("Cookie",cookies[managerId]!)).status,400);
    const detail=await request(app).get("/api/staff/contacts/"+contactId).set("Cookie",cookies[managerId]!);
    assert.equal(detail.status,200);
    assert.equal(detail.body.contact.email,"contact@example.test");
    assert.equal(detail.body.contact.status,"new");

    const note=await request(app).post("/api/staff/contacts/"+contactId+"/activities")
      .set("Cookie",cookies[managerId]!).set("Origin",origin)
      .send({kind:"call",note:"Primeira tentativa de contato registrada sem alterar o status."});
    assert.equal(note.status,201);
    const unchanged=await request(app).get("/api/staff/contacts/"+contactId).set("Cookie",cookies[managerId]!);
    assert.equal(unchanged.body.contact.status,"new");
    assert.ok(unchanged.body.events.some((e:{event_type:string})=>e.event_type==="staff_activity"));
    assert.equal((await request(app).patch("/api/staff/contacts/"+contactId)
      .set("Cookie",cookies[managerId]!).set("Origin","https://attacker.invalid")
      .send({status:"responded",reason:"Origem nao autorizada para contato."})).status,403);
    const replied=await request(app).patch("/api/staff/contacts/"+contactId)
      .set("Cookie",cookies[managerId]!).set("Origin",origin)
      .send({status:"responded",reason:"Resposta enviada ao contato por canal institucional."});
    assert.equal(replied.status,200);
    assert.equal((await request(app).patch("/api/staff/contacts/"+contactId)
      .set("Cookie",cookies[managerId]!).set("Origin",origin)
      .send({status:"responded",reason:"Transicao repetida nao pode ser aceita."})).status,409);
    assert.equal((await request(app).patch("/api/staff/contacts/"+contactId)
      .set("Cookie",cookies[sellerId]!).set("Origin",origin)
      .send({status:"archived",reason:"Vendedor nao autorizado para arquivar."})).status,403);
    const archived=await request(app).patch("/api/staff/contacts/"+contactId)
      .set("Cookie",cookies[managerId]!).set("Origin",origin)
      .send({status:"archived",reason:"Atendimento encerrado pela gestao."});
    assert.equal(archived.status,200);
    const final=await request(app).get("/api/staff/contacts/"+contactId).set("Cookie",cookies[managerId]!);
    assert.equal(final.body.contact.status,"archived");
    assert.ok(final.body.events.filter((e:{event_type:string})=>e.event_type==="staff_update").length===2);
    const stats=await request(app).get("/api/staff/contacts/overview").set("Cookie",cookies[managerId]!);
    assert.equal(stats.status,200);
    assert.ok(stats.body.statuses.some((e:{status:string})=>e.status==="archived"));
  }finally{
    if(ids.length)await pool.query("DELETE FROM contact_requests WHERE id=ANY($1::uuid[])",[ids]);
    await pool.query("DELETE FROM staff_users WHERE id=ANY($1::uuid[])",[[managerId,sellerId]]);
  }
});
