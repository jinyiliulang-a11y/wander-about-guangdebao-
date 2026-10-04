import { COUPON_SELECT, coupon, db, hash, session } from "./game-server";
import { registeredPlayer } from "./account-auth";
import { authorizationValues, playerAuthorizationSQL, staffAuthorizationSQL } from "./account-authorization";
import { GameError } from "./game-error";
import { requireStoreGeofence } from "./geofence-server";
import { validGeoLocation } from "./geofence";
import { verifyHardwareEntryToken } from "./hardware-server";
import { HARDWARE_DEVICE_ID } from "./hardware-code";
import { deviceDisplayName } from "./device-display";
import { HARDWARE_DEMO_INSTANCE } from "./application-scope";
import { NFC_LOCATION_PERMIT_MS, NFC_RANGE_SQL } from "./hardware-demo-policy";
import type { NfcClaimResult, NfcClaimStatus } from "./game-types";
import { FIXED_DEVICE_CODE_PREFIX } from "./nfc-draft-types";
import type { NfcDraft, NfcDraftPage, NfcDraftResult, NfcDraftOperationStatus, MerchantPendingClaims, MerchantIssueClaimResult } from "./nfc-draft-types";

type Row = Record<string, unknown>;
type Identity = { playerId: string; accountId: string; tokenHash: string; auth: [string, number] };
type Merchant = { playerId: string; accountId: string; storeId: string; auth: [string, number] };
const EVENT = "mall-48h";
const CLOCK = "CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// Group related guards so D1's expression-depth limit does not flatten one long AND tree.
// This preserves every authorization/stock condition and the single-statement claim CAS.
const BASE = `(t.nfc_claim=1 AND t.status='published' AND t.deleted_at IS NULL AND ap.banned=0
  AND s.event_id='${EVENT}' AND s.point_mode='hardware' AND s.status='active'
  AND (t.expires_at IS NULL OR t.expires_at>${CLOCK})
  AND (t.reward_type='points' OR t.reward_coupon_id IS NULL OR
    (ct.store_id=s.id AND ct.status='active' AND ct.deleted_at IS NULL
      AND (ct.valid_start IS NULL OR ct.valid_start<=${CLOCK}) AND (ct.valid_end IS NULL OR ct.valid_end>${CLOCK}))))`;
const STOCK = `((SELECT COUNT(*) FROM claims c WHERE c.store_id=s.id AND c.event_id=s.event_id)<s.stock_total
  AND (t.reward_type='points' OR ct.id IS NULL OR (SELECT COUNT(*) FROM claims WHERE template_id=ct.id)<ct.total_count))`;
const DEVICE = `(h.enabled=1 AND h.store_id=s.id AND h.bound_task_id=t.id
  AND (h.id<>'coin-tea-01' OR (s.id='tea' AND t.id='quest-tea')))`;
const REWARD = `CASE WHEN t.reward_type='points' THEN t.reward_value || ' 探索积分' ELSE COALESCE(ct.title,s.reward_title) END`;
const CONDITIONS = `CASE WHEN ct.id IS NULL THEN s.conditions ELSE '消费门槛 ¥' || ct.min_amount || '；按券内容使用；仅演示，不可实际消费。' END`;
const JOINS = `JOIN stores s ON s.id=t.store_id JOIN players ap ON ap.id=t.author_id
  JOIN hardware_devices h ON h.store_id=s.id AND h.bound_task_id=t.id LEFT JOIN coupon_templates ct ON ct.id=t.reward_coupon_id`;
const SNAPSHOT = `t.title AS task_title_snapshot,s.name AS store_name_snapshot,t.reward_type,t.reward_value,t.reward_coupon_id AS template_id,
  ${REWARD} AS reward_snapshot,${CONDITIONS} AS conditions_snapshot,COALESCE(ct.type,'gift') AS coupon_type,
  COALESCE(ct.value,0) AS coupon_value,COALESCE(ct.min_amount,0) AS coupon_min_amount,ct.valid_start,ct.valid_end`;
const SUBJECT = `EXISTS(SELECT 1 FROM sessions ps JOIN accounts pa ON pa.id=ps.account_id JOIN players pp ON pp.id=ps.player_id
  WHERE ps.token_hash=d.player_session_hash AND ps.role='player' AND ps.expires_at>${CLOCK}
    AND ps.player_id=d.player_id AND ps.account_id=d.player_account_id AND pa.player_id=d.player_id
    AND pa.role='player' AND pa.status='approved' AND pp.banned=0)`;
const MATCH = `(d.task_title_snapshot=t.title AND d.store_name_snapshot=s.name AND d.reward_type=t.reward_type AND d.reward_value=t.reward_value
  AND d.template_id IS t.reward_coupon_id AND d.reward_snapshot=${REWARD} AND d.conditions_snapshot=${CONDITIONS}
  AND d.coupon_type=COALESCE(ct.type,'gift') AND d.coupon_value=COALESCE(ct.value,0) AND d.coupon_min_amount=COALESCE(ct.min_amount,0)
  AND d.valid_start IS ct.valid_start AND d.valid_end IS ct.valid_end)`;
const READY = `(d.state='pending' AND d.permit_until>${CLOCK} AND d.location_timestamp>=${CLOCK}-${NFC_LOCATION_PERMIT_MS}
  AND d.location_timestamp<=${CLOCK}+5000 AND ${NFC_RANGE_SQL} AND g.revision=d.fence_revision
  AND h.id=d.device_id AND h.token_hash=d.device_token_hash AND t.author_id<>d.player_id
  AND ${BASE} AND ${STOCK} AND ${DEVICE} AND ${SUBJECT} AND ${MATCH}
  AND NOT EXISTS(SELECT 1 FROM claims WHERE player_id=d.player_id AND event_id=d.event_id AND store_id=d.store_id))`;
const DRAFT_SELECT = `SELECT d.*,p.nickname AS player_nickname,CASE WHEN ${READY} THEN 1 ELSE 0 END AS can_confirm
  FROM nfc_claim_drafts d JOIN players p ON p.id=d.player_id
  LEFT JOIN tasks t ON t.id=d.task_id LEFT JOIN stores s ON s.id=d.store_id LEFT JOIN players ap ON ap.id=t.author_id
  LEFT JOIN hardware_devices h ON h.id=d.device_id LEFT JOIN coupon_templates ct ON ct.id=t.reward_coupon_id
  LEFT JOIN store_geofences g ON g.store_id=d.store_id`;

function identifier(value: unknown, label: string) {
  if (typeof value !== "string" || !value || value.length > 100) throw new GameError(`${label}不正确`);
  return value;
}
function requestId(value: unknown) {
  if (typeof value !== "string" || !UUID.test(value.toLowerCase())) throw new GameError("请求标识不正确，请保留原请求并核对");
  return value.toLowerCase();
}
function revision(value: unknown) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || value >= Number.MAX_SAFE_INTEGER) throw new GameError("待领记录版本不正确，请刷新列表");
  return value;
}
function pagination(input: Row) {
  const page = input.page ?? 1, pageSize = input.pageSize ?? 10;
  if (typeof page !== "number" || !Number.isSafeInteger(page) || page < 1 || page > 100000 ||
    typeof pageSize !== "number" || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 20) throw new GameError("分页参数不正确");
  return { page, pageSize };
}
async function playerIdentity(req: Request): Promise<Identity> {
  const playerId = await registeredPlayer(req), auth = await authorizationValues(req);
  const row = await db().prepare(`SELECT account_id FROM sessions s WHERE s.token_hash=? AND s.player_id=? AND ${playerAuthorizationSQL("s.player_id")}`)
    .bind(auth[0], playerId, ...auth).first<Row>();
  if (!row?.account_id) throw new GameError("登录身份已变化，请重新登录", 401);
  return { playerId, accountId: String(row.account_id), tokenHash: auth[0], auth };
}
function merchantGuard() {
  return `(${staffAuthorizationSQL("s.id")} AND EXISTS(SELECT 1 FROM sessions ms WHERE ms.token_hash=? AND ms.role='merchant'
    AND ms.account_id=? AND ms.player_id=? AND ms.store_id=s.id))`;
}
function merchantValues(scope: Merchant) { return [...scope.auth, scope.auth[0], scope.accountId, scope.playerId]; }
async function merchantIdentity(req: Request): Promise<Merchant> {
  const current = await session(req, true);
  if (!current || current.role !== "merchant" || !current.store_id || !current.account_id || !current.player_id)
    throw new GameError("请使用已通过审核的本店商家账号", 403);
  const auth = await authorizationValues(req, true);
  const scope = { playerId: current.player_id, accountId: current.account_id, storeId: current.store_id, auth };
  const store = await db().prepare(`SELECT s.id FROM stores s WHERE s.id=? AND s.event_id=? AND ${merchantGuard()}`)
    .bind(scope.storeId, EVENT, ...merchantValues(scope)).first();
  if (!store) throw new GameError("商家门店权限已变化，请重新登录", 403);
  return scope;
}
async function dto(row: Row): Promise<NfcDraft> {
  const result: NfcDraft = { id: String(row.id), requestId: String(row.id), playerId: String(row.player_id), playerNickname: String(row.player_nickname),
    storeId: String(row.store_id), storeName: String(row.store_name_snapshot), taskId: String(row.task_id), taskTitle: String(row.task_title_snapshot),
    deviceId: String(row.device_id), reward: String(row.reward_snapshot), conditions: String(row.conditions_snapshot),
    rewardType: row.reward_type as "coupon" | "points", rewardValue: Number(row.reward_value), state: row.state as NfcDraft["state"],
    revision: Number(row.revision), createdAt: Number(row.created_at), updatedAt: Number(row.updated_at), permitUntil: Number(row.permit_until), canConfirm: row.can_confirm === 1 };
  if (row.device_returned_at != null) result.returnedAt = Number(row.device_returned_at);
  if (row.state === "issued" && row.claim_id) {
    const claim = await db().prepare(COUPON_SELECT + " WHERE c.id=? AND c.player_id=? AND c.store_id=? AND c.event_id=?")
      .bind(String(row.claim_id), String(row.player_id), String(row.store_id), EVENT).first();
    if (claim) result.coupon = coupon(claim);
  }
  return result;
}
async function playerDraft(identity: Identity, id: string) {
  const row = await db().prepare(DRAFT_SELECT + ` WHERE d.id=? AND d.player_id=? AND d.event_id=? AND ${playerAuthorizationSQL("d.player_id")}`)
    .bind(id, identity.playerId, EVENT, ...identity.auth).first<Row>();
  return row ? dto(row) : null;
}
async function merchantDraft(scope: Merchant, id: string) {
  const row = await db().prepare(DRAFT_SELECT + ` WHERE d.id=? AND d.store_id=? AND d.event_id=? AND ${merchantGuard()}`)
    .bind(id, scope.storeId, EVENT, ...merchantValues(scope)).first<Row>();
  return row ? dto(row) : null;
}
async function priorOperation(id: string, actor: string, purpose: string, digest: string) {
  const previous = await db().prepare("SELECT * FROM nfc_draft_operations WHERE request_id=?").bind(id).first<Row>();
  if (previous && (previous.actor_account_id !== actor || previous.purpose !== purpose || previous.request_hash !== digest))
    throw new GameError("原请求标识已对应其他操作，请核对原请求", 409);
  return previous;
}
async function candidate(taskId: string, deviceId?: string) {
  const rows = await db().prepare(`SELECT t.id,t.store_id,t.author_id,h.id AS device_id,h.token_hash AS device_token_hash,${SNAPSHOT}
    FROM tasks t ${JOINS} WHERE t.id=? AND ${BASE} AND ${DEVICE} AND ${STOCK} ${deviceId ? "AND h.id=?" : ""} LIMIT 2`)
    .bind(taskId, ...(deviceId ? [deviceId] : [])).all<Row>();
  if (rows.results.length > 1) throw new GameError("此活动有多台金币设备，请配置带设备标识的NFC入口", 409);
  return rows.results[0] ?? null;
}
function available(row: Row | null, playerId: string) {
  if (!row) throw new GameError("金币、设备、活动或奖励已不可申请，请核对门店", 409);
  if (row.author_id === playerId) throw new GameError("这是你创作的活动，请邀请朋友寻找", 409);
  return row;
}
async function throttle(identity: Identity, store: string) {
  const now = Date.now(), limit = now - 60000;
  const changed = await db().prepare(`INSERT INTO hardware_claim_attempts(player_id,store_id,window_started_at,attempt_count)
    SELECT ?,?,?,1 WHERE ${playerAuthorizationSQL("?")}
    ON CONFLICT(player_id,store_id) DO UPDATE SET window_started_at=CASE WHEN window_started_at<=? THEN excluded.window_started_at ELSE window_started_at END,
      attempt_count=CASE WHEN window_started_at<=? THEN 1 ELSE attempt_count+1 END WHERE (window_started_at<=? OR attempt_count<8)
      AND ${playerAuthorizationSQL("hardware_claim_attempts.player_id")}`)
    .bind(identity.playerId, store, now, ...identity.auth, identity.playerId, limit, limit, limit, ...identity.auth).run();
  if (!changed.meta.changes) throw new GameError("申请较频繁，请稍等一分钟后再试", 429);
}
function snapshotValues(task: Row) {
  return [task.task_title_snapshot, task.store_name_snapshot, task.reward_type, task.reward_value, task.template_id, task.reward_snapshot,
    task.conditions_snapshot, task.coupon_type, task.coupon_value, task.coupon_min_amount, task.valid_start, task.valid_end];
}

/** Passive NFC identifies an activity, not a trusted physical-tap proof. */
export async function nfcClaim(req: Request, input: Row): Promise<NfcClaimResult> {
  const identity = await playerIdentity(req), id = requestId(input.requestId), taskId = identifier(input.taskId, "金币活动标识");
  if (!validGeoLocation(input.location)) throw new GameError("请先定位并检查门店范围");
  if (input.entryToken !== undefined && typeof input.entryToken !== "string") throw new GameError("金币入口格式不正确");
  if (input.deviceId !== undefined && (typeof input.deviceId !== "string" || !HARDWARE_DEVICE_ID.test(input.deviceId))) throw new GameError("NFC设备标识不正确");
  const location = input.location, explicitDevice = input.deviceId as string | undefined;
  const digest = await hash(JSON.stringify(["nfc-draft:v1", identity.playerId, taskId, explicitDevice ?? null, input.entryToken ?? null,
    location.latitude, location.longitude, location.accuracy, location.timestamp]));
  const previous = await priorOperation(id, identity.accountId, "create", digest);
  if (previous) {
    const draft = await playerDraft(identity, String(previous.draft_id));
    if (!draft) throw new GameError("当前账号不能读取原申请", 401);
    return { requestId: id, draft, newlyCreated: false, message: "原申请已保存，请查看待领取列表" };
  }
  if (await db().prepare("SELECT id FROM claims WHERE id=?").bind(id).first()) throw new GameError("原请求已对应正式领取记录，请在卡包核对", 409);
  // A signed optional entry can identify one device before checking ambiguity.
  const entryTask = await db().prepare("SELECT store_id FROM tasks WHERE id=?").bind(taskId).first<Row>();
  const entry = input.entryToken === undefined ? undefined : await verifyHardwareEntryToken(input.entryToken, taskId, String(entryTask?.store_id ?? ""));
  if (entry && explicitDevice && entry.deviceId !== explicitDevice) throw new GameError("NFC设备与动态入口设备不一致", 409);
  const task = available(await candidate(taskId, entry?.deviceId ?? explicitDevice), identity.playerId);
  if (entry && task.device_token_hash !== entry.tokenHash) throw new GameError("金币入口授权已变化，请重新打开入口", 409);
  const verified = await requireStoreGeofence(String(task.store_id), location);
  await throttle(identity, String(task.store_id));
  let created = false;
  try {
    const result = await db().prepare(`INSERT INTO nfc_claim_drafts(id,request_hash,player_id,player_account_id,player_session_hash,event_id,store_id,task_id,
      device_id,device_token_hash,created_at,updated_at,permit_until,location_timestamp,fence_revision,
      task_title_snapshot,store_name_snapshot,reward_type,reward_value,template_id,reward_snapshot,conditions_snapshot,
      coupon_type,coupon_value,coupon_min_amount,valid_start,valid_end,last_request_id,last_request_hash,last_purpose,last_actor_account_id)
      SELECT ?,?,?,?,?,s.event_id,s.id,t.id,h.id,h.token_hash,${CLOCK},${CLOCK},?+${NFC_LOCATION_PERMIT_MS},?,g.revision,
        t.title,s.name,t.reward_type,t.reward_value,t.reward_coupon_id,${REWARD},${CONDITIONS},COALESCE(ct.type,'gift'),COALESCE(ct.value,0),COALESCE(ct.min_amount,0),ct.valid_start,ct.valid_end,?,?,'create',?
      FROM tasks t ${JOINS} JOIN store_geofences g ON g.store_id=s.id
      WHERE t.id=? AND h.id=? AND h.token_hash=? AND t.author_id<>? AND ${BASE} AND ${STOCK} AND ${DEVICE}
        AND ${NFC_RANGE_SQL} AND g.revision=? AND ?>=${CLOCK}-${NFC_LOCATION_PERMIT_MS} AND ?<=${CLOCK}+5000
        AND ${playerAuthorizationSQL("?")} ${entry ? `AND ?>${CLOCK}` : ""}
        ${entry || explicitDevice ? "" : `AND (SELECT COUNT(*) FROM hardware_devices other WHERE other.bound_task_id=t.id AND other.store_id=s.id AND other.enabled=1)=1`}
        AND NOT EXISTS(SELECT 1 FROM claims WHERE player_id=? AND event_id=s.event_id AND store_id=s.id)
        AND NOT EXISTS(SELECT 1 FROM nfc_claim_drafts WHERE player_id=? AND event_id=s.event_id AND store_id=s.id AND state='pending')
        AND NOT EXISTS(SELECT 1 FROM nfc_draft_operations WHERE request_id=?) AND NOT EXISTS(SELECT 1 FROM claims WHERE id=?)`)
      .bind(id, digest, identity.playerId, identity.accountId, identity.tokenHash, location.timestamp, location.timestamp, id, digest, identity.accountId,
        taskId, String(task.device_id), entry?.tokenHash ?? String(task.device_token_hash), identity.playerId,
        verified.fence.revision, location.timestamp, location.timestamp, ...identity.auth, identity.playerId,
        ...(entry ? [entry.expiresAt] : []), identity.playerId, identity.playerId, id, id).run();
    created = !!result.meta.changes;
  } catch (error) {
    if (!await priorOperation(id, identity.accountId, "create", digest)) throw error;
  }
  const saved = await priorOperation(id, identity.accountId, "create", digest), draft = saved ? await playerDraft(identity, String(saved.draft_id)) : null;
  if (draft) return { requestId: id, draft, newlyCreated: created, message: "待领取申请已保存；商家扫码确认后，正式奖励才会进入卡包" };
  await registeredPlayer(req);
  const active = await db().prepare("SELECT id FROM nfc_claim_drafts WHERE player_id=? AND event_id=? AND store_id=? AND state='pending'")
    .bind(identity.playerId, EVENT, String(task.store_id)).first();
  if (active) throw new GameError("本店已有待领取申请，请从卡包的待领取抽屉打开", 409);
  throw new GameError("设备、奖励、范围或账号状态已变化，申请未保存，请刷新核对", 409);
}
export async function nfcClaimStatus(req: Request, input: Row): Promise<NfcClaimStatus> {
  const identity = await playerIdentity(req), id = requestId(input.requestId);
  const operation = await db().prepare("SELECT draft_id FROM nfc_draft_operations WHERE request_id=? AND purpose='create' AND actor_account_id=?")
    .bind(id, identity.accountId).first<Row>();
  const draft = operation ? await playerDraft(identity, String(operation.draft_id)) : null;
  if (draft) return { found: true, requestId: id, draft, ...(draft.coupon ? { coupon: draft.coupon } : {}) };
  const old = await db().prepare(COUPON_SELECT + ` WHERE c.id=? AND c.player_id=? AND c.event_id=? AND c.nfc_request_hash IS NOT NULL AND ${playerAuthorizationSQL("c.player_id")}`)
    .bind(id, identity.playerId, EVENT, ...identity.auth).first();
  return old ? { found: true, requestId: id, coupon: coupon(old) } : { found: false, requestId: id };
}
export async function nfcDrafts(req: Request, input: Row): Promise<NfcDraftPage> {
  const identity = await playerIdentity(req), { page, pageSize } = pagination(input);
  const where = ` WHERE d.player_id=? AND d.event_id=? AND d.state='pending' AND ${playerAuthorizationSQL("d.player_id")}`;
  const values = [identity.playerId, EVENT, ...identity.auth];
  const count = await db().prepare("SELECT COUNT(*) AS total FROM nfc_claim_drafts d" + where).bind(...values).first<{ total: number }>();
  const rows = await db().prepare(DRAFT_SELECT + where + " ORDER BY d.created_at DESC,d.id DESC LIMIT ? OFFSET ?")
    .bind(...values, pageSize, (page - 1) * pageSize).all<Row>();
  const total = Number(count?.total ?? 0);
  return { items: await Promise.all(rows.results.map(dto)), page, pageSize, total, totalPages: Math.ceil(total / pageSize) };
}
async function changeDraft(req: Request, input: Row, purpose: "revalidate" | "delete"): Promise<NfcDraftResult> {
  const identity = await playerIdentity(req), id = requestId(input.requestId), draftId = requestId(input.draftId), expected = revision(input.expectedRevision);
  const location = input.location;
  if (purpose === "revalidate" && !validGeoLocation(location)) throw new GameError("请提供新的完整定位");
  const digest = await hash(JSON.stringify(["nfc-draft-operation:v1", purpose, identity.playerId, draftId, expected, purpose === "revalidate" ? location : null]));
  const previous = await priorOperation(id, identity.accountId, purpose, digest);
  if (previous) {
    const draft = await playerDraft(identity, String(previous.draft_id));
    if (!draft) throw new GameError("当前账号不能读取原操作", 401);
    return { requestId: id, draft, message: "原操作已完成" };
  }
  const before = await playerDraft(identity, draftId);
  if (!before) throw new GameError("待领取申请不存在", 404);
  if (before.state !== "pending" || before.revision !== expected) throw new GameError("待领取申请已变化，请刷新核对", 409);
  let result;
  if (purpose === "delete") {
    result = await db().prepare(`UPDATE nfc_claim_drafts AS d SET state='deleted',revision=revision+1,updated_at=${CLOCK},permit_until=0,
      last_request_id=?,last_request_hash=?,last_purpose='delete',last_actor_account_id=?
      WHERE d.id=? AND d.player_id=? AND d.state='pending' AND d.revision=? AND ${playerAuthorizationSQL("d.player_id")}
        AND NOT EXISTS(SELECT 1 FROM nfc_draft_operations WHERE request_id=?)`)
      .bind(id, digest, identity.accountId, draftId, identity.playerId, expected, ...identity.auth, id).run();
  } else {
    const position = location as { timestamp: number };
    const task = available(await candidate(before.taskId, before.deviceId), identity.playerId);
    const verified = await requireStoreGeofence(before.storeId, location);
    await throttle(identity, before.storeId);
    result = await db().prepare(`UPDATE nfc_claim_drafts AS d SET revision=revision+1,updated_at=${CLOCK},permit_until=?+${NFC_LOCATION_PERMIT_MS},
      location_timestamp=?,fence_revision=?,device_token_hash=?,player_account_id=?,player_session_hash=?,
      task_title_snapshot=?,store_name_snapshot=?,reward_type=?,reward_value=?,template_id=?,reward_snapshot=?,conditions_snapshot=?,
      coupon_type=?,coupon_value=?,coupon_min_amount=?,valid_start=?,valid_end=?,
      last_request_id=?,last_request_hash=?,last_purpose='revalidate',last_actor_account_id=?
      WHERE d.id=? AND d.player_id=? AND d.state='pending' AND d.revision=? AND ${playerAuthorizationSQL("d.player_id")}
        AND NOT EXISTS(SELECT 1 FROM nfc_draft_operations WHERE request_id=?)
        AND EXISTS(SELECT 1 FROM tasks t ${JOINS} JOIN store_geofences g ON g.store_id=s.id
          WHERE t.id=d.task_id AND s.id=d.store_id AND h.id=d.device_id AND h.token_hash=? AND t.author_id<>d.player_id
            AND ${BASE} AND ${STOCK} AND ${DEVICE} AND ${NFC_RANGE_SQL} AND g.revision=?
            AND ?>=${CLOCK}-${NFC_LOCATION_PERMIT_MS} AND ?<=${CLOCK}+5000)
        AND NOT EXISTS(SELECT 1 FROM claims WHERE player_id=d.player_id AND event_id=d.event_id AND store_id=d.store_id)`)
      .bind(position.timestamp, position.timestamp, verified.fence.revision, String(task.device_token_hash), identity.accountId, identity.tokenHash,
        ...snapshotValues(task), id, digest, identity.accountId, draftId, identity.playerId, expected, ...identity.auth, id,
        String(task.device_token_hash), verified.fence.revision, position.timestamp, position.timestamp).run();
  }
  const operation = await priorOperation(id, identity.accountId, purpose, digest), draft = operation ? await playerDraft(identity, draftId) : null;
  if (!draft) throw new GameError("申请版本、范围或身份已变化，本次操作未完成，请刷新核对", 409);
  return { requestId: id, draft, message: result.meta.changes ? purpose === "delete" ? "待领取草稿已删除" : HARDWARE_DEMO_INSTANCE ? "定位已记录，请让商家在10分钟内确认收回设备并领取" : "范围已重新确认，请让商家在30秒内确认领取" : "原操作已完成" };
}
export const nfcDraftRevalidate = (req: Request, input: Row) => changeDraft(req, input, "revalidate");
export const nfcDraftDelete = (req: Request, input: Row) => changeDraft(req, input, "delete");
export async function nfcDraftOperationStatus(req: Request, input: Row): Promise<NfcDraftOperationStatus> {
  const identity = await playerIdentity(req), id = requestId(input.requestId);
  const previous = await db().prepare("SELECT draft_id FROM nfc_draft_operations WHERE request_id=? AND actor_account_id=? AND purpose IN ('create','revalidate','delete')")
    .bind(id, identity.accountId).first<Row>();
  const draft = previous ? await playerDraft(identity, String(previous.draft_id)) : null;
  return draft ? { found: true, requestId: id, draft, ...(draft.coupon ? { coupon: draft.coupon } : {}) } : { found: false, requestId: id };
}
function fixedDeviceId(value: unknown) {
  if (typeof value !== "string" || !value.startsWith(FIXED_DEVICE_CODE_PREFIX) || !HARDWARE_DEVICE_ID.test(value.slice(FIXED_DEVICE_CODE_PREFIX.length)))
    throw new GameError("请扫描专用固定设备码，不能使用个人券码或网页地址");
  return value.slice(FIXED_DEVICE_CODE_PREFIX.length);
}
async function merchantDevice(scope: Merchant, deviceCode: unknown) {
  const id = fixedDeviceId(deviceCode);
  const row = await db().prepare(`SELECT h.id,s.id AS store_id,s.name AS store_name,t.id AS task_id
    FROM hardware_devices h JOIN stores s ON s.id=h.store_id JOIN tasks t ON t.id=h.bound_task_id JOIN players ap ON ap.id=t.author_id
    LEFT JOIN coupon_templates ct ON ct.id=t.reward_coupon_id
    WHERE h.id=? AND s.id=? AND ${BASE} AND ${DEVICE} AND ${merchantGuard()}`)
    .bind(id, scope.storeId, ...merchantValues(scope)).first<Row>();
  if (!row) throw new GameError("设备未登记、不属于本店、已停用或活动已解绑", 404);
  return { id, name: deviceDisplayName(id), storeId: scope.storeId, storeName: String(row.store_name), taskId: String(row.task_id), code: FIXED_DEVICE_CODE_PREFIX + id };
}
export async function merchantPendingClaims(req: Request, input: Row): Promise<MerchantPendingClaims> {
  const scope = await merchantIdentity(req), device = await merchantDevice(scope, input.deviceCode), { page, pageSize } = pagination(input);
  const where = ` WHERE d.store_id=? AND d.device_id=? AND d.task_id=? AND d.event_id=? AND d.state='pending' AND ${merchantGuard()}`;
  const values = [scope.storeId, device.id, device.taskId, EVENT, ...merchantValues(scope)];
  const count = await db().prepare(`SELECT COUNT(*) AS total FROM nfc_claim_drafts d JOIN stores s ON s.id=d.store_id` + where)
    .bind(...values).first<{ total: number }>();
  const rows = await db().prepare(DRAFT_SELECT + where + " ORDER BY d.created_at DESC,d.id DESC LIMIT ? OFFSET ?")
    .bind(...values, pageSize, (page - 1) * pageSize).all<Row>();
  const total = Number(count?.total ?? 0);
  return { device, items: await Promise.all(rows.results.map(dto)), page, pageSize, total, totalPages: Math.ceil(total / pageSize) };
}
/** Merchants may browse their store's queue before scanning. Browsing cannot issue rewards. */
export async function merchantPendingQueue(req: Request, input: Row): Promise<NfcDraftPage> {
  const scope = await merchantIdentity(req), { page, pageSize } = pagination(input);
  if (input.storeId !== undefined && input.storeId !== scope.storeId) throw new GameError("不能读取其他门店的待领取申请", 403);
  const where = ` WHERE d.store_id=? AND d.event_id=? AND d.state='pending' AND ${merchantGuard()}`;
  const values = [scope.storeId, EVENT, ...merchantValues(scope)];
  const count = await db().prepare(`SELECT COUNT(*) AS total FROM nfc_claim_drafts d JOIN stores s ON s.id=d.store_id` + where)
    .bind(...values).first<{ total: number }>();
  const rows = await db().prepare(DRAFT_SELECT + where + " ORDER BY d.created_at DESC,d.id DESC LIMIT ? OFFSET ?")
    .bind(...values, pageSize, (page - 1) * pageSize).all<Row>();
  const latest = await merchantIdentity(req);
  if (latest.accountId !== scope.accountId || latest.storeId !== scope.storeId || latest.playerId !== scope.playerId)
    throw new GameError("商家身份已变化，请重新登录后查看待领取队列", 403);
  const total = Number(count?.total ?? 0);
  return { items: await Promise.all(rows.results.map(dto)), page, pageSize, total, totalPages: Math.ceil(total / pageSize) };
}
export async function merchantIssueClaim(req: Request, input: Row): Promise<MerchantIssueClaimResult> {
  const scope = await merchantIdentity(req), id = requestId(input.requestId), draftId = requestId(input.draftId), expected = revision(input.expectedRevision);
  const deviceId = fixedDeviceId(input.deviceCode);
  if (input.receivedDevice !== true) throw new GameError("请先确认已收到对应金币设备，再发放奖励");
  const digest = await hash(JSON.stringify(["nfc-merchant-issue:v1", scope.accountId, scope.storeId, draftId, expected, deviceId, true]));
  const previous = await priorOperation(id, scope.accountId, "issue", digest);
  if (previous) {
    const draft = await merchantDraft(scope, String(previous.draft_id));
    if (!draft?.coupon) throw new GameError("原确认结果不能读取，请核对原请求", 409);
    return { requestId: id, draft, coupon: draft.coupon, newlyIssued: false, message: "原确认已发放奖励；优惠券以后由玩家自行出示核销" };
  }
  await merchantDevice(scope, input.deviceCode);
  const before = await merchantDraft(scope, draftId);
  if (!before) throw new GameError("本店没有这条待领取申请", 404);
  if (before.deviceId !== deviceId || before.state !== "pending" || before.revision !== expected || !before.canConfirm)
    throw new GameError("申请、设备或范围许可已变化，请让玩家重新定位并刷新待领取列表", 409);
  const code = "GTB-" + crypto.randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase();
  let newlyIssued = false;
  try {
    const changed = await db().prepare(`UPDATE nfc_claim_drafts AS d SET state='issued',revision=revision+1,updated_at=${CLOCK},device_returned_at=${CLOCK},
      claim_id=?,coupon_code=?,merchant_account_id=?,last_request_id=?,last_request_hash=?,last_purpose='issue',last_actor_account_id=?
      WHERE d.id=? AND d.store_id=? AND d.device_id=? AND d.state='pending' AND d.revision=?
        AND NOT EXISTS(SELECT 1 FROM nfc_draft_operations WHERE request_id=?) AND NOT EXISTS(SELECT 1 FROM claims WHERE id=?)
        AND EXISTS(SELECT 1 FROM tasks t ${JOINS} JOIN store_geofences g ON g.store_id=s.id
          WHERE t.id=d.task_id AND s.id=d.store_id AND h.id=d.device_id AND ${READY} AND ${merchantGuard()})`)
      .bind(id, code, scope.accountId, id, digest, scope.accountId, draftId, scope.storeId, deviceId, expected, id, id, ...merchantValues(scope)).run();
    newlyIssued = !!changed.meta.changes;
  } catch (error) {
    if (!await priorOperation(id, scope.accountId, "issue", digest)) throw error;
  }
  const saved = await priorOperation(id, scope.accountId, "issue", digest), draft = saved ? await merchantDraft(scope, String(saved.draft_id)) : null;
  if (!draft?.coupon) throw new GameError("账号、申请、范围、设备或奖励库存已变化；本次没有发券，请刷新核对", 409);
  return { requestId: id, draft, coupon: draft.coupon, newlyIssued, message: draft.rewardType === "points" ? "已收到金币，领取已确认，金币与积分已记录" : "已收到金币，正式优惠券已放入玩家卡包，尚未核销" };
}
export async function merchantIssueClaimStatus(req: Request, input: Row): Promise<NfcDraftOperationStatus> {
  const scope = await merchantIdentity(req), id = requestId(input.requestId);
  const previous = await db().prepare("SELECT draft_id FROM nfc_draft_operations WHERE request_id=? AND purpose='issue' AND actor_account_id=?")
    .bind(id, scope.accountId).first<Row>();
  const draft = previous ? await merchantDraft(scope, String(previous.draft_id)) : null;
  return draft?.coupon ? { found: true, requestId: id, draft, coupon: draft.coupon } : { found: false, requestId: id };
}
export async function nfcDraftAction(req: Request, input: Row) {
  switch (input.action) {
    case "nfcDrafts": return nfcDrafts(req, input);
    case "nfcDraftRevalidate": return nfcDraftRevalidate(req, input);
    case "nfcDraftDelete": return nfcDraftDelete(req, input);
    case "nfcDraftOperationStatus": return nfcDraftOperationStatus(req, input);
    case "merchantPendingClaims": return merchantPendingClaims(req, input);
    case "merchantPendingQueue": return merchantPendingQueue(req, input);
    case "merchantIssueClaim": return merchantIssueClaim(req, input);
    case "merchantIssueClaimStatus": return merchantIssueClaimStatus(req, input);
    default: return null;
  }
}
