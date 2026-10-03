import { env } from "cloudflare:workers";
import { db } from "./game-server";
import { identify,rate } from "./account-auth";
import { mailConfigured,sendVerificationEmail } from "./smtp-mail";
import { GameError } from "./game-error";
import type { AccountRole,EmailPurpose,EmailCodeResult,AccountEmailBindResult } from "./account-types";

type Row=Record<string,unknown>;
export type EmailProof={challengeId:string;role:AccountRole;email:string;purpose:EmailPurpose;codeHash:string};
const CLOCK="CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)",LIFETIME=300000;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ADDRESS=/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/;
const FAILURE="邮箱验证码无效、已使用或已过期，请重新获取";
function role(value:unknown):AccountRole{if(!['player','merchant','admin'].includes(String(value)))throw new GameError("账号身份不正确");return value as AccountRole;}
function purpose(value:unknown):EmailPurpose{if(value==='login')throw new GameError("邮箱验证码登录已停用，请使用邮箱和密码登录",410);if(!['register','bind'].includes(String(value)))throw new GameError("邮箱验证码用途不正确");return value as EmailPurpose;}
function uuid(value:unknown){if(typeof value!=='string'||!UUID.test(value.toLowerCase()))throw new GameError("邮箱验证码请求标识不正确");return value.toLowerCase();}
export function normalizeEmail(value:unknown){const email=typeof value==='string'?value.trim().toLowerCase():'';if(email.length>254||!ADDRESS.test(email))throw new GameError("请填写有效邮箱地址");return email;}
async function available(){
  if(!mailConfigured())throw new GameError("邮箱发信服务尚未配置，暂时无法验证注册或绑定邮箱；已有账号可用密码登录",503);
  try{await db().prepare('SELECT email FROM accounts LIMIT 1').first();await db().prepare('SELECT id FROM email_challenges LIMIT 1').first();}
  catch{throw new GameError("邮箱账号服务暂未就绪，请联系运营",503);}
}
async function digest(challengeId:string,accountRole:AccountRole,email:string,use:EmailPurpose,code:string){
  const secret=(env as unknown as Record<string,unknown>).MAIL_PASS;
  if(typeof secret!=='string'||!secret)throw new GameError("邮箱发信服务尚未配置",503);
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  return Array.from(new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(JSON.stringify(['email-otp:v1',challengeId,accountRole,email,use,code])))),b=>b.toString(16).padStart(2,'0')).join('');
}
function randomCode(){const bytes=new Uint32Array(1),limit=Math.floor(4294967296/1000000)*1000000;do{crypto.getRandomValues(bytes);}while(bytes[0]>=limit);return String(bytes[0]%1000000).padStart(6,'0');}
const response=(row:Row):EmailCodeResult=>({challengeId:String(row.id),expiresAt:Number(row.expires_at),retryAfter:60,message:"验证码邮件已发送，请在5分钟内填写"});
function sent(row:Row):EmailCodeResult{
  if(row.send_status==='sent'&&Number(row.expires_at)>Date.now()&&row.consumed_at==null)return response(row);
  if(row.send_status==='pending')throw new GameError("验证码邮件发送结果尚未确认，请稍后再试；同一请求不会重复发送",409);
  // A persisted failure is a known result. Keep the first transport failure
  // uncertain, but let an explicit replay release the client's original UUID.
  if(row.send_status==='failed')throw new GameError("原验证码请求已失败，请使用新的请求重新获取",409);
  throw new GameError("此验证码请求已失效，请使用新的请求重新获取",409);
}
export async function emailCodeSend(req:Request,input:Row):Promise<EmailCodeResult>{
  const accountRole=role(input.role),email=normalizeEmail(input.email),use=purpose(input.purpose),requestId=uuid(input.requestId);await available();
  const old=await db().prepare('SELECT * FROM email_challenges WHERE id=?').bind(requestId).first<Row>();
  if(old){if(old.role!==accountRole||old.email!==email||old.purpose!==use)throw new GameError("验证码请求与原邮箱、身份或用途不一致",409);return sent(old);}
  // Mail and origin budgets are shared across all roles and purposes. Reading a
  // known UUID above recovers its outcome without sending a second message.
  await rate(req,'email-send',email,6,3600000);
  const code=randomCode(),codeHash=await digest(requestId,accountRole,email,use,code);
  const inserted=await db().prepare(`INSERT INTO email_challenges(id,role,email,purpose,code_hash,send_status,created_at,expires_at,attempts)
    SELECT ?,?,?,?,?,'pending',${CLOCK},${CLOCK}+?,0 WHERE NOT EXISTS(SELECT 1 FROM email_challenges WHERE email=? AND created_at>${CLOCK}-60000)
    ON CONFLICT DO NOTHING`).bind(requestId,accountRole,email,use,codeHash,LIFETIME,email).run();
  if(!inserted.meta.changes){const existing=await db().prepare('SELECT * FROM email_challenges WHERE id=?').bind(requestId).first<Row>();if(existing&&existing.role===accountRole&&existing.email===email&&existing.purpose===use)return sent(existing);throw new GameError("验证码已申请，请等待60秒后再获取",429);}
  try{await sendVerificationEmail(email,code,use,accountRole);}
  catch{await db().prepare("UPDATE email_challenges SET send_status='failed' WHERE id=? AND code_hash=? AND send_status='pending'").bind(requestId,codeHash).run();throw new GameError("验证码邮件暂时无法发送，暂时无法验证注册或绑定邮箱；已有账号可用密码登录",503);}
  const publication=await db().batch([
    db().prepare(`UPDATE email_challenges SET send_status='sent' WHERE id=? AND code_hash=? AND send_status='pending' AND expires_at>${CLOCK} AND consumed_at IS NULL
      AND NOT EXISTS(SELECT 1 FROM email_challenges newer WHERE newer.role=email_challenges.role AND newer.email=email_challenges.email
        AND newer.purpose=email_challenges.purpose AND newer.created_at>email_challenges.created_at AND newer.send_status='sent')`).bind(requestId,codeHash),
    db().prepare(`UPDATE email_challenges SET send_status='failed' WHERE id<>? AND role=? AND email=? AND purpose=? AND consumed_at IS NULL
      AND send_status IN ('pending','sent') AND created_at<(SELECT created_at FROM email_challenges WHERE id=? AND send_status='sent')`)
      .bind(requestId,accountRole,email,use,requestId),
  ]);
  if(!publication[0].meta.changes){await db().prepare("UPDATE email_challenges SET send_status='failed' WHERE id=? AND send_status='pending'").bind(requestId).run();throw new GameError("邮件发送期间验证码已失效或被新的验证码替代，请重新获取",503);}
  const saved=await db().prepare('SELECT * FROM email_challenges WHERE id=?').bind(requestId).first<Row>();
  if(!saved)throw new GameError("验证码请求已失效，请重新获取",503);return sent(saved);
}
export async function verifyEmailProof(req:Request,input:{role:unknown;email:unknown;purpose:unknown;code:unknown;challengeId:unknown}):Promise<EmailProof>{
  const accountRole=role(input.role),email=normalizeEmail(input.email),use=purpose(input.purpose),challengeId=uuid(input.challengeId);await available();
  await rate(req,'email-verify',email,30,900000);
  if(typeof input.code!=='string'||!/^\d{6}$/.test(input.code))throw new GameError(FAILURE);
  const codeHash=await digest(challengeId,accountRole,email,use,input.code);
  await db().prepare(`UPDATE email_challenges SET attempts=attempts+1 WHERE id=? AND role=? AND email=? AND purpose=? AND send_status='sent'
    AND consumed_at IS NULL AND expires_at>${CLOCK} AND attempts<5 AND code_hash<>?`).bind(challengeId,accountRole,email,use,codeHash).run();
  const row=await db().prepare(`SELECT id FROM email_challenges WHERE id=? AND role=? AND email=? AND purpose=? AND code_hash=? AND send_status='sent'
    AND consumed_at IS NULL AND attempts<5 AND created_at<=${CLOCK} AND expires_at>${CLOCK}`).bind(challengeId,accountRole,email,use,codeHash).first();
  if(!row)throw new GameError(FAILURE);return {challengeId,role:accountRole,email,purpose:use,codeHash};
}
export function consumeEmailProof(proof:EmailProof,nonce:string,extraSQL='1',extraValues:(string|number|null)[]=[]){
  return db().prepare(`UPDATE email_challenges SET consumed_at=${CLOCK},consume_token=? WHERE id=? AND role=? AND email=? AND purpose=? AND code_hash=?
    AND send_status='sent' AND consumed_at IS NULL AND attempts<5 AND created_at<=${CLOCK} AND expires_at>${CLOCK} AND (${extraSQL})`)
    .bind(nonce,proof.challengeId,proof.role,proof.email,proof.purpose,proof.codeHash,...extraValues);
}
export function consumedEmailProof(proof:EmailProof,nonce:string){return {sql:`EXISTS(SELECT 1 FROM email_challenges ec WHERE ec.id=? AND ec.role=? AND ec.email=? AND ec.purpose=? AND ec.code_hash=?
  AND ec.send_status='sent' AND ec.consume_token=? AND ec.consumed_at IS NOT NULL AND ec.consumed_at<ec.expires_at AND ec.attempts<5)`,
  values:[proof.challengeId,proof.role,proof.email,proof.purpose,proof.codeHash,nonce]};}
export async function emailLogin():Promise<never>{
  throw new GameError("邮箱验证码登录已停用，请使用邮箱和密码登录",410);
}
export async function accountEmailBind(req:Request,input:Row):Promise<AccountEmailBindResult>{
  const row=await identify(req,input),email=normalizeEmail(input.email);
  // This upgrade endpoint adds a verified mailbox to historical usernames. A
  // newly registered mailbox is the account name and cannot be renamed here.
  if(String(row.username).includes('@')&&row.username!==email)throw new GameError("注册邮箱就是账号，此入口不能更换账号邮箱",409);
  const proof=await verifyEmailProof(req,{...input,email,purpose:'bind'} as {role:unknown;email:unknown;purpose:unknown;code:unknown;challengeId:unknown});
  if(row.role!==proof.role)throw new GameError("邮箱绑定身份不一致",401);
  const nonce=crypto.randomUUID(),guard=consumedEmailProof(proof,nonce),oldEmail=row.email==null?null:String(row.email);
  const owner="EXISTS(SELECT 1 FROM accounts a JOIN players p ON p.id=a.player_id WHERE a.id=? AND a.role=? AND a.player_id=? AND a.username=? AND a.password_hash=? AND a.email IS ? AND a.status=? AND p.banned=0) AND NOT EXISTS(SELECT 1 FROM accounts WHERE role=? AND (email=? OR username=?) AND id<>?)";
  const values=[String(row.id),proof.role,String(row.player_id),String(row.username),String(row.password_hash),oldEmail,String(row.status),proof.role,proof.email,proof.email,String(row.id)];
  const results=await db().batch([consumeEmailProof(proof,nonce,owner,values),db().prepare(`UPDATE accounts SET email=?,
    revision=revision+CASE WHEN email IS ? THEN 0 ELSE 1 END,updated_at=CASE WHEN email IS ? THEN updated_at ELSE ${CLOCK} END
    WHERE id=? AND role=? AND player_id=? AND username=? AND password_hash=? AND email IS ? AND status=? AND EXISTS(SELECT 1 FROM players p WHERE p.id=accounts.player_id AND p.banned=0)
      AND ${guard.sql} AND NOT EXISTS(SELECT 1 FROM accounts other WHERE other.role=accounts.role AND (other.email=? OR other.username=?) AND other.id<>accounts.id)`)
    .bind(proof.email,proof.email,proof.email,String(row.id),proof.role,String(row.player_id),String(row.username),String(row.password_hash),oldEmail,String(row.status),...guard.values,proof.email,proof.email)]);
  if(!results[0].meta.changes||!results[1].meta.changes)throw new GameError("验证码、账号或邮箱绑定状态已改变，请核对后重试",409);
  return {bound:true,role:proof.role,email:proof.email,message:"邮箱已绑定，请使用邮箱和密码登录"};
}
