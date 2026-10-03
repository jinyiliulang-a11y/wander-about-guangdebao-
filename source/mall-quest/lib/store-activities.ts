import { cookie, db, hash, staff } from "./game-server";
import { GameError } from "./game-error";
import { staffAuthorizationSQL } from "./account-authorization";
import { validCoordinates, validRadius } from "./geofence";
import type { StoreGeofence } from "./geofence";
import {
  STORE_ACTIVITY_DESCRIPTION_LIMIT, STORE_ACTIVITY_PAGE_SIZE, STORE_ACTIVITY_REVIEW_NOTE_LIMIT,
  STORE_ACTIVITY_TITLE_LIMIT, STORE_ACTIVITY_MAX_TIME,
} from "./store-activity-types";
import type {
  StoreActivity, StoreActivitiesState, StoreActivityMutationResult, StoreActivityState, StoreActivityStatus,
} from "./store-activity-types";

const EVENT = "mall-48h";
type Row = Record<string, unknown>;
type Scope = { manage: boolean; storeId?: string; tokenHash?: string };
const CLOCK = "CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)";
const FENCE_FIELDS = "g.enabled,g.latitude,g.longitude,g.radius_meters,g.revision AS fence_revision,g.updated_at AS fence_updated_at";
const STORE_FROM = "FROM stores s LEFT JOIN store_geofences g ON g.store_id=s.id";
const ACTIVITY_FROM = `FROM store_activities a JOIN stores s ON s.id=a.store_id AND s.event_id=a.event_id
  LEFT JOIN store_geofences g ON g.store_id=s.id`;
const FENCE_VALID = `g.enabled=1 AND g.revision>=1 AND g.latitude BETWEEN -90 AND 90
  AND g.longitude BETWEEN -180 AND 180 AND g.radius_meters BETWEEN 20 AND 5000`;
// This is evaluated inside every management query/write, including after the initial staff read.
const AUTH = staffAuthorizationSQL("s.id");
const ADMIN_AUTH = staffAuthorizationSQL(undefined, true);
const SETTINGS_STATUS = "CASE WHEN COALESCE((SELECT ugc_review FROM game_settings WHERE id='main'),1)=1 THEN 'pending' ELSE 'published' END";
const FILTERS = ["all", "pending", "published", "rejected", "offline", "expired"];

function unavailable(): never { throw new GameError("门店活动暂时无法读取或保存，请稍后重试或联系运营。", 503); }
async function rows(sql: string, values: (string | number | null)[] = []): Promise<Row[]> {
  try { return (await db().prepare(sql).bind(...values).all<Row>()).results; } catch { return unavailable(); }
}
async function write(sql: string, values: (string | number | null)[]): Promise<number> {
  try { return Number((await db().prepare(sql).bind(...values).run()).meta.changes); } catch { return unavailable(); }
}
function identifier(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim() || value.length > 100) throw new GameError(`${label}不正确`);
  return value;
}
function uuid(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value))
    throw new GameError("创建请求标识不正确，请重新打开活动表单");
  return value.toLowerCase();
}
function revision(value: unknown, create = false): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < (create ? 0 : 1) || value >= Number.MAX_SAFE_INTEGER)
    throw new GameError("活动版本不正确，请刷新后再操作");
  return value;
}
function text(value: unknown, label: string, maximum: number, minimum = 1): string {
  if (typeof value !== "string") throw new GameError(`请填写${label}`);
  const clean = value.trim(), length = Array.from(clean).length;
  if (length < minimum || length > maximum) throw new GameError(`${label}须为 ${minimum}–${maximum} 个字`);
  return clean;
}
function date(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0 || value > STORE_ACTIVITY_MAX_TIME)
    throw new GameError("活动时间不正确，请重新选择开始和结束时间");
  return value;
}
function fence(row: Row): StoreGeofence {
  return { storeId: String(row.store_id), storeName: String(row.store_name), enabled: row.enabled === 1,
    latitude: row.latitude == null ? null : Number(row.latitude), longitude: row.longitude == null ? null : Number(row.longitude),
    radiusMeters: row.radius_meters == null ? null : Number(row.radius_meters),
    revision: row.fence_revision == null ? 0 : Number(row.fence_revision),
    updatedAt: row.fence_updated_at == null ? null : Number(row.fence_updated_at), coordinateSystem: "WGS84" };
}
function configured(value: StoreGeofence) {
  return value.enabled && Number.isSafeInteger(value.revision) && value.revision >= 1 &&
    validCoordinates(value.latitude, value.longitude) && validRadius(value.radiusMeters);
}
function dto(row: Row, manage: boolean, now = Date.now()): StoreActivity {
  const currentFence = fence(row);
  return { id: String(row.id), eventId: String(row.event_id), storeId: String(row.store_id), storeName: String(row.store_name),
    title: String(row.title), description: String(row.description), startAt: Number(row.start_at), endAt: Number(row.end_at),
    status: row.status as StoreActivityStatus,
    phase: Number(row.end_at) <= now ? "expired" : Number(row.start_at) > now ? "upcoming" : "active",
    revision: Number(row.revision), createdAt: Number(row.created_at), updatedAt: Number(row.updated_at),
    fence: configured(currentFence) ? currentFence : null,
    ...(manage ? { authorId: String(row.author_id), requestId: String(row.request_id), reviewNote: String(row.review_note) } : {}) };
}
async function scope(req: Request, input: Row): Promise<Scope> {
  if (input.manage !== undefined && typeof input.manage !== "boolean") throw new GameError("活动读取方式不正确");
  const storeId = input.storeId === undefined ? undefined : identifier(input.storeId, "门店标识");
  if (input.manage !== true) return { manage: false, storeId };
  const actor = await staff(req);
  if (actor.role === "merchant" && storeId !== undefined && actor.store_id !== storeId)
    throw new GameError("不能管理其他门店的活动", 403);
  return { manage: true, storeId: actor.role === "merchant" ? String(actor.store_id) : storeId,
    tokenHash: await hash(cookie(req, "mall_staff") || "") };
}
function where(access: Scope, now: number, activity = true): { sql: string; values: (string | number)[] } {
  let sql = "s.event_id=?";
  const values: (string | number)[] = [EVENT];
  if (access.storeId) { sql += " AND s.id=?"; values.push(access.storeId); }
  if (access.manage) { sql += " AND " + AUTH; values.push(access.tokenHash!, now); }
  else {
    sql += " AND s.status='active' AND " + FENCE_VALID;
    if (activity) { sql += ` AND a.status='published' AND a.end_at>MAX(?,${CLOCK})`; values.push(now); }
  }
  return { sql, values };
}
async function context(access: Scope): Promise<{ ugcReview: boolean; fences: StoreGeofence[] }> {
  const filter = where(access, Date.now(), false);
  const configs = await rows(`SELECT s.id AS store_id,s.name AS store_name,${FENCE_FIELDS} ${STORE_FROM} WHERE ${filter.sql} ORDER BY s.id`, filter.values);
  const settings = await rows("SELECT ugc_review FROM game_settings WHERE id='main'");
  return { ugcReview: settings[0]?.ugc_review !== 0, fences: configs.map(fence) };
}
async function find(access: Scope, key: { id?: string; requestId?: string }): Promise<Row | undefined> {
  const filter = where(access, Date.now());
  if (key.id) { filter.sql += " AND a.id=?"; filter.values.push(key.id); }
  else { filter.sql += " AND a.request_id=?"; filter.values.push(key.requestId!); }
  return (await rows(`SELECT a.*,s.name AS store_name,${FENCE_FIELDS} ${ACTIVITY_FROM} WHERE ${filter.sql}`, filter.values))[0];
}
export async function readStoreActivities(req: Request, input: Row): Promise<StoreActivitiesState> {
  const access = await scope(req, input), now = Date.now();
  const filterName = input.filter === undefined ? "all" : input.filter;
  if (typeof filterName !== "string" || !FILTERS.includes(filterName) || (!access.manage && !["all", "published"].includes(filterName)))
    throw new GameError("活动筛选项不正确");
  const page = input.page === undefined ? 1 : input.page;
  if (typeof page !== "number" || !Number.isSafeInteger(page) || page < 1 || page > 100_000) throw new GameError("活动页码不正确");
  const filter = where(access, now);
  if (filterName === "expired") { filter.sql += ` AND a.end_at<=MAX(?,${CLOCK})`; filter.values.push(now); }
  else if (filterName !== "all") { filter.sql += " AND a.status=?"; filter.values.push(filterName); }
  const count = await rows(`SELECT COUNT(*) AS total ${ACTIVITY_FROM} WHERE ${filter.sql}`, filter.values);
  const data = await rows(`SELECT a.*,s.name AS store_name,${FENCE_FIELDS} ${ACTIVITY_FROM} WHERE ${filter.sql}
    ORDER BY a.updated_at DESC,a.id DESC LIMIT ? OFFSET ?`, [...filter.values, STORE_ACTIVITY_PAGE_SIZE, (page - 1) * STORE_ACTIVITY_PAGE_SIZE]);
  const total = Number(count[0]?.total || 0);
  return { activities: data.map(row => dto(row, access.manage)), ...(await context(access)),
    pagination: { page, pageSize: STORE_ACTIVITY_PAGE_SIZE, total, totalPages: Math.ceil(total / STORE_ACTIVITY_PAGE_SIZE) } };
}
export async function readStoreActivity(req: Request, input: Row): Promise<StoreActivityState> {
  const access = await scope(req, input);
  if ((input.id === undefined) === (input.requestId === undefined)) throw new GameError("请提供一个活动或创建请求标识");
  const key = input.id === undefined ? { requestId: uuid(input.requestId) } : { id: identifier(input.id, "活动标识") };
  if (key.requestId && (!access.manage || input.storeId === undefined)) throw new GameError("核对创建结果需要工作台身份和门店标识", 403);
  const row = await find(access, key);
  return { activity: row ? dto(row, access.manage) : null, ...(await context(access)) };
}
async function mutationScope(req: Request, storeId: string): Promise<Scope> {
  return scope(req, { manage: true, storeId });
}
async function storeForWrite(access: Scope): Promise<StoreGeofence> {
  const filter = where(access, Date.now(), false);
  const row = (await rows(`SELECT s.id AS store_id,s.name AS store_name,s.status,${FENCE_FIELDS} ${STORE_FROM} WHERE ${filter.sql}`, filter.values))[0];
  if (!row) throw new GameError("门店不存在或当前身份无权管理", 403);
  if (row.status !== "active") throw new GameError("门店已停用，不能发布新活动", 409);
  const value = fence(row);
  if (!configured(value)) throw new GameError("请先配置并启用本店真实位置的电子围栏，再提交活动", 409);
  return value;
}
async function freshResult(req: Request, id: string, message: string, replayed = false): Promise<StoreActivityMutationResult> {
  const result = await readStoreActivity(req, { manage: true, id });
  if (!result.activity) throw new GameError("活动状态已变化，请刷新核对保存结果", 409);
  return { activity: result.activity, message, ...(replayed ? { replayed: true } : {}) };
}
async function changed(req: Request): Promise<never> {
  await staff(req);
  throw new GameError("活动版本、门店位置或访问权限已变化，请刷新核对后再操作", 409);
}
export async function saveStoreActivity(req: Request, input: Row, playerId: string): Promise<StoreActivityMutationResult> {
  const storeId = identifier(input.storeId, "门店标识"), access = await mutationScope(req, storeId);
  const title = text(input.title, "活动标题", STORE_ACTIVITY_TITLE_LIMIT);
  const description = text(input.description, "活动说明", STORE_ACTIVITY_DESCRIPTION_LIMIT);
  const startAt = date(input.startAt), endAt = date(input.endAt), creating = input.id === undefined;
  const expected = revision(input.expectedRevision, creating);
  if (endAt <= startAt) throw new GameError("结束时间必须晚于开始时间");
  const actor = await staff(req), authorId = actor.player_id == null ? playerId : String(actor.player_id);
  const requestId = creating ? uuid(input.requestId) : undefined;
  const requestHash = creating ? await hash(JSON.stringify({ title, description, startAt, endAt })) : undefined;
  if (creating) {
    if (expected !== 0) throw new GameError("新活动版本必须为 0");
    const existing = await find(access, { requestId });
    if (existing) {
      if (existing.request_hash !== requestHash || existing.author_id !== authorId) throw new GameError("该创建请求已用于其他内容，请刷新核对原活动", 409);
      return freshResult(req, String(existing.id), "已核对原活动，无重复创建", true);
    }
  }
  if (endAt <= Date.now()) throw new GameError("活动已结束，请选择仍在将来的结束时间");
  const currentFence = await storeForWrite(access), now = Date.now();
  let id: string, changes: number;
  if (creating) {
    id = crypto.randomUUID();
    changes = await write(`INSERT INTO store_activities(id,event_id,store_id,author_id,request_id,request_hash,title,description,
        start_at,end_at,status,review_note,revision,created_at,updated_at)
      SELECT ?,s.event_id,s.id,?,?,?,?,?,?,?,${SETTINGS_STATUS},'',1,?,? ${STORE_FROM}
      WHERE s.event_id=? AND s.id=? AND s.status='active' AND ${FENCE_VALID} AND g.revision=? AND ${AUTH}
      AND EXISTS(SELECT 1 FROM players ap WHERE ap.id=? AND ap.banned=0) AND ?>MAX(?,${CLOCK})
      ON CONFLICT(event_id,store_id,request_id) DO NOTHING`,
      [id, authorId, requestId!, requestHash!, title, description, startAt, endAt, now, now, EVENT, storeId,
        currentFence.revision, access.tokenHash!, now, authorId, endAt, now]);
    if (!changes) {
      const existing = await find(access, { requestId });
      if (existing && existing.request_hash === requestHash && existing.author_id === authorId)
        return freshResult(req, String(existing.id), "已核对原活动，无重复创建", true);
      if (existing) throw new GameError("该创建请求已用于其他内容，请刷新核对原活动", 409);
      return changed(req);
    }
  } else {
    id = identifier(input.id, "活动标识");
    const existing = await find(access, { id });
    if (!existing) throw new GameError("活动不存在或不属于当前门店", 404);
    if (existing.store_id !== storeId) throw new GameError("不能变更活动所属门店", 403);
    changes = await write(`UPDATE store_activities SET title=?,description=?,start_at=?,end_at=?,
      status=${SETTINGS_STATUS},review_note='',revision=revision+1,updated_at=?
      WHERE id=? AND event_id=? AND store_id=? AND revision=? AND ?>MAX(?,${CLOCK})
      AND EXISTS(SELECT 1 ${STORE_FROM} WHERE s.id=store_activities.store_id AND s.event_id=store_activities.event_id
        AND s.status='active' AND ${FENCE_VALID} AND g.revision=? AND ${AUTH})`,
      [title, description, startAt, endAt, now, id, EVENT, storeId, expected, endAt, now,
        currentFence.revision, access.tokenHash!, now]);
    if (!changes) return changed(req);
  }
  const result = await freshResult(req, id, "活动已保存");
  result.message = result.activity.status === "pending" ? "活动已提交，运营审核通过后才会向玩家展示" : "活动已发布，玩家可查看门店位置和活动信息";
  return result;
}
export async function withdrawStoreActivity(req: Request, input: Row): Promise<StoreActivityMutationResult> {
  const access = await scope(req, { manage: true }), id = identifier(input.id, "活动标识");
  const expected = revision(input.expectedRevision), existing = await find(access, { id });
  if (!existing) throw new GameError("活动不存在或不属于当前门店", 404);
  if (existing.status === "offline" && existing.revision === expected) return freshResult(req, id, "活动已下架", true);
  const now = Date.now();
  const changes = await write(`UPDATE store_activities SET status='offline',review_note='',revision=revision+1,updated_at=?
    WHERE id=? AND event_id=? AND revision=? AND status!='offline'
    AND EXISTS(SELECT 1 FROM stores s WHERE s.id=store_activities.store_id AND s.event_id=store_activities.event_id AND ${AUTH})`,
    [now, id, EVENT, expected, access.tokenHash!, now]);
  if (!changes) return changed(req);
  return freshResult(req, id, "活动已下架，玩家地图不再展示；历史记录保留");
}
export async function reviewStoreActivity(req: Request, input: Row): Promise<StoreActivityMutationResult> {
  const actor = await staff(req);
  if (actor.role !== "admin") throw new GameError("此操作需要运营身份", 403);
  const access = await scope(req, { manage: true }), id = identifier(input.id, "活动标识"), expected = revision(input.expectedRevision);
  if (!["publish", "reject", "offline"].includes(String(input.decision))) throw new GameError("活动审核操作不正确");
  const decision = input.decision as "publish" | "reject" | "offline";
  const note = decision === "reject" ? text(input.reviewNote, "退回原因", STORE_ACTIVITY_REVIEW_NOTE_LIMIT, 2) :
    input.reviewNote === undefined || input.reviewNote === "" ? "" : text(input.reviewNote, "审核说明", STORE_ACTIVITY_REVIEW_NOTE_LIMIT);
  const existing = await find(access, { id });
  if (!existing) throw new GameError("活动不存在", 404);
  if (existing.status !== (decision === "offline" ? "published" : "pending")) throw new GameError("活动已处理，请刷新当前状态后再操作", 409);
  const target = decision === "publish" ? "published" : decision === "reject" ? "rejected" : "offline", now = Date.now();
  let gate = "", gateValues: (string | number)[] = [];
  if (decision === "publish") {
    const currentFence = await storeForWrite({ ...access, storeId: String(existing.store_id) });
    if (Number(existing.end_at) <= now) throw new GameError("活动已结束，不能通过审核，请退回商家调整时间", 409);
    gate = ` AND end_at>MAX(?,${CLOCK}) AND EXISTS(SELECT 1 ${STORE_FROM}
      WHERE s.id=store_activities.store_id AND s.event_id=store_activities.event_id AND s.status='active' AND ${FENCE_VALID} AND g.revision=?)`;
    gateValues = [now, currentFence.revision];
  }
  const changes = await write(`UPDATE store_activities SET status=?,review_note=?,revision=revision+1,updated_at=?
    WHERE id=? AND event_id=? AND revision=? AND status=? AND ${ADMIN_AUTH}${gate}`,
    [target, note, now, id, EVENT, expected, decision === "offline" ? "published" : "pending", access.tokenHash!, now, ...gateValues]);
  if (!changes) return changed(req);
  return freshResult(req, id, decision === "publish" ? "审核通过，活动已向玩家展示" : decision === "reject" ? "活动已退回，商家可修改后重新提交" : "活动已下架，玩家地图不再展示");
}
