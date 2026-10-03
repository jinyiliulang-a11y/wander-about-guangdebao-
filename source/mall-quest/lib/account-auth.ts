import { env } from "cloudflare:workers";
import { cookie, db, hash, session, sessionCookie, staff } from "./game-server";
import { HARDWARE_DEMO_INSTANCE } from "./application-scope";
import { sessionCookieName, sessionCookiePath, sessionCookieSecure } from "./session-scope";
import { GameError } from "./game-error";
import { validCoordinates, validRadius } from "./geofence";
import { recordPlayerActivity } from "./game-business";
import type { AccountApplication, AccountApplicationsResult, AccountLoginResult, AccountRegistrationResult, AccountRole, AccountStatus, AccountStatusResult, MerchantRegistration } from "./account-types";

type Row = Record<string, unknown>;
const EVENT = "mall-48h", ITERATIONS = 100000, MAX_DATE = 253402271999999;
const ROLE_SET = new Set(["player", "merchant", "admin"]);
const statusMessage = (status: AccountStatus) => status === "approved" ? "账号已通过，可以使用邮箱和密码登录" : status === "pending" ? "注册申请已提交，等待运营审核" : "注册申请未通过，请查看审核说明";
const clearCookie = (req: Request, name: string) => `${sessionCookieName(name)}=; Path=${sessionCookiePath()}; HttpOnly; SameSite=Lax; Max-Age=0${sessionCookieSecure(req) ? "; Secure" : ""}`;
function text(value: unknown, min: number, max: number, label: string) {
  const result = typeof value === "string" ? value.trim() : "";
  if ([...result].length < min || [...result].length > max) throw new GameError(`${label}请填写${min}至${max}字`);
  return result;
}
function number(value: unknown, min: number, max: number, label: string, integer = false) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isSafeInteger(value)))
    throw new GameError(`${label}格式不正确`);
  return value;
}
function role(value: unknown): AccountRole {
  if (!ROLE_SET.has(String(value))) throw new GameError("账号身份不正确");
  return value as AccountRole;
}
async function credentials(input: Row) {
  const value = typeof input.username === "string" ? input.username.trim() : "";
  // Mailboxes follow the same canonicalization as email proofs. Existing short
  // usernames remain valid credentials for previously created demo/accounts.
  const username = value.includes("@") ? (await import("./email-auth")).normalizeEmail(value) : value.normalize("NFKC").toLowerCase();
  if (!username.includes("@") && !/^[a-z0-9._-]{3,32}$/.test(username)) throw new GameError("请填写注册邮箱或已有账号名");
  const password = typeof input.password === "string" ? input.password : "";
  if (password.length < 3 || password.length > 128 || !password.trim()) throw new GameError("密码请填写3至128个字符");
  return { username, password, role: role(input.role) };
}
const hex = (bytes: Uint8Array) => Array.from(bytes, value => value.toString(16).padStart(2, "0")).join("");
async function derive(password: string, salt: string, iterations: number) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bytes = new Uint8Array(salt.match(/.{2}/g)!.map(value => parseInt(value, 16)));
  return hex(new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", salt: bytes, iterations, hash: "SHA-256" }, key, 256)));
}
function equal(left: string, right: string) {
  let mismatch = left.length ^ right.length;
  for (let i = 0; i < Math.max(left.length, right.length); i++) mismatch |= (left.charCodeAt(i) || 0) ^ (right.charCodeAt(i) || 0);
  return mismatch === 0;
}
async function passwordRecord(password: string) {
  const salt = hex(crypto.getRandomValues(new Uint8Array(16)));
  return { salt, digest: await derive(password, salt, ITERATIONS) };
}
async function verify(row: Row | null, password: string) {
  const salt = row ? String(row.password_salt) : "00000000000000000000000000000000";
  const iterations = row ? Number(row.password_iterations) : ITERATIONS;
  if (!/^[a-f0-9]{32}$/.test(salt) || !Number.isSafeInteger(iterations) || iterations < 10000 || iterations > ITERATIONS)
    throw new GameError("账号凭证暂不可用，请联系运营", 503);
  const derived = await derive(password, salt, iterations);
  return !!row && equal(derived, String(row.password_hash));
}
async function available() {
  try { await db().prepare("SELECT id FROM accounts LIMIT 1").first(); }
  catch { throw new GameError("账号服务暂未就绪，请联系运营或稍后重试", 503); }
}
export async function rate(req: Request, purpose: string, subject: string, limit: number, window: number) {
  const now = Date.now(), ip = req.headers.get("cf-connecting-ip") || req.headers.get("x-real-ip") || "unavailable";
  await db().prepare("DELETE FROM account_rate_limits WHERE window_started_at<?").bind(now - 86400000).run();
  for (const [label, value, cap] of [["subject", subject, limit], ["origin", ip, limit * 5]] as const) {
    const key = await hash(`${purpose}:${label}:${value}`);
    const result = await db().prepare(`INSERT INTO account_rate_limits(key,window_started_at,attempt_count) VALUES(?,?,1)
      ON CONFLICT(key) DO UPDATE SET window_started_at=CASE WHEN account_rate_limits.window_started_at<=? THEN excluded.window_started_at ELSE account_rate_limits.window_started_at END,
      attempt_count=CASE WHEN account_rate_limits.window_started_at<=? THEN 1 ELSE account_rate_limits.attempt_count+1 END
      WHERE account_rate_limits.window_started_at<=? OR account_rate_limits.attempt_count<?`)
      .bind(key, now, now - window, now - window, now - window, cap).run();
    if (!result.meta.changes) throw new GameError("尝试次数较多，请稍后再试", 429);
  }
}
function merchantInput(value: unknown, now: number, requireFuture = true): MerchantRegistration {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new GameError("请填写门店和优惠券信息");
  const row = value as Row, coupon = row.coupon as Row;
  if (!coupon || typeof coupon !== "object" || Array.isArray(coupon)) throw new GameError("请填写首张优惠券信息");
  if (!validCoordinates(row.latitude, row.longitude) || !validRadius(row.radiusMeters)) throw new GameError("请填写真实WGS84经纬度及20至5000米门店范围");
  if (!["cash", "discount", "gift"].includes(String(coupon.type))) throw new GameError("优惠券类型不正确");
  const type = coupon.type as MerchantRegistration["coupon"]["type"];
  const valueAmount = number(coupon.value, type === "cash" ? 0.01 : type === "discount" ? 0.1 : 0, type === "discount" ? 9.9 : type === "gift" ? 0 : 1000000, "优惠券面值");
  const minAmount = number(coupon.minAmount, 0, 1000000, "使用门槛");
  if (type === "cash" && minAmount < valueAmount) throw new GameError("消费门槛不能低于现金减免金额");
  const date = (value: unknown, label: string) => value == null || value === "" ? null : number(value, 1, MAX_DATE, label, true);
  const start = date(coupon.validStart, "生效时间"), end = date(coupon.validEnd, "到期时间");
  if (end !== null && ((requireFuture && end <= now) || (start !== null && end <= start))) throw new GameError("优惠券到期时间需晚于现在和生效时间");
  const phone = row.phone == null || row.phone === "" ? "" : text(row.phone, 1, 24, "门店联系电话");
  if (phone && !/^[+\d\s()-]+$/.test(phone)) throw new GameError("门店联系电话格式不正确");
  return { name: text(row.name, 1, 60, "门店名称"), address: text(row.address, 1, 200, "门店地址"),
    floor: text(row.floor, 1, 12, "楼层"), area: text(row.area, 1, 80, "区域"), category: text(row.category, 1, 40, "门店分类"), phone,
    latitude: row.latitude as number, longitude: row.longitude as number, radiusMeters: row.radiusMeters as number,
    coupon: { title: text(coupon.title, 1, 80, "优惠券标题"), type, value: valueAmount, minAmount,
      totalCount: number(coupon.totalCount, 1, 100000, "库存", true), conditions: text(coupon.conditions, 1, 500, "使用条件"), validStart: start, validEnd: end } };
}
function dto(row: Row): AccountApplication {
  const phone = row.phone ? String(row.phone) : null;
  return { id: String(row.id), requestId: row.request_id == null ? null : String(row.request_id), username: String(row.username), role: row.role as AccountRole,
    nickname: String(row.nickname), phoneMasked: phone ? phone.slice(0, 3) + "****" + phone.slice(-4) : null,
    status: row.status as AccountStatus, reviewNote: String(row.review_note), revision: Number(row.revision),
    storeId: row.store_id == null ? null : String(row.store_id), merchant: row.merchant_json == null ? null : JSON.parse(String(row.merchant_json)),
    createdAt: Number(row.created_at), updatedAt: Number(row.updated_at) };
}
/** Only an explicit configured password initializes the reserved demo admin once. */
export async function ensureDemoAdmin() {
  await available();
  const password = (env as unknown as Record<string, unknown>).DEMO_ADMIN_PASSWORD;
  if (typeof password !== "string" || password.length < 3 || password.length > 128 || !password.trim()) return;
  if (await db().prepare("SELECT id FROM accounts WHERE username='admin' AND role='admin'").first()) return;
  const now = Date.now(), playerId = "account-demo-admin", record = await passwordRecord(password);
  await db().batch([
    db().prepare("INSERT OR IGNORE INTO players(id,nickname,created_at) VALUES(?,?,?)").bind(playerId, "演示管理员", now),
    db().prepare(`INSERT OR IGNORE INTO accounts(id,request_id,request_hash,username,role,password_salt,password_hash,password_iterations,player_id,nickname,status,created_at,updated_at)
      VALUES('demo-admin',NULL,'bootstrap','admin','admin',?,?,?,?,?,'approved',?,?)`).bind(record.salt, record.digest, ITERATIONS, playerId, "演示管理员", now, now),
  ]);
}
export async function registerAccount(req: Request, input: Row): Promise<AccountRegistrationResult> {
  await ensureDemoAdmin();
  const emailService = await import("./email-auth"), email = emailService.normalizeEmail(input.email);
  const parsed = await credentials({ ...input, username: email }), now = Date.now();
  if (input.username !== undefined && emailService.normalizeEmail(input.username) !== email)
    throw new GameError("注册邮箱就是账号，请使用同一个邮箱地址");
  // Validate the complete submitted proof even during idempotent recovery.
  // Its cryptographic verification occurs after checking a successful replay,
  // because that exact registration has already consumed the one-use code.
  const emailChallengeId = typeof input.emailChallengeId === "string" ? input.emailChallengeId.toLowerCase() : "";
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(emailChallengeId))
    throw new GameError("请先获取注册邮箱验证码");
  const emailCode = typeof input.emailCode === "string" ? input.emailCode : "";
  if (!/^\d{6}$/.test(emailCode)) throw new GameError("请填写6位注册邮箱验证码");
  if (input.confirmPassword !== undefined && input.confirmPassword !== parsed.password) throw new GameError("两次密码不一致");
  const requestId = typeof input.requestId === "string" ? input.requestId.toLowerCase() : "";
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(requestId)) throw new GameError("注册请求标识不正确，请重新提交");
  const nickname = input.nickname == null || input.nickname === "" ? email.split("@")[0].slice(0, 24) : text(input.nickname, 1, 24, "昵称");
  const phone = input.phone == null || input.phone === "" ? null : text(input.phone, 11, 11, "联系电话");
  if (phone && !/^1\d{10}$/.test(phone)) throw new GameError("联系电话请填写11位手机号");
  const merchant = parsed.role === "merchant" ? merchantInput(input.merchant, now, false) : null;
  if (parsed.role !== "merchant" && input.merchant != null) throw new GameError("此身份无需填写门店资料");
  await rate(req, "register", email, 10, 3600000);
  const fingerprint = await hash(JSON.stringify({ username: parsed.username, role: parsed.role, nickname, phone, merchant,
    email, emailChallengeId, emailCode }));
  const existing = await db().prepare("SELECT * FROM accounts WHERE request_id=? OR (username=? AND role=?) OR (email=? AND role=?)")
    .bind(requestId, parsed.username, parsed.role, email, parsed.role).first<Row>();
  const replay = async (row: Row): Promise<AccountRegistrationResult> => {
    if (row.request_id !== requestId || row.username !== parsed.username || row.request_hash !== fingerprint || !await verify(row, parsed.password))
      throw new GameError("邮箱或注册请求已存在，请登录已有账号或更换邮箱", 409);
    return { registered: true, status: row.status as AccountStatus, username: parsed.username, message: statusMessage(row.status as AccountStatus), replayed: true };
  };
  if (existing) return replay(existing);
  // Time may have passed since a successfully saved request. Recover that
  // exact result above, while still rejecting expired coupons on new requests.
  if (merchant?.coupon.validEnd != null && merchant.coupon.validEnd <= now)
    throw new GameError("优惠券到期时间需晚于现在和生效时间");
  const emailProof = await emailService.verifyEmailProof(req, { role: parsed.role, email, purpose: "register", code: emailCode, challengeId: emailChallengeId });
  const consumeNonce = crypto.randomUUID(), emailGuard = emailService.consumedEmailProof(emailProof, consumeNonce);
  const current = await session(req), record = await passwordRecord(parsed.password);
  const candidate = current && !current.account_id ? current.player_id : null;
  const reusable = candidate ? await db().prepare("SELECT id FROM players WHERE id=? AND banned=0 AND NOT EXISTS(SELECT 1 FROM accounts WHERE player_id=players.id)").bind(candidate).first<{ id: string }>() : null;
  const playerId = reusable?.id || `account-player-${requestId}`, status = parsed.role === "player" ? "approved" : "pending";
  const statements=[
    db().prepare(`INSERT OR IGNORE INTO players(id,nickname,created_at) SELECT ?,?,?
      WHERE NOT EXISTS(SELECT 1 FROM accounts WHERE (username=? AND role=?) OR request_id=?) AND ${emailGuard.sql}`)
      .bind(playerId,nickname,now,parsed.username,parsed.role,requestId,...emailGuard.values),
    db().prepare(`INSERT OR IGNORE INTO accounts(id,request_id,request_hash,username,role,password_salt,password_hash,password_iterations,player_id,nickname,phone,merchant_json,status,created_at,updated_at,email)
      SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,? FROM players p WHERE p.id=? AND p.banned=0 AND ${emailGuard.sql}`)
      .bind(requestId,requestId,fingerprint,parsed.username,parsed.role,record.salt,record.digest,ITERATIONS,playerId,nickname,phone,merchant?JSON.stringify(merchant):null,status,now,now,
        email,playerId,...emailGuard.values),
    db().prepare(`UPDATE players SET nickname=? WHERE id=? AND EXISTS(SELECT 1 FROM accounts WHERE id=? AND request_hash=? AND player_id=players.id
      AND username=? AND password_salt=? AND password_hash=?)`).bind(nickname, playerId, requestId, fingerprint, parsed.username, record.salt, record.digest),
  ];
  statements.unshift(emailService.consumeEmailProof(emailProof,consumeNonce,
    "NOT EXISTS(SELECT 1 FROM accounts WHERE (username=? AND role=?) OR request_id=? OR (role=? AND email=?) OR player_id=?) "
      +"AND NOT EXISTS(SELECT 1 FROM players WHERE id=? AND banned<>0)",
    [parsed.username,parsed.role,requestId,parsed.role,email,playerId,playerId]));
  const results=await db().batch(statements);
  const saved = await db().prepare("SELECT * FROM accounts WHERE request_id=? OR (username=? AND role=?)").bind(requestId, parsed.username, parsed.role).first<Row>();
  if (!saved) throw new GameError("当前身份已被其他注册绑定，请重新提交", 409);
  // INSERT OR IGNORE can lose a concurrent username/request/player binding race.
  // Always verify the complete persisted request and password before reporting it.
  const result = await replay(saved);
  return results[2].meta.changes ? { ...result, replayed: undefined } : result;
}
export async function identify(req: Request, input: Row): Promise<Row> {
  await ensureDemoAdmin();
  const parsed = await credentials(input);
  await rate(req, "login", `${parsed.role}:${parsed.username}`, 12, 900000);
  const row = parsed.username.includes("@")
    ? await db().prepare("SELECT a.*,p.banned FROM accounts a JOIN players p ON p.id=a.player_id WHERE a.role=? AND (a.username=? OR a.email=?)")
      .bind(parsed.role, parsed.username, parsed.username).first<Row>()
    : await db().prepare("SELECT a.*,p.banned FROM accounts a JOIN players p ON p.id=a.player_id WHERE a.username=? AND a.role=?").bind(parsed.username, parsed.role).first<Row>();
  if (!await verify(row, parsed.password) || row?.role !== parsed.role) throw new GameError("邮箱或账号、密码或身份不正确", 401);
  if (row!.banned) throw new GameError("此账号已停用，请联系运营", 403);
  return row!;
}
export async function loginAccount(req: Request, input: Row, workspace = false): Promise<AccountLoginResult> {
  const row = await identify(req, input);
  if (workspace ? row.role === "player" : row.role !== "player") throw new GameError("请选择对应的账号登录入口", 401);
  if (row.status !== "approved") throw new GameError(statusMessage(row.status as AccountStatus) + (row.review_note ? `：${row.review_note}` : ""), 403);
  if (row.role === "merchant" && !row.store_id) throw new GameError("商家门店尚未绑定，请联系运营", 409);
  if (input.storeId !== undefined && input.storeId !== row.store_id) throw new GameError("不能选择其他门店登录", 403);
  return issueAccountSession(req, row, workspace);
}
type SessionGuard={sql:string;values:(string|number|null)[];before:ReturnType<ReturnType<typeof db>["prepare"]>[]};
export async function issueAccountSession(req: Request, row: Row, workspace: boolean, message = "登录成功",guard?:SessionGuard): Promise<AccountLoginResult> {
  const now = Date.now(), playerToken = crypto.randomUUID() + crypto.randomUUID(), staffToken = crypto.randomUUID() + crypto.randomUUID();
  const playerHash = await hash(playerToken), staffHash = await hash(staffToken), d = db();
  const authSQL = "SELECT id FROM accounts WHERE id=? AND role=? AND player_id=? AND store_id IS ? AND password_hash=? AND status='approved' AND EXISTS(SELECT 1 FROM players p WHERE p.id=accounts.player_id AND p.banned=0)"+(guard?" AND "+guard.sql:"");
  const authValues = [row.id, row.role, row.player_id, row.store_id, row.password_hash,...(guard?.values??[])];
  const statements = [...(guard?.before??[]),d.prepare(`INSERT INTO sessions(token_hash,role,player_id,store_id,expires_at,account_id)
    SELECT ?,'player',a.player_id,NULL,?,a.id FROM accounts a WHERE a.id IN (${authSQL})`).bind(playerHash, now + 2592000000, ...authValues)];
  if (workspace) statements.push(d.prepare(`INSERT INTO sessions(token_hash,role,player_id,store_id,expires_at,account_id)
    SELECT ?,a.role,a.player_id,a.store_id,?,a.id FROM accounts a WHERE a.id IN (${authSQL}) AND a.role IN ('admin','merchant')`).bind(staffHash, now + 43200000, ...authValues));
  for (const name of ["mall_player", "mall_staff"]) {
    const old = cookie(req, name);
    if (old) statements.push(d.prepare(`DELETE FROM sessions WHERE token_hash=?
      AND EXISTS(SELECT 1 FROM sessions fresh WHERE fresh.token_hash=?)`).bind(await hash(old), playerHash));
  }
  await d.batch(statements);
  if (!await d.prepare("SELECT token_hash FROM sessions WHERE token_hash=?").bind(playerHash).first() || (workspace && !await d.prepare("SELECT token_hash FROM sessions WHERE token_hash=?").bind(staffHash).first()))
    throw new GameError("账号状态已变化，请重新登录", 409);
  if (!workspace) await recordPlayerActivity(String(row.player_id));
  return { authenticated: true, accountId: String(row.id), username: String(row.username), role: row.role as AccountRole,
    storeId: row.store_id == null ? null : String(row.store_id), message, setCookie: [sessionCookie(req, playerToken), workspace ? sessionCookie(req, staffToken, true) : clearCookie(req, "mall_staff")] };
}
export async function accountApplicationStatus(req: Request, input: Row): Promise<AccountStatusResult> {
  const row = await identify(req, input);
  return { application: dto(row), message: statusMessage(row.status as AccountStatus) };
}
async function requireAdmin(req: Request) {
  if ((await staff(req)).role !== "admin") throw new GameError("此操作仅限运营", 403);
}
export async function accountApplications(req: Request, input: Row): Promise<AccountApplicationsResult> {
  await requireAdmin(req); await available();
  const filter = input.filter === undefined ? "pending" : input.filter;
  if (!["pending", "approved", "rejected", "all"].includes(String(filter))) throw new GameError("申请筛选条件不正确");
  const requested = input.page === undefined ? 1 : number(input.page, 1, Number.MAX_SAFE_INTEGER, "页码", true);
  // Bootstrap and recording identities are not merchant/operator applications.
  const where = " WHERE request_id IS NOT NULL" + (filter === "all" ? "" : " AND status=?"), bindings = filter === "all" ? [] : [String(filter)];
  const total = Number((await db().prepare("SELECT COUNT(*) AS n FROM accounts" + where).bind(...bindings).first<{ n: number }>())?.n || 0);
  const totalPages = Math.max(1, Math.ceil(total / 20)), page = Math.min(requested, totalPages);
  const rows = (await db().prepare("SELECT * FROM accounts" + where + " ORDER BY created_at DESC,id DESC LIMIT 20 OFFSET ?").bind(...bindings, (page - 1) * 20).all<Row>()).results;
  return { applications: rows.map(dto), pagination: { page, pageSize: 20, total, totalPages } };
}
export async function accountApplication(req: Request, input: Row) {
  await requireAdmin(req); await available();
  const id = text(input.id, 1, 100, "申请标识"), row = await db().prepare("SELECT * FROM accounts WHERE id=? AND request_id IS NOT NULL").bind(id).first<Row>();
  if (!row) throw new GameError("申请不存在", 404);
  return { application: dto(row) };
}
export async function reviewAccount(req: Request, input: Row) {
  await requireAdmin(req); await available();
  const id = text(input.id, 1, 100, "申请标识"), expected = number(input.expectedRevision, 1, Number.MAX_SAFE_INTEGER - 1, "申请版本", true);
  if (!["approved", "rejected"].includes(String(input.status))) throw new GameError("审核结果不正确");
  const status = input.status as "approved" | "rejected", note = text(input.note ?? "", status === "rejected" ? 2 : 0, 160, "审核说明");
  const row = await db().prepare("SELECT * FROM accounts WHERE id=?").bind(id).first<Row>();
  if (!row) throw new GameError("申请不存在", 404);
  if (row.status === status && Number(row.revision) === expected + 1 && row.review_note === note)
    return { application: dto(row), message: "审核结果已保存", replayed: true as const };
  if (row.role === "player" || row.status !== "pending" || Number(row.revision) !== expected) throw new GameError("申请状态已改变，请刷新后再审核", 409);
  const now = Date.now(), storeId = row.role === "merchant" && status === "approved" ? `store-${id}` : null;
  const merchant = storeId ? merchantInput(JSON.parse(String(row.merchant_json)), now) : null;
  const tokenHash = await hash(cookie(req, "mall_staff") || "");
  const guard = `a.id=? AND a.revision=? AND a.status='pending' AND EXISTS(SELECT 1 FROM players ap WHERE ap.id=a.player_id AND ap.banned=0)
    AND EXISTS(SELECT 1 FROM sessions ss JOIN accounts sa ON sa.id=ss.account_id JOIN players sp ON sp.id=sa.player_id
      WHERE ss.token_hash=? AND ss.role='admin' AND sa.role='admin' AND sa.status='approved' AND ss.player_id=sa.player_id AND sp.banned=0
      AND ss.expires_at>MAX(?,CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)))`;
  const values = [id, expected, tokenHash, now], nonce = crypto.randomUUID();
  // This first statement establishes one decision within D1's atomic batch. Every
  // resource insert uses its nonce; clocks and privilege changes cannot produce
  // half an approval, and a losing CAS creates no store, fence or coupon.
  const end = merchant?.coupon.validEnd ?? null;
  const statements = [db().prepare(`UPDATE accounts AS a SET review_token=? WHERE ${guard}
    AND (? IS NULL OR ?>MAX(?,CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)))`)
    .bind(nonce, ...values, end, end, now)];
  const decision = "a.id=? AND a.revision=? AND a.status='pending' AND a.review_token=?", decisionValues = [id, expected, nonce];
  if (merchant) {
    const c = merchant.coupon;
    statements.push(db().prepare(`INSERT INTO stores(id,event_id,name,floor,area,category,question,answer,code_hash,reward_title,conditions,stock_total,x,y,artwork,address,phone,status)
      SELECT ?,?,?,?,?,?,'','','',?,?,?,50,50,0,?,?,'active' FROM accounts a WHERE ${decision} AND a.role='merchant'`)
      .bind(storeId, EVENT, merchant.name, merchant.floor, merchant.area, merchant.category, c.title, c.conditions, c.totalCount, merchant.address, merchant.phone, ...decisionValues));
    statements.push(db().prepare(`INSERT INTO store_geofences(store_id,enabled,latitude,longitude,radius_meters,revision,updated_at)
      SELECT ?,1,?,?,?,1,? FROM accounts a WHERE ${decision} AND a.role='merchant' AND EXISTS(SELECT 1 FROM stores WHERE id=?)`)
      .bind(storeId, merchant.latitude, merchant.longitude, merchant.radiusMeters, now, ...decisionValues, storeId));
    statements.push(db().prepare(`INSERT INTO coupon_templates(id,store_id,title,type,value,min_amount,total_count,valid_start,valid_end,status,created_at,updated_at)
      SELECT ?,?,?,?,?,?,?,?,?,'active',?,? FROM accounts a WHERE ${decision} AND a.role='merchant' AND EXISTS(SELECT 1 FROM stores WHERE id=?)`)
      .bind(`signup-${id}`, storeId, c.title, c.type, c.type === "discount" ? c.value * 10 : c.value, c.minAmount, c.totalCount, c.validStart, c.validEnd, now, now, ...decisionValues, storeId));
  }
  statements.push(db().prepare(`UPDATE accounts AS a SET status=?,review_note=?,store_id=?,revision=revision+1,updated_at=?,review_token=NULL WHERE ${decision}`)
    .bind(status, note, storeId, now, ...decisionValues));
  const results = await db().batch(statements), saved = await db().prepare("SELECT * FROM accounts WHERE id=?").bind(id).first<Row>();
  if (!results.at(-1)?.meta.changes && saved?.status === status && Number(saved.revision) === expected + 1 && saved.review_note === note)
    return { application: dto(saved), message: "审核结果已保存", replayed: true as const };
  if (!results.at(-1)?.meta.changes || !saved || saved.status !== status || Number(saved.revision) !== expected + 1)
    throw new GameError("审核权限或申请状态已改变，请刷新确认", 409);
  return { application: dto(saved), message: status === "approved" ? "申请已通过，可以使用账号密码登录" : "申请已退回" };
}
export async function registeredPlayer(req: Request) {
  const current = await session(req);
  if (!current?.player_id || !current.account_id || current.account_role !== "player") throw new GameError("请先注册并登录客户端账号，再进行此操作", 401);
  return current.player_id;
}
export function recordingShortcutAllowed(req: Request): boolean {
  const hostname = new URL(req.url).hostname;
  return (env as unknown as Record<string, unknown>).RECORDING_SHORTCUT_LOGIN === "true" &&
    (HARDWARE_DEMO_INSTANCE || hostname === "localhost" || hostname === "127.0.0.1");
}
const RECORDING_MARKER = "recording-shortcut-v1";
async function recordingIdentity(req: Request, accountRole: "player" | "merchant"): Promise<Row> {
  let playerId: string, accountId: string, username: string, storeId: string | null = null;
  if (accountRole === "merchant") {
    const store = await db().prepare("SELECT id FROM stores WHERE id='tea' AND event_id=?").bind(EVENT).first();
    if (!store) throw new GameError("演示门店不存在，请使用正常商家账号登录", 409);
    playerId = "recording-merchant-player-tea"; accountId = username = "recording-merchant-tea"; storeId = "tea";
  } else {
    const current = await session(req);
    if (current?.account_id) {
      const own = await db().prepare("SELECT a.*,p.banned FROM accounts a JOIN players p ON p.id=a.player_id WHERE a.id=? AND a.role='player' AND a.request_hash=? AND a.request_id IS NULL")
        .bind(current.account_id, RECORDING_MARKER).first<Row>();
      if (own && !own.banned && own.status === "approved") return own;
    }
    const reusable = current?.player_id && !current.account_id ? await db().prepare("SELECT id FROM players WHERE id=? AND banned=0 AND NOT EXISTS(SELECT 1 FROM accounts WHERE player_id=players.id)")
      .bind(current.player_id).first<{id: string}>() : null;
    playerId = reusable?.id || crypto.randomUUID();
    username = "recording-player-" + (await hash(playerId)).slice(0, 14); accountId = username;
  }
  const existing = await db().prepare("SELECT a.*,p.banned FROM accounts a JOIN players p ON p.id=a.player_id WHERE a.id=? OR (a.username=? AND a.role=?)")
    .bind(accountId, username, accountRole).first<Row>();
  const safe = (row: Row) => row.id === accountId && row.username === username && row.role === accountRole && row.player_id === playerId && row.store_id === storeId && row.request_id === null && row.request_hash === RECORDING_MARKER && row.status === "approved" && !row.banned;
  if (existing) {
    if (!safe(existing)) throw new GameError("演示身份已占用或停用，请使用正常账号登录", 409);
    return existing;
  }
  const now = Date.now(), record = await passwordRecord(crypto.randomUUID() + crypto.randomUUID()), nickname = accountRole === "merchant" ? "本机演示商家" : "本机演示玩家";
  await db().batch([
    db().prepare(`INSERT OR IGNORE INTO players(id,nickname,created_at) SELECT ?,?,?
      WHERE NOT EXISTS(SELECT 1 FROM accounts WHERE id=? OR (username=? AND role=?))`).bind(playerId, nickname, now, accountId, username, accountRole),
    // The merchant uses an existing seeded store. JSON null is deliberately not
    // a registration form and introduces no invented address or GPS center.
    db().prepare(`INSERT OR IGNORE INTO accounts(id,request_id,request_hash,username,role,password_salt,password_hash,password_iterations,player_id,store_id,nickname,merchant_json,status,created_at,updated_at)
      SELECT ?,NULL,?,?,?,?,?,?,?,?,?,?,'approved',?,? FROM players p WHERE p.id=? AND p.banned=0`).bind(accountId, RECORDING_MARKER, username, accountRole,
        record.salt, record.digest, ITERATIONS, playerId, storeId, nickname, accountRole === "merchant" ? "null" : null, now, now, playerId),
  ]);
  const saved = await db().prepare("SELECT a.*,p.banned FROM accounts a JOIN players p ON p.id=a.player_id WHERE a.id=?").bind(accountId).first<Row>();
  if (!saved || !safe(saved)) throw new GameError("演示身份状态已变化，请使用正常账号登录", 409);
  return saved;
}
export async function recordingLogin(req: Request, input: Row): Promise<AccountLoginResult> {
  // Both checks are re-run on every action. Neither owner headers nor old demo
  // access codes can enable this temporary localhost-only recording shortcut.
  if (!recordingShortcutAllowed(req)) throw new GameError("当前地址未启用演示快捷登录，请使用账号密码", 403);
  const accountRole = role(input.role);
  if ((accountRole === "merchant" && input.storeId !== undefined && input.storeId !== "tea") || (accountRole !== "merchant" && input.storeId !== undefined))
    throw new GameError("演示快捷入口仅支持指定的演示身份和茶间集门店", 403);
  await available(); await rate(req, "recording", accountRole, 30, 3600000);
  let row: Row;
  if (accountRole === "admin") {
    await ensureDemoAdmin();
    const seeded = await db().prepare("SELECT a.*,p.banned FROM accounts a JOIN players p ON p.id=a.player_id WHERE a.id='demo-admin' AND a.username='admin' AND a.role='admin' AND a.request_id IS NULL AND a.request_hash='bootstrap' AND a.status='approved' AND p.banned=0").first<Row>();
    if (!seeded) throw new GameError("演示运营身份未配置或已被注册账号占用，请使用正常账号登录", 409);
    row = seeded;
  } else row = await recordingIdentity(req, accountRole);
  return issueAccountSession(req, row, accountRole !== "player", "已进入本机演示");
}
async function logoutAccount(req: Request, workspace: boolean) {
  const names = workspace ? ["mall_staff"] : ["mall_player", "mall_staff"];
  for (const name of names) {
    const token = cookie(req, name);
    if (token) await db().prepare("DELETE FROM sessions WHERE token_hash=?").bind(await hash(token)).run();
  }
  return { message: workspace ? "已退出工作台，账号和发现记录保留" : "已退出，账号和发现记录保留",
    setCookie: workspace ? clearCookie(req, "mall_staff") : names.map(name => clearCookie(req, name)) };
}
export async function accountAction(req: Request, input: Row) {
  switch (input.action) {
    case "accountRegister": return registerAccount(req, input);
    case "accountLogin": return loginAccount(req, input);
    case "staffLogin": return loginAccount(req, input, true);
    case "accountApplicationStatus": return accountApplicationStatus(req, input);
    case "accountApplications": return accountApplications(req, input);
    case "accountApplication": return accountApplication(req, input);
    case "accountReview": return reviewAccount(req, input);
    case "recordingLogin": return recordingLogin(req, input);
    case "emailCodeSend": return (await import("./email-auth")).emailCodeSend(req,input);
    case "emailLogin": return (await import("./email-auth")).emailLogin();
    case "accountEmailBind": return (await import("./email-auth")).accountEmailBind(req,input);
    case "playerLogout": return logoutAccount(req, false);
    case "staffLogout": return logoutAccount(req, true);
    case "sendLoginCode": case "playerLogin": throw new GameError("演示验证码登录已停用，请验证邮箱注册，再使用邮箱和密码登录", 410);
    default: return null;
  }
}
