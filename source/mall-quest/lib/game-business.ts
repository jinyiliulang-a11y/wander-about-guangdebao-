import { db, GameError, staff, session, normalize, TASK_SELECT, task, COUPON_SELECT, coupon } from "./game-server";
import type { Achievement, CouponTemplate, GameSettings, GameState, Store } from "./game-types";
import type { OperationsUser, OperationsUserDetail, OperationsUserPagination, OperationsUserPermissions } from "./operations-user-types";
import { summarizeMerchantCoupons } from "./merchant-stats";
import { readGeofences, saveGeofence } from "./geofence-server";
import { readStoreActivities, readStoreActivity, saveStoreActivity, withdrawStoreActivity, reviewStoreActivity } from "./store-activities";
import { authorizationValues, playerAuthorizationSQL, staffAuthorizationSQL } from "./account-authorization";
import { registeredPlayer } from "./account-auth";
import { validateStoreImageURL } from "./store-image";
import { bindDeviceCoupon } from "./device-coupon-binding";
import { isStoreIcon } from "./store-icons";
import { merchantProfileDraftGet, merchantProfileDraftSave, merchantProfileDraftDelete } from "./merchant-profile-draft-server";

type Row = Record<string, unknown>;
const EVENT = "mall-48h";
const dayMs = 86400000;
export const dayStart = (now: number) => Math.floor((now + 28800000) / dayMs) * dayMs - 28800000;
export const phoneMasked = (phone: unknown) => typeof phone === "string" ? phone.slice(0, 3) + "****" + phone.slice(-4) : null;
const numeric = (value: unknown, min: number, max: number, name: string, integer = true) => {
  const result = typeof value === "number" ? value : NaN;
  if (!Number.isFinite(result) || result < min || result > max || (integer && !Number.isSafeInteger(result)))
    throw new GameError(`${name}格式不正确`);
  return result;
};
const text = (value: unknown, min: number, max: number, name: string) => {
  const result = typeof value === "string" ? value.trim() : "";
  if (result.length < min || result.length > max) throw new GameError(`${name}请填写${min}至${max}字`);
  return result;
};
const timestamp = (value: unknown, name: string) => value == null || value === "" ? null : numeric(value, 1, 8640000000000000, name);
const rows = async (sql: string, ...values: (string | number | null)[]) => (await db().prepare(sql).bind(...values).all<Row>()).results;
export async function settings(): Promise<GameSettings> {
  const row = await db().prepare("SELECT * FROM game_settings WHERE id='main'").first<Row>();
  if (!row) throw new GameError("活动规则暂不可用", 503);
  return { dailyLimit: Number(row.daily_limit), clueCosts: JSON.parse(String(row.clue_costs)),
    contributionRatio: Number(row.contribution_ratio), ugcReview: !!row.ugc_review };
}
export async function allowedPlayer(pid: string) {
  const row = await db().prepare("SELECT banned FROM players WHERE id=?").bind(pid).first<Row>();
  if (!row || row.banned) throw new GameError("此演示账号已停用，请联系运营", 403);
}
export async function recordPlayerActivity(pid: string, now = Date.now()) {
  const day = new Date(dayStart(now)+28800000).toISOString().slice(0,10);
  await db().prepare(`INSERT INTO player_activity(player_id,day,first_seen_at) SELECT id,?,? FROM players
    WHERE id=? AND id<>'mall-curator' AND banned=0 ON CONFLICT(player_id,day) DO NOTHING`).bind(day,now,pid).run();
}
export async function recordStateActivity(req: Request, pid: string) {
  // Management screen bootstrap and polling do not count as player activity.
  const context=req.headers.get('X-Mall-Quest-Context');
  if (context==='workspace' || (context!=='player' && await session(req,true))) return;
  await recordPlayerActivity(pid);
}
export function storeDTO(r: Row): Store {
  return { id: String(r.id),pointMode: r.point_mode as Store["pointMode"], name: String(r.name),floor: String(r.floor),
    area: String(r.area),category: String(r.category),reward: String(r.reward_title),conditions: String(r.conditions),
    artwork: Number(r.artwork),imageURL: String(r.image_url || ""),imageRevision: Number(r.image_revision || 0),stockTotal: Number(r.stock_total),logo: String(r.logo),
    address: String(r.address || r.area),phone: String(r.phone),status: r.status as "active" | "inactive",rating: null };
}
const TEMPLATE_SELECT = `SELECT ct.*,(SELECT COUNT(*) FROM claims c WHERE c.template_id=ct.id) AS issued_count FROM coupon_templates ct`;
export const templateDTO = (r: Row): CouponTemplate => ({ id: String(r.id),storeId: String(r.store_id),title: String(r.title),
  type: r.type as CouponTemplate["type"],value: Number(r.value),minAmount: Number(r.min_amount),totalCount: Number(r.total_count),
  issuedCount: Number(r.issued_count),remaining: Math.max(0,Number(r.total_count)-Number(r.issued_count)),
  validStart: r.valid_start == null ? null : Number(r.valid_start),validEnd: r.valid_end == null ? null : Number(r.valid_end),
  status: r.status as CouponTemplate["status"] });
export async function enrichState(pid: string, base: GameState, accountId: string | null = null): Promise<GameState> {
  const now = Date.now(), start = dayStart(now);
  const [config,p,unlocks,templates,quota,rank,footprints,shares,dates,earned] = await Promise.all([
    settings(),db().prepare(`SELECT p.*,
      (SELECT COALESCE(SUM(delta),0) FROM points_ledger WHERE player_id=p.id AND kind IN ('claim','contribution','achievement') AND delta>0) AS earned,
      (SELECT COALESCE(SUM(delta),0) FROM points_ledger WHERE player_id=p.id AND kind='contribution') AS contribution,
      (SELECT COUNT(*) FROM claims WHERE player_id=p.id AND event_id='mall-48h') AS claim_count FROM players p WHERE p.id=?`).bind(pid).first<Row>(),
    rows("SELECT task_id,clue_index FROM clue_unlocks WHERE player_id=?",pid),
    rows(TEMPLATE_SELECT + " JOIN stores s ON s.id=ct.store_id WHERE s.event_id=? AND s.status='active' AND ct.status='active' AND ct.deleted_at IS NULL",EVENT),
    db().prepare("SELECT COUNT(*) AS n FROM tasks WHERE author_id=? AND created_at>=? AND created_at<?").bind(pid,start,start+dayMs).first<{n:number}>(),
    rows(`SELECT p.id,p.nickname,p.avatar,p.points_balance,COUNT(c.id) AS n FROM players p JOIN claims c ON c.player_id=p.id
      WHERE c.event_id=? AND c.issued_at>=? AND p.banned=0 GROUP BY p.id ORDER BY n DESC,p.points_balance DESC,p.id LIMIT 20`,EVENT,start-6*dayMs),
    rows(`SELECT s.id,s.name,s.logo,s.floor,s.category,MAX(c.issued_at) AS visited_at,COUNT(*) AS n FROM claims c
      JOIN stores s ON s.id=c.store_id WHERE c.player_id=? AND c.event_id=? GROUP BY s.id ORDER BY visited_at DESC`,pid,EVENT),
    db().prepare("SELECT COUNT(*) AS n FROM share_events WHERE player_id=?").bind(pid).first<{n:number}>(),
    rows("SELECT DISTINCT date(issued_at/1000,'unixepoch','+8 hours') AS day FROM claims WHERE player_id=? AND event_id=? ORDER BY day DESC",pid,EVENT),
    rows("SELECT source_id FROM points_ledger WHERE player_id=? AND kind='achievement'",pid),
  ]);
  if (!p) throw new GameError("体验身份暂不可用",401);
  const unlocked = new Set(unlocks.map(r => `${r.task_id}:${r.clue_index}`));
  for (const t of [...base.tasks,...base.placements]) {
    t.clueCosts = config.clueCosts;
    t.unlockedClues = config.clueCosts.map((cost,i) => t.own || cost===0 || unlocked.has(`${t.id}:${i}`));
    t.clues = t.clues.map((clue,i) => t.unlockedClues![i] ? clue : "");
    t.photoURLs = (t.photoURLs || ["","","","",""]).map((photo,i) => t.unlockedClues![i] ? photo : "");
  }
  const account = accountId ? await db().prepare("SELECT id,username,role,phone FROM accounts WHERE id=? AND player_id=? AND status='approved'").bind(accountId,pid).first<{id:string;username:string;role:'player'|'merchant'|'admin';phone:string|null}>() : null;
  const count = Number(p.claim_count);
  const dateSet = new Set(dates.map(r=>String(r.day)));
  let streak = 0;
  const streakStart=dateSet.has(new Date(start+28800000).toISOString().slice(0,10))?0:1;
  for (let i=0;i<366;i++) {
    if (!dateSet.has(new Date(start+28800000-(i+streakStart)*dayMs).toISOString().slice(0,10))) break;
    streak++;
  }
  const unlockedAchievements = new Set(earned.map(r=>String(r.source_id)));
  const specs: [string,string,string,string,number,number,number][] = [
    ["a1","初出茅庐","完成首次寻宝领奖","🌱",count,1,50],
    ["a2","寻宝新手","累计完成五次寻宝领奖","🗺️",count,5,100],
    ["a3","寻宝达人","累计完成十次寻宝领奖","🏆",count,10,200],
    ["a4","连续七日","连续七个自然日完成领奖","🔥",streak,7,150],
    ["a5","金币大师","累计完成五十次寻宝领奖","👑",count,50,500],
    ["a6","分享探索","生成十次站内分享；同任务每天计一次","📣",shares?.n||0,10,120],
  ];
  const achievements: Achievement[] = specs.map(([id,title,desc,icon,progress,target,reward])=>({id,title,desc,icon,progress:unlockedAchievements.has(id)?target:Math.min(progress,target),target,reward,unlocked:unlockedAchievements.has(id)}));
  return { ...base,player:{id:pid,nickname:String(p.nickname),avatar:String(p.avatar),phoneMasked:phoneMasked(account?.phone||p.phone),
      authenticated:account?.role==='player',accountAuthenticated:account?.role==='player',accountId:account?.id,username:account?.username,accountRole:account?.role,banned:!!p.banned,points:Number(p.points_balance),earnedPoints:Number(p.earned),level:Math.floor(Number(p.earned)/100)+1},contribution:Number(p.contribution),
    settings:config,couponTemplates:templates.map(templateDTO),dailyQuota:{used:quota?.n||0,limit:config.dailyLimit,remaining:Math.max(0,config.dailyLimit-(quota?.n||0))},
    achievements,ranking:rank.map((r,i)=>({id:String(r.id),nickname:String(r.nickname),avatar:String(r.avatar),claims:Number(r.n),points:Number(r.points_balance),rank:i+1,isMe:r.id===pid})),
    footprints:footprints.map(r=>({id:String(r.id),storeId:String(r.id),storeName:String(r.name),logo:String(r.logo),floor:String(r.floor),category:String(r.category),visitedAt:Number(r.visited_at),coinsFound:Number(r.n),mall:"演示商场",verified:false})) };
}

async function scopeStore(req: Request, requested?: unknown) {
  const scope = await staff(req);
  const id = scope.role==='merchant' ? scope.store_id : typeof requested==='string' ? requested : null;
  if (!id) throw new GameError("请选择门店");
  if (scope.role==='merchant' && requested!==undefined && requested!==id) throw new GameError("不能操作其他门店",403);
  const s = await db().prepare("SELECT * FROM stores WHERE id=? AND event_id=?").bind(id,EVENT).first<Row>();
  if (!s) throw new GameError("门店不存在",404);
  return s;
}
async function admin(req: Request) { if ((await staff(req)).role!=='admin') throw new GameError("此操作仅限运营",403); }
const summary = (p: Row): OperationsUser => ({ id:String(p.id),nickname:String(p.nickname),phoneMasked:phoneMasked(p.phone),authenticated:!!p.phone||!!p.registered_account,
  points:Number(p.points_balance),level:Math.floor(Number(p.earned||0)/100)+1,banned:!!p.banned,claimCount:Number(p.claim_count||0),createdAt:Number(p.created_at) });
const userStatusPermissions = (id: string, pid: string): OperationsUserPermissions => {
  const protectedIdentity = id===pid || id==='mall-curator';
  return {canChangeStatus:!protectedIdentity,statusReason:protectedIdentity?'不能停用当前运营身份或系统发现官':null};
};
const userDetailPage = (value: unknown, name: string) => value===undefined ? 1 : numeric(value,1,Number.MAX_SAFE_INTEGER,name);
const userDetailPagination = (requested: number, total: number): OperationsUserPagination => {
  const totalPages = Math.max(1,Math.ceil(total/10));
  return {page:Math.min(requested,totalPages),pageSize:10,total,totalPages};
};

async function workbench(req: Request, input: Row) {
  const scope = await staff(req), range = input.range===30||input.range===90 ? Number(input.range):7;
  const now = Date.now(), since = dayStart(now)-(range-1)*dayMs;
  const merchant = scope.role==='merchant', values: (string|number|null)[] = merchant ? [EVENT,scope.store_id]:[EVENT];
  const storeFilter = merchant ? " AND s.id=?" : "";
  const [config,stores,templates,tasks,devices,users,claims,daily,overview] = await Promise.all([
    settings(),rows("SELECT s.* FROM stores s WHERE s.event_id=?"+storeFilter,...values),
    rows(TEMPLATE_SELECT+" JOIN stores s ON s.id=ct.store_id WHERE s.event_id=? AND ct.deleted_at IS NULL"+storeFilter,...values),
    rows(TASK_SELECT+" WHERE s.event_id=? AND t.deleted_at IS NULL"+storeFilter+" ORDER BY t.created_at DESC",...values),
    rows("SELECT h.id,h.store_id,h.enabled,h.bound_task_id,s.name AS store_name FROM hardware_devices h JOIN stores s ON s.id=h.store_id WHERE s.event_id=?"+storeFilter,...values),
    merchant ? Promise.resolve([]) : rows(`SELECT p.*,EXISTS(SELECT 1 FROM accounts a WHERE a.player_id=p.id AND a.status='approved') AS registered_account,(SELECT COALESCE(SUM(delta),0) FROM points_ledger WHERE player_id=p.id AND kind IN ('claim','contribution','achievement') AND delta>0) AS earned,
      (SELECT COUNT(*) FROM claims c WHERE c.player_id=p.id AND c.event_id=?) AS claim_count
      FROM players p WHERE p.id<>'mall-curator' AND (p.nickname LIKE ? ESCAPE '\\' OR COALESCE(p.phone,'') LIKE ? ESCAPE '\\') ORDER BY p.created_at DESC LIMIT 100`,EVENT,
      '%'+String(input.search||'').slice(0,64).replace(/[\\%_]/g,'\\$&')+'%','%'+String(input.search||'').slice(0,64).replace(/[\\%_]/g,'\\$&')+'%'),
    rows("SELECT c.* FROM claims c JOIN stores s ON s.id=c.store_id WHERE c.event_id=?"+storeFilter+" AND c.issued_at>=?",...values,since),
    rows(`SELECT date(c.issued_at/1000,'unixepoch','+8 hours') AS day,COUNT(*) AS n FROM claims c JOIN stores s ON s.id=c.store_id
      WHERE c.event_id=?`+storeFilter+" AND c.issued_at>=? GROUP BY day",...values,since),
    merchant ? Promise.resolve(null) : db().prepare(`SELECT
      (SELECT COUNT(*) FROM players WHERE id<>'mall-curator') AS total_players,
      (SELECT COUNT(*) FROM players p WHERE p.id<>'mall-curator' AND (p.phone IS NOT NULL OR EXISTS(SELECT 1 FROM accounts a WHERE a.player_id=p.id AND a.role='player' AND a.status='approved'))) AS registered_users,
      (SELECT COUNT(DISTINCT player_id) FROM claims WHERE event_id=? AND issued_at>=? AND issued_at<?) AS today_claim_players,
      (SELECT COUNT(*) FROM stores WHERE event_id=? AND status='active') AS store_count,
      (SELECT COUNT(*) FROM stores WHERE event_id=?) AS merchant_count,
      (SELECT COUNT(*) FROM tasks t JOIN stores s ON s.id=t.store_id WHERE s.event_id=? AND s.status='active' AND t.status='published'
        AND t.deleted_at IS NULL AND (t.expires_at IS NULL OR t.expires_at>?)) AS published_tasks,
      (SELECT COUNT(*) FROM player_activity a JOIN players p ON p.id=a.player_id WHERE a.day=? AND p.banned=0 AND p.id<>'mall-curator') AS active_users_today`)
      .bind(EVENT,dayStart(Date.now()),dayStart(Date.now())+dayMs,EVENT,EVENT,EVENT,Date.now(),new Date(dayStart(Date.now())+28800000).toISOString().slice(0,10)).first<Row>(),
  ]);
  const redemptions = await rows(`SELECT date(c.redeemed_at/1000,'unixepoch','+8 hours') AS day,COUNT(*) AS n FROM claims c JOIN stores s ON s.id=c.store_id
    WHERE c.event_id=?`+storeFilter+" AND c.redeemed_at>=? GROUP BY day",...values,since);
  const mappedTasks = tasks.map(r=>({...task(r,"",new Set()),answer:String(r.answer??r.store_answer??'')}));
  const dailyMap = new Map(daily.map(r=>[String(r.day),Number(r.n)]));
  const useMap = new Map(redemptions.map(r=>[String(r.day),Number(r.n)]));
  // Read-only, store/event-scoped coupon aggregates; points never enter the coupon cohort.
  const merchantCoupons = merchant ? await (async () => {
    if (!stores[0]) throw new GameError("门店不存在",404);
    const [counts, couponDaily] = await Promise.all([
      db().prepare(`SELECT COUNT(*) AS reward_issued,
        SUM(CASE WHEN reward_type='coupon' AND issued_at BETWEEN ? AND ? THEN 1 ELSE 0 END) AS issued,
        SUM(CASE WHEN reward_type='coupon' AND issued_at BETWEEN ? AND ? AND (redeemed_at IS NULL OR redeemed_at>?) AND (valid_end IS NULL OR valid_end>?) THEN 1 ELSE 0 END) AS unused,
        SUM(CASE WHEN reward_type='coupon' AND issued_at BETWEEN ? AND ? AND redeemed_at<=? THEN 1 ELSE 0 END) AS redeemed,
        SUM(CASE WHEN reward_type='coupon' AND issued_at BETWEEN ? AND ? AND (redeemed_at IS NULL OR redeemed_at>?) AND valid_end<=? THEN 1 ELSE 0 END) AS expired,
        SUM(CASE WHEN reward_type='coupon' AND issued_at BETWEEN ? AND ? AND (redeemed_at IS NULL OR redeemed_at>?) AND (valid_end IS NULL OR valid_end>?) AND valid_start>? THEN 1 ELSE 0 END) AS upcoming,
        COUNT(DISTINCT CASE WHEN reward_type='coupon' AND issued_at BETWEEN ? AND ? THEN player_id END) AS recipients,
        SUM(CASE WHEN reward_type='coupon' AND issued_at<=? AND redeemed_at BETWEEN ? AND ? THEN 1 ELSE 0 END) AS redemptions
        FROM claims WHERE event_id=? AND store_id=?`)
        .bind(since,now,since,now,now,now,since,now,now,since,now,now,now,since,now,now,now,now,since,now,now,since,now,EVENT,scope.store_id).first<Row>(),
      rows(`SELECT day,SUM(issued) AS issued,SUM(redeemed) AS redeemed FROM (
        SELECT date(issued_at/1000,'unixepoch','+8 hours') AS day,1 AS issued,0 AS redeemed FROM claims
          WHERE event_id=? AND store_id=? AND reward_type='coupon' AND issued_at>=? AND issued_at<=?
        UNION ALL
        SELECT date(redeemed_at/1000,'unixepoch','+8 hours') AS day,0 AS issued,1 AS redeemed FROM claims
          WHERE event_id=? AND store_id=? AND reward_type='coupon' AND redeemed_at>=? AND redeemed_at<=? AND issued_at<=?
        ) GROUP BY day`,EVENT,scope.store_id,since,now,EVENT,scope.store_id,since,now,now),
    ]);
    return summarizeMerchantCoupons({counts:counts || {},templates:templates.map(templateDTO),rewardTotal:Number(stores[0].stock_total),storeEnabled:stores[0].status==='active',since,range,now,daily:couponDaily});
  })() : undefined;
  return { scope:{role:scope.role,storeId:scope.store_id},settings:config,store:merchant ? storeDTO(stores[0]):null,
    stores:stores.map(storeDTO),couponTemplates:templates.map(templateDTO),tasks:mappedTasks,
    devices:devices.map(r=>({id:String(r.id),storeId:String(r.store_id),storeName:String(r.store_name),enabled:!!r.enabled,
      boundTaskId:r.bound_task_id==null?null:String(r.bound_task_id),boundTask:mappedTasks.find(t=>t.id===r.bound_task_id)||null,
      status:!r.enabled ? 'maintenance':r.bound_task_id?'active':'idle',battery:null,lastHeartbeat:null})),
    users:users.map(summary),pendingReviews:merchant?[]:mappedTasks.filter(t=>t.status==='pending').map(t=>({id:t.id,title:t.title,storeId:t.storeId,
      storeName:stores.find(s=>s.id===t.storeId)?.name||'',authorName:t.author,createdAt:t.createdAt,kind:'task'})),
    stats:{range,totalTasks:tasks.length,claims:claims.length,redeemed:[...useMap.values()].reduce((a,b)=>a+b,0),
      ...(merchantCoupons ? {merchantCoupons} : {}),
      distinctPlayers:new Set(claims.map(c=>c.player_id)).size,claimRate:claims.length?Math.round(claims.filter(c=>c.redeemed_at!=null).length/claims.length*1000)/10:0,
      ...(overview ? {totalPlayers:Number(overview.total_players),registeredUsers:Number(overview.registered_users),
        todayClaimPlayers:Number(overview.today_claim_players),storeCount:Number(overview.store_count),merchantCount:Number(overview.merchant_count),
        publishedTasks:Number(overview.published_tasks),activeUsersToday:Number(overview.active_users_today)} : {}),
      consumption:null,daily:Array.from({length:range},(_,i)=>{const date=new Date(since+28800000+i*dayMs).toISOString().slice(0,10);return{date,claims:dailyMap.get(date)||0,redeemed:useMap.get(date)||0};})} };
}

export function taskInput(input: Row, allowPast = false) {
  const title=text(input.title,4,40,"任务标题");
  if (!Array.isArray(input.clues)||input.clues.length!==5) throw new GameError("请填写五条线索");
  const clues=input.clues.map(value=>text(value,4,160,"线索"));
  const difficulty=input.difficulty===undefined?3:numeric(input.difficulty,1,5,"难度");
  const expiresAt=timestamp(input.expiresAt,"任务期限");
  if (!allowPast&&expiresAt!==null&&expiresAt<=Date.now()) throw new GameError("任务期限需晚于当前时间");
  const rewardType=input.rewardType===undefined?'coupon':input.rewardType;
  if (rewardType!=='points'&&rewardType!=='coupon') throw new GameError("奖励类型不正确");
  const rewardValue=rewardType==='points'?numeric(input.rewardValue,10,500,"奖励积分"):50;
  const rewardCouponId=rewardType==='coupon'&&typeof input.rewardCouponId==='string'?input.rewardCouponId:null;
  let photoURLs=['','','','',''];
  if (input.photoURLs!==undefined) {
    if (!Array.isArray(input.photoURLs)||input.photoURLs.length!==5) throw new GameError("线索照片格式不正确");
    photoURLs=input.photoURLs.map(value=>{
      if(value==='')return '';
      if(typeof value!=='string'||!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value))
        throw new GameError("照片仅支持不超过256KB的PNG/JPEG/WebP本地图片");
      const encoded=value.slice(value.indexOf(',')+1),padding=encoded.endsWith('==')?2:encoded.endsWith('=')?1:0;
      if(encoded.length%4!==0||encoded.length/4*3-padding>262144)throw new GameError("照片仅支持不超过256KB的PNG/JPEG/WebP本地图片");
      return value;
    });
    if(new TextEncoder().encode(JSON.stringify(photoURLs)).byteLength>1048576)throw new GameError("五张照片合计不超过1MB");
  }
  return {title,clues,difficulty,expiresAt,rewardType,rewardValue,rewardCouponId,photoURLs};
}

export async function businessAction(req: Request, input: Row, pid: string): Promise<Record<string, unknown> | null> {
  const now=Date.now(), playerAuth=await authorizationValues(req);
  switch(input.action) {
    case 'geofenceState': return readGeofences(input.storeId);
    case 'geofenceSave': return saveGeofence(req,input);
    case 'storeActivities': return readStoreActivities(req,input);
    case 'storeActivityState': return readStoreActivity(req,input);
    case 'storeActivitySave': return saveStoreActivity(req,input,pid);
    case 'storeActivityWithdraw': return withdrawStoreActivity(req,input);
    case 'storeActivityReview': return reviewStoreActivity(req,input);
    case 'workbenchState': return workbench(req,input);
    case 'merchantProfileDraftGet': return merchantProfileDraftGet(req,input);
    case 'merchantProfileDraftSave': return merchantProfileDraftSave(req,input);
    case 'merchantProfileDraftDelete': return merchantProfileDraftDelete(req,input);
    case 'deviceCouponBind': return bindDeviceCoupon(req,input);
    case 'unlockClue': {
      const taskId=text(input.taskId,1,100,"任务"),index=numeric(input.index,0,4,"线索序号");
      const result=await db().prepare(`INSERT INTO clue_unlocks(player_id,task_id,clue_index,cost,created_at)
        SELECT ?,t.id,?,CASE WHEN t.author_id=p.id THEN 0 ELSE CAST(json_extract(gs.clue_costs,'$[' || CAST(? AS INTEGER) || ']') AS INTEGER) END,? FROM tasks t
        JOIN stores s ON s.id=t.store_id JOIN players p ON p.id=? JOIN game_settings gs ON gs.id='main'
        WHERE t.id=? AND t.status='published' AND t.deleted_at IS NULL AND (t.expires_at IS NULL OR t.expires_at>?) AND s.event_id=? AND s.status='active'
        AND p.banned=0 AND (t.author_id=p.id OR p.points_balance>=CAST(json_extract(gs.clue_costs,'$[' || CAST(? AS INTEGER) || ']') AS INTEGER))
        AND ${playerAuthorizationSQL("p.id")}
        ON CONFLICT(player_id,task_id,clue_index) DO NOTHING`).bind(pid,index,index,now,pid,taskId,now,EVENT,index,...playerAuth).run();
      const unlocked=await db().prepare("SELECT cost FROM clue_unlocks WHERE player_id=? AND task_id=? AND clue_index=?").bind(pid,taskId,index).first<Row>();
      if(!result.meta.changes)await registeredPlayer(req);
      if(!unlocked&&!result.meta.changes)throw new GameError("积分不足，或任务已到期/下架");
      return {message:'线索已解锁',cost:Number(unlocked?.cost||0)};
    }
    case 'recordShare': {
      const taskId=text(input.taskId,1,100,"任务"),day=new Date(now+28800000).toISOString().slice(0,10);
      const result=await db().prepare(`INSERT INTO share_events(id,player_id,task_id,day,created_at) SELECT ?,?,?,?,?
        WHERE EXISTS(SELECT 1 FROM tasks t JOIN stores s ON s.id=t.store_id WHERE t.id=? AND t.status='published' AND t.deleted_at IS NULL AND s.event_id=?)
        AND ${playerAuthorizationSQL("?")}
        ON CONFLICT(player_id,task_id,day) DO NOTHING`).bind(crypto.randomUUID(),pid,taskId,day,now,taskId,EVENT,...playerAuth,pid).run();
      if(!result.meta.changes)await registeredPlayer(req);
      return {message:'已记录站内分享生成；没有验证第三方发送或邀请归因'};
    }
    default:return workbenchAction(req,input,pid,now);
  }
}
async function workbenchAction(req:Request,input:Row,pid:string,now:number):Promise<Record<string,unknown>|null> {
  const staffAuth=await authorizationValues(req,true), playerAuth=await authorizationValues(req);
  switch(input.action) {
    case 'taskDelete': {
      const id=text(input.taskId,1,100,'任务标识');
      const permission=`((tasks.author_id=? AND ${playerAuthorizationSQL("tasks.author_id")})
        OR ${staffAuthorizationSQL("tasks.store_id")})
        AND EXISTS(SELECT 1 FROM stores s WHERE s.id=tasks.store_id AND s.event_id=?)`;
      const values=[pid,...playerAuth,...staffAuth,EVENT];
      if(!await db().prepare(`SELECT id FROM tasks WHERE id=? AND ${permission}`).bind(id,...values).first())
        throw new GameError('任务不存在，或没有删除权限',403);
      await db().batch([
        db().prepare(`INSERT INTO task_reviews(id,task_id,reviewer_id,action,note,created_at)
          SELECT ?,id,?,'offline','删除任务；历史领取记录保留',? FROM tasks WHERE id=? AND deleted_at IS NULL AND ${permission}`)
          .bind(crypto.randomUUID(),'delete-'+pid,now,id,...values),
        db().prepare(`UPDATE tasks SET deleted_at=?,status='offline',is_featured=0 WHERE id=? AND deleted_at IS NULL AND ${permission}`)
          .bind(now,id,...values),
        db().prepare(`UPDATE hardware_devices SET bound_task_id=NULL WHERE bound_task_id=?
          AND EXISTS(SELECT 1 FROM tasks WHERE id=? AND deleted_at IS NOT NULL AND ${permission})`).bind(id,id,...values),
      ]);
      if(!await db().prepare(`SELECT id FROM tasks WHERE id=? AND deleted_at IS NOT NULL AND ${permission}`).bind(id,...values).first())
        throw new GameError('权限或任务状态已改变，请刷新后重试',409);
      return {taskId:id,message:'任务已删除；已发奖励与审核记录保留，绑定设备已解绑'};
    }
    case 'couponDelete': {
      const id=text(input.templateId,1,100,'优惠券模板');
      await staff(req);
      const permission=`${staffAuthorizationSQL("coupon_templates.store_id")}
        AND EXISTS(SELECT 1 FROM stores s WHERE s.id=coupon_templates.store_id AND s.event_id=?)`;
      const values=[...staffAuth,EVENT];
      if(!await db().prepare(`SELECT id FROM coupon_templates WHERE id=? AND ${permission}`).bind(id,...values).first())
        throw new GameError('模板不存在，或没有删除权限',403);
      await db().prepare(`UPDATE coupon_templates SET deleted_at=?,status='inactive',updated_at=? WHERE id=? AND deleted_at IS NULL AND ${permission}`)
        .bind(now,now,id,...values).run();
      if(!await db().prepare(`SELECT id FROM coupon_templates WHERE id=? AND deleted_at IS NOT NULL AND ${permission}`).bind(id,...values).first())
        throw new GameError('模板权限或状态已改变，请刷新',409);
      return {templateId:id,message:'优惠券模板已删除；已发券按原条款保留并可核销'};
    }
    case 'feedbackDelete': {
      const id=text(input.feedbackId,1,100,'反馈标识');
      const permission=`player_id=? AND ${playerAuthorizationSQL("feedback.player_id")}`, values=[pid,...playerAuth];
      if(!await db().prepare(`SELECT id FROM feedback WHERE id=? AND ${permission}`).bind(id,...values).first())
        throw new GameError('反馈不存在，或没有删除权限',403);
      await db().prepare(`UPDATE feedback SET deleted_at=? WHERE id=? AND deleted_at IS NULL AND ${permission}`).bind(now,id,...values).run();
      if(!await db().prepare(`SELECT id FROM feedback WHERE id=? AND deleted_at IS NOT NULL AND ${permission}`).bind(id,...values).first())
        throw new GameError('反馈权限已改变，请刷新后重试',409);
      return {feedbackId:id,message:'你的反馈已删除'};
    }
    case 'couponActivate': {
      const id=text(input.templateId,1,100,'优惠券模板');
      await staff(req);
      const old=await db().prepare('SELECT * FROM coupon_templates WHERE id=?').bind(id).first<Row>();
      if(!old)throw new GameError('优惠券模板不存在',404);
      if(old.deleted_at!=null)throw new GameError('模板已删除，请新建模板',409);
      const s=await scopeStore(req,old.store_id);
      const clock="MAX(?,CAST((julianday('now')-2440587.5)*86400000 AS INTEGER))";
      const permission=`${staffAuthorizationSQL("coupon_templates.store_id")}
        AND EXISTS(SELECT 1 FROM stores s WHERE s.id=coupon_templates.store_id AND s.event_id=?)`;
      const eligible=`id=? AND store_id=? AND deleted_at IS NULL AND ${permission}
        AND (valid_end IS NULL OR valid_end>${clock})
        AND total_count>(SELECT COUNT(*) FROM claims WHERE template_id=coupon_templates.id)`;
      const values=[id,String(s.id),...staffAuth,EVENT,now];
      const current=await db().prepare(`SELECT *,
        (SELECT COUNT(*) FROM claims WHERE template_id=coupon_templates.id) AS issued_count
        FROM coupon_templates WHERE id=? AND store_id=? AND deleted_at IS NULL AND ${permission}`)
        .bind(id,String(s.id),...staffAuth,EVENT).first<Row>();
      if(!current)throw new GameError('模板权限或状态已改变，请刷新',409);
      if(current.valid_end!=null&&Number(current.valid_end)<=Date.now())
        throw new GameError('优惠券已到期，请先编辑有效期再启用',409);
      if(Number(current.total_count)<=Number(current.issued_count))
        throw new GameError('优惠券发放额度已用完，请先编辑发放总量再启用',409);
      const result=await db().prepare(`UPDATE coupon_templates SET status='active',updated_at=?
        WHERE status='inactive' AND ${eligible}`).bind(now,...values).run();
      if(!result.meta.changes&&!await db().prepare(`SELECT id FROM coupon_templates WHERE status='active' AND ${eligible}`).bind(...values).first())
        throw new GameError('模板权限、有效期或剩余额度已改变，请刷新；到期或发完的券需先编辑日期或发放总量',409);
      return {templateId:id,message:result.meta.changes?'优惠券已启用，已发券保持原条款':'优惠券已启用'};
    }
    case 'couponCreate':case 'couponUpdate':case 'couponDeactivate': {
      const old=input.action==='couponCreate'?null:await db().prepare('SELECT * FROM coupon_templates WHERE id=?').bind(String(input.templateId||'')).first<Row>();
      if(input.action!=='couponCreate'&&!old)throw new GameError('优惠券模板不存在',404);
      if(old?.deleted_at!=null)throw new GameError('模板已删除，请新建模板',409);
      const s=await scopeStore(req,old?.store_id??input.storeId);
      if(input.action==='couponDeactivate') {
        const result=await db().prepare(`UPDATE coupon_templates SET status='inactive',updated_at=? WHERE id=? AND store_id=? AND deleted_at IS NULL
          AND ${staffAuthorizationSQL("coupon_templates.store_id")}`).bind(now,String(old!.id),String(s.id),...staffAuth).run();
        if(!result.meta.changes)throw new GameError('模板权限或状态已改变，请刷新',409);
        return {message:'模板已停用，已发券保持原条款'};
      }
      const title=text(input.title,2,60,'优惠券名称');
      const type=input.type;
      if(!['discount','cash','gift'].includes(String(type)))throw new GameError('优惠券类型不正确');
      const value=numeric(input.value,0,1000000,'优惠数值',false),minAmount=numeric(input.minAmount,0,1000000,'消费门槛',false);
      if(type==='discount'&&(value<=0||value>=100))throw new GameError('折扣值需大于0且小于100，例如88表示8.8折');
      if(type==='cash'&&(value<=0||minAmount<value))throw new GameError('现金减免需大于0，消费门槛不能低于减免金额');
      const total=numeric(input.totalCount,1,100000,'发放总量'),start=timestamp(input.validStart,'有效期开始'),end=timestamp(input.validEnd,'有效期结束');
      if(start!==null&&end!==null&&start>=end)throw new GameError('开始时间需早于截止时间');
      const status=input.status===undefined?'active':input.status;
      if(status!=='active'&&status!=='inactive')throw new GameError('模板状态不正确');
      const id=old?String(old.id):crypto.randomUUID();
      const result=old?await db().prepare(`UPDATE coupon_templates SET title=?,type=?,value=?,min_amount=?,total_count=?,valid_start=?,valid_end=?,status=?,updated_at=?
        WHERE id=? AND store_id=? AND deleted_at IS NULL AND (SELECT COUNT(*) FROM claims WHERE template_id=?)<=?
        AND ${staffAuthorizationSQL("coupon_templates.store_id")}`)
        .bind(title,String(type),value,minAmount,total,start,end,status,now,id,String(s.id),id,total,...staffAuth).run():
        await db().prepare(`INSERT INTO coupon_templates(id,store_id,title,type,value,min_amount,total_count,valid_start,valid_end,status,created_at,updated_at)
          SELECT ?,s.id,?,?,?,?,?,?,?,?,?,? FROM stores s WHERE s.id=? AND s.event_id=? AND ${staffAuthorizationSQL("s.id")}`)
          .bind(id,title,String(type),value,minAmount,total,start,end,status,now,now,String(s.id),EVENT,...staffAuth).run();
      if(!result.meta.changes)throw new GameError('发放总量不能少于已经发出的券',409);
      return {templateId:id,message:old?'模板已更新；已发券保持原快照':'优惠券模板已创建'};
    }
    case 'merchantProfileSave': {
      const s=await scopeStore(req,input.storeId),name=text(input.name,2,40,'店名'),
        category=text(input.category,1,30,'店铺类别'),floor=text(input.floor,1,10,'楼层'),address=text(input.address,2,120,'地址');
      const requestedLogo=input.logo??s.logo;
      const logo=typeof requestedLogo==='string'&&requestedLogo===s.logo?requestedLogo:text(requestedLogo,1,64,'店铺图标');
      const presetIcon=isStoreIcon(logo);
      if(!presetIcon&&logo!==s.logo)throw new GameError('请从预设图标中选择门店图标');
      const phone=typeof input.phone==='string'?input.phone.trim():'';
      if(phone.length>24||phone&&!/^[+\d\s()-]+$/.test(phone))throw new GameError('联系电话格式不正确');
      const changesImage=input.imageURL!==undefined||input.artwork!==undefined;
      let imageURL=String(s.image_url||""),artwork=Number(s.artwork),revision=Number(s.image_revision||0);
      if(changesImage){
        revision=numeric(input.expectedImageRevision,0,Number.MAX_SAFE_INTEGER,'图片版本');
        if(input.artwork!==undefined)artwork=numeric(input.artwork,0,2,'示例图片');
        if(input.imageURL!==undefined){try{imageURL=validateStoreImageURL(input.imageURL);}catch(error){throw new GameError(error instanceof Error?error.message:'门店图片格式不正确');}}
      }
      const result=await db().prepare(`UPDATE stores SET name=?,logo=?,category=?,floor=?,address=?,phone=? WHERE id=? AND event_id=?
        AND (?=1 OR logo=?) AND ${staffAuthorizationSQL("stores.id")}`).bind(name,logo,category,floor,address,phone,String(s.id),EVENT,presetIcon?1:0,logo,...staffAuth);
      const imageResult=changesImage?await db().prepare(`UPDATE stores SET name=?,logo=?,category=?,floor=?,address=?,phone=?,image_url=?,artwork=?,image_revision=image_revision+1
        WHERE id=? AND event_id=? AND image_revision=? AND (?=1 OR logo=?) AND ${staffAuthorizationSQL("stores.id")}`)
        .bind(name,logo,category,floor,address,phone,imageURL,artwork,String(s.id),EVENT,revision,presetIcon?1:0,logo,...staffAuth).run():await result.run();
      if(!imageResult.meta.changes)throw new GameError('门店权限或图片版本已改变，请刷新资料后重试',409);
      return {message:'商家资料已保存；评分和真实曝光暂无数据'};
    }
    case 'deviceBind':case 'deviceWithdraw':case 'deviceMaintain':case 'deviceResume': {
      const id=text(input.deviceId,3,64,'设备标识'),device=await db().prepare('SELECT id,store_id,enabled,bound_task_id FROM hardware_devices WHERE id=?').bind(id).first<Row>();
      if(!device)throw new GameError('仅能管理已注册设备',404);
      const s=await scopeStore(req,device.store_id);
      if(input.action==='deviceBind') {
        const taskId=text(input.taskId,1,100,'任务标识');
        if(s.point_mode!=='hardware')throw new GameError('请先将实际设备登记为本店硬件点位，再绑定任务',409);
        if(id==='coin-tea-01'&&(s.id!=='tea'||taskId!=='quest-tea'))throw new GameError('固定茶间集演示设备仅支持quest-tea',409);
        const result=await db().prepare(`UPDATE hardware_devices SET bound_task_id=? WHERE id=? AND store_id=? AND enabled=1
          AND EXISTS(SELECT 1 FROM tasks WHERE id=? AND store_id=? AND status='published' AND deleted_at IS NULL AND (expires_at IS NULL OR expires_at>?))
          AND ${staffAuthorizationSQL("hardware_devices.store_id")}`)
          .bind(taskId,id,String(s.id),taskId,String(s.id),now,...staffAuth).run();
        if(!result.meta.changes)throw new GameError('设备处于维护，或任务已下架/到期',409);
      } else if(input.action==='deviceWithdraw') {
        const results=await db().batch([
          db().prepare(`UPDATE tasks SET status='offline',is_featured=0 WHERE id=? AND store_id=? AND EXISTS(
            SELECT 1 FROM hardware_devices WHERE id=? AND store_id=? AND bound_task_id=tasks.id) AND ${staffAuthorizationSQL("tasks.store_id")}`)
            .bind(device.bound_task_id==null?null:String(device.bound_task_id),String(s.id),id,String(s.id),...staffAuth),
          db().prepare(`UPDATE hardware_devices SET bound_task_id=NULL WHERE id=? AND store_id=? AND ${staffAuthorizationSQL("hardware_devices.store_id")}`)
            .bind(id,String(s.id),...staffAuth),
        ]);
        if(!results[1].meta.changes)throw new GameError('设备权限已改变，请刷新',409);
      } else {
        const result=await db().prepare(`UPDATE hardware_devices SET enabled=? WHERE id=? AND store_id=? AND ${staffAuthorizationSQL("hardware_devices.store_id")}`)
          .bind(input.action==='deviceResume'?1:0,id,String(s.id),...staffAuth).run();
        if(!result.meta.changes)throw new GameError('设备权限已改变，请刷新',409);
      }
      return {message:input.action==='deviceMaintain'?'设备已维护停用；硬件金币暂停新的领取确认，已发券保留':input.action==='deviceWithdraw'?'绑定任务已撤回，已发券不变':input.action==='deviceResume'?'设备授权已恢复；未改变令牌':'服务器任务绑定已保存；未向硬件推送新线索'};
    }
    case 'merchantPublish': {
      const scope=await staff(req),s=await scopeStore(req,input.storeId);
      if(s.status!=='active')throw new GameError('门店已下线，不能发布',409);
      const parsed=taskInput(input);
      const id=typeof input.taskId==='string'&&input.taskId?text(input.taskId,1,100,'任务标识'):crypto.randomUUID();
      const old=await db().prepare('SELECT * FROM tasks WHERE id=?').bind(id).first<Row>();
      if(old?.deleted_at!=null)throw new GameError('任务已删除，请发布一个新任务',409);
      const actorId=String(scope.player_id);
      if(old&&(old.store_id!==s.id||(scope.role==='merchant'&&old.author_id!==actorId&&id!=='quest-'+s.id)))throw new GameError('不能编辑其他作者或门店的任务',403);
      const deviceId=typeof input.deviceId==='string'&&input.deviceId?input.deviceId:null;
      const hardwareConfirmation=!!deviceId||!!old?.nfc_claim;
      // Old observations remain historical metadata for a hardware task. They are
      // neither required on publication nor used by NFC awards.
      const question=hardwareConfirmation?String(old?.question??s.question):text(input.question,4,160,'观察题');
      const answer=hardwareConfirmation?String(old?.answer??s.answer):normalize(text(input.answer,1,40,'观察答案'));
      if(deviceId) {
        if(s.point_mode!=='hardware')throw new GameError('本店尚未启用硬件点位，请先完成实际设备登记',409);
        const device=await db().prepare('SELECT id FROM hardware_devices WHERE id=? AND store_id=? AND enabled=1').bind(deviceId,String(s.id)).first();
        if(!device)throw new GameError('设备未注册、处于维护或不属于此店',409);
        if(deviceId==='coin-tea-01'&&(s.id!=='tea'||id!=='quest-tea'))throw new GameError('固定茶间集设备请更新并绑定quest-tea，其他任务可独立发布',409);
      }
      const fixed=await db().prepare("SELECT id FROM hardware_devices WHERE id='coin-tea-01' AND store_id=?").bind(String(s.id)).first();
      if(fixed&&id==='quest-tea'&&old&&(JSON.stringify(parsed.clues)!==old.clues||(!hardwareConfirmation&&(question!==(old.question??s.question)||answer!==(old.answer??s.answer)))))
        throw new GameError('该设备五条线索固定，请保留原线索；新内容可发布独立任务',409);
      if(parsed.rewardType==='coupon') {
        if(!parsed.rewardCouponId)throw new GameError('请选择当前门店的优惠券模板');
        const template=await db().prepare("SELECT id FROM coupon_templates WHERE id=? AND store_id=? AND status='active' AND deleted_at IS NULL AND (valid_start IS NULL OR valid_start<=?) AND (valid_end IS NULL OR valid_end>?)")
          .bind(parsed.rewardCouponId,String(s.id),now,now).first();
        if(!template)throw new GameError('优惠券模板未启用、未生效或不属于此店');
      }
      const templateGuard="(?='points' OR EXISTS(SELECT 1 FROM coupon_templates WHERE id=? AND store_id=? AND status='active' AND deleted_at IS NULL AND (valid_start IS NULL OR valid_start<=?) AND (valid_end IS NULL OR valid_end>?)))";
      const statements=[db().prepare(`INSERT INTO tasks(id,author_id,store_id,title,clues,status,created_at,question,answer,difficulty,expires_at,reward_type,reward_value,reward_coupon_id,photo_urls)
        SELECT ?,?,?,?,?, 'published',?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM stores WHERE id=? AND status='active' AND event_id=?) AND ${templateGuard}
        AND (? IS NULL OR EXISTS(SELECT 1 FROM hardware_devices publish_h JOIN stores publish_s ON publish_s.id=publish_h.store_id
          WHERE publish_h.id=? AND publish_h.store_id=? AND publish_h.enabled=1 AND publish_s.point_mode='hardware'))
        AND ${staffAuthorizationSQL("?")}
        ON CONFLICT(id) DO UPDATE SET title=excluded.title,clues=excluded.clues,status='published',question=excluded.question,answer=excluded.answer,
        difficulty=excluded.difficulty,expires_at=excluded.expires_at,reward_type=excluded.reward_type,reward_value=excluded.reward_value,
        reward_coupon_id=excluded.reward_coupon_id,photo_urls=excluded.photo_urls WHERE tasks.store_id=excluded.store_id AND tasks.deleted_at IS NULL
        AND (tasks.author_id=? OR tasks.id='quest-' || tasks.store_id OR ?='admin')`)
        .bind(id,old?String(old.author_id):actorId,String(s.id),parsed.title,JSON.stringify(parsed.clues),old?Number(old.created_at):now,question,answer,parsed.difficulty,
          parsed.expiresAt,parsed.rewardType,parsed.rewardValue,parsed.rewardCouponId,JSON.stringify(parsed.photoURLs),String(s.id),EVENT,
          parsed.rewardType,parsed.rewardCouponId,String(s.id),now,now,deviceId,deviceId,String(s.id),...staffAuth,String(s.id),actorId,scope.role)];
      if(deviceId)statements.push(db().prepare(`UPDATE hardware_devices SET bound_task_id=? WHERE id=? AND store_id=? AND enabled=1
        AND EXISTS(SELECT 1 FROM stores bind_s WHERE bind_s.id=hardware_devices.store_id AND bind_s.point_mode='hardware' AND bind_s.status='active')
        AND EXISTS(SELECT 1 FROM tasks WHERE id=? AND store_id=? AND status='published' AND deleted_at IS NULL)
        AND ${staffAuthorizationSQL("hardware_devices.store_id")}`).bind(id,deviceId,String(s.id),id,String(s.id),...staffAuth));
      const results=await db().batch(statements);
      if(!results[0].meta.changes)throw new GameError('门店或模板状态已变化，请刷新',409);
      return {taskId:id,message:'任务已发布；既有领取记录和券快照保留'};
    }
    case 'opsUserDetail': {
      await admin(req);
      const actorId=String((await staff(req)).player_id);
      const id=text(input.playerId,1,100,'用户标识');
      const requested={claims:userDetailPage(input.claimsPage,'领奖页码'),placements:userDetailPage(input.placementsPage,'投稿页码'),ledger:userDetailPage(input.ledgerPage,'账本页码')};
      const p=await db().prepare(`SELECT p.*,EXISTS(SELECT 1 FROM accounts a WHERE a.player_id=p.id AND a.status='approved') AS registered_account,(SELECT COALESCE(SUM(delta),0) FROM points_ledger WHERE player_id=p.id AND kind IN ('claim','contribution','achievement') AND delta>0) AS earned,
        (SELECT COUNT(*) FROM claims WHERE player_id=p.id AND event_id=?) AS claim_count,
        (SELECT COUNT(*) FROM claims WHERE player_id=p.id AND event_id=? AND reward_type='coupon') AS coupon_rewards,
        (SELECT COUNT(*) FROM claims WHERE player_id=p.id AND event_id=? AND reward_type='points') AS points_rewards,
        (SELECT COUNT(*) FROM claims WHERE player_id=p.id AND event_id=? AND reward_type='coupon' AND redeemed_at IS NOT NULL) AS redeemed_coupons,
        (SELECT COUNT(*) FROM tasks t JOIN stores s ON s.id=t.store_id WHERE t.author_id=p.id AND s.event_id=? AND t.deleted_at IS NULL) AS placement_count,
        (SELECT COUNT(*) FROM tasks t JOIN stores s ON s.id=t.store_id WHERE t.author_id=p.id AND s.event_id=? AND t.deleted_at IS NULL AND t.status='published') AS published_placements,
        (SELECT COUNT(*) FROM points_ledger WHERE player_id=p.id) AS ledger_count,
        (SELECT MAX(day) FROM player_activity WHERE player_id=p.id) AS last_active_day
        FROM players p WHERE p.id=?`).bind(EVENT,EVENT,EVENT,EVENT,EVENT,EVENT,id).first<Row>();
      if(!p)throw new GameError('用户不存在',404);
      const pagination={claims:userDetailPagination(requested.claims,Number(p.claim_count)),
        placements:userDetailPagination(requested.placements,Number(p.placement_count)),ledger:userDetailPagination(requested.ledger,Number(p.ledger_count))};
      const [claims,placements,ledger]=await Promise.all([
        rows(COUPON_SELECT+' WHERE c.player_id=? AND c.event_id=? ORDER BY c.issued_at DESC,c.id DESC LIMIT ? OFFSET ?',id,EVENT,10,(pagination.claims.page-1)*10),
        rows(TASK_SELECT+' WHERE t.author_id=? AND s.event_id=? AND t.deleted_at IS NULL ORDER BY t.created_at DESC,t.id DESC LIMIT ? OFFSET ?',id,EVENT,10,(pagination.placements.page-1)*10),
        rows('SELECT id,delta,kind,reason,created_at FROM points_ledger WHERE player_id=? ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?',id,10,(pagination.ledger.page-1)*10),
      ]);
      return {user:summary(p),claims:claims.map(coupon),placements:placements.map(r=>task(r,id,new Set())),
        ledger:ledger.map(r=>({id:String(r.id),delta:Number(r.delta),kind:String(r.kind),reason:String(r.reason),createdAt:Number(r.created_at)})),pagination,
        activity:{earnedPoints:Number(p.earned),couponRewards:Number(p.coupon_rewards),pointsRewards:Number(p.points_rewards),redeemedCoupons:Number(p.redeemed_coupons),
          placements:Number(p.placement_count),publishedPlacements:Number(p.published_placements),ledgerEntries:Number(p.ledger_count),lastActiveDay:p.last_active_day==null?null:String(p.last_active_day)},
        permissions:userStatusPermissions(id,actorId)} satisfies OperationsUserDetail;
    }
    case 'opsUserStatus': {
      await admin(req);
      const id=text(input.playerId,1,100,'用户标识');
      if(typeof input.banned!=='boolean')throw new GameError('停用状态格式不正确');
      const permission=userStatusPermissions(id,String((await staff(req)).player_id));
      if(!permission.canChangeStatus)throw new GameError(permission.statusReason!);
      const result=await db().prepare(`UPDATE players SET banned=? WHERE id=? AND ${staffAuthorizationSQL(undefined,true)}`)
        .bind(input.banned?1:0,id,...staffAuth).run();
      if(!result.meta.changes)throw new GameError('用户不存在',404);
      return {message:input.banned?'用户已停用，后续游戏与工作台写操作被拒绝':'用户已恢复'};
    }
    case 'opsPointsAdjust': {
      await admin(req);
      const id=text(input.playerId,1,100,'用户标识'),delta=numeric(input.delta,-100000,100000,'积分调整'),reason=text(input.reason,2,120,'调整原因');
      if(!delta)throw new GameError('调整积分不能为0');
      const request=typeof input.requestId==='string'?text(input.requestId,8,100,'调整请求标识'):crypto.randomUUID();
      const existing=await db().prepare("SELECT delta,reason FROM points_ledger WHERE player_id=? AND kind='adjustment' AND source_id=?").bind(id,request).first<Row>();
      if(existing&&(existing.delta!==delta||existing.reason!==reason))throw new GameError('调整请求与已有记录不一致',409);
      await db().prepare(`INSERT INTO points_ledger(id,player_id,delta,kind,source_id,reason,created_at) SELECT ?,id,?,'adjustment',?,?,?
        FROM players WHERE id=? AND points_balance+?>=0 AND ${staffAuthorizationSQL(undefined,true)} ON CONFLICT(player_id,kind,source_id) DO NOTHING`)
        .bind(crypto.randomUUID(),delta,request,reason,now,id,delta,...staffAuth).run();
      const saved=await db().prepare("SELECT id,delta,reason FROM points_ledger WHERE player_id=? AND kind='adjustment' AND source_id=?").bind(id,request).first<Row>();
      if(!saved)throw new GameError('用户不存在或积分余额不足');
      if(saved.delta!==delta||saved.reason!==reason)throw new GameError('调整请求与已有记录不一致',409);
      return {message:'积分调整已记入账本',requestId:request};
    }
    case 'opsStoreStatus': {
      await admin(req);const s=await scopeStore(req,input.storeId);
      if(input.status!=='active'&&input.status!=='inactive')throw new GameError('门店状态格式不正确');
      const result=await db().prepare(`UPDATE stores SET status=? WHERE id=? AND event_id=? AND ${staffAuthorizationSQL(undefined,true)}`)
        .bind(input.status,String(s.id),EVENT,...staffAuth).run();
      if(!result.meta.changes)throw new GameError('运营权限已改变，请重新登录',409);
      return {message:input.status==='inactive'?'门店已下线并停止新领奖；已发券仍按原条款核销':'门店已恢复'};
    }
    case 'opsSettingsSave': {
      await admin(req);
      const limit=numeric(input.dailyLimit,0,100,'每日投放上限'),ratio=numeric(input.contributionRatio,0,1,'贡献系数',false);
      if(!Array.isArray(input.clueCosts)||input.clueCosts.length!==5||input.clueCosts[0]!==0||input.clueCosts[1]!==0)throw new GameError('线索价格需五项且前两条免费');
      const costs=input.clueCosts.map(value=>numeric(value,0,1000,'线索积分'));
      if(typeof input.ugcReview!=='boolean')throw new GameError('审核开关格式不正确');
      const result=await db().prepare(`UPDATE game_settings SET daily_limit=?,clue_costs=?,contribution_ratio=?,ugc_review=?,updated_at=? WHERE id='main'
        AND ${staffAuthorizationSQL(undefined,true)}`).bind(limit,JSON.stringify(costs),ratio,input.ugcReview?1:0,now,...staffAuth).run();
      if(!result.meta.changes)throw new GameError('运营权限已改变，请重新登录',409);
      return {message:'规则已保存，对后续操作生效；已领奖积分和已解锁线索不追溯修改'};
    }
    default:return null;
  }
}
