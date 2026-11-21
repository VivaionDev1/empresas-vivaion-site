import assert from "node:assert/strict";
import test from "node:test";
import {randomUUID} from "node:crypto";
import request from "supertest";
import {app} from "../../src/app.ts";
import {pool} from "../../src/db.ts";
import {deliverPendingNotifications,enqueueIndicativeOverdueNotifications} from "../../src/notifications.ts";
import {failNextTestOperationalMail,getTestOperationalMail} from "../../src/mail.ts";

const origin="http://localhost:4321";
test("outbox: idempotent lead, failed relay retry, parallel dispatch and overdue reminder",async()=>{
  const managerId=randomUUID(), leadKey=randomUUID(), email="notices-"+randomUUID()+"@example.test";
  const course="curso-livre:notification-test-"+randomUUID().slice(0,8);
  let leadId:string|undefined;
  try{
    await pool.query("INSERT INTO staff_users(id,email,full_name,role) VALUES($1,$2,'Gestor Homologacao','manager')",[managerId,email]);
    await pool.query("INSERT INTO catalog_products(id,payload,active) VALUES($1,$2::jsonb,TRUE)",[course,JSON.stringify({id:course,title:"Produto homologacao"})]);
    const body={requestKey:leadKey,contactName:"Lead Ficticio",companyName:"Empresa Ficticia",email:"ficticio@example.test",
      privacyAcknowledged:true,items:[{productId:course,quantity:1}]};
    const first=await request(app).post("/api/public-proposals").set("Origin",origin).send(body);
    assert.equal(first.status,201,JSON.stringify(first.body));
    leadId=first.body.reference;
    const replay=await request(app).post("/api/public-proposals").set("Origin",origin).send(body);
    assert.equal(replay.status,200);
    const count=await pool.query<{total:number}>("SELECT COUNT(*)::integer AS total FROM commercial_notification_outbox WHERE lead_id=$1 AND recipient_staff_id=$2 AND kind='received'",[leadId,managerId]);
    assert.equal(count.rows[0]?.total,1,"replay cannot enqueue another notification");

    failNextTestOperationalMail(email);
    const dispatch=await deliverPendingNotifications(30);
    assert.ok(dispatch.failed>=1);
    const failed=await pool.query<{state:string;attempts:number}>("SELECT state,attempts FROM commercial_notification_outbox WHERE lead_id=$1 AND recipient_staff_id=$2 AND kind='received'",[leadId,managerId]);
    assert.equal(failed.rows[0]?.state,"pending");
    assert.equal(failed.rows[0]?.attempts,1);
    await pool.query("UPDATE commercial_notification_outbox SET next_attempt_at=NOW()-INTERVAL '1 second' WHERE lead_id=$1 AND recipient_staff_id=$2",[leadId,managerId]);
    await Promise.all([deliverPendingNotifications(30),deliverPendingNotifications(30)]);
    const received=await pool.query<{state:string;attempts:number}>("SELECT state,attempts FROM commercial_notification_outbox WHERE lead_id=$1 AND recipient_staff_id=$2 AND kind='received'",[leadId,managerId]);
    assert.equal(received.rows[0]?.state,"sent");
    assert.equal(received.rows[0]?.attempts,2,"one failed attempt followed by one successful dispatch");
    assert.ok(getTestOperationalMail(email).some(m=>m.kind==="received"));

    await pool.query("UPDATE commercial_leads SET created_at=NOW()-INTERVAL '72 hours' WHERE id=$1",[leadId]);
    await enqueueIndicativeOverdueNotifications();
    await enqueueIndicativeOverdueNotifications();
    const reminder=await pool.query<{total:number}>("SELECT COUNT(*)::integer AS total FROM commercial_notification_outbox WHERE lead_id=$1 AND recipient_staff_id=$2 AND kind='overdue'",[leadId,managerId]);
    assert.equal(reminder.rows[0]?.total,1);
    await deliverPendingNotifications(30);
    const overdueState=await pool.query<{state:string}>(
      "SELECT state FROM commercial_notification_outbox WHERE lead_id=$1 AND recipient_staff_id=$2 AND kind='overdue'",[leadId,managerId]);
    assert.equal(overdueState.rows[0]?.state,"sent");
    assert.ok(getTestOperationalMail(email).some(m=>m.kind==="overdue"));
  }finally{
    if(leadId)await pool.query("DELETE FROM commercial_leads WHERE id=$1",[leadId]);
    await pool.query("DELETE FROM catalog_products WHERE id=$1",[course]);
    await pool.query("DELETE FROM staff_users WHERE id=$1",[managerId]);
  }
});
