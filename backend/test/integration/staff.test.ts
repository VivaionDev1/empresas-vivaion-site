import assert from "node:assert/strict";
import test from "node:test";
import {randomUUID} from "node:crypto";
import request from "supertest";
import {app} from "../../src/app.ts";
import {pool} from "../../src/db.ts";
import {getTestMail} from "../../src/mail.ts";

const origin="http://localhost:4321";
test("staff-only portal: invitation, authorization, assignment, audit and isolation",async()=>{
  const managerId=randomUUID(),sellerId=randomUUID(),leadId=randomUUID(),unassignedId=randomUUID();
  const managerEmail="manager-"+randomUUID()+"@example.test";
  const sellerEmail="seller-"+randomUUID()+"@example.test";
  try{
    await pool.query("INSERT INTO staff_users(id,email,full_name,role) VALUES($1,$2,'Test Manager','manager'),($3,$4,'Test Seller','sales')",
      [managerId,managerEmail,sellerId,sellerEmail]);
    await pool.query("INSERT INTO commercial_leads(id,request_key,payload_sha256,contact_name,company_name,contact_email,items,privacy_acknowledged_at) VALUES($1,$2,$3,'Teste','Empresa Teste','lead@example.test',$4::jsonb,NOW()),($5,$6,$3,'Outro','Empresa Segura','private@example.test',$4::jsonb,NOW())",
      [leadId,randomUUID(),"a".repeat(64),JSON.stringify([{productId:"pos:cmna",title:"Formacao Teste",quantity:1}]),unassignedId,randomUUID()]);
    const anonymous=await request(app).get("/api/staff/leads");
    assert.equal(anonymous.status,401);
    const invalidOrigin=await request(app).post("/api/staff/request-access").set("Origin","https://evil.invalid").send({email:managerEmail});
    assert.equal(invalidOrigin.status,403);
    const outsider=await request(app).post("/api/staff/request-access").set("Origin",origin).send({email:"outsider@example.test"});
    assert.equal(outsider.status,202);
    const requestAccess=await request(app).post("/api/staff/request-access").set("Origin",origin).send({email:managerEmail});
    assert.equal(requestAccess.status,202);
    const message=getTestMail(managerEmail,"staff_access");
    assert.ok(message?.token);
    assert.ok(message?.url.includes("/operacao/"));
    const login=await request(app).post("/api/staff/verify-access").set("Origin",origin).send({token:message!.token});
    assert.equal(login.status,200);
    assert.equal(login.body.authenticated,true);
    const cookie=String(login.headers["set-cookie"]?.[0]??"").split(";")[0];
    assert.ok(cookie.startsWith("ve_staff="));
    const replay=await request(app).post("/api/staff/verify-access").set("Origin",origin).send({token:message!.token});
    assert.equal(replay.status,401);
    const manager=request(app);
    const list=await manager.get("/api/staff/leads").set("Cookie",cookie);
    assert.equal(list.status,200);
    assert.ok(list.body.leads.some((l:{id:string})=>l.id===leadId));
    const notificationStatus=await manager.get("/api/staff/notifications/status").set("Cookie",cookie);
    assert.equal(notificationStatus.status,200);
    assert.equal(typeof notificationStatus.body.counts.pending,"number");
    const missingReason=await manager.patch("/api/staff/leads/"+leadId).set("Cookie",cookie).set("Origin",origin).send({status:"assigned",assignedStaffId:sellerId,reason:"short"});
    assert.equal(missingReason.status,400);
    const change=await manager.patch("/api/staff/leads/"+leadId).set("Cookie",cookie).set("Origin",origin).send({
      status:"assigned",assignedStaffId:sellerId,reason:"Responsavel do atendimento indicado e verificado."
    });
    assert.equal(change.status,200);
    const cannotSkip=await manager.patch("/api/staff/leads/"+leadId).set("Cookie",cookie).set("Origin",origin).send({
      status:"won",reason:"Nao pode concluir sem verificar etapas do atendimento."
    });
    assert.equal(cannotSkip.status,409);
    const detail=await manager.get("/api/staff/leads/"+leadId).set("Cookie",cookie);
    assert.equal(detail.status,200);
    assert.ok(detail.body.events.some((e:{event_type:string})=>e.event_type==="staff_update"));

    const sellerAccess=await request(app).post("/api/staff/request-access").set("Origin",origin).send({email:sellerEmail});
    assert.equal(sellerAccess.status,202);
    const sellerToken=getTestMail(sellerEmail,"staff_access")!.token;
    const sellerLogin=await request(app).post("/api/staff/verify-access").set("Origin",origin).send({token:sellerToken});
    assert.equal(sellerLogin.status,200);
    const sellerCookie=String(sellerLogin.headers["set-cookie"]?.[0]??"").split(";")[0];
    const sellerList=await request(app).get("/api/staff/leads").set("Cookie",sellerCookie);
    assert.equal(sellerList.status,200);
    assert.ok(sellerList.body.leads.some((l:{id:string})=>l.id===leadId));
    assert.ok(!sellerList.body.leads.some((l:{id:string})=>l.id===unassignedId));
    const otherDetail=await request(app).get("/api/staff/leads/"+unassignedId).set("Cookie",sellerCookie);
    assert.equal(otherDetail.status,404);
    const sellerTeam=await request(app).get("/api/staff/team").set("Cookie",sellerCookie);
    assert.equal(sellerTeam.status,403);
    const sellerNotificationStatus=await request(app).get("/api/staff/notifications/status").set("Cookie",sellerCookie);
    assert.equal(sellerNotificationStatus.status,403);
    const unauthorizedAssignment=await request(app).patch("/api/staff/leads/"+leadId).set("Cookie",sellerCookie).set("Origin",origin).send({
      assignedStaffId:managerId,reason:"Tentativa de atribuir lead fora da permissao."
    });
    assert.equal(unauthorizedAssignment.status,403);
    const contacted=await request(app).patch("/api/staff/leads/"+leadId).set("Cookie",sellerCookie).set("Origin",origin).send({
      status:"contacted",reason:"Contato comercial concluido pela equipe responsavel."
    });
    assert.equal(contacted.status,200);
    const logout=await request(app).post("/api/staff/logout").set("Cookie",sellerCookie).set("Origin",origin);
    assert.equal(logout.status,200);
    const afterLogout=await request(app).get("/api/staff/me").set("Cookie",sellerCookie);
    assert.equal(afterLogout.status,401);
  } finally{
    await pool.query("DELETE FROM commercial_leads WHERE id=ANY($1::uuid[])",[[leadId,unassignedId]]);
    await pool.query("DELETE FROM staff_users WHERE id=ANY($1::uuid[])",[[managerId,sellerId]]);
  }
});
