import { db, GameError, hash, session } from "./game-server";
import { authorizationValues, staffAuthorizationSQL } from "./account-authorization";
import { isStoreIcon } from "./store-icons";
import { validateStoreImageURL } from "./store-image";
import type { MerchantProfileDraftForm, MerchantProfileDraftState } from "./merchant-profile-draft-types";

const EVENT = "mall-48h";
const LIMIT = 750000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type Input = Record<string, unknown>;
type Identity = { accountId: string; playerId: string; storeId: string; auth: [string, number] };
type DraftRow = { revision: number | null; draft_json: string | null; updated_at: number | null;
  last_request_id: string | null; last_request_hash: string | null; logo: string };

function object(value: unknown, keys: string[], name: string): Input {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new GameError(`${name}格式不正确`);
  const input = value as Input;
  if (Object.keys(input).some(key => !keys.includes(key)) || keys.some(key => !(key in input)))
    throw new GameError(`${name}字段不完整或不受支持`);
  return input;
}
function text(value: unknown, max: number, name: string) {
  if (typeof value !== "string" || value.length > max) throw new GameError(`${name}格式不正确`);
  return value;
}
function integer(value: unknown, max: number, name: string) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > max)
    throw new GameError(`${name}格式不正确`);
  return value;
}
export function validateMerchantProfileDraft(value: unknown, currentLogo?: string): MerchantProfileDraftForm {
  const input = object(value, ["name", "logo", "category", "floor", "address", "phone", "imageURL", "artwork", "expectedImageRevision"], "门店资料草稿");
  const logo = text(input.logo, 64, "门店图标");
  if (currentLogo !== undefined && !isStoreIcon(logo) && logo !== currentLogo)
    throw new GameError("请从预设图标中选择门店图标；历史图标只能保持原值");
  let imageURL: string;
  try { imageURL = validateStoreImageURL(input.imageURL); }
  catch (error) { throw new GameError(error instanceof Error ? error.message : "门店图片格式不正确"); }
  return { name: text(input.name, 40, "门店名称"), logo, category: text(input.category, 30, "门店类别"),
    floor: text(input.floor, 10, "门店楼层"), address: text(input.address, 120, "门店地址"), phone: text(input.phone, 24, "联系电话"),
    imageURL, artwork: integer(input.artwork, 2, "示例图片"), expectedImageRevision: integer(input.expectedImageRevision, Number.MAX_SAFE_INTEGER, "图片版本") };
}
async function identity(req: Request): Promise<Identity> {
  const current = await session(req, true);
  if (!current || current.role !== "merchant" || !current.account_id || !current.player_id || !current.store_id)
    throw new GameError("请使用已通过审核的本店商家账号管理资料草稿", 403);
  const expected = req.headers.get("X-Mall-Quest-Player");
  if (expected && expected !== current.player_id) throw new GameError("工作台身份已变化，请刷新后继续编辑门店草稿", 409);
  return { accountId: current.account_id, playerId: current.player_id, storeId: current.store_id, auth: await authorizationValues(req, true) };
}
function permission(store: string) {
  return `${staffAuthorizationSQL(store)} AND EXISTS(SELECT 1 FROM sessions mp_s
    WHERE mp_s.token_hash=? AND mp_s.role='merchant' AND mp_s.account_id=? AND mp_s.player_id=? AND mp_s.store_id=${store})`;
}
function authValues(owner: Identity) { return [...owner.auth, owner.auth[0], owner.accountId, owner.playerId]; }
async function row(owner: Identity): Promise<DraftRow> {
  const current = await db().prepare(`SELECT d.revision,d.draft_json,d.updated_at,d.last_request_id,d.last_request_hash,s.logo
    FROM stores s LEFT JOIN merchant_profile_drafts d ON d.event_id=s.event_id AND d.store_id=s.id AND d.account_id=?
    WHERE s.id=? AND s.event_id=? AND ${permission("s.id")}`)
    .bind(owner.accountId, owner.storeId, EVENT, ...authValues(owner)).first<DraftRow>();
  if (!current) throw new GameError("当前门店或商家权限已变化，请刷新后核对", 403);
  return current;
}
function dto(owner: Identity, current: DraftRow): MerchantProfileDraftState {
  // A saved historical icon remains readable after official store edits. A new
  // save still rechecks it against the current published icon and final SQL.
  return { storeId: owner.storeId, revision: Number(current.revision ?? 0), updatedAt: current.updated_at ?? null,
    draft: current.draft_json ? validateMerchantProfileDraft(JSON.parse(current.draft_json)) : null, lastRequestId: current.last_request_id ?? null };
}
export async function merchantProfileDraftGet(req: Request, input: Input): Promise<MerchantProfileDraftState> {
  object(input, ["action"], "门店草稿请求");
  const owner = await identity(req), current = await row(owner), final = await identity(req);
  if (final.accountId !== owner.accountId || final.storeId !== owner.storeId) throw new GameError("工作台身份已变化，请刷新后核对", 409);
  return dto(owner, current);
}
async function change(req: Request, input: Input, clear: boolean): Promise<MerchantProfileDraftState> {
  const owner = await identity(req);
  object(input, clear ? ["action", "requestId", "expectedRevision"] : ["action", "requestId", "expectedRevision", "draft"], "门店草稿请求");
  const expected = integer(input.expectedRevision, Number.MAX_SAFE_INTEGER - 1, "草稿版本");
  const requestId = text(input.requestId, 36, "草稿请求标识");
  if (!UUID.test(requestId)) throw new GameError("草稿请求标识须使用UUID");
  const current = await row(owner), draft = clear ? null : validateMerchantProfileDraft(input.draft);
  const json = draft ? JSON.stringify(draft) : null;
  if (json && new TextEncoder().encode(json).byteLength > LIMIT) throw new GameError("门店资料草稿过大，请缩小图片", 413);
  const payloadHash = await hash(JSON.stringify({ eventId: EVENT, accountId: owner.accountId, storeId: owner.storeId, clear, expected, draft }));
  if (current.last_request_id === requestId) {
    if (current.last_request_hash !== payloadHash) throw new GameError("同一草稿请求不能修改内容，请使用新请求标识", 409);
    const latest = await row(owner);
    if (latest.last_request_id !== requestId || latest.last_request_hash !== payloadHash) throw new GameError("草稿已在其他页面更新，请先加载最新草稿", 409);
    return dto(owner, latest);
  }
  if (Number(current.revision ?? 0) !== expected) throw new GameError("草稿已在其他页面更新，请先加载最新草稿", 409);
  if (draft) validateMerchantProfileDraft(draft, current.logo);
  const now = Date.now(), preset = clear || isStoreIcon(draft?.logo) ? 1 : 0, logo = draft?.logo ?? "";
  const result = await db().prepare(`INSERT INTO merchant_profile_drafts(event_id,account_id,store_id,revision,draft_json,created_at,updated_at,last_request_id,last_request_hash)
    SELECT s.event_id,?,s.id,1,?,?,?,?,? FROM stores s WHERE s.id=? AND s.event_id=? AND ${permission("s.id")}
      AND (?=1 OR s.logo=?) AND (?=0 OR EXISTS(SELECT 1 FROM merchant_profile_drafts d
        WHERE d.event_id=s.event_id AND d.store_id=s.id AND d.account_id=? AND d.revision=?))
    ON CONFLICT(event_id,account_id,store_id) DO UPDATE SET revision=merchant_profile_drafts.revision+1,
      draft_json=excluded.draft_json,updated_at=excluded.updated_at,last_request_id=excluded.last_request_id,last_request_hash=excluded.last_request_hash
    WHERE merchant_profile_drafts.revision=? AND (merchant_profile_drafts.last_request_id IS NULL OR merchant_profile_drafts.last_request_id<>?)
      AND EXISTS(SELECT 1 FROM stores s WHERE s.id=merchant_profile_drafts.store_id AND s.event_id=merchant_profile_drafts.event_id
        AND s.event_id='mall-48h' AND ${permission("s.id")} AND (?=1 OR s.logo=?))`)
    .bind(owner.accountId, json, now, now, requestId, payloadHash, owner.storeId, EVENT, ...authValues(owner), preset, logo,
      expected, owner.accountId, expected, expected, requestId, ...authValues(owner), preset, logo).run();
  if (!result.meta.changes) {
    const latest = await row(owner);
    if (latest.last_request_id === requestId && latest.last_request_hash === payloadHash) return dto(owner, latest);
    throw new GameError("草稿版本、图标或门店权限已变化，请先加载最新草稿", 409);
  }
  // Do not label a later concurrent save as this operation's successful result.
  return { storeId: owner.storeId, revision: expected + 1, updatedAt: now, draft, lastRequestId: requestId };
}
export const merchantProfileDraftSave = (req: Request, input: Input) => change(req, input, false);
export const merchantProfileDraftDelete = (req: Request, input: Input) => change(req, input, true);
