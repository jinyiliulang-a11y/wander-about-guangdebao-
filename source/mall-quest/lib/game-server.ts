import { env } from "cloudflare:workers";
import { allowedPlayer, businessAction, dayStart, enrichState, recordStateActivity, settings, storeDTO, taskInput } from "./game-business";
import { verifyHardwareEntryToken } from "./hardware-server";
import { GeofenceError, requireStoreGeofence } from "./geofence-server";
import { GameError } from "./game-error";
import { accountAction, registeredPlayer, recordingShortcutAllowed } from "./account-auth";
import { HARDWARE_DEMO_INSTANCE } from "./application-scope";
import { sessionCookieName, sessionCookiePath, sessionCookieSecure } from "./session-scope";
import { authorizationValues, playerAuthorizationSQL, staffAuthorizationSQL } from "./account-authorization";
import { nfcClaim, nfcClaimStatus } from "./nfc-claim-server";
import { nfcDraftAction } from "./nfc-draft-server";
import { merchantDeviceAction } from "./merchant-device-server";
import { isRecordingCouponCode, recordingCouponGrant, recordingCouponStatus, recordingCouponPreview, recordingCouponRedeem,
  recordingCouponsForPlayer, recordingCouponsForMerchant } from "./recording-coupons";
export { GameError } from "./game-error";
import type {
  GameState,
  Task,
  Coupon,
  StaffState,
  ReviewRecord,
  CoinCheckIn,
  CouponPreview,
} from "./game-types";
const EVENT = "mall-48h";
export const db = () => {
  if (!env.DB) throw new GameError("活动服务暂不可用，请稍后重试", 503);
  return env.DB;
};
export const hash = async (value: string) =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
    ),
  )
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
export const normalize = (value: string) =>
  value.trim().normalize("NFKC").toLowerCase().replace(/\s+/g, "");
export const cookie = (req: Request, name: string) =>
  req.headers
    .get("cookie")
    ?.split(";")
    .map((x) => x.trim())
    .find((x) => x.startsWith(sessionCookieName(name) + "="))
    ?.slice(sessionCookieName(name).length + 1);
export async function session(req: Request, staff = false) {
  const token = cookie(req, staff ? "mall_staff" : "mall_player");
  if (!token) return null;
  return db()
    .prepare(`SELECT s.*,a.username AS account_username,a.role AS account_role FROM sessions s
      LEFT JOIN accounts a ON a.id=s.account_id LEFT JOIN players p ON p.id=s.player_id
      WHERE s.token_hash=? AND s.expires_at>? AND p.banned=0 AND ` + (staff
      ? "s.role IN ('admin','merchant') AND a.status='approved' AND a.role=s.role AND a.player_id=s.player_id AND (s.role='admin' OR a.store_id=s.store_id)"
      : "s.role='player' AND (s.account_id IS NULL OR (a.status='approved' AND a.player_id=s.player_id))"))
    .bind(await hash(token), Date.now())
    .first<{
      role: string;
      player_id: string | null;
      store_id: string | null;
      account_id: string | null;
      legacy_authenticated: number;
      account_username: string | null;
      account_role: "player" | "merchant" | "admin" | null;
    }>();
}
export function sessionCookie(req: Request, token: string, staff = false) {
  return `${sessionCookieName(staff ? "mall_staff" : "mall_player")}=${token}; Path=${sessionCookiePath()}; HttpOnly; SameSite=Lax; Max-Age=${staff ? 43200 : 2592000}${sessionCookieSecure(req) ? "; Secure" : ""}`;
}
export async function player(req: Request) {
  const current = await session(req);
  if (current?.player_id) return { id: current.player_id };
  throw new GameError("请刷新页面重新建立体验身份", 401);
}
export async function staff(req: Request) {
  const s = await session(req, true);
  if (!s || !["admin", "merchant"].includes(s.role))
    throw new GameError("请先登录已通过审核的运营或商家账号", 403);
  if (s.player_id) await allowedPlayer(s.player_id);
  return s;
}
const SEEDS = [
  {
    id: "tea",
    name: "茶间集",
    floor: "F1",
    area: "中庭东侧",
    category: "茶饮",
    question: "菜单上，花香来自哪种茶？",
    answer: "茉莉",
    code: "TEA48",
    reward: "任购饮品 · 免费加料",
    conditions: "需购买任意一杯饮品；仅演示，不可实际消费。",
    x: 66,
    y: 40,
    artwork: 0,
    title: "把花香，藏进一杯茶",
    clues: [
      "不卖鲜花，却把花香装进杯子。",
      "在 F1 中庭东侧寻找一处绿色角落。",
      "墙上的三片叶子，正在给你提示。",
      "看看菜单里的花香茶底。",
      "找到茉莉茶，再向店员查看点位牌。",
    ],
  },
  {
    id: "book",
    name: "未完书房",
    floor: "F2",
    area: "连廊西侧",
    category: "书店 / 文具",
    question: "给未来的自己陈列上，书签印着什么？",
    answer: "月亮",
    code: "BOOK48",
    reward: "文具满 ¥20 · 减 ¥5",
    conditions: "仅限文具，满20元可用；仅演示，不可实际消费。",
    x: 33,
    y: 58,
    artwork: 1,
    title: "一封写给未来的信",
    clues: [
      "这里收集纸张，也收集没说完的故事。",
      "沿 F2 西侧连廊慢慢寻找。",
      "找一块写着给未来的自己的陈列牌。",
      "留意陈列旁的银色书签。",
      "找到月亮图案，再查看桌边的点位牌。",
    ],
  },
  {
    id: "craft",
    name: "造物小屋",
    floor: "F1",
    area: "南侧生活区",
    category: "手作体验",
    question: "印章手柄上，刻着哪种图案？",
    answer: "星星",
    code: "MAKE48",
    reward: "定制挂牌 · 免费刻字",
    conditions: "购买一枚定制挂牌后可用；仅演示，不可实际消费。",
    x: 40,
    y: 75,
    artwork: 2,
    title: "给日常盖一颗小星星",
    clues: [
      "在这里，一双手能让想法变成礼物。",
      "前往 F1 南侧生活区。",
      "寻找摆着木头印章的小桌。",
      "仔细看看印章的手柄。",
      "星星就是答案，点位牌在体验桌旁。",
    ],
  },
];
export async function seed() {
  const d = db();
  const statements = [
    d
      .prepare(
        "INSERT OR IGNORE INTO players(id,nickname,created_at) VALUES(?,?,?)",
      )
      .bind("mall-curator", "商场发现官", Date.now()),
  ];
  for (const s of HARDWARE_DEMO_INSTANCE ? SEEDS.filter(item => item.id === "tea") : SEEDS) {
    statements.push(
      d
        .prepare(
          "INSERT OR IGNORE INTO stores(id,event_id,name,floor,area,category,question,answer,code_hash,reward_title,conditions,stock_total,x,y,artwork) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        )
        .bind(
          s.id,
          EVENT,
          s.name,
          s.floor,
          s.area,
          s.category,
          s.question,
          normalize(s.answer),
          await hash(s.code),
          s.reward,
          s.conditions,
          24,
          s.x,
          s.y,
          s.artwork,
        ),
    );
    statements.push(
      d
        .prepare(
          "INSERT OR IGNORE INTO tasks(id,author_id,store_id,title,clues,status,created_at) VALUES(?,?,?,?,?,?,?)",
        )
        .bind(
          "quest-" + s.id,
          "mall-curator",
          s.id,
          s.title,
          JSON.stringify(s.clues),
          "published",
          Date.now(),
        ),
    );
  }
  await d.batch(statements);
  await d.prepare(`INSERT OR IGNORE INTO coupon_templates(id,store_id,title,type,value,min_amount,total_count,status,created_at,updated_at)
    SELECT 'legacy-' || id,id,reward_title,'gift',0,0,stock_total,'active',?,? FROM stores WHERE event_id=?`).bind(Date.now(),Date.now(),EVENT).run();
  await d.prepare(`UPDATE tasks SET reward_coupon_id='legacy-' || store_id WHERE reward_coupon_id IS NULL AND reward_type='coupon'
    AND EXISTS(SELECT 1 FROM coupon_templates WHERE id='legacy-' || tasks.store_id)`).run();
}
// SQL projections have heterogeneous columns; every response is explicitly mapped.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;
export const TASK_SELECT = `SELECT t.*,p.nickname AS author,s.floor,s.area,s.x,s.y,COALESCE(t.question,s.question) AS question,s.answer AS store_answer,
  CASE WHEN t.reward_type='points' THEN t.reward_value || ' 探索积分' ELSE COALESCE(ct.title,s.reward_title) END AS reward_title,
  s.conditions,s.point_mode,s.name AS store_name,CASE WHEN t.deleted_at IS NOT NULL OR s.status<>'active' OR (t.expires_at IS NOT NULL AND t.expires_at<=CAST((julianday('now')-2440587.5)*86400000 AS INTEGER))
  OR (t.reward_coupon_id IS NOT NULL AND (ct.id IS NULL OR ct.deleted_at IS NOT NULL OR ct.status<>'active' OR (ct.valid_start IS NOT NULL AND ct.valid_start>CAST((julianday('now')-2440587.5)*86400000 AS INTEGER))
  OR (ct.valid_end IS NOT NULL AND ct.valid_end<=CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)))) THEN 0
  ELSE MIN(s.stock_total-(SELECT COUNT(*) FROM claims c WHERE c.store_id=s.id AND c.event_id=s.event_id),
  CASE WHEN t.reward_coupon_id IS NULL THEN s.stock_total ELSE ct.total_count-(SELECT COUNT(*) FROM claims c WHERE c.template_id=ct.id) END) END AS remaining,
  (SELECT COUNT(*) FROM claims c WHERE c.task_id=t.id) AS claimed_count FROM tasks t JOIN stores s ON s.id=t.store_id
  JOIN players p ON p.id=t.author_id LEFT JOIN coupon_templates ct ON ct.id=t.reward_coupon_id`;
export const task = (r: Row, pid: string, claimedStores: Set<string>): Task => ({
  id: r.id,
  storeId: r.store_id,
  pointMode: r.point_mode,
  requiresNfcClaim: !!r.nfc_claim,
  title: r.title,
  authorId: r.author_id,
  author: r.author,
  floor: r.floor,
  area: r.area,
  x: r.x,
  y: r.y,
  clues: JSON.parse(r.clues),
  question: r.question,
  reward: r.reward_title,
  conditions: r.conditions,
  remaining: r.remaining,
  status: r.status,
  isFeatured: !!r.is_featured,
  createdAt: r.created_at,
  difficulty: r.difficulty,
  expiresAt: r.expires_at,
  rewardType: r.reward_type,
  rewardValue: r.reward_value,
  rewardCouponId: r.reward_coupon_id,
  photoURLs: JSON.parse(r.photo_urls || '["","","","",""]'),
  own: r.author_id === pid,
  claimed: claimedStores.has(r.store_id),
  ...(r.author_id === pid
    ? {
        claimedCount: r.claimed_count,
        reviewNote: r.review_note,
        storeName: r.store_name,
      }
    : {}),
});
export const COUPON_SELECT = `SELECT c.*,t.title AS task_title,COALESCE(NULLIF(c.store_name_snapshot,''),s.name) AS store_name,
  COALESCE(NULLIF(c.reward_snapshot,''),s.reward_title) AS reward_title,COALESCE(NULLIF(c.conditions_snapshot,''),s.conditions) AS conditions,
  s.artwork,s.image_url AS store_image_url,p.nickname AS author FROM claims c JOIN stores s ON s.id=c.store_id JOIN tasks t ON t.id=c.task_id JOIN players p ON p.id=t.author_id`;
export const coupon = (r: Row): Coupon => ({
  id: r.id,
  taskId: r.task_id,
  taskTitle: r.task_title,
  storeName: r.store_name,
  storeId: r.store_id,
  reward: r.reward_title,
  conditions: r.conditions,
  code: r.reward_type==='points' ? '' : r.coupon_code,
  issuedAt: r.issued_at,
  redeemedAt: r.redeemed_at,
  artwork: r.artwork,
  imageURL: r.store_image_url || "",
  author: r.author,
  validStart: r.valid_start,
  validEnd: r.valid_end,
  status: r.redeemed_at!==null&&r.redeemed_at!==undefined ? 'used' : r.valid_end!==null&&r.valid_end<=Date.now() ? 'expired' : r.valid_start!==null&&r.valid_start>Date.now() ? 'upcoming' : 'unused',
  rewardType: r.reward_type,
  rewardValue: r.reward_value,
  type: r.coupon_type,
  value: r.coupon_value,
  minAmount: r.coupon_min_amount,
});
export async function state(req: Request, pid: string): Promise<GameState> {
  const d = db();
  const [pr, tr, cr, sr, fr, ss, feedbackRows, ownFeedback] = await Promise.all([
    d
      .prepare("SELECT id,nickname FROM players WHERE id=?")
      .bind(pid)
      .first<{ id: string; nickname: string }>(),
    d
      .prepare(
        TASK_SELECT +
          " WHERE s.event_id='mall-48h' AND t.deleted_at IS NULL AND ((t.status='published' AND s.status='active' AND (t.expires_at IS NULL OR t.expires_at>?)) OR t.author_id=?) ORDER BY t.is_featured DESC,t.created_at DESC",
      )
      .bind(Date.now(),pid)
      .all<Row>(),
    d
      .prepare(COUPON_SELECT + " WHERE c.player_id=? AND c.event_id=? ORDER BY c.issued_at DESC")
      .bind(pid, EVENT)
      .all<Row>(),
    d
      .prepare(
        "SELECT * FROM stores WHERE event_id='mall-48h' ORDER BY id",
      )
      .all<Row>(),
    d
      .prepare(
        "SELECT COUNT(*) AS n FROM feedback f JOIN tasks t ON t.id=f.task_id WHERE t.author_id=? AND f.deleted_at IS NULL AND t.deleted_at IS NULL",
      )
      .bind(pid)
      .first<{ n: number }>(),
    session(req, true),
    d
      .prepare(
        "SELECT t.title AS taskTitle,f.clarity,f.comment FROM feedback f JOIN tasks t ON t.id=f.task_id WHERE t.author_id=? AND f.deleted_at IS NULL AND t.deleted_at IS NULL ORDER BY f.created_at DESC LIMIT 20",
      )
      .bind(pid)
      .all<{ taskTitle: string; clarity: number; comment: string }>(),
    d.prepare(`SELECT f.id,f.task_id AS taskId,t.title AS taskTitle,f.clarity,f.comment,f.created_at AS createdAt
      FROM feedback f JOIN tasks t ON t.id=f.task_id WHERE f.player_id=? AND f.deleted_at IS NULL ORDER BY f.created_at DESC`).bind(pid)
      .all<{id:string;taskId:string;taskTitle:string;clarity:number;comment:string;createdAt:number}>(),
  ]);
  const claimed = new Set(cr.results.map((x) => x.store_id));
  const all = tr.results.map((x) => task(x, pid, claimed));
  const placements = all.filter((x) => x.own);
  const playerSession = await session(req);
  const enriched = await enrichState(pid,{
    player: pr!,
    tasks: all.filter((x) => x.status === "published"),
    placements,
    stores: sr.results.map(storeDTO),
    coupons: cr.results.map(coupon),
    contribution: placements.reduce(
      (a, t) => a + (t.claimedCount || 0) * 10,
      0,
    ),
    feedbackCount: fr?.n || 0,
    feedback: feedbackRows.results,
    ownFeedback: ownFeedback.results,
    staff: ss ? { role: ss.role, storeId: ss.store_id } : null,
    recordingShortcutAllowed: recordingShortcutAllowed(req),
  }, playerSession?.account_id ?? null);
  // UI-only coupons are available only in the separately built demo instance.
  // Device-backed rewards keep their existing pending/merchant issue flow.
  enriched.recordingCouponAllowed=HARDWARE_DEMO_INSTANCE&&recordingShortcutAllowed(req)&&!!playerSession?.account_id&&
    playerSession.account_role==="player"&&playerSession.player_id===pid&&!!enriched.player.accountAuthenticated;
  if(enriched.recordingCouponAllowed)enriched.coupons=[...enriched.coupons,...await recordingCouponsForPlayer(req,pid)]
    .sort((a,b)=>b.issuedAt-a.issuedAt||a.id.localeCompare(b.id));
  await recordStateActivity(req,pid);
  return enriched;
}
export async function execute(req: Request, input: Row) {
  const nfcDraftResult = await nfcDraftAction(req, input);
  if (nfcDraftResult !== null) return nfcDraftResult;
  const merchantDeviceResult = await merchantDeviceAction(req, input);
  if (merchantDeviceResult !== null) return merchantDeviceResult;
  const d = db();
  const accountResult = await accountAction(req, input);
  if (accountResult !== null) return accountResult;
  const { id: pid } = await player(req);
  const now = Date.now(), playerAuth=await authorizationValues(req), staffAuth=await authorizationValues(req,true);
  if(!['playerLogout','staffLogout'].includes(String(input.action))) await allowedPlayer(pid);
  if (['place','claim','coinCheckIn','nfcClaim','nfcClaimStatus','recordingCouponGrant','recordingCouponStatus','unlockClue','feedback','feedbackDelete','recordShare','creatorDraft','creatorDraftSave','creatorDraftDelete'].includes(String(input.action)))
    await registeredPlayer(req);
  const extra=await businessAction(req,input,pid);
  if(extra!==null)return extra;
  switch (input.action) {
    case "nfcClaim": return nfcClaim(req,input);
    case "nfcClaimStatus": return nfcClaimStatus(req,input);
    case "recordingCouponGrant": return recordingCouponGrant(req,input);
    case "recordingCouponStatus": return recordingCouponStatus(req,input);
    case "place": {
      const requestId = input.requestId === undefined ? crypto.randomUUID() : String(input.requestId).toLowerCase();
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(requestId))
        throw new GameError("投稿请求标识不正确，请重新提交");
      const initial=await d.prepare("SELECT * FROM tasks WHERE id=?").bind(requestId).first<Row>();
      if(initial?.deleted_at!=null)throw new GameError("任务已删除，请重新创建投稿",409);
      const parsed=taskInput(input,!!initial);
      const clueJson=JSON.stringify(parsed.clues),photoJson=JSON.stringify(parsed.photoURLs);
      let templateId=parsed.rewardCouponId;
      if(parsed.rewardType==='coupon'&&!templateId) {
        const legacy=await d.prepare("SELECT id FROM coupon_templates WHERE id=? AND store_id=? AND status='active' AND deleted_at IS NULL")
          .bind('legacy-'+input.storeId,input.storeId).first<{id:string}>();
        templateId=legacy?.id||null;
      }
      const existingRequest = async () => {
        const existing = await d.prepare("SELECT * FROM tasks WHERE id=?").bind(requestId).first<Row>();
        if (!existing) return false;
        if(existing.deleted_at!=null)throw new GameError("任务已删除，请重新创建投稿",409);
        if (existing.author_id !== pid || existing.store_id !== input.storeId || existing.title !== parsed.title || existing.clues !== clueJson ||
          existing.difficulty!==parsed.difficulty||existing.expires_at!==parsed.expiresAt||existing.reward_type!==parsed.rewardType||
          existing.reward_value!==parsed.rewardValue||existing.reward_coupon_id!==templateId||existing.photo_urls!==photoJson)
          throw new GameError("这次投稿请求与已有记录不一致，请重新提交", 409);
        return true;
      };
      const saved = { taskId: requestId, message: "已提交，审核通过后出现在地图上" };
      if (await existingRequest()) return saved;
      const s = await d
        .prepare("SELECT id FROM stores WHERE id=? AND event_id=? AND status='active'")
        .bind(input.storeId,EVENT)
        .first();
      if (!s) throw new GameError("请选择活动中的门店");
      const config=await settings();
      const start=dayStart(now);
      const result = await d
        .prepare(
          `INSERT INTO tasks(id,author_id,store_id,title,clues,status,created_at,difficulty,expires_at,reward_type,reward_value,reward_coupon_id,photo_urls)
          SELECT ?,?,s.id,?,?,CASE WHEN gs.ugc_review=1 THEN 'pending' ELSE 'published' END,?,?,?,?,?,?,? FROM stores s JOIN game_settings gs ON gs.id='main'
          WHERE s.id=? AND s.event_id=? AND s.status='active' AND EXISTS(SELECT 1 FROM players WHERE id=? AND banned=0)
          AND (SELECT COUNT(*) FROM tasks WHERE author_id=? AND created_at>=? AND created_at<?)<gs.daily_limit
          AND (? IS NULL OR EXISTS(SELECT 1 FROM coupon_templates WHERE id=? AND store_id=s.id AND status='active' AND deleted_at IS NULL
            AND (valid_start IS NULL OR valid_start<=?) AND (valid_end IS NULL OR valid_end>?)))
          AND ${playerAuthorizationSQL("?")} ON CONFLICT(id) DO NOTHING`,
        )
        .bind(
          requestId,pid,parsed.title,clueJson,now,parsed.difficulty,parsed.expiresAt,parsed.rewardType,parsed.rewardValue,templateId,photoJson,
          input.storeId,EVENT,pid,pid,start,start+86400000,templateId,templateId,now,now,...playerAuth,pid,
        )
        .run();
      if (!result.meta.changes && !(await existingRequest()))
        { await registeredPlayer(req); throw new GameError(`今日最多提交${config.dailyLimit}条任务，或门店/优惠券模板已不可用`); }
      return {...saved,message:config.ugcReview?saved.message:'任务已发布，邀请朋友来寻找吧'};
    }
    case "coinCheckIn": {
      if (typeof input.taskId !== "string" || !input.taskId || input.taskId.length > 100)
        throw new GameError("金币任务标识不正确");
      const confirmationMode=await d.prepare("SELECT nfc_claim FROM tasks WHERE id=?").bind(input.taskId).first<{nfc_claim:number}>();
      if(confirmationMode?.nfc_claim)throw new GameError("这枚硬件金币需碰读NFC领取，不能通过旧确认按钮签到",409);
      const coin = await d.prepare(`SELECT t.id,s.id AS store_id,s.name AS store_name FROM tasks t JOIN stores s ON s.id=t.store_id
        LEFT JOIN coupon_templates ct ON ct.id=t.reward_coupon_id
        WHERE t.id=? AND t.status='published' AND t.deleted_at IS NULL AND s.event_id=? AND s.status='active'
          AND (t.expires_at IS NULL OR t.expires_at>?)
          AND (t.reward_type='points' OR t.reward_coupon_id IS NULL OR (ct.store_id=s.id AND ct.status='active' AND ct.deleted_at IS NULL
            AND (ct.valid_start IS NULL OR ct.valid_start<=?) AND (ct.valid_end IS NULL OR ct.valid_end>?)
            AND (SELECT COUNT(*) FROM claims WHERE template_id=ct.id)<ct.total_count))
          AND (SELECT COUNT(*) FROM claims c WHERE c.store_id=s.id AND c.event_id=s.event_id)<s.stock_total`)
        .bind(input.taskId, EVENT, now, now, now).first<{ id: string; store_id: string; store_name: string }>();
      if (!coin) throw new GameError("金币任务已下架、过期或奖励已领完", 409);
      const entry = input.entryToken === undefined ? undefined : await verifyHardwareEntryToken(input.entryToken, coin.id, coin.store_id);
      await requireStoreGeofence(coin.store_id, input.location);
      await registeredPlayer(req);
      const confirmation: CoinCheckIn = { taskId: coin.id, storeId: coin.store_id, storeName: coin.store_name,
        method: entry ? "dynamic" : "link", ...(entry ? { expiresAt: entry.expiresAt } : {}) };
      return confirmation;
    }
    case "claim": {
      const id = String(input.taskId || "");
      const s = await d
        .prepare(
          "SELECT t.author_id,t.status AS task_status,t.answer AS task_answer,t.expires_at,t.nfc_claim,s.* FROM tasks t JOIN stores s ON s.id=t.store_id WHERE t.id=? AND t.deleted_at IS NULL AND s.event_id=?",
        )
        .bind(id, EVENT)
        .first<Row>();
      if (!s || s.task_status !== "published" || s.status!=='active')
        throw new GameError("这个任务尚未发布或已下架");
      if(s.nfc_claim)throw new GameError("这枚硬件金币需碰读NFC提交待领申请，商家收到金币后确认发券；正式券以后单独核销",409);
      if (s.author_id === pid)
        throw new GameError("这是你创作的任务，邀请朋友来寻找吧");
      const entry = input.entryToken === undefined ? undefined : await verifyHardwareEntryToken(input.entryToken, id, s.id);
      const geofence = await requireStoreGeofence(s.id, input.location);
      const existing = await d
        .prepare(
          COUPON_SELECT +
            " WHERE c.player_id=? AND c.store_id=? AND c.event_id=?",
        )
        .bind(pid, s.id, EVENT)
        .first<Row>();
      if (existing) {
        const latest = await requireStoreGeofence(s.id, input.location);
        if (latest.fence.revision !== geofence.fence.revision) throw new GeofenceError("config-changed");
        return {
          coupon: coupon(existing),
          newlyIssued:false,
          message: "这家店的奖励已在你的卡包里",
        };
      }
      const submittedAnswer = normalize(String(input.answer || ""));
      const attempt = await d.prepare(`INSERT INTO hardware_claim_attempts(player_id,store_id,window_started_at,attempt_count)
          SELECT ?,?,?,1 WHERE ${playerAuthorizationSQL("?")}
          ON CONFLICT(player_id,store_id) DO UPDATE SET window_started_at=CASE WHEN window_started_at<=? THEN excluded.window_started_at ELSE window_started_at END,
          attempt_count=CASE WHEN window_started_at<=? THEN 1 ELSE attempt_count+1 END WHERE (window_started_at<=? OR attempt_count<8)
          AND ${playerAuthorizationSQL("hardware_claim_attempts.player_id")}`).bind(pid,s.id,now,...playerAuth,pid,now-60_000,now-60_000,now-60_000,...playerAuth).run();
      if (!attempt.meta.changes) throw new GameError("尝试较频繁，请稍等一分钟后再试", 429);
      if (submittedAnswer !== (s.task_answer??s.answer))
        throw new GameError("观察答案不正确，再看看线索吧");
      const claimId = crypto.randomUUID();
      const code =
        "GTB-" +
        crypto.randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase();
      const issued=await d.prepare(`INSERT INTO claims(id,player_id,event_id,store_id,task_id,coupon_code,issued_at,reward_type,reward_value,template_id,
        reward_snapshot,conditions_snapshot,store_name_snapshot,coupon_type,coupon_value,coupon_min_amount,valid_start,valid_end)
        SELECT ?,?,s.event_id,s.id,t.id,?,?,t.reward_type,t.reward_value,t.reward_coupon_id,
        CASE WHEN t.reward_type='points' THEN t.reward_value || ' 探索积分' ELSE COALESCE(ct.title,s.reward_title) END,
        CASE WHEN ct.id IS NULL THEN s.conditions ELSE '消费门槛 ¥' || ct.min_amount || '；按券内容使用；仅演示，不可实际消费。' END,
        s.name,COALESCE(ct.type,'gift'),COALESCE(ct.value,0),COALESCE(ct.min_amount,0),ct.valid_start,ct.valid_end
        FROM tasks t JOIN stores s ON s.id=t.store_id LEFT JOIN coupon_templates ct ON ct.id=t.reward_coupon_id
        WHERE t.id=? AND t.status='published' AND t.deleted_at IS NULL AND t.nfc_claim=0 AND t.author_id<>? AND COALESCE(t.answer,s.answer)=? AND s.id=? AND s.event_id=? AND s.status='active'
        AND EXISTS(SELECT 1 FROM players WHERE id=? AND banned=0) AND (t.expires_at IS NULL OR t.expires_at>?)
        AND (t.reward_type='points' OR t.reward_coupon_id IS NULL OR (ct.store_id=s.id AND ct.status='active' AND ct.deleted_at IS NULL AND (ct.valid_start IS NULL OR ct.valid_start<=?)
          AND (ct.valid_end IS NULL OR ct.valid_end>?) AND (SELECT COUNT(*) FROM claims WHERE template_id=ct.id)<ct.total_count))
        AND (SELECT COUNT(*) FROM claims c WHERE c.store_id=s.id AND c.event_id=s.event_id)<s.stock_total
        AND EXISTS(SELECT 1 FROM store_geofences g WHERE g.store_id=s.id AND g.enabled=1 AND g.revision=?)
        AND ?>=MAX(?,CAST((julianday('now')-2440587.5)*86400000 AS INTEGER))-30000
        AND ?<=MAX(?,CAST((julianday('now')-2440587.5)*86400000 AS INTEGER))+5000
        AND ${playerAuthorizationSQL("?")}
        ${entry ? `AND ?>MAX(?,CAST(strftime('%s','now') AS INTEGER)*1000) AND s.point_mode='hardware'
          AND EXISTS(SELECT 1 FROM hardware_devices h WHERE h.id=? AND h.enabled=1 AND h.token_hash=?
          AND h.store_id=s.id AND h.bound_task_id=t.id)` : ""}
        ON CONFLICT(player_id,event_id,store_id) DO NOTHING`)
        .bind(claimId,pid,code,now,id,pid,submittedAnswer,s.id,EVENT,pid,now,now,now,
          geofence.fence.revision,geofence.location.timestamp,Date.now(),geofence.location.timestamp,Date.now(),...playerAuth,pid,
          ...(entry ? [entry.expiresAt,Date.now(),entry.deviceId,entry.tokenHash] : [])).run();
      const awarded = await d
        .prepare(
          COUPON_SELECT +
            " WHERE c.player_id=? AND c.store_id=? AND c.event_id=?",
        )
        .bind(pid, s.id, EVENT)
        .first<Row>();
      if (!awarded) {
        await registeredPlayer(req);
        const latest = await requireStoreGeofence(s.id, input.location);
        if (latest.fence.revision !== geofence.fence.revision) throw new GeofenceError("config-changed");
        // A queued INSERT may cross the ticket's expiry or a device transition.
        // Return the rescan explanation rather than mislabeling it as sold out.
        if (entry) await verifyHardwareEntryToken(input.entryToken, id, s.id);
        throw new GameError("奖励已领完，或任务已下架，请换个目标");
      }
      return { coupon: coupon(awarded),newlyIssued:!!issued.meta.changes&&awarded.id===claimId,message: "寻宝成功，奖励已放入卡包" };
    }
    case "feedback": {
      const clarity = Number(input.clarity);
      const comment = String(input.comment || "").trim();
      if (![1, 2, 3].includes(clarity) || comment.length > 120)
        throw new GameError("请选择线索反馈，留言不超过120字");
      const result = await d
        .prepare(
          `INSERT INTO feedback(id,player_id,task_id,clarity,comment,created_at) SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM claims WHERE player_id=? AND task_id=?)
            AND EXISTS(SELECT 1 FROM players WHERE id=? AND banned=0) AND ${playerAuthorizationSQL("?")}
            ON CONFLICT(player_id,task_id) DO UPDATE SET clarity=excluded.clarity,comment=excluded.comment,deleted_at=NULL,created_at=excluded.created_at`,
        )
        .bind(
          crypto.randomUUID(),
          pid,
          input.taskId,
          clarity,
          comment,
          now,
          pid,
          input.taskId,
          pid,
          ...playerAuth,pid,
        )
        .run();
      if (!result.meta.changes)
        { await registeredPlayer(req); throw new GameError("完成这条任务后就能留下反馈"); }
      return { message: "谢谢，你的反馈已交给创作者" };
    }
    case "staffState": {
      const ss = await staff(req);
      const filter = " WHERE t.deleted_at IS NULL AND s.event_id='mall-48h'" + (ss.role === "merchant" ? " AND t.store_id=?" : "");
      const query = d.prepare(TASK_SELECT + filter);
      const tr = await (
        ss.role === "merchant" ? query.bind(ss.store_id) : query
      ).all<Row>();
      const cq = d.prepare(
        COUPON_SELECT +
          " WHERE c.event_id=?" +
          (ss.role === "merchant" ? " AND c.store_id=?" : "") +
          " ORDER BY c.issued_at DESC",
      );
      const cr = await (
        ss.role === "merchant" ? cq.bind(EVENT, ss.store_id) : cq.bind(EVENT)
      ).all<Row>();
      const all = tr.results.map((r) => ({
        ...task(r, "", new Set()),
        storeName: r.store_name,
        claimedCount: r.claimed_count,
        reviewNote: r.review_note,
      }));
      return {
        scope: { role: ss.role, storeId: ss.store_id },
        pending: all.filter((t) => t.status === "pending"),
        tasks: all,
        coupons: [...cr.results.map(coupon),...await recordingCouponsForMerchant(req)]
          .sort((a,b)=>b.issuedAt-a.issuedAt||a.id.localeCompare(b.id)),
        claims: cr.results.length,
        redeemed: cr.results.filter((c) => c.redeemed_at).length,
        distinctPlayers: new Set(cr.results.map((c) => c.player_id)).size,
      } as StaffState;
    }
    case "review": {
      if ((await staff(req)).role !== "admin")
        throw new GameError("只有运营演示账号可以审核", 403);
      if (!["published", "rejected", "offline"].includes(input.status))
        throw new GameError("审核状态不正确");
      const note = String(input.note || "").trim();
      if (note.length > 160) throw new GameError("审核意见不超过160字");
      if (input.status === "rejected" && !note)
        throw new GameError("退回前请填写修改建议");
      const reviewer =
        "staff-" +
        (await hash("review:" + cookie(req, "mall_staff"))).slice(0, 16);
      const publishable=`(?<>'published' OR (EXISTS(SELECT 1 FROM stores s WHERE s.id=tasks.store_id AND s.event_id='mall-48h' AND s.status='active')
        AND (expires_at IS NULL OR expires_at>?) AND (reward_type='points' OR reward_coupon_id IS NULL OR EXISTS(
          SELECT 1 FROM coupon_templates ct WHERE ct.id=tasks.reward_coupon_id AND ct.store_id=tasks.store_id AND ct.status='active' AND ct.deleted_at IS NULL
          AND (ct.valid_start IS NULL OR ct.valid_start<=?) AND (ct.valid_end IS NULL OR ct.valid_end>?)))))`;
      const results = await d.batch([
        d
          .prepare(
            `INSERT INTO task_reviews(id,task_id,reviewer_id,action,note,created_at) SELECT ?,id,?,?,?,? FROM tasks WHERE id=? AND deleted_at IS NULL AND ((? IN ('published','rejected') AND status='pending') OR (?='offline' AND status='published')) AND ${publishable}
              AND ${staffAuthorizationSQL(undefined,true)}`,
          )
          .bind(
            crypto.randomUUID(),
            reviewer,
            input.status,
            note,
            now,
            input.taskId,
            input.status,
            input.status,
            input.status,now,now,now,...staffAuth,
          ),
        d
          .prepare(
            `UPDATE tasks SET status=?,review_note=?,is_featured=CASE WHEN ?='offline' THEN 0 ELSE is_featured END WHERE id=? AND deleted_at IS NULL AND ((? IN ('published','rejected') AND status='pending') OR (?='offline' AND status='published')) AND ${publishable}
              AND ${staffAuthorizationSQL(undefined,true)}`,
          )
          .bind(
            input.status,
            note,
            input.status,
            input.taskId,
            input.status,
            input.status,
            input.status,now,now,now,...staffAuth,
          ),
      ]);
      if (!results[1].meta.changes)
        throw new GameError("任务状态已改变，请刷新列表");
      return {
        message:
          input.status === "published"
            ? "已发布，寻宝者现在可以看到"
            : "任务状态已更新",
      };
    }
    case "feature": {
      if ((await staff(req)).role !== "admin")
        throw new GameError("只有运营可以标记优质线索", 403);
      if (typeof input.featured !== "boolean")
        throw new GameError("优质标记格式不正确");
      const value = input.featured ? 1 : 0;
      const reviewer =
        "staff-" +
        (await hash("review:" + cookie(req, "mall_staff"))).slice(0, 16);
      const results = await d.batch([
        d
          .prepare(
            `INSERT INTO task_reviews(id,task_id,reviewer_id,action,note,created_at) SELECT ?,id,?,?,?,? FROM tasks WHERE id=? AND deleted_at IS NULL AND status='published' AND is_featured<>?
              AND ${staffAuthorizationSQL(undefined,true)}`,
          )
          .bind(
            crypto.randomUUID(),
            reviewer,
            value ? "featured" : "unfeatured",
            "",
            now,
            input.taskId,
            value,
            ...staffAuth,
          ),
        d
          .prepare(
            `UPDATE tasks SET is_featured=? WHERE id=? AND deleted_at IS NULL AND status='published' AND is_featured<>? AND ${staffAuthorizationSQL(undefined,true)}`,
          )
          .bind(value, input.taskId, value,...staffAuth),
      ]);
      if (!results[1].meta.changes)
        throw new GameError("标记已更新，或任务已下架，请刷新列表");
      return {
        message: value ? "已标记优质，公开任务列表优先展示" : "已取消优质标记",
      };
    }
    case "reviewHistory": {
      if ((await staff(req)).role !== "admin")
        throw new GameError("只有运营可以查看审核历史", 403);
      const taskId = String(input.taskId || "");
      if (
        !(await d
          .prepare("SELECT id FROM tasks WHERE id=?")
          .bind(taskId)
          .first())
      )
        throw new GameError("任务不存在", 404);
      const rows = await d
        .prepare(
          "SELECT * FROM task_reviews WHERE task_id=? ORDER BY created_at DESC,id DESC",
        )
        .bind(taskId)
        .all<Row>();
      return { reviews: rows.results.map((r): ReviewRecord => ({
        id: r.id,
        taskId: r.task_id,
        reviewer: "演示运营 " + r.reviewer_id.slice(-6).toUpperCase(),
        action: r.action,
        note: r.note,
        createdAt: r.created_at,
      })) };
    }
    case "couponPreview": {
      const ss = await staff(req);
      if (ss.role !== "merchant") throw new GameError("请切换到对应门店的商家演示账号", 403);
      if (typeof input.code !== "string" || !input.code.trim() || input.code.trim().length > 128)
        throw new GameError("请填写有效的优惠券核销码");
      const code = input.code.trim().toUpperCase();
      if(isRecordingCouponCode(code))return recordingCouponPreview(req,code);
      const row = await d.prepare(COUPON_SELECT + " WHERE c.coupon_code=? AND c.store_id=? AND c.event_id=? AND c.reward_type='coupon'")
        .bind(code, ss.store_id, EVENT).first<Row>();
      if (!row) throw new GameError("券码不存在，或不属于当前门店");
      const current = coupon(row), canRedeem = current.status === "unused";
      const preview: CouponPreview = { coupon: current, canRedeem,
        message: current.status === "used" ? "这张券已经使用，不能重复核销" : current.status === "expired" ? "这张券已过期，不能核销" :
          current.status === "upcoming" ? "这张券尚未到使用日期" : "券码有效，确认后完成核销" };
      return preview;
    }
    case "redeem": {
      const ss = await staff(req);
      if (ss.role !== "merchant")
        throw new GameError("请切换到对应门店的商家演示账号", 403);
      const code = String(input.code || "")
        .trim()
        .toUpperCase();
      if(isRecordingCouponCode(code))return recordingCouponRedeem(req,code);
      const r = await d
        .prepare(
          `UPDATE claims SET redeemed_at=? WHERE coupon_code=? AND store_id=? AND event_id=? AND redeemed_at IS NULL AND reward_type='coupon' AND (valid_start IS NULL OR valid_start<=?) AND (valid_end IS NULL OR valid_end>?)
            AND ${staffAuthorizationSQL("claims.store_id")}`,
        )
        .bind(now, code, ss.store_id, EVENT,now,now,...staffAuth)
        .run();
      if (!r.meta.changes) {
        const old = await d
          .prepare(
            "SELECT store_id,redeemed_at,reward_type,valid_start,valid_end FROM claims WHERE coupon_code=? AND event_id=?",
          )
          .bind(code, EVENT)
          .first<Row>();
        if (old?.store_id === ss.store_id && old.redeemed_at!==null&&old.redeemed_at!==undefined)
          throw new GameError("这张券已经使用，不能重复核销");
        if(old?.store_id===ss.store_id&&old.reward_type==='coupon'&&old.valid_end!==null&&old.valid_end<=now)throw new GameError("这张券已过期，不能核销");
        if(old?.store_id===ss.store_id&&old.valid_start!==null&&old.valid_start>now)throw new GameError("这张券尚未到使用日期");
        throw new GameError("券码不存在，或不属于当前门店");
      }
      return { message: "核销成功，玩家卡包状态已更新" };
    }
    default:
      throw new GameError("操作不存在");
  }
}
