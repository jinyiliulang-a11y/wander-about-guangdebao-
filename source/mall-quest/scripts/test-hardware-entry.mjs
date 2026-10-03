import assert from "node:assert/strict";
import { createHash, webcrypto } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";

// All issuance and claim records in this suite are disposable fixtures. This
// script never opens persistent D1, contacts HTTP or reads a device credential.
const project = fileURLToPath(new URL("../", import.meta.url));
const token = "isolated_entry_token_0123456789abcdefgh";
const tokenHash = createHash("sha256").update(token).digest("hex");
let database, beforeBatch, lastInsertChanges;
let batchCalls = 0;
const observations = [];
const modules = new Map();
const d1 = {
  prepare(sql) {
    return { bind(...values) {
      return { sql, values, async first() { return database.prepare(sql).get(...values) ?? null; } };
    } };
  },
  async batch(statements) {
    batchCalls++;
    if (beforeBatch) { const callback = beforeBatch; beforeBatch = null; callback(); }
    database.exec("BEGIN");
    try {
      for (const statement of statements) {
        const result = database.prepare(statement.sql).run(...statement.values);
        if (/^\s*INSERT INTO hardware_codes/i.test(statement.sql)) lastInsertChanges = Number(result.changes);
      }
      database.exec("COMMIT");
      return [];
    } catch (error) { database.exec("ROLLBACK"); throw error; }
  },
};

function load(relative) {
  if (modules.has(relative)) return modules.get(relative);
  const loadedModule = { exports: {} };
  modules.set(relative, loadedModule.exports);
  const compiled = ts.transpileModule(readFileSync(path.join(project, relative), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: relative,
  }).outputText;
  const require = (name) => {
    if (name === "cloudflare:workers") return { env: { DB: d1 } };
    if (name.startsWith("@/")) return load(name.slice(2) + ".ts");
    if (name.startsWith(".")) return load(path.posix.join(path.posix.dirname(relative), name) + ".ts");
    throw new Error(`Unexpected import ${name}`);
  };
  vm.runInNewContext(compiled, { module: loadedModule, exports: loadedModule.exports, require,
    crypto: webcrypto, Request, Response, Headers, TextEncoder, URL, Date, console }, { filename: relative });
  modules.set(relative, loadedModule.exports);
  return loadedModule.exports;
}

function mutate(sql, ...values) { database.prepare(sql).run(...values); }
function codes() { return database.prepare("SELECT COUNT(*) AS count FROM hardware_codes").get().count; }
function task(id, store = "tea", status = "published") {
  mutate("INSERT INTO tasks(id,author_id,store_id,title,clues,status,created_at) VALUES(?,?,?,?,?,?,?)",
    id, "author-fixture", store, "Isolated entry", "[]", status, Date.now());
}
function reset() {
  if (database) database.close();
  database = new DatabaseSync(":memory:");
  beforeBatch = null;
  lastInsertChanges = null;
  for (const file of readdirSync(path.join(project, "drizzle")).filter((name) => name.endsWith(".sql")).sort())
    database.exec(readFileSync(path.join(project, "drizzle", file), "utf8"));
  database.exec("PRAGMA foreign_keys=ON");
  for (const player of ["author-fixture", "player-fixture"])
    mutate("INSERT INTO players(id,nickname,created_at) VALUES(?,?,?)", player, "Isolated", Date.now());
  for (const id of ["tea", "book"])
    mutate(`INSERT INTO stores(id,event_id,name,floor,area,category,question,answer,code_hash,
      reward_title,conditions,stock_total,x,y,artwork,point_mode) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    id, "mall-48h", "Isolated store", "F1", "A", "test", "Q", "A", "fixture-hash", "Test", "", 22, 0, 0, 0, "hardware");
  for (const id of ["coin-tea-01", "generic-tea-device"])
    mutate("INSERT INTO hardware_devices(id,store_id,token_hash,enabled,created_at) VALUES(?,?,?,?,?)",
      id, "tea", tokenHash, 1, Date.now());
  task("ugc-tea");
}
async function invoke(name, expectedStatus, requestId, deviceId = "coin-tea-01", endpoint = "code") {
  const route = load(`app/api/hardware/${endpoint}/route.ts`);
  const response = await route.POST(new Request(`http://isolated.test/api/hardware/${endpoint}`, {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ deviceId, requestId }),
  }));
  const body = await response.json();
  assert.equal(response.status, expectedStatus, name);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("set-cookie"), null);
  if (expectedStatus === 403) {
    assert.deepEqual(Object.keys(body), ["error"]);
    assert.match(body.error.message, /固定寻宝入口暂不可用/);
  }
  observations.push(name);
  console.log(`PASS ${observations.length}: ${name}`);
  return body;
}

try {
  for (const status of [null, "pending", "rejected", "offline"]) {
    reset();
    if (status) task("quest-tea", "tea", status);
    const previousBatches = batchCalls;
    await invoke("Missing or unpublished canonical entry rejects new request despite published UGC", 403, "fixed_entry_request_0001");
    assert.equal(codes(), 0);
    assert.equal(batchCalls, previousBatches, "Preflight rejection does not reach mutation batch");
    assert.equal(database.prepare("SELECT stock_total FROM stores WHERE id='tea'").get().stock_total, 22);
  }
  reset();
  task("quest-tea", "book");
  await invoke("Canonical task moved to another store is rejected", 403, "fixed_entry_request_0001");
  assert.equal(codes(), 0);
  reset();
  task("quest-tea");
  mutate("UPDATE hardware_devices SET store_id='book' WHERE id='coin-tea-01'");
  await invoke("Fixed device rebound to another store cannot mint", 403, "fixed_entry_request_0001");
  assert.equal(codes(), 0);
  reset();
  task("quest-tea");
  const issued = await invoke("Published canonical entry permits issuance", 200, "fixed_entry_request_0001");
  assert.equal(issued.storeId, "tea");
  assert.equal(codes(), 1);
  mutate("UPDATE tasks SET status='offline' WHERE id='quest-tea'");
  const beforeRetry = batchCalls;
  const repeated = await invoke("Existing request stays exactly idempotent after canonical removal", 200, "fixed_entry_request_0001");
  for (const key of ["code", "expiresAt", "storeName", "storeId"])
    assert.equal(repeated[key], issued[key]);
  assert(repeated.ttlSeconds > 0 && repeated.ttlSeconds <= issued.ttlSeconds);
  assert.equal(batchCalls, beforeRetry);
  const active = await invoke("Existing active status survives canonical removal", 200, "fixed_entry_request_0001", "coin-tea-01", "status");
  assert.equal(active.state, "active");
  await invoke("A different request is forbidden even while an old code is active", 403, "fixed_entry_request_0002");
  assert.equal(codes(), 1);
  mutate(`INSERT INTO claims(id,player_id,event_id,store_id,task_id,coupon_code,issued_at)
    VALUES(?,?,?,?,?,?,?)`, "claim-fixture", "player-fixture", "mall-48h", "tea", "ugc-tea", "ISOLATED_COUPON", Date.now());
  mutate("UPDATE hardware_codes SET used_by='player-fixture',claim_id='claim-fixture',created_at=?,expires_at=?",
    Date.now() - 60000, Date.now() - 1);
  const used = await invoke("A real same-store UGC claim remains used after canonical removal and expiry", 200,
    "fixed_entry_request_0001", "coin-tea-01", "status");
  assert.equal(used.state, "used");
  const generic = await invoke("Other devices still issue for published same-store UGC", 200,
    "generic_entry_request_0001", "generic-tea-device");
  assert.equal(generic.storeId, "tea");
  reset();
  task("quest-tea");
  beforeBatch = () => mutate("UPDATE tasks SET status='offline' WHERE id='quest-tea'");
  await invoke("Removal after preflight is blocked by the atomic INSERT condition", 403, "fixed_entry_request_0001");
  assert.equal(codes(), 0);
  assert.equal(lastInsertChanges, 0);
  mutate("UPDATE tasks SET status='published' WHERE id='quest-tea'");
  await invoke("Restored canonical entry permits a later new request", 200, "fixed_entry_request_0002");
  assert.equal(codes(), 1);
  console.log(JSON.stringify({ status: "PASS", cases: observations.length, batchCalls,
    isolatedDatabase: ":memory:", persistentD1Opened: false, networkRequests: 0,
    fixturesCleanedByClosingMemoryDatabase: true }));
} finally { if (database) database.close(); }
