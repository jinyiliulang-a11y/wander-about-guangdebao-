import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { root, reset, run, get, all, load, request, environment, d1, close } from './business-fixture.mjs';

// Every coordinate, user and reward is disposable. No real location, database,
// hardware credential or external service is accessed by this suite.
const geo = load('lib/geofence.ts'), server = load('lib/game-server.ts'), service = load('lib/geofence-server.ts');
let cases = 0;
const pass = name => { cases++; console.log(`PASS ${cases}: ${name}`); };
const loc = (changes = {}) => ({ latitude: 31.23, longitude: 121.47, accuracy: 5, timestamp: Date.now(), ...changes });
const fence = (changes = {}) => ({ storeId: 'tea', storeName: 'Fixture tea', enabled: true,
  latitude: 31.23, longitude: 121.47, radiusMeters: 150, revision: 1, updatedAt: Date.now(), coordinateSystem: 'WGS84', ...changes });
const call = (action, input = {}, player = 'a', staff) => server.execute(request(player, staff), { action, ...input });
const save = (storeId = 'tea', changes = {}, player = 'merchant', staff = 'merchant') => call('geofenceSave', {
  storeId, enabled: true, latitude: 31.23, longitude: 121.47, radiusMeters: 150, expectedRevision: 0, ...changes,
}, player, staff);
const confirm = location => call('coinCheckIn', { taskId: 'quest-tea', location });
const claim = (location, changes = {}, player = 'a') => call('claim', { taskId: 'quest-tea', answer: '茉莉', location, ...changes }, player);
const reject = async (name, fn, reason, status = 409) => {
  await assert.rejects(fn, e => e.status === status && (reason === undefined || e.reason === reason)); pass(name);
};
const snapshot = () => JSON.stringify(all("SELECT * FROM claims ORDER BY id"));
try {
  const legacy = new DatabaseSync(':memory:');
  for (const file of readdirSync(path.join(root, 'drizzle')).filter(f => f.endsWith('.sql') && f < '0006').sort())
    legacy.exec(readFileSync(path.join(root, 'drizzle', file), 'utf8'));
  legacy.prepare('INSERT INTO players(id,nickname,created_at) VALUES(?,?,?)').run('old', 'Old identity', 1);
  const old = JSON.stringify(legacy.prepare('SELECT * FROM players').all());
  legacy.exec(readFileSync(path.join(root, 'drizzle/0006_store_geofences.sql'), 'utf8'));
  assert.equal(JSON.stringify(legacy.prepare('SELECT * FROM players').all()), old);
  assert.equal(legacy.prepare('SELECT COUNT(*) AS n FROM store_geofences').get().n, 0);
  assert.equal(legacy.prepare('PRAGMA integrity_check').get().integrity_check, 'ok'); legacy.close();
  pass('Migration preserves identities, starts an empty fence table and invents no GPS center');

  const now = Date.now(), sample = loc({ timestamp: now });
  for (const [value, reason] of [[null, 'not-configured'], [fence({ revision: 0 }), 'not-configured'],
    [fence({ enabled: false }), 'disabled'], [fence({ latitude: 91 }), 'invalid-config'],
    [fence({ coordinateSystem: 'GCJ02' }), 'invalid-config']]) {
    const check = geo.checkGeofence(value, sample, now); assert.equal(check.reason, reason); assert.equal(check.inside, false);
  }
  pass('Missing, disabled, out-of-range or mixed-coordinate-system fences never pass');
  for (const location of [null, {}, [], { ...sample, latitude: '31.23' }, { ...sample, longitude: NaN },
    { ...sample, accuracy: -1 }, { ...sample, accuracy: Infinity }, { ...sample, timestamp: null }])
    assert.equal(geo.checkGeofence(fence(), location, now).inside, false);
  assert.equal(geo.checkGeofence(fence(), loc({ timestamp: now - 30001 }), now).reason, 'stale-location');
  assert.equal(geo.checkGeofence(fence(), loc({ timestamp: now + 5001 }), now).reason, 'stale-location');
  pass('GPS fields, finite values, precision sign and timestamp boundaries are validated');
  assert.equal(geo.checkGeofence(fence(), sample, now).reason, 'inside');
  assert.equal(geo.checkGeofence(fence(), { ...sample, latitude: 31.24 }, now).reason, 'outside');
  assert.equal(geo.checkGeofence(fence(), { ...sample, accuracy: 151 }, now).reason, 'uncertain');
  const edge = loc({ latitude: 31.2313, accuracy: 20, timestamp: now });
  assert.equal(geo.checkGeofence(fence(), edge, now).reason, 'uncertain');
  assert(geo.distanceMeters({ latitude: 0, longitude: 179.999 }, { latitude: 0, longitude: -179.999 }) < 250);
  pass('Haversine handles wraparound and conservative accuracy disk rejects boundary overlaps');

  reset(); const beforeRead = snapshot();
  const configs = await call('geofenceState'); assert.equal(configs.fences.length, 3);
  assert(configs.fences.every(x => !x.enabled && x.revision === 0 && x.latitude === null));
  assert.equal(snapshot(), beforeRead); assert.equal(get('SELECT COUNT(*) AS n FROM store_geofences').n, 0);
  await reject('Unconfigured confirmation fails closed', () => confirm(loc()), 'not-configured');
  await reject('Unconfigured coupon reward fails closed', () => claim(loc()), 'not-configured');
  run("UPDATE tasks SET reward_type='points' WHERE id='quest-tea'");
  await reject('Unconfigured point reward fails closed', () => claim(loc()), 'not-configured');
  assert.equal(snapshot(), beforeRead);
  pass('Public configuration reads neither seed coordinates nor issue rewards');

  await reject('Player cannot save merchant configuration', () => call('geofenceSave', {storeId:'tea'}, 'a'), undefined, 403);
  await reject('Merchant cannot configure another store', () => save('book'), undefined, 403);
  for (const changes of [{ latitude: '31.23' }, { latitude: 91 }, { longitude: -181 },
    { radiusMeters: 19 }, { radiusMeters: 5001 }, { latitude: null, longitude: null, radiusMeters: null },
    { expectedRevision: -1 }, { expectedRevision: 0.5 }, { enabled: 'true' }])
    await assert.rejects(() => save('tea', changes), e => e.status === 400);
  pass('Saved configuration validates types, real coordinate ranges, radius and CAS version');
  let saved = await save(); assert.equal(saved.fence.revision, 1); assert.equal(saved.fence.coordinateSystem, 'WGS84');
  await save('book', {}, 'admin', 'admin');
  await reject('Stale configuration cannot overwrite an existing fence', () => save(), 'config-changed');
  const updates = await Promise.allSettled([save('tea', { expectedRevision: 1, radiusMeters: 200 }),
    save('tea', { expectedRevision: 1, radiusMeters: 300 })]);
  assert.equal(updates.filter(x => x.status === 'fulfilled').length, 1);
  assert.equal((await call('geofenceState', { storeId: 'tea' })).fences[0].revision, 2);
  pass('Own-store/admin saves work and concurrent stale edits accept exactly one revision');
  const configuredRadius = (await call('geofenceState', {storeId:'tea'})).fences[0].radiusMeters;
  const boundaryLocation = loc({ latitude: 31.23 + configuredRadius / 111_195, accuracy: 30 });

  for (const [location, reason, status] of [[undefined, 'location-required', 400], [{ latitude: 31.23 }, 'invalid-location', 400],
    [loc({ timestamp: Date.now() - 31000 }), 'stale-location', 409], [loc({ timestamp: Date.now() + 6000 }), 'stale-location', 409],
    [loc({ accuracy: 500 }), 'uncertain', 409], [boundaryLocation, 'uncertain', 409], [loc({ latitude: 31.25 }), 'outside', 409]]) {
    const before = snapshot();
    await reject(`Confirmation rejects ${reason}`, () => confirm(location), reason, status);
    await reject(`Direct claim rejects ${reason}`, () => claim(location), reason, status);
    assert.equal(snapshot(), before);
  }
  assert.equal((await confirm(loc())).storeId, 'tea');
  const points = await claim(loc()); assert.equal(points.newlyIssued, true); assert.equal(points.coupon.rewardType, 'points');
  const oldClaims = snapshot();
  await reject('Previously confirmed visitor must supply fresh position when claiming again', () => claim(undefined), 'location-required', 400);
  await reject('Previously issued reward cannot bypass current outside check', () => claim(loc({ latitude: 31.25 })), 'outside');
  const repeated = await claim(loc()); assert.equal(repeated.newlyIssued, false); assert.equal(repeated.coupon.id, points.coupon.id);
  assert.equal(snapshot(), oldClaims);
  pass('Confirm/points issue/inside replay preserve quota while replay still requires current fence validation');
  run("UPDATE tasks SET reward_type='coupon' WHERE id='quest-tea'");
  const coupon = await claim(loc(), {}, 'b'); assert.equal(coupon.newlyIssued, true); assert.equal(coupon.coupon.rewardType, 'coupon');
  assert.equal((await server.state(request('b'), 'b')).coupons[0].id, coupon.coupon.id);
  saved = await save('tea', { expectedRevision: 2, enabled: false });
  await reject('Disabled fence suspends coin confirmation', () => confirm(loc()), 'disabled');
  await reject('Disabled fence suspends even claim replay', () => claim(loc()), 'disabled');
  assert((await server.state(request('b'), 'b')).coupons.some(x => x.id === coupon.coupon.id));
  pass('Coupon issuance works inside and historical wallet reads survive fence suspension');

  reset(); await save();
  for (const [sql, reason] of [["UPDATE store_geofences SET revision=revision+1", 'config-changed'],
    ["UPDATE store_geofences SET enabled=0,revision=revision+1", 'disabled']]) {
    run('UPDATE store_geofences SET enabled=1');
    const prepare = d1.prepare; let guarded = false;
    d1.prepare = query => { const stmt = prepare(query); if (/^\s*INSERT INTO claims/i.test(query)) {
      const write = stmt.run; stmt.run = async () => { guarded = true; run(sql); return write(); };
    } return stmt; };
    try {
      await reject('Atomic reward guard refuses fence state changed after initial validation', () => claim(loc()), reason);
      assert(guarded); assert.equal(get('SELECT COUNT(*) AS n FROM claims').n, 0);
      assert.equal(get("SELECT COUNT(*) AS n FROM points_ledger WHERE kind='claim'").n, 0);
    } finally { d1.prepare = prepare; }
  }
  reset(); await save();
  const concurrent = await Promise.all([claim(loc()), claim(loc())]);
  assert.equal(concurrent.filter(x => x.newlyIssued).length, 1); assert.equal(get('SELECT COUNT(*) AS n FROM claims').n, 1);
  pass('Concurrent valid claims still issue one coupon and one reward ledger entry');

  reset(); await save();
  const oldPrepare = d1.prepare, oldNow = Date.now, future = oldNow() + 31_000;
  let queued = false;
  d1.prepare = query => {
    const award = /^\s*INSERT INTO claims/i.test(query);
    const stmt = oldPrepare(award ? query.replaceAll("CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)", String(future)) : query);
    if (award) { const write = stmt.run; stmt.run = async () => { queued = true; Date.now = () => future; return write(); }; }
    return stmt;
  };
  try {
    await reject('Claim queued beyond position expiry cannot award a reward', () => claim(loc()), 'stale-location');
    assert(queued); assert.equal(get('SELECT COUNT(*) AS n FROM claims').n, 0);
  } finally { d1.prepare = oldPrepare; Date.now = oldNow; }

  for (const change of ["DELETE FROM sessions WHERE role='merchant'", "UPDATE players SET banned=1 WHERE id='merchant'"]) {
    reset(); const prepare = d1.prepare;
    d1.prepare = query => { const stmt = prepare(query); if (/^\s*INSERT INTO store_geofences/i.test(query)) {
      const write = stmt.run; stmt.run = async () => { run(change); return write(); };
    } return stmt; };
    try {
      await reject('Revoked merchant permission is checked atomically at configuration save', () => save(), undefined, 403);
      assert.equal(get('SELECT COUNT(*) AS n FROM store_geofences').n, 0);
    } finally { d1.prepare = prepare; }
  }

  const previousDb = environment.DB;
  environment.DB = { ...d1, prepare(query) { if (query.includes('store_geofences')) throw new Error('no such table: store_geofences'); return d1.prepare(query); } };
  try {
    await reject('Missing migration does not degrade to open access', () => confirm(loc()), 'service-unavailable', 503);
    await reject('Missing migration also blocks direct reward claims', () => claim(loc(), {}, 'c'), 'service-unavailable', 503);
    await reject('Configuration read reports missing service clearly', () => service.readGeofences(), 'service-unavailable', 503);
  } finally { environment.DB = previousDb; }
  reset(); await save();
  const api = load('app/api/game/route.ts');
  const response = await api.POST(new Request('http://isolated.test/api/game', {
    method: 'POST', headers: { Cookie: 'mall_player=player-a', 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'coinCheckIn', taskId: 'quest-tea' }),
  }));
  assert.equal(response.status, 400); assert.equal((await response.json()).error.reason, 'location-required');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  pass('Public API exposes typed geofence rejection without location or credential logging');
  console.log(`All ${cases} isolated geofence checks passed.`);
} finally { close(); }
