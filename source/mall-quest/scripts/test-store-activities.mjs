import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import { root, reset, run, get, all, action, d1, sha, close } from './business-fixture.mjs';

// Real handlers and SQL, exclusively on disposable in-memory records/coordinates.
let cases = 0;
const pass = name => { console.log(`PASS ${++cases}: ${name}`); };
const reject = async (name, fn, status = 409) => { await assert.rejects(fn, e => e.status === status); pass(name); };
const location = () => ({ latitude: 31.23, longitude: 121.47, accuracy: 5, timestamp: Date.now() });
const fence = (storeId = 'tea', changes = {}, who = 'merchant') => action('geofenceSave', {
  storeId, enabled: true, latitude: 31.23, longitude: 121.47, radiusMeters: 150, expectedRevision: 0, ...changes,
}, who, who);
const input = changes => ({ storeId: 'tea', title: '本店有活动', description: '周末到店探索，了解活动详情。',
  startAt: Date.now() - 1000, endAt: Date.now() + 86400000, expectedRevision: 0, requestId: randomUUID(), ...changes });
const create = (value = input(), who = 'merchant') => action('storeActivitySave', value, who, who);
const list = (value = {}, who) => action('storeActivities', value, who || 'a', who);
const detail = (id, who = 'merchant') => action('storeActivityState', { manage: true, id }, who, who);
const review = (value, who = 'admin') => action('storeActivityReview', value, who, who);
const withdraw = (value, who = 'merchant') => action('storeActivityWithdraw', value, who, who);
const edit = (activity, changes = {}, who = 'merchant') => action('storeActivitySave', {
  id: activity.id, storeId: activity.storeId, title: activity.title, description: activity.description,
  startAt: activity.startAt, endAt: activity.endAt, expectedRevision: activity.revision, ...changes,
}, who, who);
const rewardSnapshot = () => sha(JSON.stringify(all("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT IN ('store_activities') ORDER BY name")
  .map(({ name }) => [name, all('SELECT * FROM ' + name + ' ORDER BY rowid')])));
async function race(match, mutate, operation) {
  const original = d1.prepare; let triggered = false;
  d1.prepare = sql => {
    const statement = original.call(d1, sql);
    if (match(sql)) {
      const execute = statement.run;
      statement.run = async () => { if (!triggered) { triggered = true; await mutate(sql); } return execute(); };
    }
    return statement;
  };
  try { await operation(); assert(triggered, 'test must intercept the actual write'); } finally { d1.prepare = original; }
}
try {
  const old = new DatabaseSync(':memory:');
  for (const file of readdirSync(path.join(root, 'drizzle')).filter(file => file.endsWith('.sql') && file < '0007').sort())
    old.exec(readFileSync(path.join(root, 'drizzle', file), 'utf8'));
  old.prepare('INSERT INTO players(id,nickname,created_at) VALUES(?,?,?)').run('historical', 'Historical', 1);
  const prior = JSON.stringify(old.prepare('SELECT * FROM players').all());
  old.exec(readFileSync(path.join(root, 'drizzle/0007_store_activities.sql'), 'utf8'));
  assert.equal(JSON.stringify(old.prepare('SELECT * FROM players').all()), prior);
  assert.equal(old.prepare('SELECT COUNT(*) AS n FROM store_activities').get().n, 0);
  assert.equal(old.prepare('PRAGMA integrity_check').get().integrity_check, 'ok'); old.close();
  pass('0007 preserves existing identities and creates no activity or invented location');

  reset(); const base = rewardSnapshot();
  const empty = await list(); assert.equal(empty.activities.length, 0); assert.equal(empty.fences.length, 0);
  assert.equal(rewardSnapshot(), base); assert.equal(get('SELECT COUNT(*) AS n FROM store_geofences').n, 0);
  pass('Unconfigured public activity reads are empty and do not seed coordinates or change business state');
  await reject('Player cannot read the management list', () => list({ manage: true }), 403);
  await reject('Player cannot publish an activity', () => action('storeActivitySave', input()), 403);
  await reject('Merchant cannot publish another store', () => create(input({ storeId: 'book' })), 403);
  await reject('Merchant cannot request another store management list', () => list({ manage: true, storeId: 'book' }, 'merchant'), 403);
  await reject('Save requires a configured enabled store fence', () => create());
  await fence();
  const beforeActivities = rewardSnapshot(), payload = input();
  let saved = (await create(payload)).activity;
  assert.equal(saved.status, 'pending'); assert.equal(saved.revision, 1); assert.equal(saved.authorId, 'merchant');
  assert.equal(saved.phase, 'active'); assert.equal(saved.fence.coordinateSystem, 'WGS84');
  assert.equal(saved.fence.latitude, 31.23); assert.equal(rewardSnapshot(), beforeActivities);
  pass('Merchant save persists a separate pending activity using the current store fence and no reward side effects');
  assert.equal((await list()).activities.length, 0);
  assert.equal((await detail(saved.id)).activity.id, saved.id);
  const lookup = await action('storeActivityState', { manage: true, storeId: 'tea', requestId: payload.requestId }, 'merchant', 'merchant');
  assert.equal(lookup.activity.id, saved.id);
  pass('Pending content remains private; exact request lookup resolves an uncertain create without pagination');
  const replay = await create(payload); assert.equal(replay.replayed, true); assert.equal(replay.activity.id, saved.id);
  assert.equal(get('SELECT COUNT(*) AS n FROM store_activities').n, 1); assert.equal(replay.activity.revision, 1);
  pass('Same creation request and payload replay the original record without a second activity');
  await reject('Reusing a creation request for changed content conflicts', () => create({ ...payload, title: '不同的活动内容' }));
  await reject('Merchant cannot approve its own activity', () => review({ id: saved.id, expectedRevision: 1, decision: 'publish' }, 'merchant'), 403);
  saved = (await review({ id: saved.id, expectedRevision: 1, decision: 'publish' })).activity;
  const publicActivity = (await list()).activities[0];
  assert.equal(publicActivity.id, saved.id); assert.equal(publicActivity.phase, 'active');
  for (const field of ['authorId', 'requestId', 'reviewNote', 'request_hash']) assert.equal(Object.hasOwn(publicActivity, field), false);
  assert.equal(rewardSnapshot(), beforeActivities);
  pass('Admin approval makes current activity public without author/request/review internals or reward writes');
  await reject('Second approval of an already processed record is rejected', () => review({ id: saved.id, expectedRevision: 1, decision: 'publish' }));
  saved = (await edit(saved, { title: '修改后的活动' })).activity;
  assert.equal(saved.status, 'pending'); assert.equal((await list()).activities.length, 0); assert.equal(saved.revision, 3);
  pass('Editing published content with review enabled removes public visibility and resubmits for approval');
  await reject('Stale editing revision cannot overwrite new content', () => edit(saved, { expectedRevision: 2, title: '不能覆盖的旧页面' }));
  await reject('Rejection requires a useful explanation', () => review({ id: saved.id, expectedRevision: 3, decision: 'reject', reviewNote: ' ' }), 400);
  saved = (await review({ id: saved.id, expectedRevision: 3, decision: 'reject', reviewNote: '请明确门店活动的参与方式' })).activity;
  assert.equal(saved.status, 'rejected'); assert.equal(saved.reviewNote, '请明确门店活动的参与方式');
  assert.equal((await list()).activities.length, 0);
  pass('Rejected activity stays private with a management-only reason');
  saved = (await edit(saved, { description: '已补充参与方式，请到店咨询。' })).activity;
  assert.equal(saved.status, 'pending'); assert.equal(saved.reviewNote, '');
  pass('A rejected activity can be corrected and submitted again without retaining an outdated review reason');
  saved = (await withdraw({ id: saved.id, expectedRevision: saved.revision })).activity;
  assert.equal(saved.status, 'offline'); assert.equal((await list()).activities.length, 0);
  const replayOffline = await withdraw({ id: saved.id, expectedRevision: saved.revision });
  assert.equal(replayOffline.replayed, true); assert.equal(replayOffline.activity.revision, saved.revision);
  pass('Merchant withdrawal accepts pending content; already offline current revision is a safe no-op');

  run("UPDATE game_settings SET ugc_review=0 WHERE id='main'");
  const future = (await create(input({ startAt: Date.now() + 3600000, endAt: Date.now() + 7200000 }))).activity;
  assert.equal(future.status, 'published'); assert.equal((await list()).activities.find(x => x.id === future.id).phase, 'upcoming');
  pass('Review disabled permits direct publication, and a future start is a visible preview');
  const current = (await edit(saved)).activity; assert.equal(current.status, 'published');
  const moved = await fence('tea', { expectedRevision: 1, latitude: 31.25, longitude: 121.49 });
  assert.equal((await list()).activities.find(x => x.id === current.id).fence.latitude, 31.25);
  assert.equal(get('SELECT latitude FROM store_geofences WHERE store_id=?', 'tea').latitude, moved.fence.latitude);
  pass('Published location follows the current configured fence rather than a stale saved map position');
  await fence('tea', { expectedRevision: 2, enabled: false });
  assert.equal((await list()).activities.length, 0); assert.equal((await detail(current.id)).activity.fence, null);
  await reject('Disabled fence blocks publication even when review is disabled', () => create());
  const withdrawnDisabled = await withdraw({ id: current.id, expectedRevision: current.revision });
  assert.equal(withdrawnDisabled.activity.status, 'offline');
  pass('Disabled fence hides public activities immediately but does not prevent merchant withdrawal');
  await fence('tea', { expectedRevision: 3 });
  run("UPDATE stores SET status='inactive' WHERE id='tea'");
  assert.equal((await list()).activities.length, 0);
  await reject('Inactive store cannot submit new activities', () => create());
  assert((await list({ manage: true }, 'merchant')).activities.length > 0);
  run("UPDATE stores SET status='active' WHERE id='tea'");
  pass('Inactive stores are hidden publicly while management history is retained');

  const validationCount = get('SELECT COUNT(*) AS n FROM store_activities').n;
  for (const [changes, label] of [[{ title: '' }, 'blank title'], [{ title: '字'.repeat(41) }, 'long title'],
    [{ description: '' }, 'blank description'], [{ description: '字'.repeat(501) }, 'long description'],
    [{ startAt: 'today' }, 'string date'], [{ endAt: Date.now() - 100 }, 'expired end'],
    [{ startAt: Date.now() + 10000, endAt: Date.now() + 9999 }, 'reversed times'],
    [{ startAt: Infinity }, 'non-finite date'], [{ endAt: 253402272000000 }, 'unsupported five-digit local year'], [{ expectedRevision: 1 }, 'invalid create revision'],
    [{ requestId: 'not-a-uuid' }, 'invalid creation identifier']]) {
    await assert.rejects(() => create(input(changes)), e => e.status === 400);
    assert.equal(get('SELECT COUNT(*) AS n FROM store_activities').n, validationCount);
    pass('Validation rejects ' + label + ' without inserting content');
  }
  run('UPDATE store_activities SET start_at=?,end_at=? WHERE id=?', Date.now() - 2000, Date.now() - 1000, future.id);
  assert(!(await list()).activities.some(x => x.id === future.id));
  assert.equal((await detail(future.id)).activity.phase, 'expired');
  assert((await list({ manage: true, filter: 'expired' }, 'merchant')).activities.some(x => x.id === future.id));
  pass('Expired content is excluded from public queries but has an explicit management phase/filter');
  run("UPDATE game_settings SET ugc_review=1 WHERE id='main'");
  const expiredPending = (await create()).activity;
  run('UPDATE store_activities SET start_at=?,end_at=? WHERE id=?', Date.now() - 2000, Date.now() - 1000, expiredPending.id);
  await reject('An expired pending activity cannot be approved', () => review({ id: expiredPending.id, expectedRevision: 1, decision: 'publish' }));

  await fence('book', {}, 'admin');
  const other = (await create(input({ storeId: 'book' }), 'admin')).activity;
  assert.equal((await detail(other.id)).activity, null);
  assert.equal((await list({ manage: true }, 'merchant')).activities.some(x => x.storeId === 'book'), false);
  await reject('Merchant cannot edit another store activity by forging its store identifier', () => edit(other, { storeId: 'tea' }), 404);
  await reject('Merchant cannot withdraw another store activity', () => withdraw({ id: other.id, expectedRevision: 1 }), 404);
  assert((await list({ manage: true, storeId: 'book' }, 'admin')).activities.every(x => x.storeId === 'book'));
  pass('Exact reads, paginated management lists and writes consistently enforce real merchant store scope');
  await reject('Public read cannot request pending management filter', () => list({ filter: 'pending' }), 400);
  await reject('Invalid pagination is rejected instead of expanding an unbounded query', () => list({ page: 0 }), 400);
  await reject('Public requestId lookup cannot expose creation internals', () => action('storeActivityState', { requestId: payload.requestId, storeId: 'tea' }), 403);

  reset(); await fence();
  await race(sql => sql.includes('INSERT INTO store_activities'), () => run("UPDATE game_settings SET ugc_review=1 WHERE id='main'"), async () => {
    run("UPDATE game_settings SET ugc_review=0 WHERE id='main'"); const result = await create(); assert.equal(result.activity.status, 'pending');
  }); pass('Atomic insert reads the latest review switch rather than trusting an earlier UI/server read');
  await race(sql => sql.includes('INSERT INTO store_activities'), () => run("UPDATE store_geofences SET enabled=0,revision=revision+1 WHERE store_id='tea'"),
    () => reject('Fence disabled between validation and insert prevents publication', () => create()));
  assert.equal(get('SELECT COUNT(*) AS n FROM store_activities').n, 1);

  reset(); await fence();
  await race(sql => sql.includes('INSERT INTO store_activities'), () => run("UPDATE players SET banned=1 WHERE id='merchant'"),
    () => reject('A merchant ban applied after validation is rechecked in the insert', () => create(), 403));
  assert.equal(get('SELECT COUNT(*) AS n FROM store_activities').n, 0);
  reset(); await fence();
  await race(sql => sql.includes('INSERT INTO store_activities'), () => run('UPDATE sessions SET expires_at=1 WHERE token_hash=?', sha('staff-merchant')),
    () => reject('Expired staff permission cannot insert after initial authentication', () => create(), 403));
  assert.equal(get('SELECT COUNT(*) AS n FROM store_activities').n, 0);
  reset(); await fence();
  await race(sql => sql.includes('INSERT INTO store_activities'), () => run('UPDATE sessions SET store_id=? WHERE token_hash=?', 'book', sha('staff-merchant')),
    () => reject('Reassigned merchant store cannot use stale permission to insert', () => create(),403));
  assert.equal(get('SELECT COUNT(*) AS n FROM store_activities').n, 0);

  reset(); await fence(); saved = (await create()).activity;
  await race(sql => sql.startsWith('UPDATE store_activities SET status='), () => run('UPDATE sessions SET role=?,store_id=? WHERE token_hash=?', 'merchant', 'tea', sha('staff-admin')),
    () => reject('Admin role revoked between read and approval is checked in the update', () => review({ id: saved.id, expectedRevision: 1, decision: 'publish' }),403));
  assert.equal(get('SELECT status FROM store_activities WHERE id=?', saved.id).status, 'pending');
  reset(); await fence(); saved = (await create()).activity;
  await race(sql => sql.startsWith('UPDATE store_activities SET status='), () => run("UPDATE store_geofences SET latitude=31.24,revision=revision+1 WHERE store_id='tea'"),
    () => reject('Fence center changed during approval invalidates the publication proof', () => review({ id: saved.id, expectedRevision: 1, decision: 'publish' })));
  assert.equal(get('SELECT status FROM store_activities WHERE id=?', saved.id).status, 'pending');
  await race(sql => sql.startsWith('UPDATE store_activities SET title='), () => run('UPDATE store_activities SET title=?,revision=revision+1 WHERE id=?', '另一个已保存的版本', saved.id),
    () => reject('Concurrent editing revision is atomically protected', () => edit(saved, { title: '旧版本想覆盖' })));
  assert.equal(get('SELECT title FROM store_activities WHERE id=?', saved.id).title, '另一个已保存的版本');

  reset(); await fence(); const simultaneous = input(); let winner;
  await race(sql => sql.includes('INSERT INTO store_activities'), async () => { winner = await create(simultaneous); }, async () => {
    const loser = await create(simultaneous); assert.equal(loser.replayed, true); assert.equal(loser.activity.id, winner.activity.id);
  });
  assert.equal(get('SELECT COUNT(*) AS n FROM store_activities').n, 1);
  pass('Two interleaved real creation handlers with the same request converge through the unique SQL constraint');
  const editedWinner = (await edit(winner.activity, { title: '原活动后续修改' })).activity;
  const originalRetry = await create(simultaneous);
  assert.equal(originalRetry.replayed, true); assert.equal(originalRetry.activity.id, editedWinner.id);
  assert.equal(originalRetry.activity.title, '原活动后续修改'); assert.equal(originalRetry.activity.revision, 2);
  pass('Replaying an original create after later edits returns current state without restoring old content');
  await race(sql => sql.startsWith('UPDATE store_activities SET title='), () => run("UPDATE game_settings SET ugc_review=1 WHERE id='main'"), async () => {
    run("UPDATE game_settings SET ugc_review=0 WHERE id='main'");
    const latest = await edit(editedWinner); assert.equal(latest.activity.status, 'pending');
  }); pass('Editing also applies a review switch enabled during the atomic write');
  saved = (await detail(editedWinner.id)).activity;
  await race(sql => sql.startsWith('UPDATE store_activities SET title='), () => run("UPDATE store_geofences SET enabled=0,revision=revision+1 WHERE store_id='tea'"),
    () => reject('Disabling the fence during an edit prevents a new submission', () => edit(saved)));
  await reject('Pending approval requires an enabled fence even after initial submission', () => review({ id: saved.id, expectedRevision: saved.revision, decision: 'publish' }));
  await fence('tea', { expectedRevision: 2 });
  await race(sql => sql.startsWith('UPDATE store_activities SET status='), () => run('UPDATE store_activities SET start_at=?,end_at=? WHERE id=?', Date.now() - 2000, Date.now() - 1000, saved.id),
    () => reject('Expiry between review validation and update cannot publish an expired record', () => review({ id: saved.id, expectedRevision: saved.revision, decision: 'publish' })));
  assert.equal(get('SELECT status FROM store_activities WHERE id=?', saved.id).status, 'pending');

  reset(); await fence(); saved = (await create()).activity;
  saved = (await review({ id: saved.id, expectedRevision: 1, decision: 'publish' })).activity;
  assert.equal((await list()).activities.length, 1);
  saved = (await review({ id: saved.id, expectedRevision: saved.revision, decision: 'offline', reviewNote: '运营暂时下架' })).activity;
  assert.equal(saved.status, 'offline'); assert.equal(saved.reviewNote, '运营暂时下架'); assert.equal((await list()).activities.length, 0);
  assert.equal((await action('storeActivityState', { id: saved.id })).activity, null);
  pass('Admin takedown removes both public list and exact public detail while retaining a management record');
  await reject('Ops offline cannot be applied repeatedly to an offline record', () => review({ id: saved.id, expectedRevision: saved.revision, decision: 'offline' }));
  await race(sql => sql.startsWith('UPDATE store_activities SET title='), () => run("UPDATE players SET banned=1 WHERE id='merchant'"),
    () => reject('An actor ban between edit authentication and its update is enforced in SQL', () => edit(saved), 403));
  assert.equal(get('SELECT status FROM store_activities WHERE id=?', saved.id).status, 'offline');

  reset(); await fence(); const stable = rewardSnapshot();
  for (let i = 0; i < 23; i++) await create(input({ title: '分页活动 ' + i }));
  const first = await list({ manage: true, page: 1 }, 'merchant'), second = await list({ manage: true, page: 2 }, 'merchant');
  assert.equal(first.activities.length, 20); assert.equal(second.activities.length, 3); assert.equal(first.pagination.total, 23);
  assert.equal(first.pagination.totalPages, 2); assert.equal(new Set([...first.activities, ...second.activities].map(x => x.id)).size, 23);
  assert.equal(rewardSnapshot(), stable);
  pass('Fixed pagination returns every independent record once without changing task/points/stock/device tables');
  await reject('An activity cannot act as a task to confirm a coin', () => action('coinCheckIn', { taskId: first.activities[0].id, location: location() }), 409);
  await reject('Existing task still rejects missing GPS even when its store has activities', () => action('coinCheckIn', { taskId: 'quest-tea' }), 400);
  await reject('Activities do not bypass GPS requirements for a direct reward API', () => action('claim', { taskId: 'quest-tea', answer: '茉莉' }), 400);
  assert.equal(get('SELECT COUNT(*) AS n FROM claims').n, 0); assert.equal(rewardSnapshot(), stable);
  pass('Announcement creation never grants a check-in, claim, ledger credit, coupon or inventory change');

  reset(); run('DROP TABLE store_activities');
  await reject('Missing 0007 table produces a closed public read error instead of silently returning empty activities', () => list(), 503);
  await reject('Missing 0007 table closes management reads with a clear unavailable response', () => list({ manage: true }, 'merchant'), 503);
  reset();
  for (const [column, value] of [['title', ''], ['description', '字'.repeat(501)], ['status', 'approved'], ['revision', 0]]) {
    const sample = input(), fields = { id: randomUUID(), event_id: 'mall-48h', store_id: 'tea', author_id: 'merchant', request_id: randomUUID(),
      request_hash: 'test-only', title: sample.title, description: sample.description, start_at: sample.startAt, end_at: sample.endAt,
      status: 'pending', revision: 1, created_at: Date.now(), updated_at: Date.now(), [column]: value };
    assert.throws(() => run(`INSERT INTO store_activities(${Object.keys(fields).join(',')}) VALUES(${Object.keys(fields).map(() => '?').join(',')})`, ...Object.values(fields)));
  } pass('Database constraints reject malformed status, empty/oversized text and invalid revisions even below the API');
  assert.equal(get('PRAGMA integrity_check').integrity_check, 'ok');

  const apiModule = { exports: {} }; let mockedTransports = 0;
  const apiSource = ts.transpileModule(readFileSync(path.join(root, 'lib/game-api.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(apiSource, { module: apiModule, exports: apiModule.exports, setTimeout, clearTimeout,
    AbortController, navigator: { onLine: true }, Response, fetch: async () => {
      mockedTransports++; return Response.json({ error: { message: 'Isolated unavailable transport' } }, { status: 503 });
    }, console }, { filename: 'lib/game-api.ts (isolated transport)' });
  for (const name of ['storeActivities', 'storeActivityState'])
    await assert.rejects(() => apiModule.exports.request(name), e => e.status === 503 && e.resultUncertain === false);
  for (const name of ['storeActivitySave', 'storeActivityWithdraw', 'storeActivityReview'])
    await assert.rejects(() => apiModule.exports.request(name), e => e.status === 503 && e.resultUncertain === true);
  assert.equal(mockedTransports, 5);
  pass('Actual API transport classifies the two read actions as safe reads and all three writes as uncertain without automatic retries');
  console.log(JSON.stringify({ status: 'PASS', cases, isolatedDatabase: ':memory:', persistentD1Opened: false, networkRequests: 0,
    realGeolocationUsed: false, serialAccess: false, newMigration: '0007_store_activities', businessTables: 22, activityMigrationBaselineTables: 20 }));
} finally { close(); }
