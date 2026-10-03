import { db, hash, GameError } from "./game-server";
import { HARDWARE_CODE_TTL_MS, HARDWARE_DEVICE_ID, HARDWARE_REQUEST_ID, hardwareCodeHash, hardwareCodeValue } from "./hardware-code";
import type { HardwareEntry } from "./game-types";

export const HARDWARE_ENTRY_TTL_SECONDS = 120;
const BASE64URL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const ENTRY_PURPOSE = "mall-48h:coin-entry:v1";
type EntryDevice = { id: string; store_id: string; token_hash: string; bound_task_id: string | null };
export type EntryAuthorization = { deviceId: string; storeId: string; taskId: string; tokenHash: string; expiresAt: number };

// Workers and the isolated test runner share this small encoding implementation;
// it deliberately needs neither Buffer nor a browser-only global.
function base64url(bytes: Uint8Array) {
  let result = "", value = 0, bits = 0;
  for (const byte of bytes) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 6) { bits -= 6; result += BASE64URL[(value >>> bits) & 63]; }
  }
  if (bits) result += BASE64URL[(value << (6 - bits)) & 63];
  return result;
}
function entryBytes(value: string, expectedLength: number) {
  let encoded = 0, bits = 0;
  const bytes: number[] = [];
  for (const character of value) {
    const index = BASE64URL.indexOf(character);
    if (index < 0) throw new GameError("金币入口格式不正确，请重新扫码", 400);
    encoded = (encoded << 6) | index; bits += 6;
    if (bits >= 8) { bits -= 8; bytes.push((encoded >>> bits) & 255); }
  }
  const decoded = new Uint8Array(bytes);
  if (decoded.length !== expectedLength || base64url(decoded) !== value)
    throw new GameError("金币入口格式不正确，请重新扫码", 400);
  return decoded;
}
function entryPayload(deviceId: string, storeId: string, taskId: string, expiry: string, nonce: string) {
  return new TextEncoder().encode(JSON.stringify([ENTRY_PURPOSE, deviceId, storeId, taskId, expiry, nonce]));
}
async function entryKey(tokenHash: string, usage: "sign" | "verify") {
  return crypto.subtle.importKey("raw", new TextEncoder().encode(tokenHash), { name: "HMAC", hash: "SHA-256" }, false, [usage]);
}
function validateFixedBinding(device: EntryDevice) {
  if (device.id === "coin-tea-01" && (device.store_id !== "tea" || device.bound_task_id !== "quest-tea"))
    throw new GameError("金币的固定点位绑定不正确，请联系现场人员", 403);
}

export async function verifyHardwareEntryToken(value: unknown, taskId: string, storeId: string): Promise<EntryAuthorization> {
  if (typeof value !== "string" || !value || value.length > 160)
    throw new GameError("金币入口格式不正确，请重新扫码", 400);
  const parts = value.split(".");
  if (parts.length !== 5 || parts[0] !== "v1" || !HARDWARE_DEVICE_ID.test(parts[1]) ||
    !/^[0-9a-z]{1,8}$/.test(parts[2]) || !/^[A-Za-z0-9_-]{22}$/.test(parts[3]) || !/^[A-Za-z0-9_-]{43}$/.test(parts[4]))
    throw new GameError("金币入口格式不正确，请重新扫码", 400);
  const [, deviceId, expiry, nonce, signature] = parts;
  const seconds = Number.parseInt(expiry, 36), expiresAt = seconds * 1000, now = Date.now();
  if (!Number.isSafeInteger(expiresAt) || seconds.toString(36) !== expiry ||
    seconds > Math.floor(now / 1000) + HARDWARE_ENTRY_TTL_SECONDS)
    throw new GameError("金币入口格式不正确，请重新扫码", 400);
  if (expiresAt <= now) throw new GameError("金币二维码已过期，请重新扫码", 409);
  entryBytes(nonce, 16);
  const signatureBytes = entryBytes(signature, 32);
  const device = await db().prepare(`SELECT h.id,h.store_id,h.token_hash,h.bound_task_id
    FROM hardware_devices h JOIN stores s ON s.id=h.store_id
    WHERE h.id=? AND h.enabled=1 AND s.event_id='mall-48h' AND s.point_mode='hardware' AND s.status='active'`)
    .bind(deviceId).first<EntryDevice>();
  if (!device || device.store_id !== storeId || device.bound_task_id !== taskId)
    throw new GameError("金币入口授权或任务绑定已变化，请重新扫码", 409);
  validateFixedBinding(device);
  const valid = await crypto.subtle.verify("HMAC", await entryKey(device.token_hash, "verify"), signatureBytes,
    entryPayload(deviceId, storeId, taskId, expiry, nonce));
  if (!valid) throw new GameError("金币入口授权无效，请重新扫码", 403);
  if (expiresAt <= Date.now()) throw new GameError("金币二维码已过期，请重新扫码", 409);
  return { deviceId, storeId, taskId, tokenHash: device.token_hash, expiresAt };
}

export async function hardwareDynamicEntry(req: Request, input: Record<string, unknown>): Promise<HardwareEntry> {
  const deviceId = typeof input.deviceId === "string" ? input.deviceId : "";
  if (!HARDWARE_DEVICE_ID.test(deviceId)) throw new GameError("设备标识格式不正确");
  const token = req.headers.get("authorization")?.match(/^Bearer ([A-Za-z0-9_-]{32,128})$/)?.[1];
  if (!token) throw new GameError("设备授权无效", 401);
  const d = db(), now = Date.now();
  const device = await d.prepare(`SELECT h.id,h.store_id,h.token_hash,h.bound_task_id
    FROM hardware_devices h JOIN stores s ON s.id=h.store_id
    WHERE h.id=? AND h.enabled=1 AND h.token_hash=? AND s.event_id='mall-48h' AND s.point_mode='hardware'`)
    .bind(deviceId, await hash(token)).first<EntryDevice>();
  if (!device) throw new GameError("设备授权无效或点位已停用", 401);
  if (!device.bound_task_id) throw new GameError("金币尚未绑定任务，请先在商家端完成绑定", 409);
  validateFixedBinding(device);
  const available = await d.prepare(`SELECT 1 FROM tasks t JOIN stores s ON s.id=t.store_id
    LEFT JOIN coupon_templates ct ON ct.id=t.reward_coupon_id
    WHERE t.id=? AND s.id=? AND t.status='published' AND t.deleted_at IS NULL
      AND s.event_id='mall-48h' AND s.status='active' AND (t.expires_at IS NULL OR t.expires_at>?)
      AND (t.reward_type='points' OR t.reward_coupon_id IS NULL OR (ct.store_id=s.id AND ct.status='active' AND ct.deleted_at IS NULL
        AND (ct.valid_start IS NULL OR ct.valid_start<=?) AND (ct.valid_end IS NULL OR ct.valid_end>?)
        AND (SELECT COUNT(*) FROM claims WHERE template_id=ct.id)<ct.total_count))
      AND (SELECT COUNT(*) FROM claims c WHERE c.store_id=s.id AND c.event_id=s.event_id)<s.stock_total`)
    .bind(device.bound_task_id, device.store_id, now, now, now).first();
  if (!available) throw new GameError("金币任务已下架、过期或奖励已领完", 409);
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(device.bound_task_id))
    throw new GameError("动态二维码任务地址配置不正确，请联系现场人员", 503);
  const expirySeconds = Math.floor(now / 1000) + HARDWARE_ENTRY_TTL_SECONDS;
  const expiresAt = expirySeconds * 1000, expiry = expirySeconds.toString(36);
  const nonce = base64url(crypto.getRandomValues(new Uint8Array(16)));
  const signature = base64url(new Uint8Array(await crypto.subtle.sign("HMAC", await entryKey(device.token_hash, "sign"),
    entryPayload(deviceId, device.store_id, device.bound_task_id, expiry, nonce))));
  const entryToken = `v1.${deviceId}.${expiry}.${nonce}.${signature}`;
  const entryUrl = new URL(`/client/coin/${device.bound_task_id}`, req.url);
  entryUrl.searchParams.set("entry", entryToken);
  const url = entryUrl.toString();
  if (!/^[\x20-\x7e]+$/.test(url) || new TextEncoder().encode(url).byteLength > 160)
    throw new GameError("动态二维码地址超过160字节，请配置更短的服务器或任务地址", 503);
  const ttlSeconds = Math.floor((expiresAt - Date.now()) / 1000);
  if (ttlSeconds < 1) throw new GameError("金币二维码已过期，请重新获取", 409);
  return { deviceId, storeId: device.store_id, taskId: device.bound_task_id, entryUrl: url, expiresAt, ttlSeconds };
}

type Device = { id: string; store_id: string; token_hash: string; enabled: number; name: string };
type CodeRow = { id: string; store_id: string; request_id: string; nonce: string; expires_at: number; used_by: string | null; auth_hash: string };
// This device ships fixed local clues and a QR for quest-tea. Other devices may
// still issue store-wide codes for any published task in their bound store.
const FIXED_ENTRY_AVAILABLE = `(? <> 'coin-tea-01' OR EXISTS(SELECT 1 FROM tasks
  WHERE id='quest-tea' AND store_id='tea' AND store_id=? AND status='published' AND deleted_at IS NULL))`;

export async function issueHardwareCode(req: Request, input: Record<string, unknown>) {
  const deviceId = typeof input.deviceId === "string" ? input.deviceId : "";
  const requestId = typeof input.requestId === "string" ? input.requestId : "";
  if (!HARDWARE_DEVICE_ID.test(deviceId) || !HARDWARE_REQUEST_ID.test(requestId)) throw new GameError("设备或请求标识格式不正确");
  const token = req.headers.get("authorization")?.match(/^Bearer ([A-Za-z0-9_-]{32,128})$/)?.[1];
  if (!token) throw new GameError("设备授权无效", 401);
  const authHash = await hash(token);
  const d = db();
  const device = await d.prepare("SELECT h.*,s.name FROM hardware_devices h JOIN stores s ON s.id=h.store_id WHERE h.id=? AND h.enabled=1 AND h.token_hash=? AND s.event_id='mall-48h' AND s.point_mode='hardware'").bind(deviceId, authHash).first<Device>();
  if (!device) throw new GameError("设备授权无效或点位已停用", 401);
  const now = Date.now();
  const read = () => d.prepare("SELECT id,store_id,request_id,nonce,expires_at,used_by,auth_hash FROM hardware_codes WHERE device_id=? AND request_id=?").bind(deviceId, requestId).first<CodeRow>();
  const response = async (row: CodeRow) => {
    if (row.store_id !== device.store_id || row.auth_hash !== authHash || row.expires_at <= Date.now() || row.used_by) throw new GameError("该次临时码已过期或使用，请重新获取", 409);
    const code = await hardwareCodeValue(token, deviceId, requestId, row.nonce);
    const ttlSeconds = Math.max(0, Math.floor((row.expires_at - Date.now()) / 1000));
    if (!ttlSeconds) throw new GameError("该次临时码已过期，请重新获取", 409);
    return { code, expiresAt: row.expires_at, ttlSeconds, storeName: device.name, storeId: device.store_id };
  };
  const previous = await read();
  if (previous) return response(previous);
  const checkFixedEntry = async () => {
    if (deviceId === "coin-tea-01" && !await d.prepare(`SELECT 1 WHERE ${FIXED_ENTRY_AVAILABLE}`)
      .bind(deviceId, device.store_id).first())
      throw new GameError("金币的固定寻宝入口暂不可用，请联系现场人员", 403);
  };
  await checkFixedEntry();
  // Refuse to churn live codes: a button press does not invalidate another visitor's code.
  const active = await d.prepare("SELECT id FROM hardware_codes WHERE device_id=? AND used_by IS NULL AND expires_at>? AND auth_hash=?").bind(deviceId, now, authHash).first();
  if (active) throw new GameError("设备已有有效临时码，请等待到期后再获取", 429);
  const available = await d.prepare("SELECT 1 FROM tasks t JOIN stores s ON s.id=t.store_id WHERE s.id=? AND t.status='published' AND t.deleted_at IS NULL AND (SELECT COUNT(*) FROM claims c WHERE c.store_id=s.id AND c.event_id=s.event_id)<s.stock_total LIMIT 1").bind(device.store_id).first();
  if (!available) throw new GameError("该点位暂无可领取的任务或奖励", 409);
  for (let attempt = 0; attempt < 4; attempt++) {
    const nonce = crypto.randomUUID();
    const code = await hardwareCodeValue(token, deviceId, requestId, nonce);
    const codeHash = await hardwareCodeHash(device.store_id, code);
    const id = crypto.randomUUID();
    // D1 serializes this conditional insert, including simultaneous button requests.
    await d.batch([
      d.prepare(`INSERT INTO hardware_codes(id,device_id,store_id,request_id,nonce,code_hash,auth_hash,created_at,expires_at)
        SELECT ?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM hardware_devices h JOIN stores s ON s.id=h.store_id WHERE h.id=? AND h.enabled=1 AND h.token_hash=? AND h.store_id=? AND s.event_id='mall-48h' AND s.point_mode='hardware')
        AND EXISTS(SELECT 1 FROM tasks t JOIN stores s ON s.id=t.store_id WHERE s.id=? AND t.status='published' AND t.deleted_at IS NULL AND (SELECT COUNT(*) FROM claims c WHERE c.store_id=s.id AND c.event_id=s.event_id)<s.stock_total)
        AND NOT EXISTS(SELECT 1 FROM hardware_codes WHERE device_id=? AND used_by IS NULL AND expires_at>? AND auth_hash=?)
        AND NOT EXISTS(SELECT 1 FROM hardware_codes WHERE store_id=? AND code_hash=? AND expires_at>?)
        AND ${FIXED_ENTRY_AVAILABLE}
        ON CONFLICT(device_id,request_id) DO NOTHING`).bind(id, deviceId, device.store_id, requestId, nonce, codeHash, authHash, now, now + HARDWARE_CODE_TTL_MS, deviceId, authHash, device.store_id, device.store_id, deviceId, now, authHash, device.store_id, codeHash, now, deviceId, device.store_id),
      d.prepare("UPDATE hardware_devices SET last_seen_at=? WHERE id=? AND enabled=1 AND token_hash=?").bind(now, deviceId, authHash),
    ]);
    const issued = await read();
    if (issued) return response(issued);
    // A task removed after preflight must report the same entry failure, while
    // the conditional INSERT already guarantees no new code was minted.
    await checkFixedEntry();
    const occupied = await d.prepare("SELECT id FROM hardware_codes WHERE device_id=? AND used_by IS NULL AND expires_at>? AND auth_hash=?").bind(deviceId, now, authHash).first();
    if (occupied) throw new GameError("设备已有有效临时码，请等待到期后再获取", 429);
    const stillAuthorized = await d.prepare("SELECT id FROM hardware_devices WHERE id=? AND enabled=1 AND token_hash=? AND store_id=?").bind(deviceId, authHash, device.store_id).first();
    if (!stillAuthorized) throw new GameError("设备授权已改变，请重新配置", 401);
  }
  throw new GameError("该点位暂不能生成临时码，请稍后重试", 409);
}

type StatusRow = {
  device_store_id: string;
  code_id: string | null;
  code_store_id: string | null;
  auth_hash: string | null;
  expires_at: number | null;
  used_by: string | null;
  claim_id: string | null;
  claim_valid: number;
};

export async function hardwareCodeStatus(req: Request, input: Record<string, unknown>) {
  const deviceId = typeof input.deviceId === "string" ? input.deviceId : "";
  const requestId = typeof input.requestId === "string" ? input.requestId : "";
  if (!HARDWARE_DEVICE_ID.test(deviceId) || !HARDWARE_REQUEST_ID.test(requestId))
    throw new GameError("设备或请求标识格式不正确");
  const token = req.headers.get("authorization")?.match(/^Bearer ([A-Za-z0-9_-]{32,128})$/)?.[1];
  if (!token) throw new GameError("设备授权无效", 401);
  const authHash = await hash(token);
  // Check current authorization, binding, request and claim in one read snapshot.
  // A status poll never creates a code, consumes it or establishes a player session.
  const row = await db().prepare(`SELECT h.store_id AS device_store_id,hc.id AS code_id,
    hc.store_id AS code_store_id,hc.auth_hash,hc.expires_at,hc.used_by,hc.claim_id,
    EXISTS(SELECT 1 FROM claims c WHERE c.id=hc.claim_id AND c.player_id=hc.used_by
      AND c.store_id=hc.store_id AND c.event_id=s.event_id) AS claim_valid
    FROM hardware_devices h JOIN stores s ON s.id=h.store_id
    LEFT JOIN hardware_codes hc ON hc.device_id=h.id AND hc.request_id=?
    WHERE h.id=? AND h.enabled=1 AND h.token_hash=?
      AND s.event_id='mall-48h' AND s.point_mode='hardware'`)
    .bind(requestId, deviceId, authHash).first<StatusRow>();
  if (!row) throw new GameError("设备授权无效或点位已停用", 401);
  if (!row.code_id) throw new GameError("该设备没有此临时码请求", 404);
  if (row.code_store_id !== row.device_store_id || row.auth_hash !== authHash)
    throw new GameError("设备授权或点位绑定已改变，请重新获取", 409);
  if (row.expires_at === null) throw new GameError("临时码状态暂不可用，请稍后重试", 503);
  const expiresAt = row.expires_at;
  if (row.used_by !== null || row.claim_id !== null) {
    if (!row.used_by || !row.claim_id || !row.claim_valid)
      throw new GameError("临时码领奖记录不完整，请联系现场人员", 409);
    // An awarded code remains used after expiry, including a delayed device poll.
    return { state: "used" as const, expiresAt, storeId: row.device_store_id };
  }
  return {
    state: Date.now() < expiresAt ? "active" as const : "expired" as const,
    expiresAt,
    storeId: row.device_store_id,
  };
}

type SyncRow = {
  store_id: string;
  store_name: string;
  task_id: string;
  stock_total: number;
  task_available: number;
  claim_count: number;
};

export async function hardwareStoreSync(req: Request, input: Record<string, unknown>) {
  const now=Date.now();
  const deviceId = typeof input.deviceId === "string" ? input.deviceId : "";
  if (!HARDWARE_DEVICE_ID.test(deviceId)) throw new GameError("设备标识格式不正确");
  const token = req.headers.get("authorization")?.match(/^Bearer ([A-Za-z0-9_-]{32,128})$/)?.[1];
  if (!token) throw new GameError("设备授权无效", 401);
  // Availability and the aggregate claim count share the authorization snapshot.
  // Sold-out or hidden tasks still return the count, including the final reward.
  const row = await db().prepare(`SELECT s.id AS store_id,s.name AS store_name,
    'quest-' || s.id AS task_id,s.stock_total,
    EXISTS(SELECT 1 FROM tasks t LEFT JOIN coupon_templates ct ON ct.id=t.reward_coupon_id WHERE t.id='quest-' || s.id
      AND t.store_id=s.id AND t.status='published' AND t.deleted_at IS NULL AND s.status='active' AND (t.expires_at IS NULL OR t.expires_at>?)
      AND (t.reward_type='points' OR t.reward_coupon_id IS NULL OR (ct.store_id=s.id AND ct.status='active' AND ct.deleted_at IS NULL
        AND (ct.valid_start IS NULL OR ct.valid_start<=?) AND (ct.valid_end IS NULL OR ct.valid_end>?)
        AND (SELECT COUNT(*) FROM claims WHERE template_id=ct.id)<ct.total_count))) AS task_available,
    (SELECT COUNT(*) FROM claims c WHERE c.store_id=s.id AND c.event_id=s.event_id) AS claim_count
    FROM hardware_devices h JOIN stores s ON s.id=h.store_id
    WHERE h.id=? AND h.enabled=1 AND h.token_hash=?
      AND s.event_id='mall-48h' AND s.point_mode='hardware'`)
    .bind(now,now,now,deviceId, await hash(token)).first<SyncRow>();
  if (!row) throw new GameError("设备授权无效或点位已停用", 401);
  if (deviceId === "coin-tea-01" && row.store_id !== "tea")
    throw new GameError("金币的固定点位绑定不正确，请联系现场人员", 403);
  return {
    storeId: row.store_id,
    storeName: row.store_name,
    taskId: row.task_id,
    available: Boolean(row.task_available && row.claim_count < row.stock_total),
    claimCount: row.claim_count,
  };
}
