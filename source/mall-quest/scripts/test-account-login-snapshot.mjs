import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { reset, run, get, all, load, request, action, sha, environment, mockModule, close } from "./business-fixture.mjs";
import { setupFixtureGeofences, fixtureLocation } from "./geofence-fixture.mjs";

// Real API handlers and authorization SQL; only SMTP is an in-memory boundary.
// A page still displays player A after another tab changes its cookie to B.
let cases = 0, code = "", handledFailures = 0;
const pass = label => console.log(`PASS ${++cases}: ${label}`);
const previousMailPass = environment.MAIL_PASS;
const previousRecordingFlag = environment.RECORDING_SHORTCUT_LOGIN;
environment.MAIL_PASS = "isolated-login-snapshot-mail-pepper";
mockModule("lib/smtp-mail.ts", { mailConfigured: () => true, sendVerificationEmail: async (_email, value) => { code = value; } });
const api = () => load("app/api/game/route.ts");
const fresh = () => { reset(); setupFixtureGeofences(); };
const snapshot = tables => sha(JSON.stringify(tables.map(table => [table, all(`SELECT * FROM ${table} ORDER BY rowid`)])));
const allTables = () => all("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").map(row => row.name);
const cookieOf = source => source.headers.get("Cookie");
const resultCookies = response => response.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");

async function post(input, source = request("b"), expectedPlayerId) {
  const headers = { "Content-Type": "application/json", Cookie: cookieOf(source) };
  if (expectedPlayerId !== undefined) headers["X-Mall-Quest-Player"] = expectedPlayerId;
  const req = new Request(source.url, { method: "POST", headers, body: JSON.stringify(input) });
  const previousError = console.error;
  // Expected API errors otherwise print long server stacks. Preserve unexpected logs.
  console.error = (...args) => { if (args[0] === "game request failed") handledFailures++; else previousError(...args); };
  try {
    const response = await api().POST(req);
    return { response, envelope: await response.json() };
  } finally { console.error = previousError; }
}

async function rejected(label, input, source, expectedPlayerId, status, message) {
  const before = snapshot(["sessions"]), result = await post(input, source, expectedPlayerId);
  assert.equal(result.response.status, status);
  assert.ok(result.envelope.error?.message);
  if (message) assert.equal(result.envelope.error.message, message);
  assert.equal(result.response.headers.get("Set-Cookie"), null);
  assert.equal(snapshot(["sessions"]), before, "Rejected login must retain current sessions");
  pass(label);
}

const login = (actionName, role, username, password = "fixture-password") => ({ action: actionName, role, username, password });
const mismatch = "登录身份已变化，请刷新确认当前账号后再操作";

try {
  fresh();
  await rejected("Old displayed actor header blocks even valid merchant credentials before login", login("staffLogin", "merchant", "fixture-merchant"), request("b"), "a", 409, mismatch);

  for (const [actionName, role, target, previous] of [
    ["accountLogin", "player", "b", "c"],
    ["staffLogin", "merchant", "merchant", "b"],
    ["staffLogin", "admin", "admin", "b"],
  ]) {
    fresh();
    const result = await post(login(actionName, role, `fixture-${target}`), request(previous));
    assert.equal(result.response.status, 200);
    assert.equal(result.envelope.data.authenticated, true);
    assert.equal(result.envelope.data.accountId, `fixture-${target}`);
    assert.equal(result.envelope.data.role, role);
    assert.equal(result.envelope.data.storeId, role === "merchant" ? "tea" : null);
    const cookies = resultCookies(result.response);
    const authenticated = new Request("http://localhost/api/game", { headers: { Cookie: cookies, "X-Mall-Quest-Context": role === "player" ? "player" : "workspace" } });
    const playerSession = await load("lib/game-server.ts").session(authenticated);
    assert.equal(playerSession.player_id, target);
    assert.equal(playerSession.account_id, `fixture-${target}`);
    assert.equal(get("SELECT token_hash FROM sessions WHERE token_hash=?", sha(`player-${previous}`)), undefined);
    const refreshed = await api().GET(authenticated);
    assert.equal(refreshed.status, 200);
    const state = (await refreshed.json()).data;
    assert.equal(state.player.id, target);
    assert.equal(state.player.accountId, result.envelope.data.accountId);
    assert.equal(state.player.username, result.envelope.data.username);
    assert.equal(state.player.accountRole, role);
    if (role === "player") {
      assert.equal(state.player.accountAuthenticated, true);
      assert.equal(state.staff, null);
    } else {
      assert.equal(state.staff.role, role);
      assert.equal(state.staff.storeId, result.envelope.data.storeId);
    }
    pass(`Explicit ${role} password login without stale actor header replaces only current cookies and verifies actual refreshed identity`);
  }

  fresh();
  run("UPDATE accounts SET email='merchant-snapshot@example.test' WHERE id='fixture-merchant'");
  const alias = await post(login("staffLogin", "merchant", "MERCHANT-SNAPSHOT@EXAMPLE.TEST"), request("b"));
  assert.equal(alias.response.status, 200);
  assert.equal(alias.envelope.data.username, "fixture-merchant");
  assert.equal(alias.envelope.data.storeId, "tea");
  pass("Historical verified mailbox alias uses the same credential-login path and retains canonical merchant/store identity");

  for (const [label, input, status] of [
    ["Bad merchant password remains rejected without actor header", login("staffLogin", "merchant", "fixture-merchant", "wrong-password"), 401],
    ["Another role cannot authenticate the merchant username", login("staffLogin", "admin", "fixture-merchant"), 401],
    ["Player credentials cannot log into the workspace API", login("staffLogin", "player", "fixture-a"), 401],
    ["Merchant credentials cannot log into the player API", login("accountLogin", "merchant", "fixture-merchant"), 401],
  ]) {
    fresh();
    await rejected(label, input, request("b"), undefined, status);
  }

  fresh();
  run("UPDATE accounts SET status='pending' WHERE id='fixture-merchant'");
  await rejected("Pending merchant approval remains mandatory despite correct password", login("staffLogin", "merchant", "fixture-merchant"), request("b"), undefined, 403);
  fresh();
  run("UPDATE players SET banned=1 WHERE id='merchant'");
  await rejected("Stopped merchant remains rejected despite correct password", login("staffLogin", "merchant", "fixture-merchant"), request("b"), undefined, 403);
  fresh();
  await rejected("Credential login cannot request another store", { ...login("staffLogin", "merchant", "fixture-merchant"), storeId: "book" }, request("b"), undefined, 403);

  fresh(); environment.RECORDING_SHORTCUT_LOGIN = "false";
  await rejected("Omitting actor snapshot does not enable a disabled recording shortcut", { action: "recordingLogin", role: "merchant" }, request("b"), undefined, 403);
  for (const origin of ["http://example.test", "http://127.0.0.1.example.test", "http://localhost.example.test"]) {
    fresh(); environment.RECORDING_SHORTCUT_LOGIN = "true";
    await rejected(`Enabled recording shortcut rejects public or deceptive host: ${new URL(origin).hostname}`, { action: "recordingLogin", role: "merchant" }, request("b", undefined, origin), undefined, 403);
  }
  fresh(); environment.RECORDING_SHORTCUT_LOGIN = "true";
  await rejected("Recording shortcut refuses selecting another merchant store", { action: "recordingLogin", role: "merchant", storeId: "book" }, request("b"), undefined, 403);
  fresh();
  await rejected("Player recording shortcut cannot acquire a store scope", { action: "recordingLogin", role: "player", storeId: "tea" }, request("b"), undefined, 403);

  for (const role of ["player", "merchant", "admin"]) {
    fresh(); environment.RECORDING_SHORTCUT_LOGIN = "true";
    const local = request("b", undefined, role === "merchant" ? "http://127.0.0.1" : "http://localhost");
    const result = await post({ action: "recordingLogin", role }, local);
    assert.equal(result.response.status, 200);
    assert.equal(result.envelope.data.role, role);
    assert.equal(result.envelope.data.storeId, role === "merchant" ? "tea" : null);
    const row = get("SELECT role,status,request_id,request_hash,store_id FROM accounts WHERE id=?", result.envelope.data.accountId);
    assert.equal(row.role, role);
    assert.equal(row.status, "approved");
    assert.equal(row.request_id, null);
    assert.equal(row.request_hash, role === "admin" ? "bootstrap" : "recording-shortcut-v1");
    const authenticated = new Request(local.url, { headers: { Cookie: resultCookies(result.response), "X-Mall-Quest-Context": role === "player" ? "player" : "workspace" } });
    const refreshed = await api().GET(authenticated);
    assert.equal(refreshed.status, 200);
    const state = (await refreshed.json()).data;
    assert.equal(state.player.accountId, result.envelope.data.accountId);
    assert.equal(state.player.accountRole, role);
    if (role === "player") assert.equal(state.player.accountAuthenticated, true);
    else { assert.equal(state.staff.role, role); assert.equal(state.staff.storeId, result.envelope.data.storeId); }
    pass(`Explicit local ${role} recording login without stale actor snapshot still verifies approved preset identity and refreshed session`);
  }
  for (const [label, update] of [
    ["Recording merchant rejects an occupied marker bound to another store", "UPDATE accounts SET store_id='book' WHERE id='recording-merchant-tea'"],
    ["Recording merchant cannot bypass a pending approval state", "UPDATE accounts SET status='pending' WHERE id='recording-merchant-tea'"],
    ["Recording merchant cannot revive a stopped demo player", "UPDATE players SET banned=1 WHERE id='recording-merchant-player-tea'"],
  ]) {
    fresh(); environment.RECORDING_SHORTCUT_LOGIN = "true";
    assert.equal((await post({ action: "recordingLogin", role: "merchant" }, request("b"))).response.status, 200);
    run(update);
    await rejected(label, { action: "recordingLogin", role: "merchant" }, request("c"), undefined, 409);
  }

  const clues = ["第一条完整观察线索", "第二条完整观察线索", "第三条完整观察线索", "第四条完整观察线索", "第五条完整观察线索"];
  for (const [label, input] of [
    ["claim", { action: "claim", taskId: "quest-tea", answer: "茉莉", location: fixtureLocation() }],
    ["place", { action: "place", requestId: randomUUID(), storeId: "book", title: "隔离测试完整宝藏标题", clues, rewardType: "points", rewardValue: 50 }],
  ]) {
    fresh();
    const before = snapshot(allTables());
    await rejected(`Stale page actor still blocks ${label} before any business mutation`, input, request("b"), "a", 409, mismatch);
    assert.equal(snapshot(allTables()), before);
  }

  fresh();
  const claimed = await action("claim", { taskId: "quest-tea", answer: "茉莉", location: fixtureLocation() });
  const beforeRedeem = snapshot(allTables());
  await rejected("Stale page actor still blocks an otherwise valid scoped merchant redemption", { action: "redeem", code: claimed.coupon.code }, request("merchant", "merchant"), "a", 409, mismatch);
  assert.equal(snapshot(allTables()), beforeRedeem);
  assert.equal(get("SELECT redeemed_at FROM claims WHERE id=?", claimed.coupon.id).redeemed_at, null);

  fresh();
  const email = "snapshot-registration@example.test";
  const proof = await action("emailCodeSend", { requestId: randomUUID(), role: "player", email, purpose: "register" }, "b");
  const registrationId = randomUUID();
  const registration = { action: "accountRegister", requestId: registrationId, role: "player", username: email, email, emailCode: code, emailChallengeId: proof.challengeId, password: "snapshot-password" };
  const beforeRegistration = snapshot(allTables());
  await rejected("Registration retains actor binding guard even with a real valid email proof", registration, request("b"), "a", 409, mismatch);
  assert.equal(snapshot(allTables()), beforeRegistration);
  assert.equal(get("SELECT consumed_at FROM email_challenges WHERE id=?", proof.challengeId).consumed_at, null);
  assert.equal(get("SELECT id FROM accounts WHERE request_id=?", registrationId), undefined);
  assert.equal(get("PRAGMA integrity_check").integrity_check, "ok");
  assert.deepEqual(all("PRAGMA foreign_key_check"), []);
  pass("Snapshot/login regression retains SQLite integrity and foreign keys");

  console.log(JSON.stringify({ status: "PASS", cases, handledExpectedFailures: handledFailures, database: ":memory:", privateDatabaseWrites: 0, realEmailsSent: 0, networkRequests: 0 }));
} finally {
  if (previousMailPass === undefined) delete environment.MAIL_PASS; else environment.MAIL_PASS = previousMailPass;
  if (previousRecordingFlag === undefined) delete environment.RECORDING_SHORTCUT_LOGIN; else environment.RECORDING_SHORTCUT_LOGIN = previousRecordingFlag;
  close();
}
