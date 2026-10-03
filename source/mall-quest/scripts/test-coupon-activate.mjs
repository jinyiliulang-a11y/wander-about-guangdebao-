import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { reset, run, get, all, action, load, request, d1, sha, close } from './business-fixture.mjs';
import { setupFixtureGeofences, fixtureLocation } from './geofence-fixture.mjs';

let cases = 0;
const pass = label => console.log(`PASS ${++cases}: ${label}`);
const templateId = 'activation-template';
const activate = (input = {}, player = 'a', staff = 'merchant') => action('couponActivate', { templateId, ...input }, player, staff);
const templates = () => all('SELECT * FROM coupon_templates ORDER BY id');
const protectedState = () => Object.fromEntries(all("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name<>'coupon_templates' ORDER BY name")
  .map(({ name }) => [name, all(`SELECT * FROM ${name} ORDER BY rowid`)]));
const rewardState = () => ({ claims: all('SELECT * FROM claims ORDER BY id'), ledger: all('SELECT * FROM points_ledger ORDER BY id'),
  balances: all('SELECT id,points_balance FROM players ORDER BY id'), stock: all('SELECT id,stock_total FROM stores ORDER BY id') });
function fixture(patch = {}) {
  reset(); setupFixtureGeofences();
  run(`INSERT INTO coupon_templates(id,store_id,title,type,value,min_amount,total_count,valid_start,valid_end,status,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`, templateId, 'tea', 'Activation original reward', 'cash', 5, 20, 10, null, null, 'inactive', Date.now() - 20000, Date.now() - 10000);
  for (const [field, value] of Object.entries(patch)) run(`UPDATE coupon_templates SET ${field}=? WHERE id=?`, value, templateId);
}
async function denied(label, operation, status = 409, message) {
  await assert.rejects(operation, error => error.status === status && (!message || message.test(error.message)));
  pass(label);
}
function seedClaim(player = 'a', redeemed = false) {
  const id = randomUUID();
  run(`INSERT INTO claims(id,player_id,event_id,store_id,task_id,coupon_code,issued_at,redeemed_at,template_id)
    VALUES(?,?,?,?,?,?,?,?,?)`, id, player, 'mall-48h', 'tea', 'quest-tea', 'GTB-' + id.replaceAll('-', '').slice(0, 12).toUpperCase(), Date.now(), redeemed ? Date.now() : null, templateId);
  return id;
}
async function queued(match, change, operation) {
  const prepare = d1.prepare; let fired = false, changedTemplates;
  d1.prepare = sql => {
    const statement = prepare(sql);
    if (match(sql)) for (const method of ['run', 'first']) {
      const execute = statement[method];
      statement[method] = async (...args) => {
        if (!fired) { fired = true; change(); changedTemplates = templates(); }
        return execute(...args);
      };
    }
    return statement;
  };
  try { await operation(); assert(fired, 'must intercept the actual final guarded statement'); }
  finally { d1.prepare = prepare; if (fired) assert.deepEqual(templates(), changedTemplates, 'rejected activation must not overwrite a concurrent template change'); }
}
const mutation = sql => sql.startsWith("UPDATE coupon_templates SET status='active',updated_at=");
const replayRead = sql => sql.startsWith("SELECT id FROM coupon_templates WHERE status='active'");
try {
  fixture(); const before = get('SELECT * FROM coupon_templates WHERE id=?', templateId), other = protectedState();
  const result = await activate({ title: 'Injected title', value: 999, totalCount: 999, validEnd: 0, storeId: 'book' });
  assert.equal(result.templateId, templateId); assert.match(result.message, /已启用/);
  const after = get('SELECT * FROM coupon_templates WHERE id=?', templateId);
  assert.equal(after.status, 'active'); assert(after.updated_at > before.updated_at);
  assert.deepEqual({ ...after, status: before.status, updated_at: before.updated_at }, { ...before });
  assert.deepEqual(protectedState(), other);
  pass('Actual dispatcher enables only status/updated_at and ignores injected full-template fields without any reward or inventory write');
  const repeatBefore = templates(), repeatProtected = protectedState(), repeated = await activate();
  assert.equal(repeated.templateId, templateId); assert.match(repeated.message, /已启用/);
  assert.deepEqual(templates(), repeatBefore); assert.deepEqual(protectedState(), repeatProtected);
  pass('An already-active valid template is an idempotent read without changing updated_at or business records');

  for (const [label, patch] of [
    ['future start and future end', { valid_start: Date.now() + 86400000, valid_end: Date.now() + 172800000 }],
    ['future start without an end', { valid_start: Date.now() + 86400000 }],
    ['currently effective dates', { valid_start: Date.now() - 86400000, valid_end: Date.now() + 86400000 }],
    ['long-term validity', {}],
  ]) {
    fixture(patch); const stable = rewardState(); await activate(); assert.equal(get('SELECT status FROM coupon_templates WHERE id=?', templateId).status, 'active'); assert.deepEqual(rewardState(), stable);
    pass(`Activation permits ${label} without issuing a coupon`);
  }
  fixture({ valid_start: Date.now() + 86400000, valid_end: Date.now() + 172800000 }); await activate();
  run("UPDATE tasks SET reward_type='coupon',reward_coupon_id=? WHERE id='quest-tea'", templateId);
  await denied('A future template is planned active but cannot actually issue a reward before its start date', () => action('claim', { taskId: 'quest-tea', answer: '茉莉', location: fixtureLocation() }), 400);
  assert.equal(get('SELECT COUNT(*) AS n FROM claims').n, 0);

  for (const [label, input, player, staff, status] of [
    ['another merchant store', { templateId: 'book-template' }, 'a', 'merchant', 403],
    ['a player', {}, 'a', undefined, 403],
    ['a missing template', { templateId: 'missing-template' }, 'a', 'merchant', 404],
    ['an empty identifier', { templateId: '' }, 'a', 'merchant', 400],
    ['an object identifier', { templateId: {} }, 'a', 'merchant', 400],
  ]) {
    fixture(); if (input.templateId === 'book-template') run(`INSERT INTO coupon_templates(id,store_id,title,type,value,min_amount,total_count,status,created_at,updated_at)
      VALUES('book-template','book','Foreign book coupon','cash',5,20,10,'inactive',?,?)`, Date.now(), Date.now());
    const stable = templates(), rewards = rewardState();
    await denied(`Activation rejects ${label}`, () => action('couponActivate', { templateId, ...input }, player, staff), status);
    assert.deepEqual(templates(), stable); assert.deepEqual(rewardState(), rewards);
  }
  fixture(); const anonymousBefore = templates();
  await denied('An unauthenticated caller cannot enable a template', () => load('lib/game-server.ts').execute(new Request('http://localhost/api/game'), { action: 'couponActivate', templateId }), 401);
  assert.deepEqual(templates(), anonymousBefore);
  fixture(); run("UPDATE coupon_templates SET store_id='book' WHERE id=?", templateId); await activate({}, 'a', 'admin');
  assert.equal(get('SELECT status FROM coupon_templates WHERE id=?', templateId).status, 'active');
  pass('An approved operator can enable a template within the current event without pretending to be its merchant');

  for (const [label, change, message] of [
    ['deleted template', () => run('UPDATE coupon_templates SET deleted_at=? WHERE id=?', Date.now(), templateId), /已删除/],
    ['expired template', () => run('UPDATE coupon_templates SET valid_end=0 WHERE id=?', templateId), /编辑有效期/],
    ['exhausted template', () => run('UPDATE coupon_templates SET total_count=0 WHERE id=?', templateId), /编辑发放总量/],
  ]) for (const active of [false, true]) {
    fixture(); if (active) run("UPDATE coupon_templates SET status='active' WHERE id=?", templateId); change();
    const stable = templates(), rewards = rewardState();
    await denied(`${active ? 'Active replay' : 'Paused template'} rejects ${label} with a repair hint`, () => activate(), 409, message);
    assert.deepEqual(templates(), stable); assert.deepEqual(rewardState(), rewards);
  }
  fixture({ total_count: 1 }); seedClaim('a', true); const usedBefore = templates(), usedRewards = rewardState();
  await denied('Redeemed issued coupons still consume template issuance quota', () => activate(), 409, /编辑发放总量/);
  assert.deepEqual(templates(), usedBefore); assert.deepEqual(rewardState(), usedRewards);
  fixture({ total_count: 2 }); seedClaim('a'); await activate();
  assert.equal(get('SELECT total_count FROM coupon_templates WHERE id=?', templateId).total_count, 2);
  pass('A template with one remaining slot enables without replenishing its quota');

  for (const [label, mutate] of [
    ['zero store-wide stock', () => run("UPDATE stores SET stock_total=0 WHERE id='tea'")],
    ['an inactive store', () => run("UPDATE stores SET status='inactive' WHERE id='tea'")],
  ]) {
    fixture(); mutate(); const stable = rewardState(); await activate(); assert.deepEqual(rewardState(), stable);
    run("UPDATE tasks SET reward_type='coupon',reward_coupon_id=? WHERE id='quest-tea'", templateId);
    await denied(`Template configuration may enable with ${label}, while actual issuance stays blocked`, () => action('claim', { taskId: 'quest-tea', answer: '茉莉', location: fixtureLocation() }), 400);
    assert.equal(get('SELECT COUNT(*) AS n FROM claims').n, 0); assert.deepEqual(rewardState(), stable);
  }

  for (const [label, mutate] of [
    ['merchant approval revoked', () => run("UPDATE accounts SET status='rejected' WHERE id='fixture-merchant'")],
    ['merchant banned', () => run("UPDATE players SET banned=1 WHERE id='merchant'")],
    ['merchant logout', () => run('DELETE FROM sessions WHERE token_hash=?', sha('staff-merchant'))],
    ['merchant session expired', () => run('UPDATE sessions SET expires_at=0 WHERE token_hash=?', sha('staff-merchant'))],
    ['merchant role changed', () => run("UPDATE accounts SET role='player',merchant_json=NULL,store_id=NULL WHERE id='fixture-merchant'")],
    ['merchant store rebound', () => run("UPDATE accounts SET store_id='book' WHERE id='fixture-merchant'")],
    ['template deleted', () => run('UPDATE coupon_templates SET deleted_at=? WHERE id=?', Date.now(), templateId)],
    ['template moved to another store', () => run("UPDATE coupon_templates SET store_id='book' WHERE id=?", templateId)],
    ['store moved outside the current event', () => run("UPDATE stores SET event_id='other-event' WHERE id='tea'")],
    ['template expiration changed', () => run('UPDATE coupon_templates SET valid_end=0 WHERE id=?', templateId)],
    ['template quota changed', () => run('UPDATE coupon_templates SET total_count=0 WHERE id=?', templateId)],
  ]) {
    fixture(); const rewardBefore = rewardState();
    await denied(`Final SQL rejects queued ${label}`, () => queued(mutation, mutate, () => activate()), 409);
    assert.deepEqual(all('SELECT * FROM claims ORDER BY id'), rewardBefore.claims); assert.deepEqual(all('SELECT * FROM points_ledger ORDER BY id'), rewardBefore.ledger);
  }
  fixture({ total_count: 1 }); let inserted;
  await denied('A last quota slot consumed immediately before activation is checked in the final SQL', () => queued(mutation, () => { seedClaim('b'); inserted = rewardState(); }, () => activate()), 409);
  assert.deepEqual(rewardState(), inserted);
  for (const [label, mutate] of [
    ['approval revoked', () => run("UPDATE accounts SET status='rejected' WHERE id='fixture-merchant'")],
    ['event changed', () => run("UPDATE stores SET event_id='other-event' WHERE id='tea'")],
    ['template expired', () => run('UPDATE coupon_templates SET valid_end=0 WHERE id=?', templateId)],
    ['quota exhausted', () => run('UPDATE coupon_templates SET total_count=0 WHERE id=?', templateId)],
  ]) {
    fixture({ status: 'active' });
    await denied(`Already-active recovery rechecks ${label} after its zero-row update`, () => queued(replayRead, mutate, () => activate()), 409);
  }
  fixture(); const stable = protectedState(); const concurrent = await Promise.all([activate(), activate()]);
  assert(concurrent.every(reply => reply.templateId === templateId)); assert.equal(get('SELECT status FROM coupon_templates WHERE id=?', templateId).status, 'active'); assert.deepEqual(protectedState(), stable);
  pass('Concurrent status-only enables converge on one active template without repeated reward effects');

  fixture({ status: 'active' }); run("UPDATE tasks SET reward_type='coupon',reward_coupon_id=? WHERE id='quest-tea'", templateId);
  const issued = await action('claim', { taskId: 'quest-tea', answer: '茉莉', location: fixtureLocation() });
  await action('couponDeactivate', { templateId }, 'a', 'merchant');
  const originalCoupon = get('SELECT * FROM claims WHERE id=?', issued.coupon.id), originalRewards = rewardState(); await activate();
  assert.deepEqual(get('SELECT * FROM claims WHERE id=?', issued.coupon.id), originalCoupon); assert.deepEqual(rewardState(), originalRewards);
  assert.equal((await action('couponPreview', { code: issued.coupon.code }, 'a', 'merchant')).coupon.reward, 'Activation original reward');
  pass('Re-enabling a paused template preserves the actual previously issued coupon snapshot, points and stock');
  assert.equal(get('PRAGMA integrity_check').integrity_check, 'ok'); assert.deepEqual(all('PRAGMA foreign_key_check'), []);
  pass('Activation fixtures retain SQLite integrity and foreign keys with no migration');
  console.log(JSON.stringify({ status: 'PASS', cases, database: ':memory:', privateDatabaseWrites: 0, cloudRequests: 0, deviceWrites: 0, realEmailsSent: 0 }));
} finally { close(); }
