import {test,expect} from "@playwright/test";

test("staff manager can load additional pages of leads without losing the first page",async({page})=>{
  const idA="11111111-1111-4111-8111-111111111111";
  const idB="22222222-2222-4222-8222-222222222222";
  await page.route("**/api/staff/**",async route=>{
    const url=new URL(route.request().url());
    const path=url.pathname;
    const send=(body:unknown,status=200)=>route.fulfill({status,contentType:"application/json",body:JSON.stringify(body)});
    if(path.endsWith("/me"))return send({staff:{id:idA,fullName:"Gestora Homologacao",role:"manager"}});
    if(path.endsWith("/team"))return send({staff:[{id:idA,full_name:"Gestora Homologacao",role:"manager"}]});
    if(path.endsWith("/overview"))return send({statuses:[{status:"received",total:2}],overdue:0});
    if(path.endsWith("/leads")){
      const cursor=url.searchParams.get("cursor");
      const id=cursor?idB:idA;
      return send({leads:[{id,company_name:cursor?"Empresa Pagina Dois":"Empresa Pagina Um",contact_name:"Contato",contact_email:"test@example.test",status:"received",created_at:new Date().toISOString(),courses:1}],nextCursor:cursor?null:"page-two"});
    }
    return send({error:"not_found"},404);
  });
  await page.goto("/operacao/");
  await expect(page.locator("#staff-leads")).toContainText("Empresa Pagina Um");
  const button=page.getByRole("button",{name:"Carregar mais solicitações"});
  await expect(button).toBeVisible();
  await button.click();
  await expect(page.locator("#staff-leads")).toContainText("Empresa Pagina Dois");
  await expect(page.locator("#staff-leads")).toContainText("Empresa Pagina Um");
  await expect(button).toBeHidden();
});
