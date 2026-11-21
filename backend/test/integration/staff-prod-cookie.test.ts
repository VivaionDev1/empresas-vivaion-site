import assert from "node:assert/strict";
import test from "node:test";
import {execFileSync} from "node:child_process";
import {randomUUID} from "node:crypto";
import {pool} from "../../src/db.ts";
import {createSessionToken,hashSessionToken} from "../../src/domain/passwords.ts";

test("production staff login sets __Host-only Secure HttpOnly SameSite=Strict session cookie",async()=>{
  const id=randomUUID(), token=createSessionToken();
  const origin="https://empresas-hml.vivaion.com.br";
  try{
    await pool.query("INSERT INTO staff_users(id,email,full_name,role) VALUES($1,$2,'Test Secure Cookie','sales')",[id,randomUUID()+"@example.test"]);
    await pool.query(
      "INSERT INTO staff_login_tokens(staff_id,token_hash,expires_at) VALUES($1,$2,NOW()+INTERVAL '15 minutes')",
      [id,hashSessionToken(token)]);
    const script=[
      "import request from 'supertest';",
      "import {app} from './src/app.ts';",
      "import {pool} from './src/db.ts';",
      "const result=await request(app).post('/api/staff/verify-access')",
      " .set('Origin',process.env.APP_ORIGIN).send({token:process.env.STAFF_COOKIE_TEST_TOKEN});",
      "process.stdout.write(JSON.stringify({status:result.status,cookie:result.headers['set-cookie']?.[0]??''}));",
      "await pool.end();"
    ].join("\n");
    const output=execFileSync(process.execPath,["--import","tsx","--input-type=module","-e",script],{
      cwd:process.cwd(),encoding:"utf8",timeout:15_000,
      env:{...process.env,NODE_ENV:"production",APP_ORIGIN:origin,STAFF_PORTAL_ENABLED:"true",STAFF_COOKIE_TEST_TOKEN:token}
    });
    const parsed=JSON.parse(output) as {status:number;cookie:string};
    assert.equal(parsed.status,200);
    assert.match(parsed.cookie,/^__Host-ve_staff=/);
    assert.match(parsed.cookie,/;\s*Secure/i);
    assert.match(parsed.cookie,/;\s*HttpOnly/i);
    assert.match(parsed.cookie,/;\s*SameSite=Strict/i);
    assert.match(parsed.cookie,/;\s*Path=\//i);
    assert.doesNotMatch(parsed.cookie,/;\s*Domain=/i);
  }finally{
    await pool.query("DELETE FROM staff_users WHERE id=$1",[id]);
  }
});
