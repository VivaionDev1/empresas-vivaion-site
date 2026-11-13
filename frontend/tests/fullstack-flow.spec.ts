import { randomUUID } from "node:crypto";
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
