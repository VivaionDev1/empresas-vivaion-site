import { pool } from "./db.js";
import { sendOperationalMail, mailConfigured } from "./mail.js";

type Kind = "received"|"assigned"|"overdue";
type OutboxRow = {id:string;kind:Kind;email:string};

/**
 * Transactional outbox dispatcher; each row is locked until the relay completes.
 * Delivery is at-least-once if the process stops after relay acceptance but before COMMIT.
 * Never logs recipient details, customer PII, tokens, or relay response bodies.
 */
export async function deliverPendingNotifications(maxItems=20):Promise<{sent:number;failed:number;remaining:number}>{
  if(!Number.isInteger(maxItems)||maxItems<1||maxItems>50)throw Error("invalid_batch_size");
  if(!mailConfigured())throw Error("mail_relay_unavailable");
  let sent=0,failed=0;
  for(let i=0;i<maxItems;i++){
    const client=await pool.connect();
    try{
      await client.query("BEGIN");
      const {rows}=await client.query<OutboxRow>(
        "SELECT o.id::text AS id,o.kind,u.email "+
        "FROM commercial_notification_outbox o JOIN staff_users u ON u.id=o.recipient_staff_id AND u.active=TRUE "+
        "WHERE o.state='pending' AND o.next_attempt_at<=NOW() "+
        "ORDER BY o.next_attempt_at,o.id FOR UPDATE OF o SKIP LOCKED LIMIT 1");
      const item=rows[0];
      if(!item){await client.query("COMMIT");break;}
      try{
        await sendOperationalMail(item.email,item.kind);
        await client.query("UPDATE commercial_notification_outbox SET state='sent',sent_at=NOW(),attempts=attempts+1 WHERE id=$1",[item.id]);
        sent++;
      }catch{
        // Provider errors may include PII; only count attempts and schedule a retry.
        await client.query(
          "UPDATE commercial_notification_outbox SET attempts=attempts+1,"+
          "state=CASE WHEN attempts+1>=5 THEN 'dead' ELSE 'pending' END,"+
          "next_attempt_at=NOW()+(INTERVAL '1 minute' * LEAST(POWER(2,attempts)::integer,60)) WHERE id=$1",
          [item.id]);
        failed++;
      }
      await client.query("COMMIT");
    }catch(error){await client.query("ROLLBACK");throw error;}
    finally{client.release();}
  }
  const outstanding=await pool.query<{total:number}>(
    "SELECT COUNT(*)::integer AS total FROM commercial_notification_outbox WHERE state='pending'");
  return {sent,failed,remaining:outstanding.rows[0]?.total??0};
}

/** One indicative 48-hour follow-up per overdue lead and active manager. */
export async function enqueueIndicativeOverdueNotifications():Promise<number>{
  const {rowCount}=await pool.query(
    "INSERT INTO commercial_notification_outbox(lead_id,recipient_staff_id,kind,dedupe_key) "+
    "SELECT l.id,s.id,'overdue','overdue:'||l.id::text||':'||s.id::text "+
    "FROM commercial_leads l CROSS JOIN staff_users s "+
    "WHERE l.anonymized_at IS NULL AND l.status IN ('received','assigned') "+
    "AND l.created_at<NOW()-INTERVAL '48 hours' AND s.active=TRUE AND s.role='manager' "+
    "ON CONFLICT(dedupe_key) DO NOTHING");
  return rowCount??0;
}
