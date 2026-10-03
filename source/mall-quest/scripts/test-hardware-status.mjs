import assert from "node:assert/strict";
import { createHash, webcrypto } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";

// Exercise the actual TypeScript handlers and SQL against a disposable in-memory
// database. Never open the site's persistent D1 or call a running HTTP service.
const project = fileURLToPath(new URL("../", import.meta.url));
const database = new DatabaseSync(":memory:");
const modules = new Map();
const observations = [];
const sha = (value) => createHash("sha256").update(value).digest("hex");
const token = "isolated_status_test_token_0123456789abcdef";
const nextToken = "isolated_rotated_token_0123456789abcdefgh";
const requestId = "status_fixture_request_0001";
const deviceId = "status-fixture-device";
let readCount = 0;
let clock = null;
class ControlledDate extends Date {
  static now() { return clock ?? Date.now(); }
}
const d1 = {
  prepare(sql) {
    assert.match(sql, /^\s*SELECT\b/i, "Status and idempotent issue tests must only SELECT");
    return { bind(...values) {
      return { async first() { readCount++; return database.prepare(sql).get(...values) ?? null; } };
    } };
  },
  batch() { throw new Error("Unexpected mutation batch"); },
};
const env = { DB: d1 };

function load(relative) {
  if (modules.has(relative)) return modules.get(relative);
  const loadedModule = { exports: {} };
  modules.set(relative, loadedModule.exports);
  const source = readFileSync(path.join(project, relative), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: relative,
  }).outputText;
  const require = (name) => {
    if (name === "cloudflare:workers") return { env };
    if (name.startsWith("@/")) return load(name.slice(2) + ".ts");
    if (name.startsWith(".")) return load(path.posix.join(path.posix.dirname(relative), name) + ".ts");
    throw new Error(`Unexpected import ${name}`);
  };
  vm.runInNewContext(compiled, {
    module: loadedModule, exports: loadedModule.exports, require, crypto: webcrypto,
    Request, Response, Headers, TextEncoder, URL, Date: ControlledDate, console,
  }, { filename: relative });
  modules.set(relative, loadedModule.exports);
  return loadedModule.exports;
}

function snapshot() {
  return JSON.stringify(database.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all()
    .map(({ name }) => [name, database.prepare(`SELECT * FROM ${name} ORDER BY rowid`).all()]));
}

function mutate(sql, ...values) { database.prepare(sql).run(...values); }

function fixture() {
  const now = Date.now();
  for (const file of readdirSync(path.join(project, "drizzle")).filter((name) => name.endsWith(".sql")).sort())
    database.exec(readFileSync(path.join(project, "drizzle", file), "utf8"));
  database.exec("PRAGMA foreign_keys=ON");
  for (const id of ["status-player", "other-player"])
    mutate("INSERT INTO players(id,nickname,created_at) VALUES(?,?,?)", id, "Isolated fixture", now);
  for (const id of ["status-store", "other-store"])
    mutate(`INSERT INTO stores(id,event_id,name,floor,area,category,question,answer,code_hash,
      reward_title,conditions,stock_total,x,y,artwork,point_mode)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    id, "mall-48h", "Isolated store", "L1", "A", "test", "Q", "A", "fixture-hash", "Test", "", 22, 0, 0, 0, "hardware");
  mutate(`INSERT INTO tasks(id,author_id,store_id,title,clues,status,created_at)
    VALUES(?,?,?,?,?,?,?)`, "status-task", "other-player", "status-store", "Isolated", "[]", "published", now);
  mutate(`INSERT INTO hardware_devices(id,store_id,token_hash,enabled,created_at,last_seen_at)
    VALUES(?,?,?,?,?,?)`, deviceId, "status-store", sha(token), 1, now, now - 1000);
  mutate(`INSERT INTO hardware_devices(id,store_id,token_hash,enabled,created_at)
    VALUES(?,?,?,?,?)`, "other-device", "status-store", sha(token), 1, now);
  mutate(`INSERT INTO hardware_codes(id,device_id,store_id,request_id,nonce,code_hash,auth_hash,created_at,expires_at)
    VALUES(?,?,?,?,?,?,?,?,?)`, "status-code", deviceId, "status-store", requestId, "fixture-nonce", "fixture-hash", sha(token), now - 1000, now + 60000);
}

async function check(name, expectedStatus, options = {}, expectedState) {
  const route = load("app/api/hardware/status/route.ts");
  const input = { deviceId, requestId, ...options.input };
  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...options.headers };
  if (options.noAuth) delete headers.Authorization;
  const request = new Request("http://isolated.test/api/hardware/status", {
    method: "POST", headers, body: options.body ?? JSON.stringify(input),
  });
  const before = snapshot();
  const readsBefore = readCount;
  const response = options.method === "GET" ? route.GET() : await route.POST(request);
  const result = await response.json();
  assert.equal(response.status, expectedStatus, name);
  assert.equal(response.headers.get("cache-control"), "no-store", name);
  assert.equal(response.headers.get("set-cookie"), null, name);
  assert.equal(snapshot(), before, `${name}: database remains unchanged`);
  if (expectedStatus === 200) {
    assert.equal(readCount - readsBefore, 1, "One authorization/code/claim read snapshot");
    assert.deepEqual(Object.keys(result).sort(), ["expiresAt", "state", "storeId"]);
    assert.equal(result.state, expectedState);
    assert.equal(result.storeId, "status-store");
    assert.equal(result.expiresAt, database.prepare("SELECT expires_at FROM hardware_codes WHERE id='status-code'").get().expires_at);
  } else {
    assert.deepEqual(Object.keys(result), ["error"]);
    assert.deepEqual(Object.keys(result.error), ["message"]);
    assert.equal(typeof result.error.message, "string");
    if (expectedStatus === 405) assert.equal(response.headers.get("allow"), "POST");
  }
  observations.push(name);
  console.log(`PASS ${observations.length}: ${name}`);
}

try {
  fixture();
  await check("Active request exposes only state, expiry and store binding", 200, {}, "active");
  await check("Repeated status does not renew or consume", 200, {}, "active");
  clock = database.prepare("SELECT expires_at FROM hardware_codes WHERE id='status-code'").get().expires_at;
  await check("Exactly at expiry is expired", 200, {}, "expired");
  clock = null;
  const beforeIssue = snapshot();
  const issueRoute = load("app/api/hardware/code/route.ts");
  const existing = await issueRoute.POST(new Request("http://isolated.test/api/hardware/code", {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ deviceId, requestId }),
  }));
  const existingBody = await existing.json();
  assert.equal(existing.status, 200);
  assert.deepEqual(Object.keys(existingBody).sort(), ["code", "expiresAt", "storeId", "storeName", "ttlSeconds"]);
  assert.equal(existingBody.storeId, "status-store");
  assert.equal(snapshot(), beforeIssue);
  observations.push("Existing code response adds storeId without renewing or creating a code");
  console.log(`PASS ${observations.length}: ${observations.at(-1)}`);
  await check("Missing Bearer", 401, { noAuth: true });
  await check("Player and staff cookies cannot authorize a device", 401,
    { noAuth: true, headers: { Cookie: "mall_player=fixture; mall_staff=fixture" } });
  await check("Wrong token", 401, { headers: { Authorization: `Bearer ${nextToken}` } });
  await check("Malformed Bearer", 401, { headers: { Authorization: "Bearer short" } });
  await check("Unknown device", 401, { input: { deviceId: "unknown-device" } });
  await check("Invalid device ID", 400, { input: { deviceId: "x" } });
  await check("Invalid request ID", 400, { input: { requestId: "short" } });
  await check("Device ID must be a string", 400, { input: { deviceId: 123 } });
  await check("Request ID must be a string", 400, { input: { requestId: [requestId] } });
  await check("Unknown request does not mint", 404, { input: { requestId: "unknown_request_0001" } });
  await check("Another authorized device cannot see this request", 404, { input: { deviceId: "other-device" } });
  for (const body of ["{", "null", "[]", "true", '"string"'])
    await check("Malformed or non-object JSON rejected", 400, { body });
  await check("Declared oversized body", 413, { headers: { "Content-Length": "1025" } });
  await check("Actual oversized ASCII body", 413, { body: "x".repeat(1025) });
  await check("UTF-8 byte limit, not character limit", 413,
    { body: JSON.stringify({ deviceId, requestId, padding: "中".repeat(360) }) });
  const small = JSON.stringify({ deviceId, requestId });
  await check("Exactly 1024-byte valid request", 200, { body: small + " ".repeat(1024 - Buffer.byteLength(small)) }, "active");
  await check("GET cannot query or mutate", 405, { method: "GET" });
  mutate("UPDATE hardware_devices SET enabled=0 WHERE id=?", deviceId);
  await check("Disabled device", 401);
  mutate("UPDATE hardware_devices SET enabled=1 WHERE id=?", deviceId);
  mutate("UPDATE stores SET point_mode='static' WHERE id='status-store'");
  await check("Static store", 401);
  mutate("UPDATE stores SET point_mode='hardware',event_id='other-event' WHERE id='status-store'");
  await check("Wrong activity", 401);
  mutate("UPDATE stores SET event_id='mall-48h' WHERE id='status-store'");
  mutate("UPDATE hardware_devices SET token_hash=? WHERE id=?", sha(nextToken), deviceId);
  await check("Rotated old token loses authorization", 401);
  await check("New token cannot adopt old token request", 409, { headers: { Authorization: `Bearer ${nextToken}` } });
  mutate("UPDATE hardware_devices SET token_hash=?,store_id='other-store' WHERE id=?", sha(token), deviceId);
  await check("Rebound device cannot adopt old store request", 409);
  mutate("UPDATE hardware_devices SET store_id='status-store' WHERE id=?", deviceId);
  mutate("UPDATE hardware_codes SET expires_at=? WHERE id='status-code'", Date.now() - 1);
  await check("Unused expired request", 200, {}, "expired");
  mutate(`INSERT INTO claims(id,player_id,event_id,store_id,task_id,coupon_code,issued_at)
    VALUES(?,?,?,?,?,?,?)`, "status-claim", "status-player", "mall-48h", "status-store", "status-task", "FIXTURE_ONLY", Date.now());
  mutate("UPDATE hardware_codes SET expires_at=? WHERE id='status-code'", Date.now() + 60000);
  await check("Existing player coupon does not mark an unconsumed code used", 200, {}, "active");
  mutate("UPDATE hardware_codes SET used_by='status-player',claim_id='status-claim' WHERE id='status-code'");
  mutate("UPDATE hardware_codes SET expires_at=? WHERE id='status-code'", Date.now() - 1);
  await check("Confirmed claim remains used after expiry", 200, {}, "used");
  mutate("UPDATE claims SET redeemed_at=? WHERE id='status-claim'", Date.now());
  await check("Redeemed coupon is still a completed claim", 200, {}, "used");
  mutate("UPDATE tasks SET status='offline' WHERE id='status-task'");
  mutate("UPDATE stores SET stock_total=0 WHERE id='status-store'");
  await check("Task removal and sold-out inventory preserve completed claim status", 200, {}, "used");
  mutate("UPDATE claims SET player_id='other-player' WHERE id='status-claim'");
  await check("Wrong claim player is never success", 409);
  mutate("UPDATE claims SET player_id='status-player',store_id='other-store' WHERE id='status-claim'");
  await check("Wrong claim store is never success", 409);
  mutate("UPDATE claims SET store_id='status-store',event_id='other-event' WHERE id='status-claim'");
  await check("Wrong claim event is never success", 409);
  mutate("UPDATE claims SET event_id='mall-48h' WHERE id='status-claim'");
  // Deliberately corrupted fixtures bypass constraints only inside :memory:.
  database.exec("PRAGMA foreign_keys=OFF; PRAGMA ignore_check_constraints=ON");
  mutate("UPDATE hardware_codes SET claim_id='missing-claim' WHERE id='status-code'");
  await check("Missing linked claim is never success", 409);
  mutate("UPDATE hardware_codes SET claim_id=NULL WHERE id='status-code'");
  await check("Partial used marker is never success", 409);
  mutate("UPDATE hardware_codes SET used_by=NULL,claim_id='status-claim' WHERE id='status-code'");
  await check("Partial claim marker is never success", 409);
  env.DB = undefined;
  await check("Unavailable database gives structured 503", 503);
  env.DB = d1;
  console.log(JSON.stringify({ status: "PASS", cases: observations.length, sqlReads: readCount,
    isolatedDatabase: ":memory:", persistentD1Opened: false, networkRequests: 0,
    fixturesCleanedByClosingMemoryDatabase: true }));
} finally {
  database.close();
}
