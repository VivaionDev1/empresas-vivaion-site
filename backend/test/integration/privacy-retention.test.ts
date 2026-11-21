import assert from "node:assert/strict";
import test from "node:test";
import {randomUUID} from "node:crypto";
import {pool} from "../../src/db.ts";
import {anonymizeEligibleRetention,previewRetention} from "../../src/privacy.ts";

test("retention is selective, erases PII including event metadata and retains audit history",async()=>{
  const staffId=randomUUID(),closedId=randomUUID(),openId=randomUUID(),answeredId=randomUUID(),newId=randomUUID();
  try{
    await pool.query("INSERT INTO staff_users(id,email,full_name,role) VALUES($1,$2,'Staff Privacy','manager')",[staffId,randomUUID()+"@example.test"]);
    const items=JSON.stringify([{productId:"pos:test",title:"Treinamento",quantity:1}]);
    await pool.query(
      "INSERT INTO commercial_leads(id,request_key,payload_sha256,contact_name,company_name,contact_email,message,items,privacy_acknowledged_at,status,created_at,assigned_staff_id) "+
      "VALUES($1,$2,$3,'Cliente Identificavel','Empresa Identificavel','private@example.test','Detalhes pessoais',$4::jsonb,NOW(),'closed',NOW()-INTERVAL '4000 days',$5),"+
      "($6,$7,$3,'Cliente Ativo','Empresa Ativa','active@example.test','Atendimento em curso',$4::jsonb,NOW(),'received',NOW()-INTERVAL '4000 days',$5)",
      [closedId,randomUUID(),"a".repeat(64),items,staffId,openId,randomUUID()]);
    await pool.query(
      "INSERT INTO commercial_lead_events(lead_id,event_type,metadata) VALUES($1,'status_updated',$2::jsonb)",
      [closedId,JSON.stringify({reason:"Telefone e outros dados privados do cliente"})]);
    await pool.query(
      "INSERT INTO commercial_notification_outbox(lead_id,recipient_staff_id,kind,dedupe_key) VALUES($1,$2,'assigned',$3)",
      [closedId,staffId,"privacy-test:"+closedId]);
    await pool.query(
      "INSERT INTO contact_requests(id,contact_name,email,company_name,message,status,created_at) "+
      "VALUES($1,'Contato Identificado','private@example.test','Empresa Identificavel','Mensagem sensivel','responded',NOW()-INTERVAL '4000 days'),"+
      "($2,'Contato em Aberto','active@example.test','Empresa Ativa','Mensagem ativa','new',NOW()-INTERVAL '4000 days')",
      [answeredId,newId]);
    const before=await previewRetention(3650);
    assert.ok(before.leads>=1&&before.contacts>=1);
    const applied=await anonymizeEligibleRetention(3650,50);
    assert.ok(applied.leads>=1&&applied.contacts>=1);
    const anonymized=await pool.query<{
      contact_email:string;message:string|null;items:unknown[];payload_sha256:string;anonymized_at:string|null;assigned_staff_id:string|null
    }>("SELECT contact_email,message,items,payload_sha256,anonymized_at,assigned_staff_id FROM commercial_leads WHERE id=$1",[closedId]);
    assert.match(anonymized.rows[0]!.contact_email,/^anon-/);
    assert.equal(anonymized.rows[0]!.message,null);
    assert.deepEqual(anonymized.rows[0]!.items,[]);
    assert.equal(anonymized.rows[0]!.payload_sha256,"0".repeat(64));
    assert.equal(anonymized.rows[0]!.assigned_staff_id,null);
    assert.ok(anonymized.rows[0]!.anonymized_at);
    const events=await pool.query<{event_type:string;metadata:unknown}>("SELECT event_type,metadata FROM commercial_lead_events WHERE lead_id=$1 ORDER BY id",[closedId]);
    assert.deepEqual(events.rows[0]!.metadata,{});
    assert.equal(events.rows.at(-1)!.event_type,"privacy.anonymized");
    const queue=await pool.query<{count:number}>("SELECT COUNT(*)::integer AS count FROM commercial_notification_outbox WHERE lead_id=$1",[closedId]);
    assert.equal(queue.rows[0]!.count,0);
    const open=await pool.query<{anonymized_at:string|null;contact_email:string}>("SELECT anonymized_at,contact_email FROM commercial_leads WHERE id=$1",[openId]);
    assert.equal(open.rows[0]!.anonymized_at,null);
    assert.equal(open.rows[0]!.contact_email,"active@example.test");
    const contacts=await pool.query<{id:string;email:string;anonymized_at:string|null}>("SELECT id,email,anonymized_at FROM contact_requests WHERE id=ANY($1::uuid[]) ORDER BY id",[[answeredId,newId]]);
    assert.ok(contacts.rows.find(x=>x.id===answeredId)?.anonymized_at);
    assert.equal(contacts.rows.find(x=>x.id===newId)?.anonymized_at,null);
  }finally{
    await pool.query("DELETE FROM commercial_leads WHERE id=ANY($1::uuid[])",[[closedId,openId]]);
    await pool.query("DELETE FROM contact_requests WHERE id=ANY($1::uuid[])",[[answeredId,newId]]);
    await pool.query("DELETE FROM staff_users WHERE id=$1",[staffId]);
  }
});
