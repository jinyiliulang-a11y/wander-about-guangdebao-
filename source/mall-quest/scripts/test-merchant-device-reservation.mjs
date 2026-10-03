import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { reset, run, all, load, request, d1, close } from './business-fixture.mjs';

let cases = 0;
const pass = name => console.log(`PASS ${++cases}: ${name}`);
const actions = ['merchantDeviceCapabilities', 'merchantDeviceVerify', 'merchantDeviceReturn', 'merchantDeviceOperationStatus'];
const intent = { deviceId: 'coin-tea-01', roundId: randomUUID(), requestId: randomUUID(), proof: { unspecifiedFormat: 'OPAQUE_PRIVATE_PROOF_DO_NOT_LOG' } };
const snapshot = () => JSON.stringify(all("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").map(({ name }) => [name, all(`SELECT * FROM ${name} ORDER BY rowid`)]));
const staffOnly = who => new Request('http://localhost/api/game', { headers: { Cookie: `mall_staff=staff-${who}` } });
const logs = [], originalError = console.error, prepare = d1.prepare, batch = d1.batch;
async function post(action, input = {}, actor = staffOnly('merchant'), headers = {}) {
  const combined = new Headers(actor.headers); for (const [key, value] of Object.entries(headers)) combined.set(key, value);
  const response = await load('app/api/game/route.ts').POST(new Request(actor.url, { method: 'POST', headers: combined, body: JSON.stringify({ action, ...input }) }));
  return { status: response.status, body: await response.json() };
}
try {
  reset();
  run('INSERT INTO hardware_devices(id,store_id,token_hash,enabled,created_at) VALUES(?,?,?,?,?)', 'coin-book-private', 'book', 'other-store-private-token-hash', 1, Date.now());
  const before = snapshot();
  console.error = (...values) => logs.push(values.map(value => String(value)).join(' '));
  d1.prepare = sql => { assert(!/^\s*(?:INSERT|UPDATE|DELETE|REPLACE|CREATE|ALTER|DROP)\b/i.test(sql), 'reserved HTTP routes must never prepare a write'); return prepare(sql); };
  d1.batch = async () => { throw new Error('Reserved HTTP routes must never execute a batch'); };

  const capability = await post('merchantDeviceCapabilities');
  assert.equal(capability.status, 200); assert.deepEqual(capability.body.data, { apiVersion: 1, storeId: 'tea', deviceVerification: 'reserved', returnRegistration: 'reserved', operationStatus: 'reserved', fixedDeviceCode: 'available', pendingClaimIssuance: 'available', offlineCryptographicProof: 'reserved' });
  pass('Actual HTTP capability uses an approved merchant cookie and distinguishes the fixed-code flow from reserved cryptographic adapters');
  for (const action of actions.slice(1)) {
    const first = await post(action, intent), repeated = await post(action, intent);
    assert.equal(first.status, 409); assert.equal(first.body.error.code, 'MERCHANT_DEVICE_NOT_CONFIGURED'); assert.deepEqual(repeated, first); assert(!first.body.data);
  }
  pass('Verify, return and exact operation status each give definite stable 409 on the original and repeated opaque request');
  for (const actor of [new Request('http://localhost/api/game'), request(), staffOnly('admin')]) for (const action of actions) {
    const denied = await post(action, intent, actor); assert.equal(denied.status, 403); assert.equal(denied.body.error.code, 'MERCHANT_DEVICE_FORBIDDEN');
  }
  pass('Anonymous callers, players and approved operators cannot access merchant device routes');
  for (const action of actions) {
    const wrongStore = await post(action, { ...intent, storeId: 'book' }), wrongDevice = await post(action, { ...intent, deviceId: 'coin-book-private' });
    assert.equal(wrongStore.status, 403); assert.equal(wrongStore.body.error.code, 'MERCHANT_DEVICE_FORBIDDEN');
    assert.equal(wrongDevice.status, 404); assert.equal(wrongDevice.body.error.code, 'MERCHANT_DEVICE_NOT_FOUND');
    assert(!JSON.stringify(wrongDevice).includes('other-store-private-token-hash'));
  }
  pass('Body store selection and another registered device cannot broaden the merchant scope or reveal its credential');
  const stalePage = await post('merchantDeviceCapabilities', {}, request('merchant', 'merchant'), { 'X-Mall-Quest-Player': 'a' });
  assert.equal(stalePage.status, 409); assert(stalePage.body.error.message.includes('身份已变化'));
  pass('The existing public route player snapshot guard still rejects stale page identity');
  assert.equal(snapshot(), before); assert(!logs.join('\n').includes('OPAQUE_PRIVATE_PROOF_DO_NOT_LOG'));
  pass('All successful, denied and repeated HTTP reservations preserve every table and do not log the opaque proof');

  for (const [label, change, undo] of [
    ['approval revoked', "UPDATE accounts SET status='rejected' WHERE id='fixture-merchant'", "UPDATE accounts SET status='approved' WHERE id='fixture-merchant'"],
    ['player banned', "UPDATE players SET banned=1 WHERE id='merchant'", "UPDATE players SET banned=0 WHERE id='merchant'"],
    ['store rebound', "UPDATE accounts SET store_id='book' WHERE id='fixture-merchant'", "UPDATE accounts SET store_id='tea' WHERE id='fixture-merchant'"],
    ['session expired', "UPDATE sessions SET expires_at=0 WHERE token_hash=(SELECT token_hash FROM sessions WHERE role='merchant' LIMIT 1)", null],
  ]) {
    run(change); const stable = snapshot();
    for (const action of actions) { const denied = await post(action, intent); assert.equal(denied.status, 403); assert.equal(denied.body.error.code, 'MERCHANT_DEVICE_FORBIDDEN'); }
    assert.equal(snapshot(), stable); if (undo) run(undo);
    pass(`Current ${label} fails merchant authorization with no route writes`);
  }
  console.log(JSON.stringify({ status: 'PASS', cases, database: ':memory:', privateDatabaseWrites: 0, cloudRequests: 0, deviceWrites: 0, realEmailsSent: 0 }));
} finally { console.error = originalError; d1.prepare = prepare; d1.batch = batch; close(); }
