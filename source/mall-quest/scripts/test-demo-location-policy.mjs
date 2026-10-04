import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { reset, run, get, all, load, environment, mockModule, close } from './business-fixture.mjs';

// The release-time constant is simulated only in this process; source stays unchanged.
// All coordinates and records below are disposable in-memory fixtures.
mockModule('lib/application-scope.ts', { APP_BASE_PATH: '/hardware-demo', HARDWARE_DEMO_INSTANCE: true });
let cases = 0;
const pass = name => console.log(`PASS ${++cases}: ${name}`);
const call = (actor, action, input = {}) => load('lib/game-server.ts').execute(actor, { action, ...input });
const anonymous = () => new Request('https://demo.example/hardware-demo/api/game');
const cookieRequest = login => new Request('https://demo.example/hardware-demo/api/game', {
  headers: { Cookie: [login.setCookie].flat().map(value => value.split(';')[0]).join('; ') },
});
const count = table => get(`SELECT COUNT(*) AS n FROM ${table}`).n;
const rewards = () => ({ claims: all('SELECT * FROM claims ORDER BY id'), ledger: all('SELECT * FROM points_ledger ORDER BY id') });
const position = patch => ({ latitude: 40.7128, longitude: -74.006, accuracy: 15000, timestamp: Date.now(), ...patch });
const claimInput = location => ({ taskId: 'quest-tea', deviceId: 'coin-tea-01', requestId: randomUUID(), location });
const confirmation = draft => ({ draftId: draft.id, expectedRevision: draft.revision, requestId: randomUUID(), deviceCode: 'GTB-DEVICE:coin-tea-01', receivedDevice: true });
const deny = async (name, operation, status) => {
  await assert.rejects(operation, error => error.status === status);
  pass(name);
};
async function fixture() {
  reset({ hardwareConfirmation: true });
  environment.RECORDING_SHORTCUT_LOGIN = 'true';
  run("INSERT INTO store_geofences(store_id,enabled,latitude,longitude,radius_meters,revision,updated_at) VALUES('tea',0,NULL,NULL,NULL,1,?)", Date.now());
  run("INSERT INTO coupon_templates(id,store_id,title,type,value,min_amount,total_count,status,created_at,updated_at) VALUES('fixture-coupon','tea','定位演示测试奖励','gift',0,0,24,'active',?,?)", Date.now(), Date.now());
  run("UPDATE tasks SET reward_coupon_id='fixture-coupon' WHERE id='quest-tea'");
  const playerLogin = await call(anonymous(), 'recordingLogin', { role: 'player' });
  const merchantLogin = await call(anonymous(), 'recordingLogin', { role: 'merchant', storeId: 'tea' });
  return { player: cookieRequest(playerLogin), merchant: cookieRequest(merchantLogin) };
}

try {
  let { player, merchant } = await fixture();
  const fence = get("SELECT enabled,latitude,longitude,radius_meters,revision FROM store_geofences WHERE store_id='tea'");
  assert.equal(fence.enabled, 0); assert.equal(fence.latitude, null); assert.equal(fence.longitude, null);
  assert.equal(fence.radius_meters, null); assert.equal(fence.revision, 1);
  const before = rewards(), fresh = position();
  const created = await call(player, 'nfcClaim', claimInput(fresh));
  assert.equal(created.newlyCreated, true); assert.equal(created.draft.state, 'pending');
  assert.equal(created.draft.canConfirm, true); assert.equal(created.draft.deviceId, 'coin-tea-01');
  const stored = get('SELECT * FROM nfc_claim_drafts WHERE id=?', created.draft.id);
  assert.equal(stored.fence_revision, 1);
  assert.equal(stored.location_timestamp, fresh.timestamp);
  assert.equal(stored.permit_until - stored.location_timestamp, 600000);
  assert.deepEqual(rewards(), before);
  pass('Isolated demo accepts a valid far-away position with large accuracy and a disabled null-center fence');

  // Age the saved location, not the VM clock or real environment.
  const agedTimestamp = Date.now() - 60000;
  run('UPDATE nfc_claim_drafts SET location_timestamp=?,permit_until=? WHERE id=?', agedTimestamp, agedTimestamp + 600000, created.draft.id);
  assert.equal((await call(player, 'nfcClaimStatus', { requestId: created.draft.id })).draft.canConfirm, true);
  const ready = await call(merchant, 'merchantPendingClaims', { deviceCode: 'GTB-DEVICE:coin-tea-01' });
  assert.equal(ready.items[0].canConfirm, true);
  const confirm = confirmation(created.draft), issued = await call(merchant, 'merchantIssueClaim', confirm);
  assert.equal(issued.newlyIssued, true); assert.equal(issued.draft.state, 'issued');
  assert.match(issued.coupon.code, /^GTB-[0-9A-F]{12}$/);
  assert.equal(count('claims'), 1);
  pass('Merchant confirmation succeeds after 30 seconds when the recorded demo location is within ten minutes');

  const confirmed = rewards();
  assert.equal((await call(merchant, 'merchantIssueClaim', confirm)).newlyIssued, false);
  assert.deepEqual(rewards(), confirmed);
  await deny('Relaxed location policy does not allow a second confirmation UUID', () => call(merchant, 'merchantIssueClaim', { ...confirm, requestId: randomUUID() }), 409);
  assert.equal((await call(merchant, 'couponPreview', { code: issued.coupon.code })).canRedeem, true);
  await call(merchant, 'redeem', { code: issued.coupon.code });
  await deny('Relaxed location policy still rejects duplicate personal coupon redemption', () => call(merchant, 'redeem', { code: issued.coupon.code }), 400);
  assert.equal(count('claims'), 1); assert.deepEqual(rewards().ledger, confirmed.ledger);

  ({ player, merchant } = await fixture());
  const rejectedBefore = rewards();
  await deny('Demo NFC application still requires a location object', () => call(player, 'nfcClaim', claimInput(undefined)), 400);
  await deny('Demo NFC application rejects invalid latitude', () => call(player, 'nfcClaim', claimInput(position({ latitude: 91 }))), 400);
  await deny('Demo NFC application rejects invalid longitude', () => call(player, 'nfcClaim', claimInput(position({ longitude: -181 }))), 400);
  await deny('Demo NFC application rejects negative accuracy', () => call(player, 'nfcClaim', claimInput(position({ accuracy: -1 }))), 400);
  await deny('Demo NFC application rejects non-finite coordinates', () => call(player, 'nfcClaim', claimInput(position({ latitude: NaN }))), 400);
  await deny('Demo NFC application rejects an expired ten-minute location', () => call(player, 'nfcClaim', claimInput(position({ timestamp: Date.now() - 600001 }))), 409);
  await deny('Demo NFC application rejects a future position beyond the clock tolerance', () => call(player, 'nfcClaim', claimInput(position({ timestamp: Date.now() + 60000 }))), 409);
  assert.equal(count('nfc_claim_drafts'), 0); assert.deepEqual(rewards(), rejectedBefore);
  pass('Rejected location inputs leave drafts, rewards and ledger unchanged');

  const oldButAllowed = position({ timestamp: Date.now() - 90000 });
  const oldDraft = await call(player, 'nfcClaim', claimInput(oldButAllowed));
  assert.equal(oldDraft.draft.canConfirm, true);
  assert.equal(oldDraft.draft.permitUntil, oldButAllowed.timestamp + 600000);
  pass('A valid recorded demo position older than thirty seconds can still create a ten-minute application');
  run('UPDATE nfc_claim_drafts SET location_timestamp=?,permit_until=? WHERE id=?', Date.now() - 600001, Date.now() - 1, oldDraft.draft.id);
  assert.equal((await call(player, 'nfcClaimStatus', { requestId: oldDraft.draft.id })).draft.canConfirm, false);
  await deny('Merchant cannot confirm an application after its ten-minute position permit expires', () => call(merchant, 'merchantIssueClaim', confirmation(oldDraft.draft)), 409);
  assert.equal(count('claims'), 0);
  const renewed = await call(player, 'nfcDraftRevalidate', { draftId: oldDraft.draft.id, expectedRevision: oldDraft.draft.revision, requestId: randomUUID(), location: position() });
  assert.equal(renewed.draft.revision, 2); assert.equal(renewed.draft.canConfirm, true);
  const renewalRow = get('SELECT permit_until,location_timestamp FROM nfc_claim_drafts WHERE id=?', oldDraft.draft.id);
  assert.equal(renewalRow.permit_until - renewalRow.location_timestamp, 600000);
  pass('Explicit revalidation restores a ten-minute permit without issuing a reward');

  run("UPDATE hardware_devices SET enabled=0 WHERE id='coin-tea-01'");
  await deny('Disabled hardware remains unavailable despite relaxed demo positioning', () => call(merchant, 'merchantPendingClaims', { deviceCode: 'GTB-DEVICE:coin-tea-01' }), 404);
  await deny('Revoked hardware cannot issue a saved demo application', () => call(merchant, 'merchantIssueClaim', confirmation(renewed.draft)), 404);
  assert.equal(count('claims'), 0);
  run("UPDATE hardware_devices SET enabled=1 WHERE id='coin-tea-01'");
  run("UPDATE store_geofences SET revision=revision+1 WHERE store_id='tea'");
  assert.equal((await call(player, 'nfcClaimStatus', { requestId: oldDraft.draft.id })).draft.canConfirm, false);
  await deny('The isolated demo still checks the saved fence revision during confirmation', () => call(merchant, 'merchantIssueClaim', confirmation(renewed.draft)), 409);
  assert.equal(count('claims'), 0);

  ({ player, merchant } = await fixture());
  run("UPDATE store_geofences SET enabled=1,latitude=31.23,longitude=121.47,radius_meters=20 WHERE store_id='tea'");
  const outside = await call(player, 'nfcClaim', claimInput(position()));
  assert.equal(outside.draft.canConfirm, true);
  assert.equal(count('claims'), 0);
  pass('The demo build bypasses configured geometric distance as well as an unconfigured disabled fence');
  assert.equal(get('PRAGMA integrity_check').integrity_check, 'ok');
  assert.equal(all('PRAGMA foreign_key_check').length, 0);
  pass('Disposable database integrity and foreign-key checks remain sound');
  console.log(JSON.stringify({ status: 'PASS', cases, buildConstant: 'HARDWARE_DEMO_INSTANCE=true', database: ':memory:', cloudRequests: 0, privateDatabaseWrites: 0, physicalDeviceWrites: 0 }));
} finally {
  delete environment.RECORDING_SHORTCUT_LOGIN;
  close();
}
