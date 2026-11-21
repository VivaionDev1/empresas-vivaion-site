import assert from "node:assert/strict";
import test from "node:test";
import {execFileSync} from "node:child_process";
import {randomUUID} from "node:crypto";
import {pool} from "../../src/db.ts";
import {deliverPendingNotifications} from "../../src/notifications.ts";
import {getTestOperationalMail} from "../../src/mail.ts";

function provision(...args:string[]):void{
  const output=execFileSync(process.execPath,
    ["--import","tsx","scripts/provision-staff.ts",...args],
    {cwd:process.cwd(),encoding:"utf8",timeout:15_000,
      env:{...process.env,STAFF_PROVISIONING_ENABLED:"true"}});
  assert.match(output,/Staff/);
}

test("revocation cancels pending mail, reactivation does not revive it, new events can be delivered",async()=>{
  const id=randomUUID(),email="revoked-"+randomUUID()+"@example.test";
  const leads=[randomUUID(),randomUUID(),randomUUID(),randomUUID()];
  const keys=leads.map((x,i)=>"revocation:"+x+":"+i);
  try{
    await pool.query("INSERT INTO staff_users(id,email,full_name,role) VALUES($1,$2,'Operador Ficticio','manager')",[id,email]);
    for(let i=0;i<leads.length;i++){
      await pool.query(
        "INSERT INTO commercial_leads(id,request_key,payload_sha256,contact_name,company_name,contact_email,items,privacy_acknowledged_at) "+
        "VALUES($1,$2,$3,'Pessoa de Teste','Empresa de Teste','ficticio@example.test','[]'::jsonb,NOW())",
        [leads[i],randomUUID(),"a".repeat(64)]);
    }
    const enqueue=async(i:number,kind:"received"|"assigned"="received")=>
      pool.query("INSERT INTO commercial_notification_outbox(lead_id,recipient_staff_id,kind,dedupe_key,next_attempt_at) "+
        "VALUES($1,$2,$3,$4,NOW()+INTERVAL '1 day')",
        [leads[i],id,kind,keys[i]]);
    const state=async(i:number)=>{
      const r=await pool.query<{state:string;cancelled_at:string|null}>(
        "SELECT state,cancelled_at FROM commercial_notification_outbox WHERE dedupe_key=$1",[keys[i]]);
      return r.rows[0]!;
    };

    // First: an undelivered notification is cancelled by the actual provisioning CLI.
    await enqueue(0);
    assert.equal((await state(0)).state,"pending");
    provision("--action","revoke","--email",email);
    assert.equal((await state(0)).state,"cancelled");
    assert.ok((await state(0)).cancelled_at);
    provision("--action","grant","--email",email,"--name","Operador Ficticio","--role","manager");
    assert.equal((await state(0)).state,"cancelled");

    // No old notification is sent after the account is reactivated.
    await deliverPendingNotifications(50);
    assert.equal(getTestOperationalMail(email).length,0);

    // A direct SQL revocation is protected by the DB trigger too, not just by the CLI.
    await enqueue(1);
    await pool.query("UPDATE staff_users SET active=FALSE WHERE id=$1",[id]);
    assert.equal((await state(1)).state,"cancelled");

    // Defensive worker sweep: messages queued while staff is already inactive
    // (for example by a race or old component) cannot remain pending forever.
    await enqueue(2);
    const dispatched=await deliverPendingNotifications(50);
    assert.ok(dispatched.cancelled>=1,"inactive recipient must be swept");
    assert.equal((await state(2)).state,"cancelled");
    assert.equal(getTestOperationalMail(email).length,0);

    // Even if the worker has not run, reactivation must cancel leftover pending mail.
    await pool.query("UPDATE commercial_notification_outbox SET state='pending',cancelled_at=NULL WHERE dedupe_key=$1",[keys[2]]);
    await pool.query("UPDATE staff_users SET active=TRUE WHERE id=$1",[id]);
    assert.equal((await state(2)).state,"cancelled");

    // New notices created AFTER reactivation remain deliverable.
    await enqueue(3,"assigned");
    await pool.query(
      "UPDATE commercial_notification_outbox SET next_attempt_at=NOW()-INTERVAL '1 second' WHERE dedupe_key=$1",
      [keys[3]]);
    const fresh=await deliverPendingNotifications(50);
    assert.ok(fresh.sent>=1);
    assert.equal((await state(3)).state,"sent");
    assert.equal(getTestOperationalMail(email).filter(m=>m.kind==="received").length,0);
    assert.equal(getTestOperationalMail(email).filter(m=>m.kind==="assigned").length,1);

    const counts=await pool.query<{state:string;total:number}>(
      "SELECT state,COUNT(*)::integer AS total FROM commercial_notification_outbox "+
      "WHERE recipient_staff_id=$1 GROUP BY state",[id]);
    assert.equal(counts.rows.find(x=>x.state==="cancelled")?.total,3);
    assert.equal(counts.rows.find(x=>x.state==="sent")?.total,1);
    assert.ok(!counts.rows.some(x=>x.state==="pending"));
  }finally{
    await pool.query("DELETE FROM commercial_leads WHERE id=ANY($1::uuid[])",[leads]);
    await pool.query("DELETE FROM staff_users WHERE id=$1",[id]);
  }
});
