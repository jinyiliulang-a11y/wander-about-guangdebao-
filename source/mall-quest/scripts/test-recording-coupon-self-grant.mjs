import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { reset, run, get, all, load, environment, d1, sha, close } from './business-fixture.mjs';

// Actual production handlers and SQL, disposable in-memory SQLite only.
// Mutating the loader's exported scope exercises both build profiles without
// changing application-scope.ts, private configuration or a live database.
const scope = load('lib/application-scope.ts');
let cases = 0;
const pass = name => console.log(`PASS ${++cases}: ${name}`);
const fresh = () => { reset(); scope.HARDWARE_DEMO_INSTANCE = true; environment.RECORDING_SHORTCUT_LOGIN = 'true'; };
const req = (actor = 'a', staff) => new Request('https://demo.example/demo/api/game', {
  headers: { Cookie: `${scope.HARDWARE_DEMO_INSTANCE ? 'hardware_demo_' : ''}mall_player=player-${actor}` +
    (staff ? `; ${scope.HARDWARE_DEMO_INSTANCE ? 'hardware_demo_' : ''}mall_staff=staff-${staff}` : '') },
});
const grant = (input = {}, actor = 'a') => load('lib/recording-coupons.ts').recordingCouponGrant(req(actor), { requestId: randomUUID(), ...input });
const table = name => all(`SELECT * FROM ${name} ORDER BY rowid`);
const count = name => get(`SELECT COUNT(*) AS n FROM ${name}`).n;
const snapshot = names => sha(JSON.stringify(names.map(name => [name, table(name)])));
const resources = ['claims', 'points_ledger', 'players', 'stores', 'coupon_templates', 'tasks', 'hardware_devices', 'nfc_claim_drafts', 'nfc_draft_operations'];
const deny = async (name, operation, status) => { await assert.rejects(operation, error => error.status === status); pass(name); };
async function beforeWrite(change, operation) {
  const original = d1.prepare; let intercepted = false;
  d1.prepare = sql => {
    const statement = original(sql);
    if (sql.startsWith('INSERT INTO recording_coupons(')) {
      const execute = statement.execute;
      statement.execute = (...args) => { if (!intercepted) { intercepted = true; change(); } return execute(...args); };
    }
    return statement;
  };
  try { await operation(); assert(intercepted, 'the mutation must intercept the actual insert'); }
  finally { d1.prepare = original; }
}

try {
  fresh(); scope.HARDWARE_DEMO_INSTANCE = false;
  await deny('A public build cannot self-grant even at localhost with the shortcut flag enabled',
    () => load('lib/recording-coupons.ts').recordingCouponGrant(new Request('http://localhost/api/game', { headers: { Cookie: 'mall_player=player-a' } }), { requestId: randomUUID() }), 403);
  assert.equal(count('recording_coupons'), 0);
  assert.equal((await load('lib/game-server.ts').state(req(), 'a')).recordingCouponAllowed, false);

  fresh(); delete environment.RECORDING_SHORTCUT_LOGIN;
  await deny('The demo build still requires its server recording switch', () => grant(), 403);
  fresh();
  await deny('An anonymous demo visitor cannot self-grant', () => load('lib/recording-coupons.ts').recordingCouponGrant(new Request('https://demo.example/demo/api/game'), { requestId: randomUUID() }), 401);
  await deny('A merchant player cookie cannot act as a registered client', () => grant({}, 'merchant'), 401);
  await deny('An operator player cookie cannot act as a registered client', () => grant({}, 'admin'), 401);
  await deny('A request cannot choose another store', () => grant({ storeId: 'book' }), 403);
  await deny('Request identities must be UUIDs', () => grant({ requestId: 'arbitrary-value' }), 400);

  fresh(); const baseline = snapshot(resources), requestId = randomUUID();
  const first = await grant({ requestId });
  assert.equal(first.newlyIssued, true); assert.equal(first.requestId, requestId);
  assert.equal(first.coupon.demo, true); assert.equal(first.coupon.storeId, 'tea');
  assert.equal(first.coupon.rewardValue, 0); assert.match(first.coupon.code, /^GTB-D-[0-9A-F]{20}$/);
  assert.equal(count('recording_coupons'), 1); assert.equal(count('recording_coupon_requests'), 1);
  assert.equal(snapshot(resources), baseline);
  pass('A demo client receives one clearly labelled persisted display coupon with no normal business effects');

  const replay = await grant({ requestId });
  assert.equal(replay.newlyIssued, false); assert.equal(replay.coupon.id, first.coupon.id);
  const aliasId = randomUUID(), alias = await grant({ requestId: aliasId });
  assert.equal(alias.newlyIssued, false); assert.equal(alias.coupon.id, first.coupon.id);
  assert.equal(count('recording_coupons'), 1); assert.equal(count('recording_coupon_requests'), 2);
  const status = await load('lib/recording-coupons.ts').recordingCouponStatus(req(), { requestId: aliasId });
  assert.equal(status.found, true); assert.equal(status.coupon.id, first.coupon.id);
  assert.equal(snapshot(resources), baseline);
  pass('Same UUID is idempotent and a fresh UUID resolves to the same unredeemed live coupon');

  await deny('Another player cannot reuse a request identity', () => grant({ requestId }, 'b'), 409);
  assert.equal((await load('lib/recording-coupons.ts').recordingCouponStatus(req('b'), { requestId })).found, false);
  assert.equal((await load('lib/recording-coupons.ts').recordingCouponsForPlayer(req('b'), 'a')).length, 0);
  const clientState = await load('lib/game-server.ts').state(req(), 'a');
  assert.equal(clientState.recordingCouponAllowed, true);
  assert.equal(clientState.coupons.filter(coupon => coupon.demo).length, 1);
  assert.equal(clientState.coupons.find(coupon => coupon.demo).id, first.coupon.id);
  pass('Only the owner sees the saved display coupon in the restored state wallet');

  fresh(); const parallelBaseline = snapshot(resources);
  const simultaneous = await Promise.all([grant(), grant()]);
  assert.equal(simultaneous[0].coupon.id, simultaneous[1].coupon.id);
  assert.equal(simultaneous.filter(result => result.newlyIssued).length, 1);
  assert.equal(count('recording_coupons'), 1); assert.equal(count('recording_coupon_requests'), 2);
  assert.equal(snapshot(resources), parallelBaseline);
  pass('Overlapping different request UUIDs create one live coupon and two recoverable receipts');
  fresh(); const concurrentId = randomUUID();
  const duplicateRequests = await Promise.all([grant({ requestId: concurrentId }), grant({ requestId: concurrentId })]);
  assert.equal(duplicateRequests.filter(result => result.newlyIssued).length, 1);
  assert.equal(duplicateRequests[0].coupon.id, duplicateRequests[1].coupon.id);
  assert.equal(count('recording_coupons'), 1); assert.equal(count('recording_coupon_requests'), 1);
  pass('Overlapping identical UUIDs preserve one coupon and one receipt');

  for (const [name, change] of [
    ['account approval revoked', () => run("UPDATE accounts SET status='rejected' WHERE id='fixture-a'")],
    ['player banned', () => run("UPDATE players SET banned=1 WHERE id='a'")],
    ['session expired', () => run("UPDATE sessions SET expires_at=1 WHERE token_hash=?", sha('player-a'))],
    ['merchant role substituted', () => run("UPDATE accounts SET role='merchant',store_id='tea',merchant_json='{}' WHERE id='fixture-a'")],
    ['store deactivated', () => run("UPDATE stores SET status='inactive' WHERE id='tea'")],
  ]) {
    fresh(); const ordinaryBefore = snapshot(['claims', 'points_ledger', 'coupon_templates', 'tasks', 'hardware_devices', 'nfc_claim_drafts', 'nfc_draft_operations']);
    await beforeWrite(change, async () => assert.rejects(() => grant(), error => [401, 403, 409].includes(error.status)));
    assert.equal(count('recording_coupons'), 0); assert.equal(count('recording_coupon_requests'), 0);
    assert.equal(snapshot(['claims', 'points_ledger', 'coupon_templates', 'tasks', 'hardware_devices', 'nfc_claim_drafts', 'nfc_draft_operations']), ordinaryBefore);
    pass(`${name} immediately before the SQL mutation saves no display coupon or receipt`);
  }

  fresh(); const faultId = randomUUID(), faultBaseline = snapshot(resources);
  // Inject a database fault in the receipt trigger, not a fake handler outcome.
  run(`CREATE TRIGGER fixture_receipt_failure BEFORE INSERT ON recording_coupon_requests
    WHEN NEW.request_id='${faultId}' BEGIN SELECT RAISE(ABORT,'fixture receipt failure'); END`);
  await assert.rejects(() => grant({ requestId: faultId }), /fixture receipt failure/);
  assert.equal(count('recording_coupons'), 0); assert.equal(count('recording_coupon_requests'), 0);
  assert.equal(snapshot(resources), faultBaseline);
  pass('A receipt-trigger failure rolls back the coupon and every request record atomically');

  fresh(); const redeemed = await grant(), merchant = req('merchant', 'merchant');
  assert.equal((await load('lib/recording-coupons.ts').recordingCouponPreview(merchant, redeemed.coupon.code)).canRedeem, true);
  const redeemBaseline = snapshot(resources);
  await load('lib/recording-coupons.ts').recordingCouponRedeem(merchant, redeemed.coupon.code);
  assert.equal((await load('lib/recording-coupons.ts').recordingCouponStatus(req(), { requestId: redeemed.requestId })).coupon.status, 'used');
  await deny('A display coupon cannot be redeemed twice', () => load('lib/recording-coupons.ts').recordingCouponRedeem(merchant, redeemed.coupon.code), 400);
  const next = await grant(); assert.equal(next.newlyIssued, true); assert.notEqual(next.coupon.id, redeemed.coupon.id);
  assert.equal(snapshot(resources), redeemBaseline);
  pass('Existing merchant display redemption updates only its isolated coupon and allows another UI demonstration');

  fresh(); const expired = await grant();
  run('UPDATE recording_coupons SET issued_at=?,valid_end=? WHERE id=?', Date.now() - 2000, Date.now() - 1000, expired.coupon.id);
  const expiredReplay = await grant({ requestId: expired.requestId });
  assert.equal(expiredReplay.newlyIssued, false); assert.equal(expiredReplay.coupon.status, 'expired');
  assert.equal((await grant()).newlyIssued, true);
  pass('An expired UUID recovers its old result while a fresh UUID can create the next display coupon');

  assert.equal(get('PRAGMA integrity_check').integrity_check, 'ok');
  assert.deepEqual(all('PRAGMA foreign_key_check'), []);
  console.log(JSON.stringify({ status: 'PASS', cases, database: ':memory:', persistentD1Writes: 0, networkRequests: 0, physicalDeviceWrites: 0 }));
} finally {
  scope.HARDWARE_DEMO_INSTANCE = false;
  delete environment.RECORDING_SHORTCUT_LOGIN;
  close();
}
