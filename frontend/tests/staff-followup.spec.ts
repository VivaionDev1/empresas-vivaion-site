import {test,expect} from "@playwright/test";

test("commercial staff can log interactions and schedule follow-ups without changing pipeline status",async({page})=>{
  const leadId="11111111-1111-4111-8111-111111111111";
  const managerId="22222222-2222-4222-8222-222222222222";
  let followup:string|null=null;
  let activityNote="";
  let kind="";
  let currentFilter="";
  let calls=0;
  await page.route("**/api/staff/**",async route=>{
    const u=new URL(route.request().url());
    const path=u.pathname;
    const send=(body:unknown,status=200)=>route.fulfill({status,contentType:"application/json",body:JSON.stringify(body)});
    if(path.endsWith("/me"))return send({staff:{id:managerId,fullName:"Gestora QA",role:"manager"}});
    if(path.endsWith("/team"))return send({staff:[{id:managerId,full_name:"Gestora QA",role:"manager"}]});
    if(path.endsWith("/notifications/status"))return send({counts:{pending:0,sent:0,dead:0,cancelled:0},deliveryEnabled:false,relayConfigured:false});
    if(path.endsWith("/overview"))return send({statuses:[{status:"contacted",total:1}],overdue:0,
      dueFollowups:0,scheduledFollowups:followup?1:0});
    if(path.endsWith("/leads")&&route.request().method()==="GET"){
      currentFilter=u.searchParams.get("followup")??"";
      return send({leads:[{id:leadId,company_name:"Empresa Consulta",contact_name:"Pessoa",
        contact_email:"contato@example.test",status:"contacted",created_at:new Date().toISOString(),
        courses:1,assigned_staff_id:managerId,assigned_staff_name:"Gestora QA",next_followup_at:followup}],nextCursor:null});
    }
    if(path.endsWith("/leads/"+leadId)&&route.request().method()==="GET")return send({
      lead:{id:leadId,company_name:"Empresa Consulta",contact_name:"Pessoa",contact_email:"contato@example.test",
        status:"contacted",items:[{title:"Formacao Teste",quantity:1}],assigned_staff_id:managerId,
        next_followup_at:followup},
      events:activityNote?[{event_type:"staff_activity",created_at:new Date().toISOString(),
        metadata:{kind,note:activityNote,followUpAt:followup}}]:[]
    });
    if(path.endsWith("/leads/"+leadId+"/activities")&&route.request().method()==="POST"){
      const body=JSON.parse(route.request().postData()??"{}") as {kind:string;note:string;followUpAt?:string|null};
      calls++;
      kind=body.kind;activityNote=body.note;
      if("followUpAt" in body)followup=body.followUpAt??null;
      return send({id:String(calls),nextFollowupAt:followup},201);
    }
    return send({error:"not_found"},404);
  });
  await page.goto("/operacao/");
  await expect(page.locator("#staff-panel")).toBeVisible();
  await page.getByRole("button",{name:"Examinar"}).click();
  await expect(page.getByRole("heading",{name:"Registrar atividade ou próximo retorno"})).toBeVisible();

  const future=new Date(Date.now()+2*86400_000).toISOString().slice(0,16);
  await page.locator("#staff-followup-at").fill(future);
  await page.locator("#staff-activity-kind").selectOption("call");
  const malicious="<img src=x onerror=alert(1)> Contato registrado com sucesso.";
  await page.getByRole("textbox",{name:"Registro da atividade"}).fill(malicious);
  await page.getByRole("button",{name:"Registrar atividade"}).click();
  await expect(page.locator("#staff-notice")).toContainText("Atividade registrada");
  await expect(page.locator("#staff-detail-data")).toContainText("Próximo retorno");
  await expect(page.locator("#staff-events")).toContainText(malicious);
  expect(await page.locator("#staff-events img").count()).toBe(0);
  await expect(page.locator("#staff-detail-data")).toContainText("Contatada");
  expect(calls).toBe(1);
  await page.locator("#staff-followup-filter").selectOption("scheduled");
  await expect.poll(()=>currentFilter).toBe("scheduled");
  await expect(page.locator("#staff-leads")).toContainText("Próximo retorno");

  await page.locator("#staff-clear-followup").check();
  await page.locator("#staff-activity-kind").selectOption("note");
  await page.getByRole("textbox",{name:"Registro da atividade"}).fill("Retorno cancelado após novo contato comercial.");
  await page.getByRole("button",{name:"Registrar atividade"}).click();
  await expect(page.locator("#staff-detail-data")).toContainText("Sem retorno agendado");
  expect(followup).toBe(null);
  expect(calls).toBe(2);
});
