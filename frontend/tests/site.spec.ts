import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const catalog = JSON.parse(readFileSync(resolve(process.cwd(), "../data/catalog-v1.json"), "utf8")) as {
  products: Array<{id:string;title:string;commercialStage:string;canonicalUrl:string}>;
};

test.beforeEach(async ({ page }) => {
  await page.route("https://fonts.googleapis.com/**", route => route.abort());
  await page.route("https://fonts.gstatic.com/**", route => route.abort());
});

test("homepage: institutional brand, clear action and non-indexed HML", async ({page}) => {
  await page.goto("/");
  await expect(page.getByRole("heading", {level:1})).toContainText("Capacitação para sua equipe");
  await expect(page.getByRole("link", {name:/Explorar formações/}).first()).toBeVisible();
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex, nofollow");
});

test("catalog: official feed, 12 items per batch, search and useful filters", async ({page}) => {
  await page.route("**/api/catalog", route => route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({schemaVersion:1,source:"institutional",products:catalog.products})}));
  await page.route("**/api/commercial/catalog", route => route.fulfill({status:503,contentType:"application/json",body:JSON.stringify({error:"pricing_unavailable"})}));
  await page.goto("/catalogo/");
  await expect(page.locator(".course-card")).toHaveCount(12);
  await expect(page.locator("#catalog-count")).toContainText(String(catalog.products.length));
  await page.locator("#load-more").click();
  await expect(page.locator(".course-card")).toHaveCount(24);
  await page.locator("#search").fill("Comunicação");
  await expect(page.locator(".course-card").first()).toBeVisible();
  await expect(page.locator("#catalog-count")).not.toContainText("46 formações encontradas");
});

test("course detail: generated route offers official source and no checkout", async ({page}) => {
  const sample=catalog.products.find(p => p.commercialStage==="available")!;
  const [kind,slug]=sample.id.split(":");
  await page.goto(`/cursos/${kind}/${slug}/`);
  await expect(page.getByRole("heading",{level:1})).toContainText(sample.title);
  await expect(page.getByRole("link",{name:/Voltar ao catálogo/})).toBeVisible();
  await expect(page.locator('a[href="'+sample.canonicalUrl+'"]')).toBeVisible();
});

test("cart: informational estimate with honest empty state", async ({page}) => {
  await page.goto("/carrinho/");
  await expect(page.getByRole("heading",{level:1})).toContainText("Seu carrinho");
  await expect(page.getByText("Nenhum pagamento é feito aqui.")).toBeVisible();
});

test("registration and contact: accessible labels, no false promises", async ({page}) => {
  await page.goto("/cadastro/");
  await expect(page.getByRole("heading",{name:/Cadastro empresarial/})).toBeVisible();
  const form=page.locator("#register-form");
  if(await form.count()){
    await expect(form.getByRole("textbox",{name:"Razão social"})).toBeVisible();
  }else{
    await expect(page.getByText(/cadastro.*temporariamente|cadastro abrirá|prévia não recebe/i).first()).toBeVisible();
  }
  await page.goto("/contato/");
  await expect(page.getByRole("textbox",{name:"Qual é a necessidade?"})).toBeVisible();
  await expect(page.getByRole("link",{name:"aviso de privacidade"}).first()).toBeVisible();
});

test("mobile or desktop: navigation and four pages without horizontal overflow", async ({page,isMobile}) => {
  for(const p of ["/","/catalogo/","/carrinho/","/contato/"]){
    await page.goto(p);
    const width=await page.evaluate(()=>document.documentElement.clientWidth);
    const scroll=await page.evaluate(()=>document.documentElement.scrollWidth);
    expect(scroll,p+" overflow").toBeLessThanOrEqual(width+2);
  }
  if(isMobile){
    await page.goto("/");
    await page.getByRole("button",{name:"Abrir menu"}).click();
    await expect(page.getByRole("navigation",{name:"Navegação principal"})).toBeVisible();
  }
});

test("assisted commercial proposal page does not require an account",async({page})=>{
  await page.goto("/solicitar-proposta/");
  await expect(page.getByRole("heading",{level:1})).toContainText("Solicite uma proposta");
  await expect(page.getByRole("textbox",{name:"Seu nome"})).toBeVisible();
  await expect(page.getByText("Não é necessário criar uma conta empresarial")).toBeVisible();
});

test("assisted proposal is available when corporate pricing has no approval",async({page})=>{
  const product=catalog.products.find(p=>p.commercialStage==="available")!;
  await page.route("**/api/catalog",route=>route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({schemaVersion:1,products:catalog.products})}));
  await page.route("**/api/commercial/catalog",route=>route.fulfill({status:503,contentType:"application/json",body:JSON.stringify({error:"pricing_disabled"})}));
  await page.goto("/carrinho/");
  await page.evaluate((id)=>{
    localStorage.setItem("vivaion-empresas-cart-v1",JSON.stringify([{productId:id,quantity:2}]));
  },product.id);
  await page.reload();
  await expect(page.locator(".cart-item")).toHaveCount(1);
  await expect(page.locator("#cart-total")).toContainText("Sob consulta");
  await expect(page.locator("#cart-proposal")).toHaveAttribute("href","/solicitar-proposta/");
  await page.locator("#cart-proposal").click();
  await expect(page).toHaveURL(/\/solicitar-proposta\/$/);
  await expect(page.getByText(product.title).first()).toBeVisible();
});

test("available courses without approved price retain the proposal action",async({page})=>{
  const sample=catalog.products.find(p=>p.commercialStage==="available")!;
  await page.route("**/api/catalog",route=>route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({schemaVersion:1,products:catalog.products})}));
  await page.route("**/api/commercial/catalog",route=>route.fulfill({status:503,contentType:"application/json",body:JSON.stringify({error:"pricing_disabled"})}));
  await page.goto("/catalogo/");
  await page.locator("#search").fill(sample.title);
  const card=page.locator(".course-card").filter({hasText:sample.title}).first();
  await expect(card.getByRole("button",{name:"Solicitar proposta +"})).toBeEnabled();
  await card.getByRole("button",{name:"Solicitar proposta +"}).click();
  const selection=await page.evaluate(()=>JSON.parse(localStorage.getItem("vivaion-empresas-cart-v1")??"[]"));
  expect(selection).toContainEqual({productId:sample.id,quantity:1});
  await page.goto("/carrinho/");
  await expect(page.locator("#cart-total")).toContainText("Sob consulta");
  await expect(page.locator("#cart-proposal")).toHaveAttribute("href","/solicitar-proposta/");
});
