import assert from "node:assert/strict";
import test from "node:test";
import {randomUUID} from "node:crypto";
import request from "supertest";
import {app} from "../../src/app.ts";
import {pool} from "../../src/db.ts";
import {createSessionToken,hashSessionToken} from "../../src/domain/passwords.ts";

const origin="http://localhost:4321";
test("staff activities and follow-up queue enforce isolation, audit and terminal cleanup",async()=>{
  const managerId=randomUUID(),sellerId=randomUUID(),outsiderId=randomUUID();
  const leadId=randomUUID(),otherLeadId=randomUUID();
  const identities=[managerId,sellerId,outsiderId],leads=[leadId,otherLeadId];
  const cookies:Record<string,string>={};
  try{
    await pool.query(
      "INSERT INTO staff_users(id,email,full_name,role) VALUES "+
      "($1,$4,'Gestora Teste','manager'),($2,$5,'Vendedor Teste','sales'),($3,$6,'Outro Vendedor','sales')",
      [...identities,...identities.map(id=>"staff-"+id+"@example.test")]);
    for(const id of identities){
      const token=createSessionToken();
      await pool.query(
        "INSERT INTO staff_sessions(token_hash,staff_id,expires_at) VALUES($1,$2,NOW()+INTERVAL '1 hour')",
        [hashSessionToken(token),id]);
      cookies[id]="ve_staff="+token;
    }
    await pool.query(
      "INSERT INTO commercial_leads(id,request_key,payload_sha256,contact_name,company_name,contact_email,items,privacy_acknowledged_at,status,assigned_staff_id) "+
      "VALUES ($1,$2,$3,'Pessoa Teste','Empresa Contato','test@example.test','[]'::jsonb,NOW(),'contacted',$4),"+
      "($5,$6,$3,'Outra Pessoa','Empresa Restrita','private@example.test','[]'::jsonb,NOW(),'contacted',$7)",
      [leadId,randomUUID(),"c".repeat(64),sellerId,otherLeadId,randomUUID(),outsiderId]);
    const activity=(id:string,cookie:string,body:unknown)=>request(app)
      .post("/api/staff/leads/"+id+"/activities")
      .set("Origin",origin).set("Cookie",cookie).send(body);

    assert.equal((await request(app).post("/api/staff/leads/"+leadId+"/activities")
      .set("Origin",origin).send({kind:"note",note:"Acesso sem autenticacao"})).status,401);
    assert.equal((await request(app).post("/api/staff/leads/"+leadId+"/activities")
      .set("Origin","https://attacker.invalid").set("Cookie",cookies[managerId]!)
      .send({kind:"note",note:"Tentativa de cross origin"})).status,403);
    assert.equal((await activity(leadId,cookies[outsiderId]!,{kind:"email",note:"Tentativa de acesso cruzado"})).status,404);
    assert.equal((await activity(leadId,cookies[sellerId]!,{kind:"wrong",note:"Formato de atividade invalido"})).status,400);
    assert.equal((await activity(leadId,cookies[sellerId]!,{kind:"note",note:"curto"})).status,400);

    const future=new Date(Date.now()+48*3600_000).toISOString();
    const logged=await activity(leadId,cookies[sellerId]!,{
      kind:"call",note:"Contato comercial registrado com detalhes limitados.",followUpAt:future});
    assert.equal(logged.status,201,JSON.stringify(logged.body));
    assert.ok(logged.body.nextFollowupAt);
    const detail=await request(app).get("/api/staff/leads/"+leadId).set("Cookie",cookies[sellerId]!);
    assert.equal(detail.status,200);
    assert.equal(detail.body.lead.status,"contacted","notes must not fake status transitions");
    assert.ok(detail.body.lead.next_followup_at);
    assert.ok(detail.body.events.some((e:{event_type:string;metadata?:{kind:string;note:string}})=>
      e.event_type==="staff_activity"&&e.metadata?.kind==="call"&&e.metadata.note.includes("Contato comercial")));

    const scheduled=await request(app).get("/api/staff/leads?followup=scheduled").set("Cookie",cookies[sellerId]!);
    assert.equal(scheduled.status,200);
    assert.ok(scheduled.body.leads.some((x:{id:string})=>x.id===leadId));
    assert.ok(!scheduled.body.leads.some((x:{id:string})=>x.id===otherLeadId));
    assert.ok(!JSON.stringify(scheduled.body).includes("Contato comercial registrado"));
    const salesDue=await request(app).get("/api/staff/leads?followup=due").set("Cookie",cookies[sellerId]!);
    assert.equal(salesDue.status,200);
    assert.ok(!salesDue.body.leads.some((x:{id:string})=>x.id===leadId));
    const overview=await request(app).get("/api/staff/overview").set("Cookie",cookies[sellerId]!);
    assert.equal(overview.status,200);
    assert.ok(overview.body.scheduledFollowups>=1);
    assert.equal((await request(app).get("/api/staff/leads?followup=invalid")
      .set("Cookie",cookies[sellerId]!)).status,400);
    const past=new Date(Date.now()-3*86400_000).toISOString();
    assert.equal((await activity(leadId,cookies[sellerId]!,{
      kind:"note",note:"Tentativa com prazo antigo nao permitido.",followUpAt:past})).status,400);
    const tooFar=new Date(Date.now()+400*86400_000).toISOString();
    assert.equal((await activity(leadId,cookies[sellerId]!,{
      kind:"note",note:"Tentativa com prazo excessivo nao permitido.",followUpAt:tooFar})).status,400);

    await pool.query("UPDATE commercial_leads SET next_followup_at=NOW()-INTERVAL '2 hours' WHERE id=$1",[leadId]);
    const due=await request(app).get("/api/staff/leads?followup=due").set("Cookie",cookies[sellerId]!);
    assert.equal(due.status,200);
    assert.ok(due.body.leads.some((x:{id:string})=>x.id===leadId));
    const updated=await request(app).get("/api/staff/overview").set("Cookie",cookies[sellerId]!);
    assert.equal(updated.status,200);
    assert.ok(updated.body.dueFollowups>=1);

    const managerNote=await activity(otherLeadId,cookies[managerId]!,{
      kind:"meeting",note:"Gestor registrou atividade em lead de outro vendedor."});
    assert.equal(managerNote.status,201);
    const clear=await activity(leadId,cookies[sellerId]!,{
      kind:"note",note:"Retorno removido manualmente pelo atendente.",followUpAt:null});
    assert.equal(clear.status,201);
    assert.equal(clear.body.nextFollowupAt,null);
    const noSchedule=await request(app).get("/api/staff/leads?followup=none").set("Cookie",cookies[sellerId]!);
    assert.ok(noSchedule.body.leads.some((x:{id:string})=>x.id===leadId));

    const again=await activity(leadId,cookies[sellerId]!,{
      kind:"email",note:"Confirmar recebimento da proposta por e-mail.",followUpAt:future});
    assert.equal(again.status,201);
    assert.equal((await request(app).patch("/api/staff/leads/"+leadId).set("Origin",origin)
      .set("Cookie",cookies[sellerId]!).send({status:"proposal_sent",reason:"Proposta comercial enviada em teste."})).status,200);
    assert.equal((await request(app).patch("/api/staff/leads/"+leadId).set("Origin",origin)
      .set("Cookie",cookies[sellerId]!).send({status:"won",reason:"Negociacao concluida em teste."})).status,200);
    const final=await request(app).get("/api/staff/leads/"+leadId).set("Cookie",cookies[sellerId]!);
    assert.equal(final.body.lead.next_followup_at,null,"terminal status must clear future action");
    assert.equal((await activity(leadId,cookies[sellerId]!,{
      kind:"call",note:"Nao pode agendar retorno apos encerramento.",followUpAt:future})).status,409);
    assert.equal((await activity(leadId,cookies[sellerId]!,{
      kind:"note",note:"Anotacao de encerramento sem prazo adicional."})).status,201);

    await pool.query("UPDATE staff_users SET active=FALSE WHERE id=$1",[sellerId]);
    assert.equal((await activity(leadId,cookies[sellerId]!,{
      kind:"note",note:"Ex-funcionario nao deve adicionar anotacoes."})).status,401);
  }finally{
    await pool.query("DELETE FROM commercial_leads WHERE id=ANY($1::uuid[])",[leads]);
    await pool.query("DELETE FROM staff_users WHERE id=ANY($1::uuid[])",[identities]);
  }
});
