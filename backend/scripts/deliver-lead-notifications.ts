import "dotenv/config";
import { pool } from "../src/db.js";
import { config } from "../src/config.js";
import { assertIsolatedDatabaseUrl } from "../src/domain/dbTarget.js";
import { deliverPendingNotifications, enqueueIndicativeOverdueNotifications } from "../src/notifications.js";

if(process.env.NOTIFICATION_DELIVERY_ENABLED!=="true")throw Error("Notification delivery disabled");
if(!config.databaseUrl)throw Error("DATABASE_URL required");
assertIsolatedDatabaseUrl(config.databaseUrl);
if(config.nodeEnv!=="test"&&!config.staffPortalEnabled)throw Error("Staff portal must be approved before notifications");
if(process.argv.length!==2 && !(process.argv.length===4&&process.argv[2]==="--max"&&/^[1-9][0-9]?$/.test(process.argv[3]??"")&&Number(process.argv[3])<=50))
  throw Error("Usage: tsx scripts/deliver-lead-notifications.ts [--max 1..50]");
const max=process.argv[2]==="--max"?Number(process.argv[3]):20;
try{
  const queued=await enqueueIndicativeOverdueNotifications();
  const result=await deliverPendingNotifications(max);
  // Counters only, never recipient/customer identifiers.
  process.stdout.write(JSON.stringify({queuedOverdue:queued,...result})+"\n");
  if(result.failed)process.exitCode=1;
}finally{await pool.end();}
