import assert from "node:assert/strict";
import test from "node:test";
import {randomUUID} from "node:crypto";
import request from "supertest";
import {app} from "../../src/app.ts";
import {pool} from "../../src/db.ts";
import {failNextTestActionMail,getTestMail} from "../../src/mail.ts";

const origin="http://localhost:4321";
test("failed staff relay consumes undelivered token and permits safe retry",async()=>{
  const id=randomUUID(),email="relay-"+randomUUID()+"@example.test";
  try{
    await pool.query("INSERT INTO staff_users(id,email,full_name,role) VALUES($1,$2,'Atendente Ficticio','sales')",[id,email]);
    failNextTestActionMail(email,"staff_access");
    const first=await request(app).post("/api/staff/request-access").set("Origin",origin).send({email});
    assert.equal(first.status,202);
    assert.equal(getTestMail(email,"staff_access"),undefined);
    const undelivered=await pool.query<{consumed_at:string|null}>("SELECT consumed_at FROM staff_login_tokens WHERE staff_id=$1 ORDER BY created_at DESC LIMIT 1",[id]);
    assert.ok(undelivered.rows[0]?.consumed_at,"undelivered token must be consumed");

    const retry=await request(app).post("/api/staff/request-access").set("Origin",origin).send({email});
    assert.equal(retry.status,202);
    const mail=getTestMail(email,"staff_access");
    assert.ok(mail?.token,"retry must issue a fresh link");
    const okay=await request(app).post("/api/staff/verify-access").set("Origin",origin).send({token:mail!.token});
    assert.equal(okay.status,200);
  }finally{
    await pool.query("DELETE FROM staff_users WHERE id=$1",[id]);
  }
});

test("concurrent revocation prevents staff login and invalidates pending credentials",async()=>{
  const id=randomUUID(),email="revoke-"+randomUUID()+"@example.test";
  let client:import("pg").PoolClient|undefined;
  try{
    await pool.query("INSERT INTO staff_users(id,email,full_name,role) VALUES($1,$2,'Atendente Ficticio','sales')",[id,email]);
    const issued=await request(app).post("/api/staff/request-access").set("Origin",origin).send({email});
    assert.equal(issued.status,202);
    const mail=getTestMail(email,"staff_access");
    assert.ok(mail?.token);

    client=await pool.connect();
    await client.query("BEGIN");
    await client.query("UPDATE staff_users SET active=FALSE WHERE id=$1",[id]);
    await client.query("UPDATE staff_login_tokens SET consumed_at=NOW() WHERE staff_id=$1 AND consumed_at IS NULL",[id]);
    await client.query("DELETE FROM staff_sessions WHERE staff_id=$1",[id]);
    // The verification starts while revocation holds the identity row lock.
    const pending=request(app).post("/api/staff/verify-access").set("Origin",origin).send({token:mail!.token}).then(r=>r);
    await new Promise(resolve=>setTimeout(resolve,30));
    await client.query("COMMIT");
    client.release();client=undefined;
    const denied=await pending;
    assert.equal(denied.status,401,JSON.stringify(denied.body));
    const sessions=await pool.query<{count:number}>("SELECT COUNT(*)::integer AS count FROM staff_sessions WHERE staff_id=$1",[id]);
    assert.equal(sessions.rows[0]?.count,0);
  }finally{
    if(client){await client.query("ROLLBACK");client.release();}
    await pool.query("DELETE FROM staff_users WHERE id=$1",[id]);
  }
});
