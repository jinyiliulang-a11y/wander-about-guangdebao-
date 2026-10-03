import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { reset, run, get, all, exec, load, request, d1, sha, demoToken, root, bindFixtureAccounts, close } from './business-fixture.mjs';
import { setupFixtureGeofences, fixtureLocation } from './geofence-fixture.mjs';

let cases = 0;
const pass = name => console.log(`PASS ${++cases}: ${name}`);
const id = () => randomUUID();
const merchant = () => request('merchant', 'merchant');
const call = (action, input = {}, actor = request()) => load('lib/game-server.ts').execute(actor, { action, ...input });
const payload = patch => ({ taskId: 'quest-tea', requestId: id(), location: fixtureLocation(), ...patch });
const issueInput = (draft, patch) => ({ draftId: draft.id, requestId: id(), expectedRevision: draft.revision, deviceCode: 'GTB-DEVICE:' + draft.deviceId, receivedDevice: true, ...patch });
const issue = (draft, patch) => call('merchantIssueClaim', issueInput(draft, patch), merchant());
const reject = async (name, fn, status) => { await assert.rejects(fn, e => status === undefined || e.status === status); pass(name); };
const count = table => get(`SELECT COUNT(*) AS n FROM ${table}`).n;
const rewards = () => ({ claims: all('SELECT * FROM claims ORDER BY id'), ledger: all('SELECT * FROM points_ledger ORDER BY id'), players: all('SELECT id,points_balance FROM players ORDER BY id') });
function fixture() {
  reset({ hardwareConfirmation: true }); setupFixtureGeofences();
  run("INSERT INTO coupon_templates(id,store_id,title,type,value,min_amount,total_count,status,created_at,updated_at) VALUES('fixture-coupon','tea','免费加料','gift',0,0,24,'active',?,?)", Date.now(), Date.now());
  run("UPDATE tasks SET reward_coupon_id='fixture-coupon' WHERE id='quest-tea'");
}
async function queued(change, operation, match = "SET state='issued'") {
  const prepare = d1.prepare; let applied = false;
  d1.prepare = sql => { const statement = prepare(sql); if (sql.includes(match)) { const original = statement.run; statement.run = async () => { if (!applied) { applied = true; change(); } return original(); }; } return statement; };
  try { const result = await operation(); assert(applied); return result; } finally { d1.prepare = prepare; }
}
const deviceRequest = () => new Request('http://localhost/api/hardware/entry', { headers: { Authorization: `Bearer ${demoToken}` } });
try {
  // Preserve the prior sticky-mode migration proof, then independently verify the new additive migration.
  reset({ legacy: true });
  for (const file of readdirSync(path.join(root, 'drizzle')).filter(f => f.endsWith('.sql') && f >= '0003' && f < '0009').sort()) exec(readFileSync(path.join(root, 'drizzle', file), 'utf8'));
  bindFixtureAccounts(); run("UPDATE hardware_devices SET bound_task_id='quest-tea' WHERE id='coin-tea-01'");
  const originalTables = all("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").map(r => r.name);
  const old = Object.fromEntries(originalTables.map(name => [name, all(`SELECT * FROM ${name} ORDER BY rowid`)]));
  exec(readFileSync(path.join(root, 'drizzle/0009_nfc_claims.sql'), 'utf8'));
  assert.equal(originalTables.length, 22); assert.equal(all("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").length, 22);
  for (const name of originalTables) for (const [i, row] of old[name].entries()) for (const [key, value] of Object.entries(row)) assert.equal(all(`SELECT * FROM ${name} ORDER BY rowid`)[i][key], value);
  assert.equal(get("SELECT nfc_claim FROM tasks WHERE id='quest-tea'").nfc_claim, 1);
  pass('0009 sticky device mode preserves all 22 prior tables and every old value');
  for (const file of readdirSync(path.join(root, 'drizzle')).filter(f => f.endsWith('.sql') && f >= '0010' && f < '0014').sort()) exec('BEGIN;\n' + readFileSync(path.join(root, 'drizzle', file), 'utf8') + '\nCOMMIT;');
  const baseline = all("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").map(r => r.name), baselineRows = Object.fromEntries(baseline.map(name => [name, all(`SELECT * FROM ${name} ORDER BY rowid`)]));
  exec(readFileSync(path.join(root, 'drizzle/0014_nfc_claim_drafts.sql'), 'utf8'));
  assert.equal(baseline.length, 25); assert.equal(all("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").length, 27);
  for (const name of baseline) assert.deepEqual(all(`SELECT * FROM ${name} ORDER BY rowid`), baselineRows[name]);
  assert.equal(count('nfc_claim_drafts'), 0); assert.equal(count('nfc_draft_operations'), 0);
  pass('0014 adds only two empty draft/operation tables and preserves all prior rows/columns');

  for (const [label, change] of [
    ['player approval revoked', () => run("UPDATE accounts SET status='rejected' WHERE id='fixture-a'")],
    ['player banned', () => run("UPDATE players SET banned=1 WHERE id='a'")],
    ['player logged out', () => run("DELETE FROM sessions WHERE token_hash=?", sha('player-a'))],
    ['device disabled', () => run("UPDATE hardware_devices SET enabled=0 WHERE id='coin-tea-01'")],
    ['device rebound', () => run("UPDATE hardware_devices SET bound_task_id=NULL WHERE id='coin-tea-01'")],
    ['device credential rotated', () => run("UPDATE hardware_devices SET token_hash='rotated' WHERE id='coin-tea-01'")],
    ['store inactive', () => run("UPDATE stores SET status='inactive' WHERE id='tea'")],
    ['task withdrawn', () => run("UPDATE tasks SET status='offline' WHERE id='quest-tea'")],
    ['range revision changed', () => run("UPDATE store_geofences SET revision=revision+1 WHERE store_id='tea'")],
    ['range disabled', () => run("UPDATE store_geofences SET enabled=0 WHERE store_id='tea'")],
    ['template unavailable', () => run("UPDATE coupon_templates SET status='inactive' WHERE id='fixture-coupon'")],
  ]) {
    fixture(); const stable = rewards();
    await reject(`Final application CAS closes queued ${label}`, () => queued(change, () => call('nfcClaim', payload()), 'INSERT INTO nfc_claim_drafts'));
    assert.equal(count('nfc_claim_drafts'), 0); assert.equal(count('nfc_draft_operations'), 0); assert.deepEqual(rewards(), stable);
  }

  fixture(); const input = payload(), before = rewards(), created = await call('nfcClaim', input);
  assert.equal(created.draft.id, input.requestId); assert.equal(created.draft.state, 'pending'); assert.equal(created.newlyCreated, true); assert.equal(created.coupon, undefined);
  assert.equal(created.draft.revision, 1); assert.equal(created.draft.canConfirm, true); assert.equal(created.draft.coupon, undefined); assert.equal(created.draft.returnedAt, undefined);
  assert.deepEqual(rewards(), before); assert.equal(count('nfc_draft_operations'), 1);
  pass('NFC creates a durable pending application, with no claim, coupon, stock use, points or coin growth');
  const replay = await call('nfcClaim', input); assert.equal(replay.newlyCreated, false); assert.equal(replay.draft.id, created.draft.id); assert.deepEqual(rewards(), before);
  pass('The original frozen NFC UUID is idempotent and does not extend GPS permission');
  for (const [label, changed, actor] of [['GPS', { ...input, location: { ...input.location, accuracy: 6 } }], ['task', { ...input, taskId: 'quest-book' }], ['device', { ...input, deviceId: 'coin-tea-01' }], ['player', input, request('b')]])
    await reject(`Original NFC UUID rejects changed ${label}`, () => call('nfcClaim', changed, actor), 409);
  const known = await call('nfcClaimStatus', { requestId: input.requestId }); assert.equal(known.found, true); assert.equal(known.draft.state, 'pending');
  assert.equal((await call('nfcClaimStatus', { requestId: input.requestId }, request('b'))).found, false);
  assert.equal((await call('nfcClaimStatus', { requestId: id() })).found, false); assert.deepEqual(rewards(), before);
  pass('Player status recovers only the exact owning request and never fabricates an unknown result');
  const ownList = await call('nfcDrafts'); assert.equal(ownList.total, 1); assert.equal((await call('nfcDrafts', {}, request('b'))).total, 0);
  for (const key of ['request_hash', 'last_request_hash', 'latitude', 'longitude', 'player_session_hash', 'device_token_hash', 'player_account_id']) assert(!Object.hasOwn(ownList.items[0], key));
  pass('The paginated drawer is owner-only and public DTOs omit GPS, hashes and credentials');
  const ready = await call('merchantPendingClaims', { deviceCode: 'GTB-DEVICE:coin-tea-01' }, merchant()); assert.equal(ready.device.id, 'coin-tea-01'); assert.equal(ready.items[0].id, created.draft.id);
  assert.deepEqual(rewards(), before);
  pass('Scanning a reusable fixed device code filters the corresponding pending player records without issuing anything');
  for (const code of ['http://localhost/client/coin/quest-tea', 'GTB-0123456789AB', 'coin-tea-01', 'GTB-DEVICE:coin-tea-01/../book'])
    await reject('A webpage, personal coupon, bare ID or malformed device code is never accepted as a device scan', () => call('merchantPendingClaims', { deviceCode: code }, merchant()), 400);
  await reject('Confirmation requires explicit acknowledgement that the physical device was received', () => issue(created.draft, { receivedDevice: false }), 400);
  const confirm = issueInput(created.draft), issued = await call('merchantIssueClaim', confirm, merchant());
  assert.equal(issued.newlyIssued, true); assert.equal(issued.coupon.id, confirm.requestId); assert.equal(issued.draft.state, 'issued'); assert.equal(issued.draft.revision, 2);
  assert(issued.draft.returnedAt); assert.equal(issued.coupon.redeemedAt, null); assert.match(issued.coupon.code, /^GTB-[0-9A-F]{12}$/); assert.equal(count('claims'), 1);
  assert.equal(get('SELECT merchant_account_id FROM nfc_claim_drafts WHERE id=?', created.draft.id).merchant_account_id, 'fixture-merchant');
  assert.equal(get("SELECT enabled FROM hardware_devices WHERE id='coin-tea-01'").enabled, 1);
  assert.equal((await call('nfcDrafts')).total, 0); assert.equal((await call('merchantPendingClaims', { deviceCode: 'GTB-DEVICE:coin-tea-01' }, merchant())).total, 0);
  pass('Merchant confirmation atomically records receipt of the exact device and issues one unused official coupon, without disabling the device');
  const afterIssue = rewards(); const again = await call('merchantIssueClaim', confirm, merchant()); assert.equal(again.newlyIssued, false); assert.equal(again.coupon.id, issued.coupon.id); assert.deepEqual(rewards(), afterIssue);
  const recovered = await call('merchantIssueClaimStatus', { requestId: confirm.requestId }, merchant()); assert.equal(recovered.found, true); assert.equal(recovered.coupon.id, issued.coupon.id);
  assert.equal((await call('merchantIssueClaimStatus', { requestId: id() }, merchant())).found, false);
  assert.equal((await call('nfcClaimStatus', { requestId: input.requestId })).coupon.id, issued.coupon.id);
  pass('Original merchant UUID recovery and original NFC UUID recovery resolve the same issued coupon exactly once');
  await reject('A different merchant confirmation UUID cannot claim an already-issued draft as its own result', () => issue(created.draft), 409);
  await reject('An issued record cannot be deleted as a draft', () => call('nfcDraftDelete', { draftId: created.draft.id, expectedRevision: 2, requestId: id() }), 409);
  await reject('The same player cannot receive a second same-store official reward', () => call('nfcClaim', payload()), 409);
  const preview = await call('couponPreview', { code: issued.coupon.code }, merchant()); assert.equal(preview.canRedeem, true); assert.deepEqual(rewards(), afterIssue);
  await call('redeem', { code: issued.coupon.code }, merchant()); assert(get('SELECT redeemed_at FROM claims WHERE id=?', issued.coupon.id).redeemed_at); assert.equal(count('claims'), 1); assert.deepEqual(rewards().ledger, afterIssue.ledger);
  pass('Later personal wallet QR redemption consumes the issued coupon without creating another claim or coin record');
  const secondPlayer = await call('nfcClaim', payload(), request('b')); const secondIssue = await issue(secondPlayer.draft); assert.equal(secondIssue.coupon.id !== issued.coupon.id, true);
  pass('The same fixed device code works again for a different player rather than being permanently consumed');
  const sync = await load('lib/hardware-server.ts').hardwareStoreSync(deviceRequest(), { deviceId: 'coin-tea-01' }); assert.deepEqual(Object.keys(sync).sort(), ['available','claimCount','storeId','storeName','taskId'].sort()); assert.equal(sync.claimCount, 2);
  pass('The unchanged five-field hardware sync counts only official merchant-confirmed claims');

  fixture(); const saved = await call('nfcClaim', payload()); run('UPDATE nfc_claim_drafts SET permit_until=0,location_timestamp=0 WHERE id=?', saved.draft.id);
  assert.equal((await call('nfcClaimStatus', { requestId: saved.draft.id })).draft.canConfirm, false);
  await reject('Old saved drafts cannot be issued using expired player location', () => issue(saved.draft), 409);
  const renewal = { draftId: saved.draft.id, requestId: id(), expectedRevision: 1, location: fixtureLocation() }, renewed = await call('nfcDraftRevalidate', renewal);
  assert.equal(renewed.draft.revision, 2); assert.equal(renewed.draft.canConfirm, true); assert.equal((await call('nfcDraftOperationStatus', { requestId: renewal.requestId })).draft.id, saved.draft.id);
  assert.equal((await call('nfcDraftRevalidate', renewal)).draft.revision, 2); assert.equal(count('claims'), 0); await issue(renewed.draft);
  pass('Reopening preserves the draft and a new explicit player location supplies a fresh 30-second permit with exact renewal recovery');
  fixture(); const disposable = await call('nfcClaim', payload()), deletion = { draftId: disposable.draft.id, expectedRevision: 1, requestId: id() }, deleted = await call('nfcDraftDelete', deletion);
  assert.equal(deleted.draft.state, 'deleted'); assert.equal(deleted.draft.canConfirm, false); assert.equal((await call('nfcDrafts')).total, 0); assert.equal(count('claims'), 0);
  assert.equal((await call('nfcDraftDelete', deletion)).draft.state, 'deleted'); assert.equal((await call('nfcDraftOperationStatus', { requestId: deletion.requestId })).found, true);
  assert.equal((await call('nfcDraftOperationStatus', { requestId: deletion.requestId }, request('b'))).found, false);
  await reject('A deleted draft cannot later be issued by a delayed merchant request', () => issue(disposable.draft), 409);
  const replacement = await call('nfcClaim', payload()); assert.notEqual(replacement.draft.id, deleted.draft.id); assert.equal((await call('nfcClaimStatus', { requestId: disposable.draft.id })).draft.state, 'deleted');
  pass('Soft deletion preserves exact recovery, permits a new application, and isolates late requests from the replacement draft');
  for (const [label, change] of [
    ['player approval revoked', () => run("UPDATE accounts SET status='rejected' WHERE id='fixture-a'")],
    ['device disabled', () => run("UPDATE hardware_devices SET enabled=0 WHERE id='coin-tea-01'")],
    ['device credential rotated', () => run("UPDATE hardware_devices SET token_hash='changed' WHERE id='coin-tea-01'")],
    ['range changed', () => run("UPDATE store_geofences SET revision=revision+1 WHERE store_id='tea'")],
  ]) {
    fixture(); const renewalDraft = await call('nfcClaim', payload()), renewRequest = { draftId: renewalDraft.draft.id, expectedRevision: 1, requestId: id(), location: fixtureLocation() };
    await reject(`Final player renewal CAS closes queued ${label}`, () => queued(change, () => call('nfcDraftRevalidate', renewRequest), "last_purpose='revalidate'"));
    assert.equal(get('SELECT revision FROM nfc_claim_drafts WHERE id=?', renewalDraft.draft.id).revision, 1); assert.equal(count('nfc_draft_operations'), 1); assert.equal(count('claims'), 0);
  }
  fixture(); const originalDraft = await call('nfcClaim', payload());
  await call('nfcClaim', payload(), request('b'));
  const page1 = await call('merchantPendingClaims', { deviceCode: 'GTB-DEVICE:coin-tea-01', pageSize: 1, page: 1 }, merchant());
  const page2 = await call('merchantPendingClaims', { deviceCode: 'GTB-DEVICE:coin-tea-01', pageSize: 1, page: 2 }, merchant());
  assert.equal(page1.total, 2); assert.equal(page1.totalPages, 2); assert.notEqual(page1.items[0].id, page2.items[0].id);
  await reject('Server pagination remains bounded', () => call('nfcDrafts', { pageSize: 500 }), 400);
  await reject('Unknown UUID is not a deletable draft', () => call('nfcDraftDelete', { draftId: id(), expectedRevision: 1, requestId: id() }), 404);
  run("INSERT INTO hardware_devices(id,store_id,token_hash,enabled,created_at,bound_task_id) VALUES('coin-book-private','book',?,1,?,'quest-book')", sha('private-book-device'), Date.now());
  run("UPDATE stores SET point_mode='hardware' WHERE id='book'");
  await reject('A merchant scanning another registered store device cannot read its pending records', () => call('merchantPendingClaims', { deviceCode: 'GTB-DEVICE:coin-book-private' }, merchant()), 404);
  pass('Pending lists page without duplication and preserve real device/store scope');
  await reject('Another player cannot renew an owned draft', () => call('nfcDraftRevalidate', { draftId: originalDraft.draft.id, expectedRevision: 1, requestId: id(), location: fixtureLocation() }, request('b')), 404);
  await reject('Another player cannot delete an owned draft', () => call('nfcDraftDelete', { draftId: originalDraft.draft.id, expectedRevision: 1, requestId: id() }, request('b')), 404);
  for (const action of ['nfcClaimStatus', 'nfcDrafts', 'nfcDraftDelete', 'nfcDraftRevalidate', 'nfcDraftOperationStatus']) await reject('Merchant role cannot use player draft APIs', () => call(action, { requestId: id() }, merchant()), 401);
  for (const actor of [request(), request('admin','admin'), new Request('http://localhost/api/game')]) for (const action of ['merchantPendingClaims', 'merchantIssueClaim', 'merchantIssueClaimStatus'])
    await reject('Player, operator and anonymous callers cannot use merchant pending-claim APIs', () => call(action, { deviceCode: 'GTB-DEVICE:coin-tea-01', requestId: id() }, actor), 403);

  for (const [label, location] of [['outside',{...fixtureLocation(),latitude:32}],['uncertain',{...fixtureLocation(),accuracy:200}],['stale',{...fixtureLocation(),timestamp:Date.now()-31000}],['future',{...fixtureLocation(),timestamp:Date.now()+6000}]]) {
    fixture(); await reject(`NFC creation refuses ${label} location`, () => call('nfcClaim', payload({ location })), 409); assert.equal(count('nfc_claim_drafts'), 0);
  }
  for (const [label, change] of [
    ['device maintenance', () => run("UPDATE hardware_devices SET enabled=0 WHERE id='coin-tea-01'")],
    ['device unbinding', () => run("UPDATE hardware_devices SET bound_task_id=NULL WHERE id='coin-tea-01'")],
    ['device token rotation', () => run("UPDATE hardware_devices SET token_hash='rotated' WHERE id='coin-tea-01'")],
    ['store offline', () => run("UPDATE stores SET status='inactive' WHERE id='tea'")],
    ['store mode change', () => run("UPDATE stores SET point_mode='static' WHERE id='tea'")],
    ['task withdrawn', () => run("UPDATE tasks SET status='offline' WHERE id='quest-tea'")],
    ['task deleted', () => run("UPDATE tasks SET deleted_at=? WHERE id='quest-tea'", Date.now())],
    ['task expiry', () => run("UPDATE tasks SET expires_at=0 WHERE id='quest-tea'")],
    ['author ownership change', () => run("UPDATE tasks SET author_id='a' WHERE id='quest-tea'")],
    ['author ban', () => run("UPDATE players SET banned=1 WHERE id='author'")],
    ['player ban', () => run("UPDATE players SET banned=1 WHERE id='a'")],
    ['player approval revoked', () => run("UPDATE accounts SET status='rejected' WHERE id='fixture-a'")],
    ['player logout', () => run("DELETE FROM sessions WHERE token_hash=?", sha('player-a'))],
    ['player expiry', () => run("UPDATE sessions SET expires_at=0 WHERE token_hash=?", sha('player-a'))],
    ['merchant ban', () => run("UPDATE players SET banned=1 WHERE id='merchant'")],
    ['merchant approval revoked', () => run("UPDATE accounts SET status='rejected' WHERE id='fixture-merchant'")],
    ['merchant logout', () => run("DELETE FROM sessions WHERE token_hash=?", sha('staff-merchant'))],
    ['merchant role mutation', () => run("UPDATE accounts SET role='admin',merchant_json=NULL,store_id=NULL WHERE id='fixture-merchant'")],
    ['merchant store rebound', () => run("UPDATE accounts SET store_id='book' WHERE id='fixture-merchant'")],
    ['range disabled', () => run("UPDATE store_geofences SET enabled=0 WHERE store_id='tea'")],
    ['range revision changed', () => run("UPDATE store_geofences SET revision=revision+1 WHERE store_id='tea'")],
    ['location permit expiry', () => run('UPDATE nfc_claim_drafts SET permit_until=0')],
    ['position freshness expiry', () => run('UPDATE nfc_claim_drafts SET location_timestamp=0')],
    ['coupon stopped', () => run("UPDATE coupon_templates SET status='inactive' WHERE id='fixture-coupon'")],
    ['coupon deleted', () => run("UPDATE coupon_templates SET deleted_at=? WHERE id='fixture-coupon'", Date.now())],
    ['coupon expired', () => run("UPDATE coupon_templates SET valid_end=0 WHERE id='fixture-coupon'")],
    ['coupon not yet valid', () => run("UPDATE coupon_templates SET valid_start=? WHERE id='fixture-coupon'", Date.now()+60000)],
    ['coupon snapshot changed', () => run("UPDATE coupon_templates SET title='新券内容',value=10 WHERE id='fixture-coupon'")],
    ['task reward changed', () => run("UPDATE tasks SET reward_value=100 WHERE id='quest-tea'")],
    ['store stock exhausted', () => run("UPDATE stores SET stock_total=0 WHERE id='tea'")],
    ['template stock exhausted', () => run("UPDATE coupon_templates SET total_count=0 WHERE id='fixture-coupon'")],
  ]) {
    fixture(); const pending = await call('nfcClaim', payload()), unchanged = rewards(), operation = issueInput(pending.draft);
    await reject(`Final merchant CAS closes queued ${label}`, () => queued(change, () => call('merchantIssueClaim', operation, merchant())));
    assert.deepEqual(rewards(), unchanged); assert.equal(get('SELECT state FROM nfc_claim_drafts WHERE id=?', pending.draft.id).state, 'pending');
    assert.equal(get('SELECT request_id FROM nfc_draft_operations WHERE request_id=?', operation.requestId), undefined);
  }
  fixture(); const changing = await call('nfcClaim', payload()); run("UPDATE coupon_templates SET title='重新绑定后的券',value=20 WHERE id='fixture-coupon'");
  await reject('A saved old coupon snapshot cannot silently issue a newly bound coupon', () => issue(changing.draft), 409);
  const updated = await call('nfcDraftRevalidate', { draftId: changing.draft.id, expectedRevision: 1, requestId: id(), location: fixtureLocation() }); assert.equal(updated.draft.reward, '重新绑定后的券');
  const current = await issue(updated.draft); assert.equal(current.coupon.reward, '重新绑定后的券'); assert.equal(current.coupon.value, 20);
  pass('Explicit player revalidation refreshes the current reward snapshot before merchant confirmation');

  fixture(); const concurrentInput = payload(), simultaneous = await Promise.all([call('nfcClaim', concurrentInput), call('nfcClaim', concurrentInput)]);
  assert.equal(count('nfc_claim_drafts'), 1); assert.equal(simultaneous.filter(r => r.newlyCreated).length, 1); assert.equal(count('claims'), 0);
  pass('Concurrent identical creation UUIDs save one draft with one receipt and no award');
  fixture(); const distinct = await Promise.allSettled([call('nfcClaim', payload()), call('nfcClaim', payload())]); assert.equal(distinct.filter(r => r.status === 'fulfilled').length, 1); assert.equal(count('nfc_claim_drafts'), 1);
  pass('Concurrent different creation UUIDs cannot create two active applications for one player/store');
  fixture(); const oneDraft = await call('nfcClaim', payload()), sameIssue = issueInput(oneDraft.draft), concurrentIssue = await Promise.all([call('merchantIssueClaim', sameIssue, merchant()), call('merchantIssueClaim', sameIssue, merchant())]);
  assert.equal(count('claims'), 1); assert.equal(concurrentIssue.filter(r => r.newlyIssued).length, 1); assert.equal(all("SELECT * FROM points_ledger WHERE kind='claim'").length, 1);
  pass('Concurrent identical merchant UUIDs create one official claim and return the exact same result');
  fixture(); const shared = await call('nfcClaim', payload()), competing = await Promise.allSettled([issue(shared.draft), issue(shared.draft)]); assert.equal(competing.filter(r => r.status === 'fulfilled').length, 1); assert.equal(count('claims'), 1);
  pass('Concurrent different merchant intents cannot issue one draft twice');
  for (const label of ['store','template']) {
    fixture(); const a = await call('nfcClaim', payload()), b = await call('nfcClaim', payload(), request('b'));
    run(label === 'store' ? "UPDATE stores SET stock_total=1 WHERE id='tea'" : "UPDATE coupon_templates SET total_count=1 WHERE id='fixture-coupon'");
    const outcomes = await Promise.allSettled([issue(a.draft), issue(b.draft)]); assert.equal(outcomes.filter(r => r.status === 'fulfilled').length, 1); assert.equal(count('claims'), 1);
    pass(`Two pending players racing the last ${label} reward allocate it once`);
  }
  fixture(); const rollback = await call('nfcClaim', payload()), rollbackIssue = issueInput(rollback.draft);
  run("INSERT INTO points_ledger(id,player_id,delta,kind,source_id,reason,created_at) VALUES(?,'a',0,'adjustment','rollback-fixture','Fixture only',?)", 'reward-' + rollbackIssue.requestId, Date.now());
  const rollbackSnapshot = rewards(); await reject('Reward trigger failure rolls back official issuance, device-return audit and operation receipt together', () => call('merchantIssueClaim', rollbackIssue, merchant()));
  assert.deepEqual(rewards(), rollbackSnapshot); assert.equal(get('SELECT state FROM nfc_claim_drafts WHERE id=?', rollback.draft.id).state, 'pending'); assert.equal(get('SELECT device_returned_at FROM nfc_claim_drafts WHERE id=?', rollback.draft.id).device_returned_at, null);
  assert.equal((await call('merchantIssueClaimStatus', { requestId: rollbackIssue.requestId }, merchant())).found, false);

  fixture(); const deletes = await call('nfcClaim', payload()), race = await Promise.allSettled([issue(deletes.draft), call('nfcDraftDelete', { draftId: deletes.draft.id, requestId: id(), expectedRevision: 1 })]);
  assert.equal(race.filter(r => r.status === 'fulfilled').length, 1); assert.equal(count('claims'), get('SELECT state FROM nfc_claim_drafts WHERE id=?', deletes.draft.id).state === 'issued' ? 1 : 0);
  pass('A deletion/issuance race has one winner and never issues a deleted replacement');
  fixture(); run("UPDATE tasks SET reward_type='points',reward_value=40,reward_coupon_id=NULL WHERE id='quest-tea'");
  const points = await call('nfcClaim', payload()); assert.equal(count('claims'), 0); const paid = await issue(points.draft); assert.equal(paid.coupon.rewardType, 'points'); assert.equal(paid.coupon.code, ''); assert.equal(paid.coupon.redeemedAt, null);
  assert.equal(get("SELECT delta FROM points_ledger WHERE player_id='a' AND kind='claim'").delta, 40);
  pass('Points activities also wait for merchant confirmation, then record points without manufacturing a redemption QR');

  fixture(); run("INSERT INTO hardware_devices(id,store_id,token_hash,enabled,created_at,bound_task_id) VALUES('coin-extra','tea',?,1,?,'quest-tea')", sha(demoToken+'extra'), Date.now());
  await reject('Legacy task-only NFC links refuse ambiguous multiple devices rather than selecting the first', () => call('nfcClaim', payload()), 409);
  const exactDevice = await call('nfcClaim', payload({ deviceId: 'coin-extra' })); assert.equal(exactDevice.draft.deviceId, 'coin-extra');
  assert.equal((await call('merchantPendingClaims', { deviceCode: 'GTB-DEVICE:coin-tea-01' }, merchant())).total, 0);
  assert.equal((await call('merchantPendingClaims', { deviceCode: 'GTB-DEVICE:coin-extra' }, merchant())).items[0].id, exactDevice.draft.id);
  await reject('Scanning another same-task device cannot issue the selected draft', () => issue(exactDevice.draft, { deviceCode: 'GTB-DEVICE:coin-tea-01' }), 409);
  pass('Explicit NFC device binding controls the exact fixed-code list even when the task has multiple devices');
  fixture(); await reject('A second enabled device arriving before creation CAS closes task-only ambiguity', () => queued(() => run("INSERT INTO hardware_devices(id,store_id,token_hash,enabled,created_at,bound_task_id) VALUES('coin-extra','tea',?,1,?,'quest-tea')", sha(demoToken+'extra'), Date.now()), () => call('nfcClaim', payload()), 'INSERT INTO nfc_claim_drafts'), 409); assert.equal(count('nfc_claim_drafts'), 0);
  fixture(); const dynamic = await load('lib/hardware-server.ts').hardwareDynamicEntry(deviceRequest(), { deviceId: 'coin-tea-01' }), entryToken = new URL(dynamic.entryUrl).searchParams.get('entry');
  await reject('Optional signed entry cannot disagree with explicit NFC device ID', () => call('nfcClaim', payload({ entryToken, deviceId: 'coin-extra' })), 409);
  const signed = await call('nfcClaim', payload({ entryToken })); assert.equal(signed.draft.deviceId, 'coin-tea-01'); assert.equal(count('claims'), 0);
  pass('Optional online signed entry may identify a device, but still creates only a merchant-pending application');
  await reject('Malformed optional entry never silently falls back to a static NFC link', () => call('nfcClaim', payload({ entryToken:'v1.invalid' })), 400);

  fixture(); const throttledInput = payload(); await call('nfcClaim', throttledInput);
  for (let i = 0; i < 7; i++) await assert.rejects(() => call('nfcClaim', payload()), e => e.status === 409);
  await reject('Eight new write attempts per minute cap repeated application churn', () => call('nfcClaim', payload()), 429);
  assert.equal((await call('nfcClaim', throttledInput)).newlyCreated, false); assert.equal((await call('nfcClaimStatus', { requestId: throttledInput.requestId })).found, true);
  assert.equal(get("SELECT attempt_count FROM hardware_claim_attempts WHERE player_id='a' AND store_id='tea'").attempt_count, 8);
  pass('Exact successful UUID replay/status never spends or resets the write throttle');
  fixture(); const routeDraft = await call('nfcClaim', payload()), routeInput = issueInput(routeDraft.draft);
  const mismatch = await load('app/api/game/route.ts').POST(new Request('http://localhost/api/game', { method: 'POST', headers: { Cookie: 'mall_player=player-merchant; mall_staff=staff-merchant', 'X-Mall-Quest-Player':'a' }, body: JSON.stringify({action:'merchantIssueClaim',...routeInput}) }));
  assert.equal(mismatch.status,409); assert.equal(count('claims'),0);
  const actual = await load('app/api/game/route.ts').POST(new Request('http://localhost/api/game', { method:'POST', headers:{Cookie:'mall_staff=staff-merchant'}, body:JSON.stringify({action:'merchantIssueClaim',...routeInput}) }));
  assert.equal(actual.status,200); assert.equal((await actual.json()).data.coupon.redeemedAt,null);
  pass('Actual HTTP merchant confirmation supports its approved staff cookie and retains the page identity-snapshot guard');

  fixture(); const web = await call('claim', { taskId:'quest-book',answer:'茉莉',location:fixtureLocation() }); assert.equal(web.coupon.status,'unused'); assert.equal(get('SELECT nfc_request_hash FROM claims WHERE id=?',web.coupon.id).nfc_request_hash,null);
  assert.equal((await call('nfcClaimStatus',{requestId:web.coupon.id})).found,false);
  pass('Independent static web activities retain their original answer/claim flow without impersonating NFC requests');
  await reject('Sticky hardware tasks reject the old answer claim action',()=>call('claim',{taskId:'quest-tea',answer:'茉莉',location:fixtureLocation()}),409);
  await reject('Sticky hardware tasks reject the old coin-confirm action',()=>call('coinCheckIn',{taskId:'quest-tea',location:fixtureLocation()}),409);
  run("UPDATE hardware_devices SET enabled=0,bound_task_id=NULL WHERE id='coin-tea-01'"); assert.equal(get("SELECT nfc_claim FROM tasks WHERE id='quest-tea'").nfc_claim,1);
  await reject('Withdrawing a device never restores an old direct-award bypass',()=>call('claim',{taskId:'quest-tea',answer:'茉莉',location:fixtureLocation()}),409);
  fixture(); const historical = id(); run("INSERT INTO claims(id,player_id,event_id,store_id,task_id,coupon_code,issued_at,nfc_request_hash) VALUES(?,'a','mall-48h','tea','quest-tea','GTB-OLDNFC',?,?)",historical,Date.now(),sha('prior-nfc-award'));
  assert.equal((await call('nfcClaimStatus',{requestId:historical})).coupon.id,historical); assert.equal((await call('nfcClaimStatus',{requestId:historical},request('b'))).found,false);
  await reject('Historical official NFC UUID cannot be reused to create a new pending record',()=>call('nfcClaim',payload({requestId:historical})),409);
  pass('Exact historical direct-NFC rewards remain owner-readable and are never reissued or migrated into pending drafts');
  assert.equal(get('PRAGMA integrity_check').integrity_check,'ok'); assert.deepEqual(all('PRAGMA foreign_key_check'),[]);
  pass('Pending and legacy flows retain valid SQLite integrity and foreign keys');
  console.log(JSON.stringify({status:'PASS',cases,database:':memory:',privateDatabaseWrites:0,cloudRequests:0,deviceWrites:0,realEmailsSent:0}));
} finally { close(); }
