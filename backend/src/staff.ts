import { Router, type Request, type RequestHandler } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { pool } from "./db.js";
import { config } from "./config.js";
import { createSessionToken, hashSessionToken } from "./domain/passwords.js";
import { mailConfigured, sendActionMail } from "./mail.js";

type Role = "manager" | "sales";
type Staff = {id:string;fullName:string;role:Role};
type StaffRequest = Request & {staff?:Staff};
type Status = "received"|"assigned"|"contacted"|"proposal_sent"|"negotiating"|"won"|"lost"|"closed";
const statuses = ["received","assigned","contacted","proposal_sent","negotiating","won","lost","closed"] as const;
const transitions:Record<Status,readonly Status[]> = {
  received:["assigned","closed"], assigned:["contacted","lost","closed"],
  contacted:["proposal_sent","negotiating","lost","closed"],
  proposal_sent:["negotiating","won","lost","closed"],
  negotiating:["proposal_sent","won","lost","closed"],
  won:["closed"],lost:["closed"],closed:[]
};
const cookieName=config.isProduction?"__Host-ve_staff":"ve_staff";
function readCookie(req:Request):string|null{
  const part=(req.headers.cookie??"").split(";").map(x=>x.trim()).find(x=>x.startsWith(cookieName+"="));
  if(!part)return null;
  try{return decodeURIComponent(part.slice(cookieName.length+1));}catch{return null;}
}
const enabled:RequestHandler=(_req,res,next)=>{
  if(!config.staffPortalEnabled && config.nodeEnv!=="test"){res.status(404).json({error:"not_found"});return;}
  next();
};
const requireStaff:RequestHandler=async(req,res,next)=>{
  const token=readCookie(req);
  if(!token||!/^[A-Za-z0-9_-]{35,64}$/.test(token)){res.status(401).json({error:"staff_auth_required"});return;}
  try{
    const result=await pool.query<{id:string;full_name:string;role:Role}>(
      "SELECT u.id,u.full_name,u.role FROM staff_sessions s JOIN staff_users u ON u.id=s.staff_id WHERE s.token_hash=$1 AND s.expires_at>NOW() AND u.active=TRUE LIMIT 1",
      [hashSessionToken(token)]);
    const row=result.rows[0];
    if(!row){res.status(401).json({error:"staff_session_expired"});return;}
    (req as StaffRequest).staff={id:row.id,fullName:row.full_name,role:row.role};
    next();
  }catch(e){next(e);}
};
const managerOnly:RequestHandler=(req,res,next)=>{
  if((req as StaffRequest).staff?.role!=="manager"){res.status(403).json({error:"staff_manager_required"});return;}
  next();
};
const emailSchema=z.object({email:z.email().max(254).transform(v=>v.trim().toLowerCase())}).strict();
const tokenSchema=z.object({token:z.string().regex(/^[A-Za-z0-9_-]{35,64}$/)}).strict();
const changeSchema=z.object({
  status:z.enum(["assigned","contacted","proposal_sent","negotiating","won","lost","closed"]).optional(),
  assignedStaffId:z.uuid().nullable().optional(),
  reason:z.string().trim().min(10).max(1000)
}).strict().refine(v=>v.status!==undefined||v.assignedStaffId!==undefined);
const activitySchema=z.object({
  kind:z.enum(["call","email","meeting","note"]),
  note:z.string().trim().min(10).max(1000),
  followUpAt:z.string().datetime({offset:true}).nullable().optional()
}).strict();
export const staffRouter=Router();
staffRouter.use(enabled);
staffRouter.post("/request-access",rateLimit({windowMs:15*60_000,limit:5,standardHeaders:"draft-8",legacyHeaders:false}),async(req,res,next)=>{
  const parsed=emailSchema.safeParse(req.body);
  if(!parsed.success){res.status(400).json({error:"invalid_email"});return;}
  if(!mailConfigured()){res.status(503).json({error:"mail_unavailable"});return;}
  try{
    const found=await pool.query<{id:string}>("SELECT id FROM staff_users WHERE email=$1 AND active=TRUE LIMIT 1",[parsed.data.email]);
    if(found.rows[0]){
      const staffId=found.rows[0].id;
      const client=await pool.connect();
      let token:string|null=null;
      try{
        await client.query("BEGIN");
        // Serialize access issuance against revocation and concurrent requests.
        const locked=await client.query<{id:string}>(
          "SELECT id FROM staff_users WHERE id=$1 AND active=TRUE FOR UPDATE",[staffId]);
        if(!locked.rows[0]){await client.query("COMMIT");res.status(202).json({
          message:"Se seu acesso estiver habilitado, um link sera enviado ao e-mail institucional."});return;}
        const recent=await client.query<{recent:boolean}>(
          "SELECT EXISTS(SELECT 1 FROM staff_login_tokens WHERE staff_id=$1 AND consumed_at IS NULL AND created_at>NOW()-INTERVAL '60 seconds') AS recent",
          [staffId]);
        if(!recent.rows[0]?.recent){
          token=createSessionToken();
          await client.query("UPDATE staff_login_tokens SET consumed_at=NOW() WHERE staff_id=$1 AND consumed_at IS NULL",[staffId]);
          await client.query("INSERT INTO staff_login_tokens(staff_id,token_hash,expires_at) VALUES($1,$2,NOW()+INTERVAL '15 minutes')",[staffId,hashSessionToken(token)]);
        }
        await client.query("COMMIT");
      }catch(e){await client.query("ROLLBACK");throw e;}
      finally{client.release();}
      if(token){
        try{await sendActionMail(parsed.data.email,"staff_access",token);}
        catch{
          // Do not retain an undelivered login credential or block an immediate retry.
          await pool.query(
            "UPDATE staff_login_tokens SET consumed_at=NOW() WHERE staff_id=$1 AND token_hash=$2 AND consumed_at IS NULL",
            [staffId,hashSessionToken(token)]);
        }
      }
    }
    res.status(202).json({message:"Se seu acesso estiver habilitado, um link sera enviado ao e-mail institucional."});
  }catch(e){next(e);}
});
staffRouter.post("/verify-access",rateLimit({windowMs:15*60_000,limit:10,standardHeaders:"draft-8",legacyHeaders:false}),async(req,res,next)=>{
  const parsed=tokenSchema.safeParse(req.body);
  if(!parsed.success){res.status(400).json({error:"invalid_token"});return;}
  const client=await pool.connect();
  try{
    await client.query("BEGIN");
    // Lock the identity itself before consuming a token. Concurrent revocation
    // must either wait and remove the new session or win and block this login.
    const identity=await client.query<{staff_id:string}>(
      "SELECT u.id AS staff_id FROM staff_users u JOIN staff_login_tokens t ON t.staff_id=u.id WHERE t.token_hash=$1 AND t.consumed_at IS NULL AND t.expires_at>NOW() AND u.active=TRUE FOR UPDATE OF u",
      [hashSessionToken(parsed.data.token)]);
    if(!identity.rows[0]){await client.query("ROLLBACK");res.status(401).json({error:"invalid_or_expired_token"});return;}
    const found=await client.query<{staff_id:string}>(
      "UPDATE staff_login_tokens SET consumed_at=NOW() WHERE token_hash=$1 AND consumed_at IS NULL AND expires_at>NOW() AND staff_id IN (SELECT id FROM staff_users WHERE active=TRUE) RETURNING staff_id",
      [hashSessionToken(parsed.data.token)]);
    if(!found.rows[0]){await client.query("ROLLBACK");res.status(401).json({error:"invalid_or_expired_token"});return;}
    const token=createSessionToken();
    await client.query("INSERT INTO staff_sessions(token_hash,staff_id,expires_at) VALUES($1,$2,NOW()+INTERVAL '12 hours')",[hashSessionToken(token),found.rows[0].staff_id]);
    await client.query("COMMIT");
    res.cookie(cookieName,token,{httpOnly:true,secure:config.isProduction,sameSite:"strict",path:"/",maxAge:12*3600_000});
    res.json({authenticated:true});
  }catch(e){await client.query("ROLLBACK");next(e);}
  finally{client.release();}
});
staffRouter.post("/logout",async(req,res,next)=>{
  const token=readCookie(req);
  try{
    if(token&&/^[A-Za-z0-9_-]{35,64}$/.test(token))await pool.query("DELETE FROM staff_sessions WHERE token_hash=$1",[hashSessionToken(token)]);
    res.clearCookie(cookieName,{httpOnly:true,secure:config.isProduction,sameSite:"strict",path:"/"});
    res.json({ok:true});
  }catch(e){next(e);}
});
staffRouter.get("/me",requireStaff,(req,res)=>res.json({staff:(req as StaffRequest).staff}));
staffRouter.get("/team",requireStaff,managerOnly,async(_req,res,next)=>{
  try{
    const result=await pool.query("SELECT id,full_name,role FROM staff_users WHERE active=TRUE ORDER BY full_name LIMIT 200");
    res.json({staff:result.rows});
  }catch(e){next(e);}
});
staffRouter.get("/overview",requireStaff,async(req,res,next)=>{
  const staff=(req as StaffRequest).staff!;
  try{
    const result=await pool.query<{status:string;total:number;overdue:number}>(
      "SELECT status,COUNT(*)::integer AS total,COUNT(*) FILTER(WHERE status IN ('received','assigned') AND created_at<NOW()-INTERVAL '48 hours')::integer AS overdue FROM commercial_leads WHERE anonymized_at IS NULL AND ($1::boolean OR assigned_staff_id=$2) GROUP BY status ORDER BY status",
      [staff.role==="manager",staff.id]);
    const followups=await pool.query<{due:number;scheduled:number}>(
      "SELECT COUNT(*) FILTER (WHERE next_followup_at<=NOW())::integer AS due,"+
      "COUNT(*) FILTER (WHERE next_followup_at>NOW())::integer AS scheduled "+
      "FROM commercial_leads WHERE anonymized_at IS NULL "+
      "AND status NOT IN ('won','lost','closed') AND ($1::boolean OR assigned_staff_id=$2)",
      [staff.role==="manager",staff.id]);
    res.json({statuses:result.rows,overdue:result.rows.reduce((n,r)=>n+r.overdue,0),
      dueFollowups:followups.rows[0]?.due??0,scheduledFollowups:followups.rows[0]?.scheduled??0,
      slaBasis:"indicative_48_calendar_hours"});
  }catch(e){next(e);}
});
const leadCursorSchema=z.object({t:z.string().datetime({offset:true}),id:z.uuid()}).strict();
staffRouter.get("/notifications/status",requireStaff,managerOnly,async(_req,res,next)=>{
  try{
    const result=await pool.query<{state:string;total:number}>(
      "SELECT state,COUNT(*)::integer AS total FROM commercial_notification_outbox GROUP BY state");
    const counts={pending:0,sent:0,dead:0,cancelled:0};
    for(const row of result.rows)if(row.state in counts)
      counts[row.state as keyof typeof counts]=row.total;
    res.json({counts,deliveryEnabled:process.env.NOTIFICATION_DELIVERY_ENABLED==="true",relayConfigured:mailConfigured()});
  }catch(e){next(e);}
});
staffRouter.get("/leads",requireStaff,async(req,res,next)=>{
  const state=req.query.status===undefined?null:z.enum(statuses).safeParse(req.query.status);
  if(state!==null&&!state.success){res.status(400).json({error:"invalid_status"});return;}
  const followup=req.query.followup===undefined?null:z.enum(["due","scheduled","none"]).safeParse(req.query.followup);
  if(followup!==null&&!followup.success){res.status(400).json({error:"invalid_followup_filter"});return;}
  let cursor:{t:string;id:string}|null=null;
  if(req.query.cursor!==undefined){
    if(typeof req.query.cursor!=="string"||req.query.cursor.length>256){
      res.status(400).json({error:"invalid_cursor"});return;
    }
    try{
      const parsed=leadCursorSchema.parse(JSON.parse(Buffer.from(req.query.cursor,"base64url").toString("utf8")));
      cursor=parsed;
    }catch{res.status(400).json({error:"invalid_cursor"});return;}
  }
  const staff=(req as StaffRequest).staff!;
  try{
    const result=await pool.query<{
      id:string;created_at:string;company_name:string;contact_name:string;
      contact_email:string;contact_phone:string|null;status:Status;
      updated_at:string;next_followup_at:string|null;assigned_staff_id:string|null;
      assigned_staff_name:string|null;courses:number
    }>(
      // pg's default timestamp parser returns JS Date (millisecond precision).
      // Serialize at the source to preserve the full six PostgreSQL digits.
      "SELECT l.id,l.company_name,l.contact_name,l.contact_email,l.contact_phone,l.status,"+
      "to_char(l.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') AS created_at,"+
      "l.updated_at,l.next_followup_at,l.assigned_staff_id,u.full_name AS assigned_staff_name,jsonb_array_length(l.items)::integer AS courses "+
      "FROM commercial_leads l LEFT JOIN staff_users u ON u.id=l.assigned_staff_id "+
      "WHERE l.anonymized_at IS NULL AND ($1::text IS NULL OR l.status=$1) AND ($2::boolean OR l.assigned_staff_id=$3) "+
      "AND ($4::timestamptz IS NULL OR (l.created_at,l.id) < ($4::timestamptz,$5::uuid)) "+
      "AND ($6::text IS NULL OR ($6='due' AND l.next_followup_at<=NOW() AND l.status NOT IN ('won','lost','closed')) "+
      "OR ($6='scheduled' AND l.next_followup_at>NOW() AND l.status NOT IN ('won','lost','closed')) "+
      "OR ($6='none' AND l.next_followup_at IS NULL)) "+
      "ORDER BY l.created_at DESC,l.id DESC LIMIT 51",
      [state===null?null:state.data,staff.role==="manager",staff.id,cursor?.t??null,cursor?.id??null,
        followup===null?null:followup.data]);
    const leads=result.rows.slice(0,50);
    const last=leads.at(-1);
    const nextCursor=result.rows.length>50&&last
      ?Buffer.from(JSON.stringify({t:last.created_at,id:last.id})).toString("base64url")
      :null;
    res.json({leads,limit:50,nextCursor});
  }catch(e){next(e);}
});
staffRouter.get("/leads/:id",requireStaff,async(req,res,next)=>{
  const id=z.uuid().safeParse(req.params.id);
  if(!id.success){res.status(400).json({error:"invalid_lead_id"});return;}
  const staff=(req as StaffRequest).staff!;
  try{
    const found=await pool.query(
      "SELECT id,company_name,contact_name,contact_email,contact_phone,message,items,status,created_at,updated_at,next_followup_at,assigned_staff_id FROM commercial_leads WHERE id=$1 AND anonymized_at IS NULL AND ($2::boolean OR assigned_staff_id=$3)",
      [id.data,staff.role==="manager",staff.id]);
    if(!found.rows[0]){res.status(404).json({error:"lead_not_found"});return;}
    const events=await pool.query("SELECT event_type,created_at,metadata FROM commercial_lead_events WHERE lead_id=$1 ORDER BY id DESC LIMIT 100",[id.data]);
    res.json({lead:found.rows[0],events:events.rows});
  }catch(e){next(e);}
});
staffRouter.patch("/leads/:id",requireStaff,async(req,res,next)=>{
  const id=z.uuid().safeParse(req.params.id);
  const parsed=changeSchema.safeParse(req.body);
  if(!id.success||!parsed.success){res.status(400).json({error:"invalid_change"});return;}
  const staff=(req as StaffRequest).staff!;
  if(parsed.data.assignedStaffId!==undefined&&staff.role!=="manager"){res.status(403).json({error:"manager_required_for_assignment"});return;}
  const client=await pool.connect();
  try{
    await client.query("BEGIN");
    // Serialize role/access changes with the staff action; stale sessions cannot
    // continue writing after a concurrent grant/revoke transaction commits.
    const identity=await client.query<{active:boolean;role:Role}>(
      "SELECT active,role FROM staff_users WHERE id=$1 FOR SHARE",[staff.id]);
    if(!identity.rows[0]?.active||identity.rows[0].role!==staff.role){
      await client.query("ROLLBACK");res.status(401).json({error:"staff_session_revoked"});return;
    }
    const found=await client.query<{status:Status;assigned_staff_id:string|null;next_followup_at:Date|null}>("SELECT status,assigned_staff_id,next_followup_at FROM commercial_leads WHERE id=$1 AND anonymized_at IS NULL FOR UPDATE",[id.data]);
    const lead=found.rows[0];
    if(!lead||(staff.role!=="manager"&&lead.assigned_staff_id!==staff.id)){
      await client.query("ROLLBACK");res.status(404).json({error:"lead_not_found"});return;
    }
    const newStatus=parsed.data.status??lead.status;
    const newAssignee=parsed.data.assignedStaffId===undefined?lead.assigned_staff_id:parsed.data.assignedStaffId;
    if(newStatus===lead.status&&newAssignee===lead.assigned_staff_id){
      await client.query("ROLLBACK");res.status(409).json({error:"no_change"});return;
    }
    if(newStatus!==lead.status&&!transitions[lead.status].includes(newStatus)){
      await client.query("ROLLBACK");res.status(409).json({error:"invalid_transition"});return;
    }
    if(newStatus==="assigned"&&!newAssignee){
      await client.query("ROLLBACK");res.status(409).json({error:"assignee_required"});return;
    }
    if(newAssignee){
      const active=await client.query("SELECT id FROM staff_users WHERE id=$1 AND active=TRUE",[newAssignee]);
      if(!active.rows[0]){await client.query("ROLLBACK");res.status(409).json({error:"invalid_assignee"});return;}
    }
    await client.query(
      "UPDATE commercial_leads SET status=$1,assigned_staff_id=$2,updated_at=NOW(),"+
      "next_followup_at=CASE WHEN $1 IN ('won','lost','closed') THEN NULL ELSE next_followup_at END WHERE id=$3",
      [newStatus,newAssignee,id.data]);
    const event=await client.query<{id:string}>(
      "INSERT INTO commercial_lead_events(lead_id,event_type,actor_staff_id,metadata) VALUES($1,'staff_update',$2,$3::jsonb) RETURNING id::text",
      [id.data,staff.id,JSON.stringify({from:lead.status,to:newStatus,assignedStaffId:newAssignee,
        reason:parsed.data.reason,followupCleared:Boolean(lead.next_followup_at&&["won","lost","closed"].includes(newStatus))})]);
    if(newAssignee&&newAssignee!==lead.assigned_staff_id){
      await client.query(
        "INSERT INTO commercial_notification_outbox(lead_id,recipient_staff_id,kind,dedupe_key) "+
        "VALUES($1,$2,'assigned',$3) ON CONFLICT(dedupe_key) DO NOTHING",
        [id.data,newAssignee,"assigned:"+id.data+":"+event.rows[0]!.id]);
    }
    await client.query("COMMIT");
    res.json({id:id.data,status:newStatus,assignedStaffId:newAssignee});
  }catch(e){await client.query("ROLLBACK");next(e);}
  finally{client.release();}
});

// Record operational interactions independently of the sales pipeline status.
// This makes multiple contact attempts and next actions auditable without fake transitions.
staffRouter.post("/leads/:id/activities",requireStaff,async(req,res,next)=>{
  const id=z.uuid().safeParse(req.params.id);
  const parsed=activitySchema.safeParse(req.body);
  if(!id.success||!parsed.success){res.status(400).json({error:"invalid_activity"});return;}
  const requested=parsed.data.followUpAt;
  if(requested){
    const at=Date.parse(requested);
    if(!Number.isFinite(at)||at<Date.now()-5*60_000||at>Date.now()+365*24*3600_000){
      res.status(400).json({error:"invalid_followup_date"});return;
    }
  }
  const staff=(req as StaffRequest).staff!;
  const client=await pool.connect();
  try{
    await client.query("BEGIN");
    const identity=await client.query<{role:Role}>(
      "SELECT role FROM staff_users WHERE id=$1 AND active=TRUE FOR SHARE",[staff.id]);
    if(!identity.rows[0]||identity.rows[0].role!==staff.role){
      await client.query("ROLLBACK");res.status(401).json({error:"staff_session_revoked"});return;
    }
    const found=await client.query<{status:Status;assigned_staff_id:string|null;next_followup_at:Date|null}>(
      "SELECT status,assigned_staff_id,next_followup_at FROM commercial_leads "+
      "WHERE id=$1 AND anonymized_at IS NULL FOR UPDATE",[id.data]);
    const lead=found.rows[0];
    if(!lead||(staff.role!=="manager"&&lead.assigned_staff_id!==staff.id)){
      await client.query("ROLLBACK");res.status(404).json({error:"lead_not_found"});return;
    }
    if(requested!==undefined&&requested!==null&&["won","lost","closed"].includes(lead.status)){
      await client.query("ROLLBACK");res.status(409).json({error:"terminal_lead_followup"});return;
    }
    let nextFollowupAt=lead.next_followup_at?.toISOString()??null;
    if(requested!==undefined){
      const result=await client.query<{next_followup_at:Date|null}>(
        "UPDATE commercial_leads SET next_followup_at=$1::timestamptz,updated_at=NOW() "+
        "WHERE id=$2 RETURNING next_followup_at",[requested,id.data]);
      nextFollowupAt=result.rows[0]?.next_followup_at?.toISOString()??null;
    }else{
      await client.query("UPDATE commercial_leads SET updated_at=NOW() WHERE id=$1",[id.data]);
    }
    const event=await client.query<{id:string}>(
      "INSERT INTO commercial_lead_events(lead_id,event_type,actor_staff_id,metadata) "+
      "VALUES($1,'staff_activity',$2,$3::jsonb) RETURNING id::text",
      [id.data,staff.id,JSON.stringify({kind:parsed.data.kind,note:parsed.data.note,
        ...(requested!==undefined?{followUpAt:nextFollowupAt}:{})})]);
    await client.query("COMMIT");
    res.status(201).json({id:event.rows[0]!.id,nextFollowupAt});
  }catch(e){await client.query("ROLLBACK");next(e);}
  finally{client.release();}
});
