import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { reset, run, get, all, load, request, d1, sha, demoToken, close } from './business-fixture.mjs';
import { setupFixtureGeofences, fixtureLocation } from './geofence-fixture.mjs';

let cases = 0;
const pass = name => console.log(`PASS ${++cases}: ${name}`);
const merchant = () => request('merchant', 'merchant');
const call = (action, input = {}, actor = merchant()) => load('lib/game-server.ts').execute(actor, { action, ...input });
const bindInput = patch => ({ deviceId: 'coin-tea-01', expectedTaskId: 'quest-tea', expectedCouponId: 'old-coupon', templateId: 'new-coupon', ...patch });
const bind = (patch, actor) => call('deviceCouponBind', bindInput(patch), actor);
const rejected = async (label, fn, status) => { await assert.rejects(fn, error => status === undefined ? Number.isInteger(error.status) : error.status === status); pass(label); };
const unaffected = () => Object.fromEntries(all("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name<>'tasks' ORDER BY name").map(({ name }) => [name, all(`SELECT * FROM ${name} ORDER BY rowid`)]));
const rewardState = () => ({ claims: all('SELECT * FROM claims ORDER BY id'), ledger: all('SELECT * FROM points_ledger ORDER BY id'), balances: all('SELECT id,points_balance FROM players ORDER BY id'), stores: all('SELECT id,stock_total FROM stores ORDER BY id'), templates: all('SELECT id,total_count FROM coupon_templates ORDER BY id') });
function fixture() {
  reset({ hardwareConfirmation: true }); setupFixtureGeofences();
  for (const [id, store] of [['old-coupon','tea'],['new-coupon','tea'],['other-coupon','tea'],['book-coupon','book']]) {
    run('INSERT INTO coupon_templates(id,store_id,title,type,value,min_amount,total_count,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)', id, store, id + ' title', 'cash', 5, 20, 10, 'active', Date.now(), Date.now());
  }
  run("UPDATE tasks SET reward_type='coupon',reward_coupon_id='old-coupon' WHERE id='quest-tea'");
}
async function race(change, operation) {
  const prepare = d1.prepare; let applied = false, afterChange;
  d1.prepare = sql => {
    const statement = prepare(sql);
    if (sql.startsWith("UPDATE tasks SET reward_type='coupon',reward_coupon_id=")) {
      const original = statement.run;
      statement.run = async () => { if (!applied) { applied = true; change(); afterChange = all('SELECT * FROM tasks ORDER BY id'); } return original(); };
    }
    return statement;
  };
  try { await operation(); } finally { d1.prepare = prepare; assert(applied, 'must intercept the actual final CAS'); assert.deepEqual(all('SELECT * FROM tasks ORDER BY id'), afterChange, 'failed binding must not overwrite the changed task'); }
}
try {
  fixture(); const before = unaffected(), initialTasks = all('SELECT * FROM tasks ORDER BY id'), success = await bind();
  assert.equal(success.bound, true); assert.equal(success.deviceId, 'coin-tea-01'); assert.equal(success.templateId, 'new-coupon');
  assert.equal(get("SELECT reward_coupon_id FROM tasks WHERE id='quest-tea'").reward_coupon_id, 'new-coupon');
  assert.deepEqual(unaffected(), before);
  for (const row of initialTasks.filter(row => row.id !== 'quest-tea')) assert.deepEqual(get('SELECT * FROM tasks WHERE id=?', row.id), row);
  pass('Actual game dispatcher binds a current active same-store template and changes only the existing task reward');
  const repeatBefore = all('SELECT * FROM tasks ORDER BY id'), replay = await bind();
  assert.equal(replay.bound, true); assert.equal(replay.replayed, true); assert.deepEqual(all('SELECT * FROM tasks ORDER BY id'), repeatBefore); assert.deepEqual(unaffected(), before);
  pass('Exact desired binding replay is read-only and preserves every business record and hardware credential');
  fixture(); run("UPDATE tasks SET reward_type='points',reward_coupon_id=NULL,reward_value=40 WHERE id='quest-tea'"); const pointsBefore = rewardState();
  await bind({ expectedCouponId: null }); assert.equal(get("SELECT reward_type FROM tasks WHERE id='quest-tea'").reward_type, 'coupon'); assert.equal(get("SELECT reward_value FROM tasks WHERE id='quest-tea'").reward_value, 50); assert.deepEqual(rewardState(), pointsBefore);
  pass('Binding a coupon changes future task reward configuration without granting points or touching stock');

  for (const [label, patch, actor] of [
    ['player', {}, request()], ['anonymous caller', {}, new Request('http://localhost/api/game')],
    ['foreign-store template', { templateId:'book-coupon' }], ['missing device', { deviceId:'not-registered' }],
    ['missing template', { templateId:'not-registered' }], ['wrong expected task', { expectedTaskId:'quest-book' }],
    ['stale previous coupon', { expectedCouponId:'other-coupon' }], ['missing expected coupon snapshot', { expectedCouponId:undefined }],
  ]) {
    fixture(); const stable = all('SELECT * FROM tasks ORDER BY id'), protectedBefore = unaffected();
    await rejected(`Binding denies ${label}`, () => bind(patch, actor)); assert.deepEqual(all('SELECT * FROM tasks ORDER BY id'), stable); assert.deepEqual(unaffected(), protectedBefore);
  }
  fixture(); run("UPDATE stores SET point_mode='hardware' WHERE id='book'"); run("INSERT INTO hardware_devices(id,store_id,token_hash,enabled,created_at,bound_task_id) VALUES('coin-book','book',?,1,?,'quest-book')",sha(demoToken+'book'),Date.now());
  await rejected('A merchant cannot configure another registered store device', () => bind({deviceId:'coin-book',expectedTaskId:'quest-book',expectedCouponId:null,templateId:'book-coupon'}),403);

  for (const [label, change] of [
    ['disabled device', () => run("UPDATE hardware_devices SET enabled=0 WHERE id='coin-tea-01'")],
    ['unbound device', () => run("UPDATE hardware_devices SET bound_task_id=NULL WHERE id='coin-tea-01'")],
    ['inactive store', () => run("UPDATE stores SET status='inactive' WHERE id='tea'")],
    ['static store mode', () => run("UPDATE stores SET point_mode='static' WHERE id='tea'")],
    ['withdrawn task', () => run("UPDATE tasks SET status='offline' WHERE id='quest-tea'")],
    ['deleted task', () => run("UPDATE tasks SET deleted_at=? WHERE id='quest-tea'",Date.now())],
    ['expired task', () => run("UPDATE tasks SET expires_at=0 WHERE id='quest-tea'")],
    ['stopped template', () => run("UPDATE coupon_templates SET status='inactive' WHERE id='new-coupon'")],
    ['deleted template', () => run("UPDATE coupon_templates SET deleted_at=? WHERE id='new-coupon'",Date.now())],
    ['expired template', () => run("UPDATE coupon_templates SET valid_end=0 WHERE id='new-coupon'")],
    ['zero template quota', () => run("UPDATE coupon_templates SET total_count=0 WHERE id='new-coupon'")],
    ['revoked merchant approval', () => run("UPDATE accounts SET status='rejected' WHERE id='fixture-merchant'")],
    ['banned merchant', () => run("UPDATE players SET banned=1 WHERE id='merchant'")],
    ['merchant store rebound', () => run("UPDATE accounts SET store_id='book' WHERE id='fixture-merchant'")],
  ]) {
    for (const replay of [false,true]) {
      fixture(); if (replay) run("UPDATE tasks SET reward_coupon_id='new-coupon' WHERE id='quest-tea'"); change();
      const stable = all('SELECT * FROM tasks ORDER BY id'), other = unaffected();
      await rejected(`${replay ? 'Already-bound replay' : 'New binding'} rejects ${label}`, () => bind()); assert.deepEqual(all('SELECT * FROM tasks ORDER BY id'), stable); assert.deepEqual(unaffected(), other);
    }
  }
  for (const replay of [false,true]) {
    fixture(); run("UPDATE hardware_devices SET store_id='book',bound_task_id='quest-book' WHERE id='coin-tea-01'"); run("UPDATE stores SET point_mode='hardware' WHERE id='book'");
    if (replay) run("UPDATE tasks SET reward_coupon_id='book-coupon' WHERE id='quest-book'");
    await rejected(`${replay ? 'Replay' : 'New binding'} refuses a corrupted canonical tea device attached to a different task/store`, () => bind({deviceId:'coin-tea-01',expectedTaskId:'quest-book',expectedCouponId:replay?'book-coupon':null,templateId:'book-coupon'},request('admin','admin')),403);
  }

  for (const [label, change] of [
    ['merchant approval revoked',()=>run("UPDATE accounts SET status='rejected' WHERE id='fixture-merchant'")],
    ['merchant banned',()=>run("UPDATE players SET banned=1 WHERE id='merchant'")],
    ['merchant logout',()=>run("DELETE FROM sessions WHERE token_hash=?",sha('staff-merchant'))],
    ['merchant session expiry',()=>run("UPDATE sessions SET expires_at=0 WHERE token_hash=?",sha('staff-merchant'))],
    ['merchant role changed',()=>run("UPDATE accounts SET role='admin',merchant_json=NULL,store_id=NULL WHERE id='fixture-merchant'")],
    ['merchant store rebound',()=>run("UPDATE accounts SET store_id='book' WHERE id='fixture-merchant'")],
    ['device disabled',()=>run("UPDATE hardware_devices SET enabled=0 WHERE id='coin-tea-01'")],
    ['device unbound',()=>run("UPDATE hardware_devices SET bound_task_id=NULL WHERE id='coin-tea-01'")],
    ['task binding drift',()=>run("UPDATE hardware_devices SET bound_task_id='quest-book' WHERE id='coin-tea-01'")],
    ['old coupon changed',()=>run("UPDATE tasks SET reward_coupon_id='other-coupon' WHERE id='quest-tea'")],
    ['store inactive',()=>run("UPDATE stores SET status='inactive' WHERE id='tea'")],
    ['store point mode changed',()=>run("UPDATE stores SET point_mode='static' WHERE id='tea'")],
    ['store event changed',()=>run("UPDATE stores SET event_id='other-event' WHERE id='tea'")],
    ['task withdrawn',()=>run("UPDATE tasks SET status='offline' WHERE id='quest-tea'")],
    ['task deleted',()=>run("UPDATE tasks SET deleted_at=? WHERE id='quest-tea'",Date.now())],
    ['task expired',()=>run("UPDATE tasks SET expires_at=0 WHERE id='quest-tea'")],
    ['template stopped',()=>run("UPDATE coupon_templates SET status='inactive' WHERE id='new-coupon'")],
    ['template deleted',()=>run("UPDATE coupon_templates SET deleted_at=? WHERE id='new-coupon'",Date.now())],
    ['template expired',()=>run("UPDATE coupon_templates SET valid_end=0 WHERE id='new-coupon'")],
    ['template store changed',()=>run("UPDATE coupon_templates SET store_id='book' WHERE id='new-coupon'")],
    ['template quota exhausted',()=>run("UPDATE coupon_templates SET total_count=0 WHERE id='new-coupon'")],
    ['canonical tea binding corrupted',()=>run("UPDATE hardware_devices SET store_id='book',bound_task_id='quest-book' WHERE id='coin-tea-01'")],
  ]) {
    fixture(); const priorReward = rewardState(); await rejected(`Final configuration CAS closes queued ${label}`, () => race(change,()=>bind()),409);
    assert.deepEqual(all('SELECT * FROM claims ORDER BY id'),priorReward.claims); assert.deepEqual(all('SELECT * FROM points_ledger ORDER BY id'),priorReward.ledger);
  }
  fixture(); const contestants = await Promise.allSettled([bind(), bind({templateId:'other-coupon'})]);
  assert.equal(contestants.filter(result=>result.status==='fulfilled').length,1); assert.equal(contestants.filter(result=>result.status==='rejected').length,1);
  const winning = contestants.find(result=>result.status==='fulfilled').value.templateId; assert.equal(get("SELECT reward_coupon_id FROM tasks WHERE id='quest-tea'").reward_coupon_id,winning);
  assert.equal(get('SELECT COUNT(*) AS n FROM claims').n,0);
  pass('Concurrent requests with the same old-coupon snapshot cannot overwrite each other with different targets');

  fixture(); const pending = await call('nfcClaim',{taskId:'quest-tea',requestId:randomUUID(),location:fixtureLocation()},request());
  const issued = await call('merchantIssueClaim',{draftId:pending.draft.id,requestId:randomUUID(),expectedRevision:pending.draft.revision,receivedDevice:true,deviceCode:'GTB-DEVICE:coin-tea-01'});
  const protectedReward = rewardState(), currentClaim = get('SELECT * FROM claims WHERE id=?',issued.coupon.id);
  await bind(); assert.deepEqual(get('SELECT * FROM claims WHERE id=?',issued.coupon.id),currentClaim); assert.deepEqual(rewardState(),protectedReward);
  assert.equal(issued.coupon.reward,'old-coupon title'); assert.equal((await call('couponPreview',{code:issued.coupon.code})).coupon.reward,'old-coupon title');
  pass('Changing the device future reward preserves the already issued official coupon snapshot, growth ledger and both quotas');
  fixture(); const oldDraft = await call('nfcClaim',{taskId:'quest-tea',requestId:randomUUID(),location:fixtureLocation()},request()); await bind();
  await rejected('An old saved application cannot issue a newly bound reward without player revalidation',()=>call('merchantIssueClaim',{draftId:oldDraft.draft.id,requestId:randomUUID(),expectedRevision:1,receivedDevice:true,deviceCode:'GTB-DEVICE:coin-tea-01'}),409);
  const refreshed = await call('nfcDraftRevalidate',{draftId:oldDraft.draft.id,requestId:randomUUID(),expectedRevision:1,location:fixtureLocation()},request());
  assert.equal(refreshed.draft.reward,'new-coupon title'); assert.equal(get('SELECT COUNT(*) AS n FROM claims').n,0);
  pass('The actual deviceCouponBind action invalidates a saved reward snapshot until its owning player explicitly refreshes location');
  const {discountLabel}=load('lib/coupon-format.ts'); assert.equal(discountLabel(88),'8.8折'); assert.equal(discountLabel(88.12),'8.812折'); assert.equal(discountLabel(90),'9折');
  pass('Discount labels render 88/88.12 without binary floating-point tails');
  assert.equal(get('PRAGMA integrity_check').integrity_check,'ok'); assert.deepEqual(all('PRAGMA foreign_key_check'),[]);
  pass('All configuration and pending integration fixtures preserve integrity and foreign keys');
  console.log(JSON.stringify({status:'PASS',cases,database:':memory:',privateDatabaseWrites:0,cloudRequests:0,deviceWrites:0,realEmailsSent:0}));
} finally { close(); }
