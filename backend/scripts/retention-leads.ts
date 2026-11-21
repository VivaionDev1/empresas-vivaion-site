import "dotenv/config";
import {pool} from "../src/db.js";
import {config} from "../src/config.js";
import {assertIsolatedDatabaseUrl} from "../src/domain/dbTarget.js";
import {previewRetention,anonymizeEligibleRetention} from "../src/privacy.js";

if(!config.databaseUrl)throw Error("DATABASE_URL required");
assertIsolatedDatabaseUrl(config.databaseUrl);
const days=Number(process.env.APPROVED_LEAD_RETENTION_DAYS);
if(!Number.isInteger(days)||days<30||days>3650)throw Error("APPROVED_LEAD_RETENTION_DAYS missing or invalid");
const [mode,confirmation]=process.argv.slice(2);
if(!["preview","apply"].includes(mode??""))throw Error("Usage: retention-leads.ts preview | apply acknowledge-institutional-approval");
if(mode==="apply"&&(
  process.env.PRIVACY_RETENTION_ENABLED!=="true"||
  confirmation!=="acknowledge-institutional-approval"
))throw Error("Retention apply disabled: institutional approval and explicit acknowledgement required");
if(mode==="preview"&&confirmation)throw Error("Unexpected argument");
try{
  const result=mode==="preview"?await previewRetention(days):await anonymizeEligibleRetention(days,50);
  // Only counts are ever printed, no personally identifying data.
  process.stdout.write(JSON.stringify({mode,retentionDays:days,...result})+"\n");
}finally{await pool.end();}
