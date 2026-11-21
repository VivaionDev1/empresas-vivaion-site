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
        const recent=await client.query<{recent:boolean}>(
          "SELECT EXISTS(SELECT 1 FROM staff_login_tokens WHERE staff_id=$1 AND created_at>NOW()-INTERVAL '60 seconds') AS recent",
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
        catch{/* Response does not reveal whether a staff identity exists. */}
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
      "SELECT status,COUNT(*)::integer AS total,COUNT(*) FILTER(WHERE status IN ('received','assigned') AND created_at<NOW()-INTERVAL '48 hours')::integer AS overdue FROM commercial_leads WHERE ($1::boolean OR assigned_staff_id=$2) GROUP BY status ORDER BY status",
      [staff.role==="manager",staff.id]);
    res.json({statuses:result.rows,overdue:result.rows.reduce((n,r)=>n+r.overdue,0),slaBasis:"indicative_48_calendar_hours"});
  }catch(e){next(e);}
});
staffRouter.get("/leads",requireStaff,async(req,res,next)=>{
  const state=req.query.status===undefined?null:z.enum(statuses).safeParse(req.query.status);
  if(state!==null&&!state.success){res.status(400).json({error:"invalid_status"});return;}
  const staff=(req as StaffRequest).staff!;
  try{
    const result=await pool.query(
      "SELECT l.id,l.company_name,l.contact_name,l.contact_email,l.contact_phone,l.status,l.created_at,l.updated_at,l.assigned_staff_id,u.full_name AS assigned_staff_name,jsonb_array_length(l.items)::integer AS courses FROM commercial_leads l LEFT JOIN staff_users u ON u.id=l.assigned_staff_id WHERE ($1::text IS NULL OR l.status=$1) AND ($2::boolean OR l.assigned_staff_id=$3) ORDER BY l.created_at DESC,l.id DESC LIMIT 50",
      [state===null?null:state.data,staff.role==="manager",staff.id]);
    res.json({leads:result.rows,limit:50});
  }catch(e){next(e);}
});
staffRouter.get("/leads/:id",requireStaff,async(req,res,next)=>{
  const id=z.uuid().safeParse(req.params.id);
  if(!id.success){res.status(400).json({error:"invalid_lead_id"});return;}
  const staff=(req as StaffRequest).staff!;
  try{
    const found=await pool.query(
      "SELECT id,company_name,contact_name,contact_email,contact_phone,message,items,status,created_at,updated_at,assigned_staff_id FROM commercial_leads WHERE id=$1 AND ($2::boolean OR assigned_staff_id=$3)",
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
    const found=await client.query<{status:Status;assigned_staff_id:string|null}>("SELECT status,assigned_staff_id FROM commercial_leads WHERE id=$1 FOR UPDATE",[id.data]);
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
    await client.query("UPDATE commercial_leads SET status=$1,assigned_staff_id=$2,updated_at=NOW() WHERE id=$3",[newStatus,newAssignee,id.data]);
    await client.query(
      "INSERT INTO commercial_lead_events(lead_id,event_type,actor_staff_id,metadata) VALUES($1,'staff_update',$2,$3::jsonb)",
      [id.data,staff.id,JSON.stringify({from:lead.status,to:newStatus,assignedStaffId:newAssignee,reason:parsed.data.reason})]);
    await client.query("COMMIT");
    res.json({id:id.data,status:newStatus,assignedStaffId:newAssignee});
  }catch(e){await client.query("ROLLBACK");next(e);}
  finally{client.release();}
});
