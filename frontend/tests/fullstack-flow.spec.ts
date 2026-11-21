import { randomUUID,randomBytes,createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { Pool } from "pg";

test.skip(process.env.E2E_FULLSTACK !== "true", "Requires disposable API and PostgreSQL");

const feed=JSON.parse(readFileSync(resolve(process.cwd(),"../data/catalog-v1.json"),"utf8")) as {
  products:Array<{id:string;title:string;commercialStage:string}>
};
const course=feed.products.find(p=>p.commercialStage==="available");
if(!course)throw new Error("No eligible course in institutional catalog");

test("live full-stack: catalog -> cart without prices -> public proposal -> PostgreSQL",async({page})=>{
  const email="hml-"+randomUUID()+"@example.test";
  await page.goto("/catalogo/");
  await expect(page.locator("#catalog-count")).toContainText(String(feed.products.length));
  await page.locator("#search").fill(course!.title);
  const card=page.locator(".course-card").filter({hasText:course!.title}).first();
  await expect(card.getByRole("button",{name:"Solicitar proposta +"})).toBeEnabled();
  await card.getByRole("button",{name:"Solicitar proposta +"}).click();
  await page.goto("/carrinho/");
  await expect(page.locator(".cart-item")).toHaveCount(1);
  await expect(page.locator("#cart-total")).toContainText("Sob consulta");
  await page.locator("#cart-proposal").click();
  await expect(page).toHaveURL(/\/solicitar-proposta\/$/);
  await page.getByRole("textbox",{name:"Seu nome"}).fill("Pessoa de Homologação");
  await page.getByRole("textbox",{name:"Empresa"}).fill("Empresa Teste Opção A");
  await page.getByRole("textbox",{name:"E-mail"}).fill(email);
  await page.getByRole("checkbox").check();
  const responsePromise=page.waitForResponse(r=>r.url().endsWith("/api/public-proposals")&&r.request().method()==="POST");
  await page.getByRole("button",{name:/Enviar solicitação/}).click();
  const response=await responsePromise;
  expect(response.status()).toBe(201);
  const result=await response.json() as {reference:string;accepted:boolean;status:string};
  expect(result.accepted).toBe(true);
  expect(result.status).toBe("received");
  await expect(page.locator("#proposal-feedback")).toContainText(result.reference);
  const db=new Pool({connectionString:process.env.DATABASE_URL});
  try{
    const saved=await db.query<{contact_email:string;items:Array<{productId:string;quantity:number}>;status:string}>(
      "SELECT contact_email,items,status FROM commercial_leads WHERE id=$1",[result.reference]);
    expect(saved.rowCount).toBe(1);
    expect(saved.rows[0]?.contact_email).toBe(email);
    expect(saved.rows[0]?.items).toContainEqual(expect.objectContaining({productId:course!.id,quantity:1}));
    const events=await db.query<{count:number}>(
      "SELECT COUNT(*)::integer AS count FROM commercial_lead_events WHERE lead_id=$1",[result.reference]);
    expect(events.rows[0]?.count).toBe(1);
  }finally{
    await db.query("DELETE FROM commercial_leads WHERE id=$1",[result.reference]);
    await db.end();
  }
  await expect(page.locator("#proposal-course-summary")).toContainText("Nenhuma formação selecionada");
});

test("live full-stack: contact form -> audit -> manager inbox -> response",async({page})=>{
  const staffId=randomUUID(),staffEmail="staff-"+randomUUID()+"@example.test";
  const visitorEmail="visitor-"+randomUUID()+"@example.test";
  const sessionToken=randomBytes(32).toString("base64url");
  const tokenHash=createHash("sha256").update(sessionToken).digest("hex");
  const db=new Pool({connectionString:process.env.DATABASE_URL});
  let reference:string|undefined;
  try{
    await db.query(
      "INSERT INTO staff_users(id,email,full_name,role) VALUES($1,$2,'Gestora Homologacao','manager')",
      [staffId,staffEmail]);
    await db.query(
      "INSERT INTO staff_sessions(token_hash,staff_id,expires_at) VALUES($1,$2,NOW()+INTERVAL '1 hour')",
      [tokenHash,staffId]);
    await page.context().addCookies([{name:"ve_staff",value:sessionToken,
      url:"http://127.0.0.1:4322",httpOnly:true,sameSite:"Strict"}]);
    await page.goto("/contato/");
    // Build remains non-public for rootless tests; exercise only the API path here.
    await page.evaluate(()=>document.body.dataset.siteLive="true");
    await page.getByRole("textbox",{name:"Seu nome"}).fill("Contato E2E");
    await page.getByRole("textbox",{name:"Seu e-mail"}).fill(visitorEmail);
    await page.getByRole("textbox",{name:"Empresa"}).fill("Empresa de Homologacao");
    await page.getByRole("textbox",{name:"Qual é a necessidade?"})
      .fill("Gostaria de um contato para uma trilha de capacitacao corporativa.");
    await page.locator('#contact-form input[name="privacyAcknowledged"]').check();
    const createdResponse=page.waitForResponse(r=>r.url().endsWith("/api/contact")&&r.request().method()==="POST");
    await page.locator('#contact-form button[type="submit"]').click();
    const response=await createdResponse;
    expect(response.status()).toBe(202);
    reference=(await response.json() as {reference:string}).reference;
    await expect(page.locator("#contact-feedback")).toContainText(reference);
    const stored=await db.query<{email:string;privacy_acknowledged_at:string|null}>(
      "SELECT email,privacy_acknowledged_at FROM contact_requests WHERE id=$1",[reference]);
    expect(stored.rows[0]?.email).toBe(visitorEmail);
    expect(stored.rows[0]?.privacy_acknowledged_at).toBeTruthy();

    await page.goto("/operacao/");
    await expect(page.locator("#staff-contact-panel")).toBeVisible();
    const row=page.locator("#staff-contacts > div").filter({hasText:"Empresa de Homologacao"}).first();
    await expect(row).toBeVisible();
    await row.getByRole("button",{name:"Examinar contato"}).click();
    await expect(page.locator("#staff-contact-data")).toContainText(visitorEmail);
    await page.locator('#staff-contact-activity-form textarea[name="note"]')
      .fill("Primeira tentativa de retorno registrada no ambiente de homologacao.");
    await page.getByRole("button",{name:"Registrar contato"}).click();
    await expect(page.locator("#staff-contact-events")).toContainText("Primeira tentativa de retorno");

    await page.locator('#staff-contact-status-form textarea[name="reason"]')
      .fill("Contato respondido por canal institucional ficticio.");
    await page.getByRole("button",{name:"Salvar situação"}).click();
    await expect(page.locator("#staff-contact-data")).toContainText("Respondida");
    const evidence=await db.query<{status:string}>(
      "SELECT status FROM contact_requests WHERE id=$1",[reference]);
    expect(evidence.rows[0]?.status).toBe("responded");
    const audits=await db.query<{event_type:string}>(
      "SELECT event_type FROM contact_request_events WHERE contact_id=$1 ORDER BY id",[reference]);
    expect(audits.rows.map(x=>x.event_type)).toEqual(["received","staff_activity","staff_update"]);
  }finally{
    if(reference)await db.query("DELETE FROM contact_requests WHERE id=$1",[reference]);
    await db.query("DELETE FROM staff_users WHERE id=$1",[staffId]);
    await db.end();
  }
});
