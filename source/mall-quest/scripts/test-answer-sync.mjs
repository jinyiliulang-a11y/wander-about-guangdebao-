import assert from "node:assert/strict";
import { createHash, webcrypto } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";

// Actual production handlers and SQL run only against disposable memory SQLite.
// No live D1, network requests, hardware credentials or device access are used.
// This compatibility suite deliberately sets nfc_claim=0 for historical web
// answer scenarios. It does not assert that marked hardware can answer-claim;
// test-nfc-claims.mjs separately verifies mandatory NFC and its sticky SQL gates.
const project = fileURLToPath(new URL("../", import.meta.url));
const token = "isolated_sync_token_0123456789abcdefgh";
const sha = (value) => createHash("sha256").update(value).digest("hex");
const modules = new Map();
const observations = [];
let database, beforeClaimInsert;
let readOnly = false, reads = 0;
const d1 = {
  prepare(sql) {
    if (readOnly) assert.match(sql, /^\s*SELECT\b/i, "Hardware sync must be SELECT-only");
    return { bind(...values) {
      return {
        async first() { reads++; return database.prepare(sql).get(...values) ?? null; },
        async all() { reads++; return { results: database.prepare(sql).all(...values) }; },
        async run() {
          assert.equal(readOnly, false, "Read-only endpoints must never execute mutations");
          if (/^\s*INSERT INTO claims/i.test(sql) && beforeClaimInsert) {
            const callback = beforeClaimInsert; beforeClaimInsert = null; callback();
          }
          return { meta: { changes: Number(database.prepare(sql).run(...values).changes) } };
        },
      };
    } };
  },
  batch() { throw new Error("Unexpected batch in answer-only claim or sync"); },
};
const env = { DB: d1 };

function load(relative) {
  if (modules.has(relative)) return modules.get(relative);
  const loadedModule = { exports: {} };
  modules.set(relative, loadedModule.exports);
  const compiled = ts.transpileModule(readFileSync(path.join(project, relative), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: relative,
  }).outputText;
  const require = (name) => {
    if (name === "cloudflare:workers") return { env };
    if (name.startsWith("@/")) return load(name.slice(2) + ".ts");
    if (name.startsWith(".")) return load(path.posix.join(path.posix.dirname(relative), name) + ".ts");
    throw new Error(`Unexpected import ${name}`);
  };
  vm.runInNewContext(compiled, { module: loadedModule, exports: loadedModule.exports, require,
    crypto: webcrypto, Request, Response, Headers, TextEncoder, URL, Date, console }, { filename: relative });
  modules.set(relative, loadedModule.exports);
  return loadedModule.exports;
}
function mutate(sql, ...values) { return database.prepare(sql).run(...values); }
function scalar(sql, ...values) { return Object.values(database.prepare(sql).get(...values))[0]; }
function hardwareRows() { return JSON.stringify(database.prepare("SELECT * FROM hardware_codes ORDER BY id").all()); }
function snapshot() {
  return JSON.stringify(database.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all()
    .map(({ name }) => [name, database.prepare(`SELECT * FROM ${name} ORDER BY rowid`).all()]));
}
function passed(name) { observations.push(name); console.log(`PASS ${observations.length}: ${name}`); }
function reset() {
  if (database) database.close();
  database = new DatabaseSync(":memory:");
  beforeClaimInsert = null;
  for (const file of readdirSync(path.join(project, "drizzle")).filter((name) => name.endsWith(".sql")).sort())
    database.exec(readFileSync(path.join(project, "drizzle", file), "utf8"));
  database.exec("PRAGMA foreign_keys=ON");
  const now = Date.now();
  for (const id of ["author", "buyer1", "buyer2", "buyer3", "buyer4", "buyer5", "seller"] ) {
    mutate("INSERT INTO players(id,nickname,created_at) VALUES(?,?,?)", id, "Isolated", now);
    // This suite tests existing reward behavior using approved account-bound sessions.
    mutate(`INSERT INTO accounts(id,request_hash,username,role,password_salt,password_hash,password_iterations,player_id,nickname,status,created_at,updated_at)
      VALUES(?,'isolated-fixture',?,'player',?,?,100000,?,?,'approved',?,?)`, id, id, '0'.repeat(32), '0'.repeat(64), id, id, now, now);
    mutate("INSERT INTO sessions(token_hash,role,player_id,expires_at,account_id) VALUES(?,?,?,?,?)", sha(`player-${id}`), "player", id, now + 86400000, id);
  }
  for (const [id, answer, mode, event] of [["tea", "茉莉", "hardware", "mall-48h"], ["book", "moon", "static", "mall-48h"], ["other", "星星", "hardware", "other-event"]])
    mutate(`INSERT INTO stores(id,event_id,name,floor,area,category,question,answer,code_hash,
      reward_title,conditions,stock_total,x,y,artwork,point_mode) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    id, event, "Isolated store", "F1", "A", "test", "Q", answer, "unused-static-hash", "Test", "", 2, 0, 0, 0, mode);
  for (const [name, role, store] of [["merchant-tea", "merchant", "tea"], ["merchant-book", "merchant", "book"], ["admin", "admin", null]]) {
    const identity = `workspace-${name}`;
    mutate("INSERT INTO players(id,nickname,created_at) VALUES(?,?,?)", identity, name, now);
    mutate(`INSERT INTO accounts(id,request_hash,username,role,password_salt,password_hash,password_iterations,player_id,store_id,nickname,merchant_json,status,created_at,updated_at)
      VALUES(?,'isolated-fixture',?,?,?, ?,100000,?,?,?,?, 'approved',?,?)`,
      identity, name, role, '0'.repeat(32), '0'.repeat(64), identity, store, name, role === 'merchant' ? '{}' : null, now, now);
    mutate("INSERT INTO sessions(token_hash,role,player_id,store_id,expires_at,account_id) VALUES(?,?,?,?,?,?)", sha(`staff-${name}`), role, identity, store, now + 86400000, identity);
  }
  mutate(`INSERT INTO store_geofences(store_id,enabled,latitude,longitude,radius_meters,revision,updated_at)
    SELECT id,1,31.23,121.47,150,1,? FROM stores WHERE event_id='mall-48h'`, now);
  for (const [id, store, author] of [["quest-tea", "tea", "author"], ["ugc-tea", "tea", "buyer5"], ["quest-book", "book", "author"], ["quest-other", "other", "author"]])
    mutate("INSERT INTO tasks(id,author_id,store_id,title,clues,status,created_at) VALUES(?,?,?,?,?,?,?)", id, author, store, "Isolated", "[]", "published", now);
  for (const [id, store] of [["coin-tea-01", "tea"], ["generic-tea", "tea"], ["generic-book", "book"], ["generic-other", "other"]])
    mutate("INSERT INTO hardware_devices(id,store_id,token_hash,enabled,created_at,last_seen_at) VALUES(?,?,?,?,?,?)", id, store, sha(token), 1, now, now - 1000);
  mutate(`INSERT INTO hardware_codes(id,device_id,store_id,request_id,nonce,code_hash,auth_hash,created_at,expires_at)
    VALUES(?,?,?,?,?,?,?,?,?)`, "legacy-code", "coin-tea-01", "tea", "legacy_request_fixture_01", "fixture-nonce", "fixture-hash", sha(token), now - 1000, now + 60000);
  mutate('UPDATE tasks SET nfc_claim=0');
}
function playerRequest(player, staff) {
  return new Request("http://isolated.test/api/game", { headers: {
    Cookie: `mall_player=player-${player}${staff ? `; mall_staff=staff-${staff}` : ""}`,
  } });
}
async function claim(player, input = {}) {
  return load("lib/game-server.ts").execute(playerRequest(player), { action: "claim", taskId: "quest-tea", answer: "茉莉", location: fixtureLocation(), ...input });
}
const fixtureLocation = () => ({ latitude: 31.23, longitude: 121.47, accuracy: 5, timestamp: Date.now() });
async function failure(name, action, expectedStatus = 400, message) {
  const previousClaims = scalar("SELECT COUNT(*) FROM claims");
  const oldCodes = hardwareRows();
  await assert.rejects(action, (error) => {
    assert.equal(error.status, expectedStatus);
    if (message) assert.match(error.message, message);
    return true;
  });
  assert.equal(scalar("SELECT COUNT(*) FROM claims"), previousClaims);
  assert.equal(hardwareRows(), oldCodes);
  passed(name);
}
async function sync(name, status = 200, options = {}) {
  const route = load("app/api/hardware/sync/route.ts");
  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...options.headers };
  if (options.noAuth) delete headers.Authorization;
  const before = snapshot(), beforeReads = reads;
  readOnly = true;
  let response;
  try {
    response = options.method === "GET" ? route.GET() : await route.POST(new Request("http://isolated.test/api/hardware/sync", {
      method: "POST", headers, body: options.body ?? JSON.stringify({ deviceId: "coin-tea-01", ...options.input }),
    }));
  } finally { readOnly = false; }
  const body = await response.json();
  assert.equal(response.status, status, name);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("set-cookie"), null);
  assert.equal(snapshot(), before, `${name}: no mutations`);
  if (status === 200) {
    assert.equal(reads - beforeReads, 1, "Authorization, availability and count share one SELECT");
    assert.deepEqual(Object.keys(body).sort(), ["available", "claimCount", "storeId", "storeName", "taskId"]);
    assert.equal(body.taskId, `quest-${body.storeId}`);
    assert.equal(typeof body.available, "boolean");
    assert(Number.isSafeInteger(body.claimCount) && body.claimCount >= 0);
    if (options.available !== undefined) assert.equal(body.available, options.available);
    if (options.count !== undefined) assert.equal(body.claimCount, options.count);
  } else {
    assert.deepEqual(Object.keys(body), ["error"]);
    assert.deepEqual(Object.keys(body.error), ["message"]);
    if (status === 405) assert.equal(response.headers.get("allow"), "POST");
  }
  passed(name);
  return body;
}

try {
  reset();
  await sync("Initial store snapshot has no code, player or session data", 200, { available: true, count: 0 });
  await failure("Task authors cannot claim their own task", () => claim("author"));
  await failure("Wrong answer gives answer-only message and no reward", () => claim("buyer1", { answer: "错误" }), 400, /观察答案不正确/);
  const untouched = hardwareRows();
  const input = { action: "claim", taskId: "quest-tea", answer: " 茉莉 ", location: fixtureLocation() };
  Object.defineProperty(input, "pointCode", { get() { throw new Error("pointCode must never be read"); } });
  const first = await load("lib/game-server.ts").execute(playerRequest("buyer1"), input);
  assert(first.coupon.id);
  assert.equal(hardwareRows(), untouched);
  passed("Legacy web-mode task in a hardware store preserves answer awards without consuming point codes");
  const attempts = scalar("SELECT attempt_count FROM hardware_claim_attempts WHERE player_id='buyer1' AND store_id='tea'");
  const duplicate = await claim("buyer1", { taskId: "ugc-tea", answer: "wrong", pointCode: "ignored" });
  assert.equal(duplicate.coupon.id, first.coupon.id);
  assert.equal(scalar("SELECT attempt_count FROM hardware_claim_attempts WHERE player_id='buyer1' AND store_id='tea'"), attempts);
  assert.equal(scalar("SELECT COUNT(*) FROM claims"), 1);
  passed("Duplicate through another store task returns the same coupon without another attempt");
  const book = await claim("buyer1", { taskId: "quest-book", answer: " ＭＯＯＮ " });
  assert.equal(book.coupon.storeId, "book");
  passed("Static stores also accept only the normalized answer");
  mutate("UPDATE hardware_devices SET enabled=0 WHERE id='coin-tea-01'");
  await claim("buyer2");
  assert.equal(hardwareRows(), untouched);
  passed("Legacy web-mode task claim is independent of hardware device authorization; marked NFC tasks are tested separately");
  mutate("UPDATE hardware_devices SET enabled=1 WHERE id='coin-tea-01'");
  await sync("Final coupon keeps the incremented count when availability becomes false", 200, { available: false, count: 2 });
  await failure("Sold-out store cannot issue another answer-only reward", () => claim("buyer3"));
  const statusRoute = load("app/api/hardware/status/route.ts");
  const legacy = await statusRoute.POST(new Request("http://isolated.test/api/hardware/status", { method: "POST",
    headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify({ deviceId: "coin-tea-01", requestId: "legacy_request_fixture_01" }) }));
  assert.equal(legacy.status, 200);
  assert.equal((await legacy.json()).state, "active");
  passed("Legacy status stays compatible while new answer claims leave legacy codes untouched");
  const game = load("lib/game-server.ts");
  await failure("Another merchant cannot redeem this coupon", () => game.execute(playerRequest("seller", "merchant-book"), { action: "redeem", code: first.coupon.code }));
  await failure("Administrator cannot impersonate a merchant redemption", () => game.execute(playerRequest("seller", "admin"), { action: "redeem", code: first.coupon.code }), 403);
  await game.execute(playerRequest("seller", "merchant-tea"), { action: "redeem", code: first.coupon.code });
  assert(scalar("SELECT redeemed_at FROM claims WHERE id=?", first.coupon.id));
  passed("Correct merchant still redeems the issued coupon");
  await failure("Repeated merchant redemption remains rejected", () => game.execute(playerRequest("seller", "merchant-tea"), { action: "redeem", code: first.coupon.code }));
  await sync("Redemption does not inflate the store claim count", 200, { available: false, count: 2 });

  reset();
  for (const [taskId, status] of [["quest-tea", "pending"], ["quest-tea", "rejected"], ["quest-tea", "offline"]]) {
    mutate("UPDATE tasks SET status=? WHERE id=?", status, taskId);
    await failure("Unpublished or removed task cannot reward", () => claim("buyer1"));
    await sync("Unavailable canonical task still returns its aggregate count", 200, { available: false, count: 0 });
  }
  mutate("DELETE FROM tasks WHERE id='quest-tea'");
  await sync("Missing canonical task is unavailable even with published UGC", 200, { available: false, count: 0 });
  await claim("buyer1", { taskId: "ugc-tea" });
  await sync("Same-store UGC claim is counted while canonical entry is missing", 200, { available: false, count: 1 });
  await failure("Claim stays within the current activity", () => claim("buyer2", { taskId: "quest-other", answer: "星星" }));

  reset();
  for (const [taskId, answer, player, store] of [["quest-tea", "茉莉", "buyer1", "tea"], ["quest-book", "moon", "buyer2", "book"]]) {
    for (let i = 0; i < 8; i++)
      await assert.rejects(() => claim(player, { taskId, answer: "wrong" }), (error) => error.status === 400);
    await failure("Eight attempts per minute apply to hardware and static stores", () => claim(player, { taskId, answer }), 429);
    mutate("UPDATE hardware_claim_attempts SET window_started_at=? WHERE player_id=? AND store_id=?", Date.now() - 60001, player, store);
    await claim(player, { taskId, answer });
    assert.equal(scalar("SELECT attempt_count FROM hardware_claim_attempts WHERE player_id=? AND store_id=?", player, store), 1);
    passed("A new answer-attempt window permits a valid reward");
  }
  reset();
  const samePlayer = await Promise.all([claim("buyer1"), claim("buyer1", { taskId: "ugc-tea" })]);
  assert.equal(samePlayer[0].coupon.id, samePlayer[1].coupon.id);
  assert.equal(scalar("SELECT COUNT(*) FROM claims"), 1);
  passed("Concurrent same-player store requests produce exactly one coupon");
  reset();
  mutate("UPDATE stores SET stock_total=1 WHERE id='tea'");
  const finalRace = await Promise.allSettled([claim("buyer1"), claim("buyer2")]);
  assert.equal(finalRace.filter((item) => item.status === "fulfilled").length, 1);
  assert.equal(finalRace.filter((item) => item.status === "rejected" && item.reason.status === 400).length, 1);
  assert.equal(scalar("SELECT COUNT(*) FROM claims WHERE store_id='tea'"), 1);
  passed("Two players racing the final inventory receive exactly one reward");
  await sync("Sold-out final inventory still reports the successful claim count", 200, { available: false, count: 1 });
  for (const [change, expected] of [
    [() => mutate("UPDATE tasks SET status='offline' WHERE id='quest-tea'"), 400],
    [() => mutate("UPDATE tasks SET author_id='buyer1' WHERE id='quest-tea'"), 400],
    [() => mutate("UPDATE stores SET stock_total=0 WHERE id='tea'"), 400],
    [() => mutate("UPDATE stores SET event_id='other-event' WHERE id='tea'"), 404],
  ]) {
    reset();
    beforeClaimInsert = change;
    await failure("Atomic award rechecks publication, author, stock and activity", () => claim("buyer1"), expected);
  }

  reset();
  await sync("Missing Bearer", 401, { noAuth: true });
  await sync("Player cookies cannot authorize device sync", 401, { noAuth: true, headers: { Cookie: "mall_player=player-buyer1" } });
  await sync("Wrong current token", 401, { headers: { Authorization: `Bearer ${token}wrong` } });
  await sync("Malformed Bearer", 401, { headers: { Authorization: "Bearer short" } });
  await sync("Unknown device", 401, { input: { deviceId: "unknown-device" } });
  for (const deviceId of ["x", "x".repeat(65), null, 123])
    await sync("Strict device identifier validation", 400, { input: { deviceId } });
  for (const body of ["{", "null", "[]", "true"])
    await sync("Non-object or malformed sync payload", 400, { body });
  await sync("Declared oversized sync body", 413, { headers: { "Content-Length": "1025" } });
  await sync("Actual UTF-8 byte size limit", 413, { body: JSON.stringify({ deviceId: "coin-tea-01", extra: "中".repeat(360) }) });
  const body = JSON.stringify({ deviceId: "coin-tea-01" });
  await sync("Exactly 1024 valid bytes", 200, { body: body + " ".repeat(1024 - Buffer.byteLength(body)), available: true, count: 0 });
  await sync("GET is explicitly refused", 405, { method: "GET" });
  mutate("UPDATE hardware_devices SET enabled=0 WHERE id='coin-tea-01'");
  await sync("Disabled device", 401);
  mutate("UPDATE hardware_devices SET enabled=1 WHERE id='coin-tea-01'");
  mutate("UPDATE stores SET point_mode='static' WHERE id='tea'");
  await sync("Non-hardware store cannot authorize hardware sync", 401);
  mutate("UPDATE stores SET point_mode='hardware',event_id='other-event' WHERE id='tea'");
  await sync("Wrong activity cannot authorize sync", 401);
  mutate("UPDATE stores SET event_id='mall-48h' WHERE id='tea'");
  mutate("UPDATE stores SET point_mode='hardware' WHERE id='book'");
  mutate("UPDATE hardware_devices SET store_id='book' WHERE id='coin-tea-01'");
  await sync("Fixed tea device cannot synchronize another store", 403);
  const generic = await sync("Other authorized devices receive their own canonical store", 200, { input: { deviceId: "generic-book" }, available: true, count: 0 });
  assert.equal(generic.storeId, "book");
  assert.equal(generic.taskId, "quest-book");
  mutate("UPDATE hardware_devices SET store_id='tea' WHERE id='coin-tea-01'");
  mutate("UPDATE hardware_devices SET token_hash=? WHERE id='coin-tea-01'", sha(token + "rotated"));
  await sync("Token rotation rejects the old token", 401);
  await sync("The rotated current token can read the same store", 200,
    { headers: { Authorization: `Bearer ${token}rotated` }, available: true, count: 0 });
  env.DB = undefined;
  await sync("Database unavailability is a structured no-store 503", 503);
  env.DB = d1;
  console.log(JSON.stringify({ status: "PASS", cases: observations.length, isolatedDatabase: ":memory:",
    persistentD1Opened: false, networkRequests: 0, serialAccess: false,
    fixturesCleanedByClosingMemoryDatabase: true }));
} finally { if (database) database.close(); }
