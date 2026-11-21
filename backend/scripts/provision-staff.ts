import "dotenv/config";
import {z} from "zod";
import {pool} from "../src/db.js";
import {config} from "../src/config.js";
import {assertIsolatedDatabaseUrl} from "../src/domain/dbTarget.js";

// Restricted offline provisioning. Do not expose to HTTP or schedule unattended.
if(process.env.STAFF_PROVISIONING_ENABLED!=="true")throw Error("Staff provisioning disabled");
if(!config.databaseUrl)throw Error("DATABASE_URL required");
assertIsolatedDatabaseUrl(config.databaseUrl);
const args=new Map<string,string>();
for(let i=2;i<process.argv.length;i+=2){
  const key=process.argv[i],value=process.argv[i+1];
  if(!key?.startsWith("--")||!value||value.startsWith("--")||args.has(key))throw Error("Expected unique --key value pairs");
  args.set(key,value);
}
const action=z.enum(["grant","revoke"]).parse(args.get("--action"));
const email=z.email().max(254).parse(args.get("--email")).toLowerCase();
const grant=action==="grant"?z.object({
  name:z.string().trim().min(3).max(140),role:z.enum(["manager","sales"])
}).parse({name:args.get("--name"),role:args.get("--role")}):null;
const client=await pool.connect();
try{
  await client.query("BEGIN");
  // Co-serialize account/role changes with session revocation.
  let staffId:string|undefined;
  if(grant){
    const result=await client.query<{id:string}>(
      "INSERT INTO staff_users(email,full_name,role,active) VALUES($1,$2,$3,TRUE) "+
      "ON CONFLICT(email) DO UPDATE SET full_name=EXCLUDED.full_name,role=EXCLUDED.role,active=TRUE RETURNING id",
      [email,grant.name,grant.role]);
    staffId=result.rows[0]!.id;
  }else{
    const result=await client.query<{id:string}>(
      "UPDATE staff_users SET active=FALSE WHERE email=$1 RETURNING id",[email]);
    staffId=result.rows[0]?.id;
  }
  if(staffId){
    await client.query("DELETE FROM staff_sessions WHERE staff_id=$1",[staffId]);
    await client.query("UPDATE staff_login_tokens SET consumed_at=NOW() WHERE staff_id=$1 AND consumed_at IS NULL",[staffId]);
  }
  await client.query("COMMIT");
  process.stdout.write(grant?"Staff role provisioned and sessions revoked.\n":"Staff access revoked if user existed.\n");
}catch(e){await client.query("ROLLBACK");throw e;}
finally{client.release();await pool.end();}
