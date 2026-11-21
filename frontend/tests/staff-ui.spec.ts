import {expect,test} from "@playwright/test";
test("staff portal is not indexed and does not reveal leads without authentication",async({page})=>{
  await page.route("**/api/staff/me",r=>r.fulfill({status:401,contentType:"application/json",body:JSON.stringify({error:"staff_auth_required"})}));
  await page.goto("/operacao/");
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content","noindex, nofollow");
  await expect(page.getByRole("heading",{level:1})).toContainText("Operação comercial");
  await expect(page.locator("#staff-login")).toBeVisible();
  await expect(page.locator("#staff-panel")).toBeHidden();
  await expect(page.getByRole("textbox",{name:"E-mail institucional"})).toBeVisible();
});
test("staff manager can inspect leads, transition workflow and retain safe rendering",async({page})=>{
  const id="11111111-1111-4111-8111-111111111111";
  const staffId="22222222-2222-4222-8222-222222222222";
  let status="received";
  await page.route("**/api/staff/**",async route=>{
    const url=new URL(route.request().url());
    const path=url.pathname;
    const body=(data:unknown,statusCode=200)=>route.fulfill({status:statusCode,contentType:"application/json",body:JSON.stringify(data)});
    if(path.endsWith("/me"))return body({staff:{id:staffId,fullName:"Gestora Vivaion",role:"manager"}});
    if(path.endsWith("/team"))return body({staff:[{id:staffId,full_name:"Gestora Vivaion",role:"manager"}]});
    if(path.endsWith("/overview"))return body({statuses:[{status,total:1}],overdue:0});
    if(path.endsWith("/leads")&&route.request().method()==="GET")return body({leads:[{id,company_name:"Empresa de Teste",contact_name:"Contato",contact_email:"contato@example.test",status,created_at:new Date().toISOString(),courses:1,assigned_staff_id:status==="received"?null:staffId,assigned_staff_name:status==="received"?null:"Gestora Vivaion"}]});
    if(path.endsWith("/leads/"+id)&&route.request().method()==="GET")return body({lead:{id,company_name:"Empresa de Teste",contact_name:"Contato",contact_email:"contato@example.test",status,assigned_staff_id:status==="received"?null:staffId,items:[{title:"<script>alert(1)</script>",quantity:1}],message:"Interesse corporativo"},events:[{event_type:"received",created_at:new Date().toISOString(),metadata:{}}]});
    if(path.endsWith("/leads/"+id)&&route.request().method()==="PATCH"){status="assigned";return body({id,status,assignedStaffId:staffId});}
    return body({error:"not_found"},404);
  });
  await page.goto("/operacao/");
  await expect(page.locator("#staff-panel")).toBeVisible();
  await page.getByRole("button",{name:"Examinar"}).click();
  await expect(page.locator("#staff-detail")).toBeVisible();
  await expect(page.locator("#staff-detail-data")).toContainText("<script>alert(1)</script>");
  expect(await page.locator("#staff-detail-data script").count()).toBe(0);
  await page.locator("#staff-new-status").selectOption("assigned");
  await page.locator("#staff-assignee").selectOption(staffId);
  await page.getByRole("textbox",{name:"Motivo e registro da ação"}).fill("Atendimento atribuido ao gerente responsavel.");
  await page.getByRole("button",{name:"Salvar acompanhamento"}).click();
  await expect(page.locator("#staff-notice")).toContainText("Atualização registrada");
});
