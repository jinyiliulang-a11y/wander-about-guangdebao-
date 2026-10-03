import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { reset, run, get, all, load, environment, demoToken, close } from './business-fixture.mjs';
import { setupFixtureGeofences, fixtureLocation } from './geofence-fixture.mjs';

// Disposable in-memory fixtures only: no remote server, physical device or live database.
let cases = 0;
const pass = name => console.log(`PASS ${++cases}: ${name}`);
const call = (actor, action, input = {}) => load('lib/game-server.ts').execute(actor, { action, ...input });
const anonymous = () => new Request('http://localhost/api/game');
const sessionRequest = login => new Request('http://localhost/api/game', {
  headers: { Cookie: [login.setCookie].flat().map(value => value.split(';')[0]).join('; ') },
});
const count = table => get(`SELECT COUNT(*) AS n FROM ${table}`).n;
const rewards = () => ({ claims: all('SELECT * FROM claims ORDER BY id'), ledger: all('SELECT * FROM points_ledger ORDER BY id') });
const deny = async (name, operation, status) => {
  await assert.rejects(operation, error => error.status === status);
  pass(name);
};
const hardwareRequest = () => new Request('http://localhost/api/hardware/store-sync', {
  headers: { Authorization: `Bearer ${demoToken}` },
});

try {
  reset({ hardwareConfirmation: true });
  setupFixtureGeofences();
  environment.RECORDING_SHORTCUT_LOGIN = 'true';
  run("INSERT INTO coupon_templates(id,store_id,title,type,value,min_amount,total_count,status,created_at,updated_at) VALUES('fixture-coupon','tea','免费加料','gift',0,0,24,'active',?,?)", Date.now(), Date.now());
  run("UPDATE tasks SET reward_coupon_id='fixture-coupon' WHERE id='quest-tea'");

  const playerLogin = await call(anonymous(), 'recordingLogin', { role: 'player' });
  const merchantLogin = await call(anonymous(), 'recordingLogin', { role: 'merchant', storeId: 'tea' });
  const player = sessionRequest(playerLogin), merchant = sessionRequest(merchantLogin);
  const playerId = get('SELECT player_id FROM accounts WHERE id=?', playerLogin.accountId).player_id;
  assert.equal(playerLogin.authenticated, true);
  assert.equal(merchantLogin.authenticated, true);
  assert.equal(merchantLogin.storeId, 'tea');
  assert.equal((await load('lib/game-server.ts').staff(merchant)).store_id, 'tea');
  assert.equal((await load('lib/game-server.ts').state(player, playerId)).player.accountAuthenticated, true);
  pass('Real recordingLogin establishes independent authenticated player and tea merchant sessions');

  const baseline = rewards();
  await deny('Direct demonstration coupon grant is retired for a valid recording player', () => call(player, 'recordingCouponGrant', { requestId: randomUUID() }), 410);
  assert.deepEqual(rewards(), baseline);
  assert.equal(count('recording_coupons'), 0);
  assert.equal(count('recording_coupon_requests'), 0);
  delete environment.RECORDING_SHORTCUT_LOGIN;
  await deny('Retired grant retains the disabled recording gate', () => call(player, 'recordingCouponGrant', { requestId: randomUUID() }), 403);
  environment.RECORDING_SHORTCUT_LOGIN = 'true';
  await deny('Retired grant still requires a registered player', () => load('lib/recording-coupons.ts').recordingCouponGrant(anonymous(), { requestId: randomUUID() }), 401);

  const sync = () => load('lib/hardware-server.ts').hardwareStoreSync(hardwareRequest(), { deviceId: 'coin-tea-01' });
  assert.equal((await sync()).claimCount, 0);
  const claimInput = { taskId: 'quest-tea', deviceId: 'coin-tea-01', requestId: randomUUID(), location: fixtureLocation() };
  const pending = await call(player, 'nfcClaim', claimInput);
  assert.equal(pending.draft.state, 'pending');
  assert.equal(pending.draft.deviceId, 'coin-tea-01');
  assert.equal(pending.newlyCreated, true);
  assert.equal(pending.coupon, undefined);
  assert.deepEqual(rewards(), baseline);
  const pendingReplay = await call(player, 'nfcClaim', claimInput);
  assert.equal(pendingReplay.newlyCreated, false);
  assert.equal(pendingReplay.draft.id, pending.draft.id);
  assert.equal(count('nfc_claim_drafts'), 1);
  assert.equal((await sync()).claimCount, 0);
  pass('Recording player device entry creates one idempotent pending draft without issuing a reward');

  const deviceCode = 'GTB-DEVICE:coin-tea-01';
  const queue = await call(merchant, 'merchantPendingClaims', { deviceCode });
  assert.equal(queue.device.id, 'coin-tea-01');
  assert.equal(queue.device.storeId, 'tea');
  assert.equal(queue.total, 1);
  assert.equal(queue.items[0].id, pending.draft.id);
  assert.deepEqual(rewards(), baseline);
  assert.equal((await sync()).claimCount, 0);
  pass('The real demonstration merchant scans the bound fixed device and only reads its pending draft');

  const issueInput = { draftId: pending.draft.id, requestId: randomUUID(), expectedRevision: pending.draft.revision, deviceCode, receivedDevice: true };
  await deny('A device query cannot replace the explicit physical receipt acknowledgement', () => call(merchant, 'merchantIssueClaim', { ...issueInput, receivedDevice: false }), 400);
  run("UPDATE hardware_devices SET enabled=0 WHERE id='coin-tea-01'");
  await deny('A revoked device cannot be scanned for pending claims', () => call(merchant, 'merchantPendingClaims', { deviceCode }), 404);
  await deny('A revoked device cannot issue the already saved application', () => call(merchant, 'merchantIssueClaim', issueInput), 404);
  assert.equal(get('SELECT state FROM nfc_claim_drafts WHERE id=?', pending.draft.id).state, 'pending');
  assert.deepEqual(rewards(), baseline);
  run("UPDATE hardware_devices SET enabled=1 WHERE id='coin-tea-01'");

  const issued = await call(merchant, 'merchantIssueClaim', issueInput);
  assert.equal(issued.newlyIssued, true);
  assert.equal(issued.draft.state, 'issued');
  assert.equal(issued.coupon.id, issueInput.requestId);
  assert.equal(issued.coupon.redeemedAt, null);
  assert.match(issued.coupon.code, /^GTB-[0-9A-F]{12}$/);
  assert.notEqual(issued.coupon.demo, true);
  assert.equal(count('claims'), 1);
  assert.equal(count('recording_coupons'), 0);
  assert.equal(count('recording_coupon_requests'), 0);
  assert.equal(get('SELECT merchant_account_id FROM nfc_claim_drafts WHERE id=?', pending.draft.id).merchant_account_id, merchantLogin.accountId);
  assert.equal((await load('lib/game-server.ts').state(player, playerId)).coupons.find(coupon => coupon.id === issued.coupon.id).code, issued.coupon.code);
  pass('Receipt confirmation issues one normal unused coupon into the recording player wallet through the device chain');

  const confirmed = rewards();
  const replay = await call(merchant, 'merchantIssueClaim', issueInput);
  assert.equal(replay.newlyIssued, false);
  assert.equal(replay.coupon.id, issued.coupon.id);
  assert.deepEqual(rewards(), confirmed);
  await deny('Another confirmation UUID cannot mint a second reward for the same application', () => call(merchant, 'merchantIssueClaim', { ...issueInput, requestId: randomUUID() }), 409);
  await deny('The same player cannot obtain another same-store reward with a fresh NFC request', () => call(player, 'nfcClaim', { ...claimInput, requestId: randomUUID(), location: fixtureLocation() }), 409);
  assert.equal(count('claims'), 1);
  assert.deepEqual(rewards(), confirmed);
  pass('Same-request recovery and new-request rejection preserve one claim and one reward ledger effect');

  const preview = await call(merchant, 'couponPreview', { code: issued.coupon.code });
  assert.equal(preview.canRedeem, true);
  assert.equal(preview.coupon.id, issued.coupon.id);
  assert.deepEqual(rewards(), confirmed);
  await call(merchant, 'redeem', { code: issued.coupon.code });
  assert(get('SELECT redeemed_at FROM claims WHERE id=?', issued.coupon.id).redeemed_at);
  assert.equal(count('claims'), 1);
  assert.deepEqual(rewards().ledger, confirmed.ledger);
  assert.equal((await call(merchant, 'couponPreview', { code: issued.coupon.code })).canRedeem, false);
  await deny('An already redeemed personal coupon cannot be redeemed twice', () => call(merchant, 'redeem', { code: issued.coupon.code }), 400);
  pass('A separate personal coupon preview and redemption consume the issued reward without a second claim');
  const hardware = await sync();
  assert.deepEqual(Object.keys(hardware).sort(), ['available', 'claimCount', 'storeId', 'storeName', 'taskId'].sort());
  assert.equal(hardware.claimCount, 1);
  assert.equal(hardware.storeId, 'tea');
  assert.equal(hardware.taskId, 'quest-tea');
  pass('The existing five-field physical-device sync reflects one merchant-confirmed claim');

  // Seed a historical row directly to prove read-only recovery survives retiring grant.
  const legacyId = randomUUID(), now = Date.now();
  run(`INSERT INTO recording_coupons(id,player_id,event_id,store_id,coupon_code,store_name_snapshot,reward_snapshot,conditions_snapshot,artwork,issued_at,valid_end)
    VALUES(?,?,'mall-48h','tea','GTB-D-0123456789ABCDEF0123','Fixture tea','Legacy recording fixture','Historical only',0,?,?)`, legacyId, playerId, now, now + 86400000);
  const legacyStatus = await call(player, 'recordingCouponStatus', { requestId: legacyId });
  assert.equal(legacyStatus.found, true);
  assert.equal(legacyStatus.coupon.id, legacyId);
  assert.equal(legacyStatus.coupon.demo, true);
  const legacyRows = all('SELECT * FROM recording_coupons');
  await deny('Retired grant also refuses an old recording request while its status stays recoverable', () => call(player, 'recordingCouponGrant', { requestId: legacyId }), 410);
  assert.deepEqual(all('SELECT * FROM recording_coupons'), legacyRows);
  assert.equal((await call(player, 'recordingCouponStatus', { requestId: legacyId })).found, true);
  assert.equal(get('PRAGMA integrity_check').integrity_check, 'ok');
  assert.equal(all('PRAGMA foreign_key_check').length, 0);
  pass('Historical recording coupon status remains readable and memory database integrity remains sound');
  console.log(JSON.stringify({ status: 'PASS', cases, database: ':memory:', privateDatabaseWrites: 0, cloudRequests: 0, physicalDeviceWrites: 0 }));
} finally {
  delete environment.RECORDING_SHORTCUT_LOGIN;
  close();
}
