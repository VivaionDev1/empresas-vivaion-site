import {test,expect} from "@playwright/test";

test("general contact form requires privacy acknowledgement and sends an idempotent payload",async({page})=>{
  let seen:{requestKey?:string;privacyAcknowledged?:boolean;message?:string}|null=null;
  let submissions=0;
  await page.route("**/api/contact",async route=>{
    submissions++;
    seen=JSON.parse(route.request().postData()??"{}");
    await route.fulfill({status:202,contentType:"application/json",
      body:JSON.stringify({accepted:true,reference:"11111111-1111-4111-8111-111111111111"})});
  });
  await page.goto("/contato/");
  await page.evaluate(()=>document.body.dataset.siteLive="true");
  await page.getByRole("textbox",{name:"Seu nome"}).fill("Contato Ficticio");
  await page.getByRole("textbox",{name:"Seu e-mail"}).fill("ficticio@example.test");
  await page.getByRole("textbox",{name:"Empresa"}).fill("Empresa Ficticia");
  await page.getByRole("textbox",{name:"Qual é a necessidade?"}).fill("Necessidade de capacitação corporativa para o time.");
  await page.locator('#contact-form button[type="submit"]').click();
  expect(submissions).toBe(0);
  await page.locator('#contact-form input[name="privacyAcknowledged"]').check();
  await page.locator('#contact-form button[type="submit"]').click();
  await expect(page.locator("#contact-feedback")).toContainText("Protocolo:");
  expect(submissions).toBe(1);
  expect(seen).not.toBeNull();
  expect(seen!.privacyAcknowledged).toBe(true);
  expect(seen!.requestKey).toMatch(/^[0-9a-f-]{36}$/);
});

test("manager can review contact inbox and securely log a note and response",async({page})=>{
  const id="11111111-1111-4111-8111-111111111111";
  const managerId="22222222-2222-4222-8222-222222222222";
  let status="new",activity="";
  let updated=false;
  await page.route("**/api/staff/**",async route=>{
    const path=new URL(route.request().url()).pathname;
    const send=(body:unknown,code=200)=>route.fulfill({status:code,contentType:"application/json",body:JSON.stringify(body)});
    if(path.endsWith("/me"))return send({staff:{id:managerId,fullName:"Gestora Contatos",role:"manager"}});
    if(path.endsWith("/team"))return send({staff:[{id:managerId,full_name:"Gestora Contatos",role:"manager"}]});
    if(path.endsWith("/overview"))return send({statuses:[],overdue:0,dueFollowups:0,scheduledFollowups:0});
    if(path.endsWith("/notifications/status"))return send({counts:{pending:0,sent:0,dead:0,cancelled:0},deliveryEnabled:false,relayConfigured:false});
    if(path.endsWith("/leads"))return send({leads:[],nextCursor:null});
    if(path.endsWith("/contacts/overview"))return send({statuses:[{status,total:1}]});
    if(path.endsWith("/contacts")&&route.request().method()==="GET")return send({
      contacts:[{id,contact_name:"Contato de Teste",company_name:"Empresa de Teste",
        created_at:new Date().toISOString(),status}],nextCursor:null
    });
    if(path.endsWith("/contacts/"+id)&&route.request().method()==="GET")return send({
      contact:{id,contact_name:"Contato de Teste",company_name:"Empresa de Teste",
        email:"ficticio@example.test",message:"<img src=x onerror=alert(1)> Necessidade de teste.",
        status,created_at:new Date().toISOString()},
      events:activity?[{event_type:"staff_activity",created_at:new Date().toISOString(),
        metadata:{kind:"note",note:activity}}]:[]
    });
    if(path.endsWith("/contacts/"+id+"/activities")&&route.request().method()==="POST"){
      const body=JSON.parse(route.request().postData()??"{}");
      activity=body.note;return send({id:"5"},201);
    }
    if(path.endsWith("/contacts/"+id)&&route.request().method()==="PATCH"){
      const body=JSON.parse(route.request().postData()??"{}");
      status=body.status;updated=true;return send({id,status});
    }
    return send({error:"not_found"},404);
  });
  await page.goto("/operacao/");
  await expect(page.locator("#staff-contact-panel")).toBeVisible();
  await expect(page.locator("#staff-contacts")).toContainText("Empresa de Teste");
  await page.getByRole("button",{name:"Examinar contato"}).click();
  await expect(page.locator("#staff-contact-detail")).toBeVisible();
  await expect(page.locator("#staff-contact-data")).toContainText("<img src=x onerror=alert(1)>");
  expect(await page.locator("#staff-contact-data img").count()).toBe(0);
  await page.locator('#staff-contact-activity-form textarea[name="note"]').fill(
    "<svg onload=alert(1)> Contato adicional registrado."
  );
  await page.getByRole("button",{name:"Registrar contato"}).click();
  await expect(page.locator("#staff-contact-events")).toContainText("<svg onload=alert(1)>");
  expect(await page.locator("#staff-contact-events svg").count()).toBe(0);
  await page.locator('#staff-contact-status-form textarea[name="reason"]').fill("Cliente respondido pelo canal oficial.");
  await page.getByRole("button",{name:"Salvar situação"}).click();
  await expect(page.locator("#staff-contact-data")).toContainText("Respondida");
  expect(updated).toBe(true);
});

test("sales users never see the manager-only contact inbox",async({page})=>{
  const salesId="22222222-2222-4222-8222-222222222222";
  let attemptedContactRead=false;
  await page.route("**/api/staff/**",async route=>{
    const path=new URL(route.request().url()).pathname;
    const send=(body:unknown,status=200)=>route.fulfill({status,contentType:"application/json",body:JSON.stringify(body)});
    if(path.endsWith("/me"))return send({staff:{id:salesId,fullName:"Vendedor",role:"sales"}});
    if(path.endsWith("/overview"))return send({statuses:[],overdue:0});
    if(path.endsWith("/leads"))return send({leads:[],nextCursor:null});
    if(path.includes("/contacts")){attemptedContactRead=true;return send({error:"staff_manager_required"},403);}
    return send({error:"not_found"},404);
  });
  await page.goto("/operacao/");
  await expect(page.locator("#staff-panel")).toBeVisible();
  await expect(page.locator("#staff-contact-panel")).toBeHidden();
  expect(attemptedContactRead).toBe(false);
});
