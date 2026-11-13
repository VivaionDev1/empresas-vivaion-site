import "dotenv/config";
import { z } from "zod";
import { pool } from "../src/db.js";
import { config } from "../src/config.js";
import { assertIsolatedDatabaseUrl } from "../src/domain/dbTarget.js";

// Restricted, offline operations support. Not a substitute for a staff portal and RBAC.
if (process.env.LEAD_OPERATIONS_ENABLED !== "true") throw new Error("Commercial lead operations are disabled.");
if (!config.databaseUrl) throw new Error("DATABASE_URL required");
assertIsolatedDatabaseUrl(config.databaseUrl);
const args = new Map<string,string>();
for(let i=2;i<process.argv.length;i+=2) {
  const key=process.argv[i],value=process.argv[i+1];
  if(!key?.startsWith("--")||!value||value.startsWith("--")||args.has(key))throw Error("Expected unique --key value pairs");
  args.set(key,value);
}
const cmd=z.enum(["list","review"]).parse(args.get("--action"));
try{
  if(cmd==="list"){
    const state=args.get("--status");
    if(state&&!["received","assigned","contacted","proposal_sent","negotiating","won","lost","closed"].includes(state))throw Error("Invalid status");
    const result=await pool.query<{
      id:string;company_name:string;status:string;created_at:string;number_of_courses:number
    }>(`
      SELECT id,company_name,status,created_at,jsonb_array_length(items) AS number_of_courses
      FROM commercial_leads WHERE ($1::text IS NULL OR status=$1)
      ORDER BY created_at DESC LIMIT 50
    `,[state??null]);
    // Do not output telephone, email, message or other customer PII to general logs.
    console.log(JSON.stringify(result.rows));
  }else{
    const input=z.object({
      id:z.string().uuid(),status:z.enum(["assigned","contacted","proposal_sent","negotiating","won","lost","closed"]),
      operator:z.string().trim().min(4).max(120),reason:z.string().trim().min(10).max(1000)
    }).parse({id:args.get("--id"),status:args.get("--status"),operator:args.get("--operator"),reason:args.get("--reason")});
    const client=await pool.connect();
    try{
      await client.query("BEGIN");
      const previous=await client.query<{status:string}>("SELECT status FROM commercial_leads WHERE id=$1 FOR UPDATE",[input.id]);
      if(!previous.rows[0])throw Error("Unknown lead");
      if(previous.rows[0].status===input.status)throw Error("No status change requested");
      await client.query("UPDATE commercial_leads SET status=$1,updated_at=NOW() WHERE id=$2",[input.status,input.id]);
      await client.query(
        "INSERT INTO commercial_lead_events(lead_id,event_type,actor_label,metadata) VALUES($1,'status_updated',$2,$3::jsonb)",
        [input.id,input.operator,JSON.stringify({from:previous.rows[0].status,to:input.status,reason:input.reason})]
      );
      await client.query("COMMIT");
      console.log("Recorded lead status update:",input.id,input.status);
    }catch(e){await client.query("ROLLBACK");throw e;}finally{client.release();}
  }
}finally{await pool.end();}
