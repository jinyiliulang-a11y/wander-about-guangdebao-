import { allowedPlayer } from "./game-business";
import { db, GameError, hash } from "./game-server";
import { registeredPlayer } from "./account-auth";
import { authorizationValues, playerAuthorizationSQL } from "./account-authorization";
import type { CreatorDraft, CreatorDraftState } from "./creator-draft-types";

const EVENT = "mall-48h";
const LIMIT = 1_200_000;
type DraftRow = {
  revision: number;
  draft_json: string | null;
  updated_at: number | null;
  last_request_id: string | null;
  last_request_hash: string | null;
};
function object(value: unknown, keys: string[], name: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new GameError(`${name}格式不正确`);
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some(key => !keys.includes(key)) || keys.some(key => !(key in input))) throw new GameError(`${name}字段不完整或不受支持`);
  return input;
}
function text(value: unknown, max: number, name: string): string {
  if (typeof value !== "string" || value.length > max) throw new GameError(`${name}格式不正确`);
  return value;
}
function integer(value: unknown, min: number, max: number, name: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) throw new GameError(`${name}格式不正确`);
  return value;
}
export function validateCreatorDraft(value: unknown): CreatorDraft {
  const input = object(value, ["storeId", "title", "clues", "options", "step", "submissionId"], "草稿");
  const options = object(input.options, ["difficulty", "expiresAt", "rewardType", "rewardValue", "rewardCouponId", "photoURLs"], "草稿设置");
  if (!Array.isArray(input.clues) || input.clues.length !== 5) throw new GameError("草稿须保留五条线索");
  if (!Array.isArray(options.photoURLs) || options.photoURLs.length !== 5) throw new GameError("草稿照片格式不正确");
  const photoURLs = options.photoURLs.map(value => {
    const photo = text(value, 256 * 1024, "草稿照片");
    if (photo && !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(photo)) throw new GameError("草稿照片须使用JPEG、PNG或WebP图片");
    if (photo && photo.slice(photo.indexOf(",") + 1).length % 4 !== 0) throw new GameError("草稿照片编码不完整，请重新添加图片");
    return photo;
  });
  if (photoURLs.reduce((size, photo) => size + photo.length, 0) > 768 * 1024) throw new GameError("草稿照片总量过大，请缩小图片再保存");
  if (options.rewardType !== "points" && options.rewardType !== "coupon") throw new GameError("草稿奖励类型不正确");
  if (input.submissionId !== null && (typeof input.submissionId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.submissionId))) throw new GameError("草稿投稿标识格式不正确");
  return {
    storeId: text(input.storeId, 100, "草稿门店"),
    title: text(input.title, 40, "草稿标题"),
    clues: input.clues.map(value => text(value, 160, "草稿线索")),
    step: integer(input.step, 0, 2, "草稿步骤") as 0 | 1 | 2,
    submissionId: input.submissionId as string | null,
    options: {
      difficulty: integer(options.difficulty, 1, 5, "草稿难度"),
      expiresAt: options.expiresAt === null ? null : integer(options.expiresAt, 1, 8_640_000_000_000_000, "草稿截止时间"),
      rewardType: options.rewardType,
      rewardValue: integer(options.rewardValue, 10, 500, "草稿积分"),
      rewardCouponId: options.rewardCouponId === null ? null : text(options.rewardCouponId, 100, "草稿优惠券"),
      photoURLs,
    },
  };
}
async function identity(req: Request): Promise<string> {
  const currentId = await registeredPlayer(req);
  const expected = req.headers.get("X-Mall-Quest-Player");
  if (!expected) throw new GameError("草稿请求缺少当前体验身份，请刷新页面后重试");
  if (expected !== currentId) throw new GameError("体验身份已变化，请刷新页面后继续编辑草稿", 409);
  await allowedPlayer(currentId);
  return currentId;
}
async function row(playerId: string): Promise<DraftRow | null> {
  return db().prepare("SELECT revision,draft_json,updated_at,last_request_id,last_request_hash FROM creator_drafts WHERE event_id=? AND player_id=?").bind(EVENT, playerId).first<DraftRow>();
}
function dto(playerId: string, current: DraftRow | null): CreatorDraftState {
  return { eventId: EVENT, playerId, revision: current ? Number(current.revision) : 0, updatedAt: current?.updated_at ?? null, draft: current?.draft_json ? validateCreatorDraft(JSON.parse(current.draft_json)) : null };
}
export async function getCreatorDraft(req: Request): Promise<CreatorDraftState> {
  const playerId = await identity(req);
  return dto(playerId, await row(playerId));
}
export async function writeCreatorDraft(req: Request, value: unknown, clear = false): Promise<CreatorDraftState> {
  const playerId = await identity(req);
  const input = object(value, clear ? ["expectedRevision", "requestId"] : ["expectedRevision", "requestId", "draft"], "草稿请求");
  const expected = integer(input.expectedRevision, 0, Number.MAX_SAFE_INTEGER - 1, "草稿版本");
  const requestId = text(input.requestId, 100, "草稿请求标识");
  if (!/^[A-Za-z0-9_-]{8,100}$/.test(requestId)) throw new GameError("草稿请求标识格式不正确");
  const draft = clear ? null : validateCreatorDraft(input.draft);
  const json = draft ? JSON.stringify(draft) : null;
  if (json && new TextEncoder().encode(json).byteLength > LIMIT) throw new GameError("草稿过大，请减少照片后重试", 413);
  if (draft) {
    // Unknown or inactive references may be preserved as incomplete drafts;
    // known references from another event must never enter this event scope.
    const store = draft.storeId ? await db().prepare("SELECT event_id FROM stores WHERE id=?").bind(draft.storeId).first<{event_id: string}>() : null;
    if (store && store.event_id !== EVENT) throw new GameError("草稿门店不属于当前活动");
    const coupon = draft.options.rewardCouponId ? await db().prepare("SELECT s.event_id FROM coupon_templates c JOIN stores s ON s.id=c.store_id WHERE c.id=?").bind(draft.options.rewardCouponId).first<{event_id: string}>() : null;
    if (coupon && coupon.event_id !== EVENT) throw new GameError("草稿优惠券不属于当前活动");
  }
  const payloadHash = await hash(JSON.stringify({ clear, expected, draft }));
  const current = await row(playerId);
  if (current?.last_request_id === requestId) {
    if (current.last_request_hash !== payloadHash) throw new GameError("同一草稿请求不能修改内容，请使用新请求标识", 409);
    return dto(playerId, current);
  }
  if ((current ? Number(current.revision) : 0) !== expected) throw new GameError("草稿已在其他页面更新，请重新加载后继续编辑", 409);
  const now = Date.now(), auth = await authorizationValues(req);
  const results = await db().batch([
    db().prepare(`INSERT OR IGNORE INTO creator_drafts(event_id,player_id,revision)
      SELECT ?,id,0 FROM players WHERE id=? AND ${playerAuthorizationSQL("players.id")}`).bind(EVENT, playerId, ...auth),
    db().prepare(`UPDATE creator_drafts SET revision=revision+1,draft_json=?,updated_at=?,last_request_id=?,last_request_hash=?
      WHERE event_id=? AND player_id=? AND revision=? AND (last_request_id IS NULL OR last_request_id<>?)
      AND ${playerAuthorizationSQL("creator_drafts.player_id")}`)
      .bind(json, now, requestId, payloadHash, EVENT, playerId, expected, requestId, ...auth),
  ]);
  const latest = await row(playerId);
  if (!results[1].meta.changes) {
    await allowedPlayer(playerId);
    await registeredPlayer(req);
    if (latest?.last_request_id === requestId && latest.last_request_hash === payloadHash) return dto(playerId, latest);
    throw new GameError("草稿已在其他页面更新，请重新加载后继续编辑", 409);
  }
  // A concurrent successful later save must not be reported as this write.
  return { eventId: EVENT, playerId, revision: expected + 1, updatedAt: now, draft };
}
export const creatorDraftRequestLimit = LIMIT;
