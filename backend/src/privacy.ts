import {pool} from "./db.js";

function validate(days:number,limit:number){
  if(!Number.isInteger(days)||days<30||days>3650)throw Error("invalid_retention_policy");
  if(!Number.isInteger(limit)||limit<1||limit>100)throw Error("invalid_batch_size");
}
const ageFilter="created_at < NOW()-(INTERVAL '1 day' * $1::integer) AND anonymized_at IS NULL";
export async function previewRetention(days:number):Promise<{leads:number;contacts:number}>{
  validate(days,1);
  const leads=await pool.query<{total:number}>(
    "SELECT COUNT(*)::integer AS total FROM commercial_leads WHERE "+ageFilter+" AND status IN ('won','lost','closed')",[days]);
  const contacts=await pool.query<{total:number}>(
    "SELECT COUNT(*)::integer AS total FROM contact_requests WHERE "+ageFilter+" AND status IN ('responded','archived')",[days]);
  return {leads:leads.rows[0]?.total??0,contacts:contacts.rows[0]?.total??0};
}

/**
 * Policy-controlled, audit-preserving minimization.
 * Active leads and unanswered contacts are excluded. Does not delete employee
 * identities or non-portal external copies; LGPD legal approval is still required.
 */
export async function anonymizeEligibleRetention(days:number,limit=50):Promise<{leads:number;contacts:number}>{
  validate(days,limit);
  const client=await pool.connect();
  let leads=0,contacts=0;
  try{
    await client.query("BEGIN");
    const candidates=await client.query<{id:string}>(
      "SELECT id FROM commercial_leads WHERE "+ageFilter+
      " AND status IN ('won','lost','closed') ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT $2",
      [days,limit]);
    for(const item of candidates.rows){
      // Remove PII, item snapshots and link to assigned operator; preserve only
      // aggregate status/timestamps and an anonymized audit event.
      await client.query(
        "UPDATE commercial_leads SET contact_name='Dados anonimizados',company_name='Empresa anonimizada',"+
        "contact_email='anon-'||id::text||'@invalid.local',contact_phone=NULL,message=NULL,"+
        "items='[]'::jsonb,payload_sha256=repeat('0',64),assigned_staff_id=NULL,anonymized_at=NOW(),updated_at=NOW() "+
        "WHERE id=$1",[item.id]);
      await client.query(
        "UPDATE commercial_lead_events SET actor_label=NULL,metadata='{}'::jsonb WHERE lead_id=$1",[item.id]);
      await client.query("DELETE FROM commercial_notification_outbox WHERE lead_id=$1",[item.id]);
      await client.query(
        "INSERT INTO commercial_lead_events(lead_id,event_type,metadata) VALUES($1,'privacy.anonymized',$2::jsonb)",
        [item.id,JSON.stringify({policy:"retention",retentionDays:days})]);
      leads++;
    }
    const due=await client.query<{id:string}>(
      "SELECT id FROM contact_requests WHERE "+ageFilter+
      " AND status IN ('responded','archived') ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT $2",
      [days,limit]);
    for(const item of due.rows){
      await client.query(
        "UPDATE contact_requests SET contact_name='Dados anonimizados',company_name='Empresa anonimizada',"+
        "email='anon-'||id::text||'@invalid.local',message='Conteudo removido conforme politica de retencao',"+
        "anonymized_at=NOW() WHERE id=$1",[item.id]);
      contacts++;
    }
    await client.query("COMMIT");
    return {leads,contacts};
  }catch(e){await client.query("ROLLBACK");throw e;}
  finally{client.release();}
}
