import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { root, reset, run, get, all, load, request, d1, sha, close } from './business-fixture.mjs';

let cases = 0;
const pass = label => console.log(`PASS ${++cases}: ${label}`);
const form = patch => ({ name: '', logo: '🏪', category: '', floor: '', address: '', phone: '', imageURL: '', artwork: 0, expectedImageRevision: 0, ...patch });
const actor = (id = 'merchant') => { const base = request(id, id), headers = new Headers(base.headers); headers.set('X-Mall-Quest-Player', id); return new Request(base.url, { headers }); };
const call = (action, input = {}, req = actor()) => load('lib/game-server.ts').execute(req, { action, ...input });
const read = req => call('merchantProfileDraftGet', {}, req);
const save = (draft = form(), expectedRevision = 0, requestId = randomUUID(), req = actor()) => call('merchantProfileDraftSave', { draft, expectedRevision, requestId }, req);
const clear = (expectedRevision, requestId = randomUUID(), req = actor()) => call('merchantProfileDraftDelete', { expectedRevision, requestId }, req);
const drafts = () => all('SELECT * FROM merchant_profile_drafts ORDER BY event_id,account_id,store_id');
const protectedState = () => Object.fromEntries(all("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name<>'merchant_profile_drafts' ORDER BY name")
  .map(({ name }) => [name, all(`SELECT * FROM ${name} ORDER BY rowid`)]));
const denied = async (label, operation, status = 400) => { await assert.rejects(operation, error => error.status === status); pass(label); };
async function race(change, operation, before = true) {
  const prepare = d1.prepare; let fired = false, afterChange;
  d1.prepare = sql => {
    const statement = prepare(sql);
    if (sql.startsWith('INSERT INTO merchant_profile_drafts')) {
      const original = statement.run;
      statement.run = async () => { if (!fired && before) { fired = true; change(); afterChange = drafts(); } const result = await original(); if (!fired && !before) { fired = true; change(); afterChange = drafts(); } return result; };
    }
    return statement;
  };
  try { const value = await operation(); return value; }
  finally { d1.prepare = prepare; assert(fired, 'must intercept the real draft mutation'); if (before) assert.deepEqual(drafts(), afterChange, 'a failed operation must not overwrite concurrent draft data'); }
}
async function readRace(change, operation, after = false) {
  const prepare = d1.prepare; let fired = false;
  d1.prepare = sql => {
    const statement = prepare(sql);
    if (sql.startsWith('SELECT d.revision,d.draft_json')) {
      const original = statement.first;
      statement.first = async () => { if (!after && !fired) { fired = true; change(); } const value = await original(); if (after && !fired) { fired = true; change(); } return value; };
    }
    return statement;
  };
  try { await operation(); assert(fired); } finally { d1.prepare = prepare; }
}
function anotherMerchant(storeId = 'tea') {
  run("UPDATE accounts SET role='merchant',store_id=?,merchant_json='{}' WHERE id='fixture-b'", storeId);
  run("INSERT INTO sessions(token_hash,role,player_id,store_id,expires_at,account_id) VALUES(?,'merchant','b',?,?,'fixture-b')", sha('staff-b'), storeId, Date.now() + 86400000);
}
try {
  const old = new DatabaseSync(':memory:');
  for (const name of readdirSync(path.join(root, 'drizzle')).filter(name => name.endsWith('.sql') && name < '0015').sort()) old.exec(readFileSync(path.join(root, 'drizzle', name), 'utf8'));
  old.prepare('INSERT INTO players(id,nickname,created_at) VALUES(?,?,?)').run('retained-player', 'Existing migration identity', 123);
  const originalTables = old.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
  const previous = originalTables.map(({ name }) => [name, old.prepare(`SELECT * FROM ${name} ORDER BY rowid`).all()]);
  assert.equal(originalTables.length, 27); old.exec(readFileSync(path.join(root, 'drizzle/0015_merchant_profile_drafts.sql'), 'utf8'));
  assert.deepEqual(originalTables.map(({ name }) => [name, old.prepare(`SELECT * FROM ${name} ORDER BY rowid`).all()]), previous);
  assert.equal(old.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").get().n, 28);
  assert.equal(old.prepare('SELECT COUNT(*) AS n FROM merchant_profile_drafts').get().n, 0);
  assert.equal(old.prepare('PRAGMA integrity_check').get().integrity_check, 'ok'); assert.deepEqual(old.prepare('PRAGMA foreign_key_check').all(), []); old.close();
  pass('0015 adds one empty draft table to the 27-table migration chain without altering any original row');

  reset(); const beforeGet = protectedState(), initial = await read();
  assert.deepEqual(JSON.parse(JSON.stringify(initial)), { storeId: 'tea', revision: 0, updatedAt: null, draft: null, lastRequestId: null });
  assert.equal(drafts().length, 0); assert.deepEqual(protectedState(), beforeGet);
  pass('Actual dispatcher reads absent draft as revision zero with no write or private hash');
  const partial = form({ name: '  未完成 ', address: '半', phone: '+(', floor: '' }), id = randomUUID(), protectedBefore = protectedState();
  const saved = await save(partial, 0, id); assert.equal(saved.revision, 1); assert.equal(saved.lastRequestId, id);
  assert.deepEqual(JSON.parse(JSON.stringify(saved.draft)), partial); assert.deepEqual(JSON.parse(JSON.stringify((await read()).draft)), partial); assert.deepEqual(protectedState(), protectedBefore);
  assert.equal(JSON.stringify(saved).includes('last_request_hash'), false); assert.equal(JSON.stringify(saved).includes('account_id'), false);
  pass('Incomplete raw strings and exact whitespace round-trip while every official profile/reward/account row stays unchanged');
  const replayBefore = drafts(); const replay = await save(partial, 0, id); assert.equal(replay.revision, 1); assert.deepEqual(drafts(), replayBefore);
  pass('Same UUID and frozen form recover a saved response without a second revision or timestamp write');
  await denied('Same UUID cannot change its contents', () => save(form({ name: 'different' }), 0, id), 409);
  await denied('Same UUID cannot change its original expected version', () => save(partial, 1, id), 409);
  await denied('Stale expected version cannot overwrite another save', () => save(form(), 0), 409);
  const deletionId = randomUUID(), deleted = await clear(1, deletionId); assert.equal(deleted.revision, 2); assert.equal(deleted.draft, null); assert.equal(deleted.lastRequestId, deletionId);
  assert.equal(get('SELECT draft_json FROM merchant_profile_drafts').draft_json, null); const deletedBefore = drafts(); assert.equal((await clear(1, deletionId)).revision, 2); assert.deepEqual(drafts(), deletedBefore);
  pass('Delete keeps a versioned null tombstone and exact request replay is read-only');
  await denied('An old save cannot resurrect a deleted draft', () => save(partial, 0, id), 409);
  await save(form({ name: 'new draft after deletion' }), 2); const newBefore = drafts();
  await denied('A delayed old clear cannot remove the new draft', () => clear(1, deletionId), 409); assert.deepEqual(drafts(), newBefore);
  reset(); const emptyDelete = await clear(0); assert.equal(emptyDelete.revision, 1); assert.equal(emptyDelete.draft, null); assert.equal(drafts().length, 1);
  pass('Deleting an initially absent draft still preserves a tombstone to reject delayed revision-zero saves');

  reset(); anotherMerchant(); await save(form({ name: 'owner merchant only' })); const otherRead = await read(actor('b')); assert.equal(otherRead.draft, null); assert.equal(otherRead.revision, 0);
  await save(form({ name: 'second account only' }), 0, randomUUID(), actor('b')); assert.equal((await read()).draft.name, 'owner merchant only'); assert.equal((await read(actor('b'))).draft.name, 'second account only');
  await clear(1, randomUUID(), actor('b')); assert.equal((await read()).draft.name, 'owner merchant only');
  pass('Two approved merchant accounts at the same store have independent drafts and cannot read/delete each other');
  reset(); anotherMerchant('book'); await save(form({ name: 'tea only' })); await save(form({ name: 'book only' }), 0, randomUUID(), actor('b'));
  assert.equal((await read()).storeId, 'tea'); assert.equal((await read(actor('b'))).storeId, 'book');
  pass('Different approved merchant stores remain isolated even under the same event');
  const row = drafts()[0]; run(`INSERT INTO merchant_profile_drafts(event_id,account_id,store_id,revision,draft_json,created_at,updated_at,last_request_id,last_request_hash)
    VALUES(?,?,?,?,?,?,?,?,?)`, 'other-event', 'fixture-merchant', 'tea', 9, row.draft_json, Date.now(), Date.now(), randomUUID(), 'f'.repeat(64));
  const foreign = get("SELECT * FROM merchant_profile_drafts WHERE event_id='other-event'"); await clear(1); assert.deepEqual(get("SELECT * FROM merchant_profile_drafts WHERE event_id='other-event'"), foreign);
  pass('Reading and clearing current event data cannot modify a preserved draft from a different event');
  for (const [label, req, status] of [['player', request(), 403], ['operator', actor('admin'), 403], ['missing session', new Request('http://localhost/api/game'), 401]]) {
    reset(); const stable = drafts(); await denied(`${label} cannot read merchant profile drafts`, () => read(req), status); await denied(`${label} cannot save merchant profile drafts`, () => save(form(), 0, randomUUID(), req), status); assert.deepEqual(drafts(), stable);
  }
  reset(); const mismatch = new Request('http://localhost/api/game', { headers: { Cookie: actor().headers.get('cookie'), 'X-Mall-Quest-Player': 'b' } });
  await denied('A stale page player snapshot cannot read a different merchant actor', () => read(mismatch), 409);
  await denied('A stale page player snapshot cannot write a different merchant actor', () => save(form(), 0, randomUUID(), mismatch), 409);
  for (const field of ['storeId', 'accountId', 'eventId']) { await denied(`Request ${field} cannot override the authenticated draft scope`, () => call('merchantProfileDraftSave', { draft: form(), requestId: randomUUID(), expectedRevision: 0, [field]: 'foreign' })); }
  assert.equal(drafts().length, 0);

  for (const [label, change, status] of [
    ['pending merchant approval', () => run("UPDATE accounts SET status='pending' WHERE id='fixture-merchant'"), 401],
    ['banned merchant', () => run("UPDATE players SET banned=1 WHERE id='merchant'"), 401],
    ['expired merchant session', () => run('UPDATE sessions SET expires_at=0 WHERE token_hash=?', sha('staff-merchant')), 403],
    ['merchant store outside the current event', () => run("UPDATE stores SET event_id='other-event' WHERE id='tea'"), 403],
  ]) { reset(); change(); await denied(`${label} cannot access drafts`, () => read(), status); assert.equal(drafts().length, 0); }

  reset(); run("UPDATE stores SET logo='  historical custom glyph  ' WHERE id='tea'"); const legacy = form({ logo: '  historical custom glyph  ' }), legacyId = randomUUID(); await save(legacy, 0, legacyId);
  assert.equal((await read()).draft.logo, legacy.logo); run("UPDATE stores SET logo='🍵' WHERE id='tea'"); const legacyReplay = await save(legacy, 0, legacyId); assert.equal(legacyReplay.revision, 1);
  assert.equal((await read()).draft.logo, legacy.logo); await denied('A new save cannot replace the current icon with a now-obsolete historical custom icon', () => save(legacy, 1));
  await clear(1); assert.equal((await read()).draft, null);
  pass('A previously legal legacy icon stays readable/replayable/deletable after formal icon edits, but cannot be newly saved as a changed custom value');
  for (const logo of ['free text', '<script>bad</script>', '🦖', '🏪🏪']) { reset(); await denied('New draft icons must belong to the shared preset catalog or exactly preserve the current legacy icon', () => save(form({ logo }))); assert.equal(drafts().length, 0); }
  reset(); run("UPDATE stores SET logo='legacy one' WHERE id='tea'");
  await denied('Final save cannot restore a legacy icon changed after validation', () => race(() => run("UPDATE stores SET logo='legacy two' WHERE id='tea'"), () => save(form({ logo: 'legacy one' }))), 409);
  assert.equal(drafts().length, 0);

  const png = 'data:image/png;base64,' + readFileSync(new URL('./fixtures/store-images/png.png', import.meta.url)).toString('base64');
  reset(); const imageBefore = protectedState(); await save(form({ imageURL: png, expectedImageRevision: 7, artwork: 2 }));
  assert.equal((await read()).draft.imageURL, png); assert.equal((await read()).draft.expectedImageRevision, 7); assert.deepEqual(protectedState(), imageBefore);
  pass('One verified bounded picture and its original image revision are stored only in the draft, without altering the formal image');
  const badForms = [
    ['name length', form({ name: 'x'.repeat(41) })], ['category length', form({ category: 'x'.repeat(31) })],
    ['floor length', form({ floor: 'x'.repeat(11) })], ['address length', form({ address: 'x'.repeat(121) })],
    ['phone length', form({ phone: 'x'.repeat(25) })], ['nonstring name', form({ name: 1 })],
    ['external image URL', form({ imageURL: 'https://x.example/image.png' })], ['SVG image', form({ imageURL: 'data:image/svg+xml;base64,PHN2Zz4=' })],
    ['fake PNG content', form({ imageURL: 'data:image/png;base64,aW1hZ2U=' })], ['multiple images', form({ imageURL: [png, png] })],
    ['invalid artwork', form({ artwork: 3 })], ['fractional image revision', form({ expectedImageRevision: 1.5 })],
    ['unrecognized form field', { ...form(), latitude: 31.23 }], ['missing field', { ...form(), imageURL: undefined }],
  ];
  for (const [label, value] of badForms) { reset(); await denied(`Draft rejects ${label}`, () => save(value)); assert.equal(drafts().length, 0); }
  reset(); await denied('Draft requires a UUID request identifier', () => save(form(), 0, 'not-a-UUID'));
  await denied('Draft rejects negative expected version', () => save(form(), -1));
  await denied('Delete cannot include an unrelated replacement form', () => call('merchantProfileDraftDelete', { expectedRevision: 0, requestId: randomUUID(), draft: form() }));

  for (const [label, change] of [
    ['approval revoked', () => run("UPDATE accounts SET status='rejected' WHERE id='fixture-merchant'")],
    ['merchant banned', () => run("UPDATE players SET banned=1 WHERE id='merchant'")],
    ['session deleted', () => run('DELETE FROM sessions WHERE token_hash=?', sha('staff-merchant'))],
    ['session expired', () => run('UPDATE sessions SET expires_at=0 WHERE token_hash=?', sha('staff-merchant'))],
    ['role promoted to operator', () => run("UPDATE accounts SET role='admin',store_id=NULL,merchant_json=NULL WHERE id='fixture-merchant'")],
    ['store reassigned', () => run("UPDATE accounts SET store_id='book' WHERE id='fixture-merchant'")],
    ['store event changed', () => run("UPDATE stores SET event_id='other-event' WHERE id='tea'")],
  ]) for (const deleting of [false, true]) {
    reset(); if (deleting) await save(form());
    await denied(`Final atomic ${deleting ? 'delete' : 'first save'} rejects queued ${label}`, () => race(change, () => deleting ? clear(1) : save(form())), 403);
    if (!deleting) assert.equal(drafts().length, 0);
  }
  reset(); await save(form({ name: 'old revision' }));
  await denied('Final revision CAS cannot overwrite a concurrently saved replacement', () => race(() => run("UPDATE merchant_profile_drafts SET revision=2,draft_json=?,last_request_id=?,last_request_hash=?", JSON.stringify(form({ name: 'concurrent replacement' })), randomUUID(), 'e'.repeat(64)), () => save(form({ name: 'stale override' }), 1)), 409);
  for (const after of [false, true]) { reset(); await save(form()); await denied(`Draft read rechecks merchant approval ${after ? 'after' : 'within'} its final data read`, () => readRace(() => run("UPDATE accounts SET status='rejected' WHERE id='fixture-merchant'"), () => read(), after), 403); }
  reset(); const concurrent = await Promise.allSettled([save(form({ name: 'first' })), save(form({ name: 'second' }))]);
  assert.equal(concurrent.filter(item => item.status === 'fulfilled').length, 1); assert.equal(concurrent.find(item => item.status === 'rejected').reason.status, 409); assert.equal((await read()).revision, 1);
  pass('Concurrent distinct version-zero drafts accept one save and never overwrite the winner');
  reset(); const duplicateId = randomUUID(), duplicates = await Promise.all([save(form(), 0, duplicateId), save(form(), 0, duplicateId)]); assert(duplicates.every(item => item.revision === 1)); assert.equal((await read()).revision, 1);
  pass('Concurrent identical UUID retries commit once and return the same draft revision');
  reset(); const originalId = randomUUID(); const earlier = await race(() => run("UPDATE merchant_profile_drafts SET revision=2,draft_json=?,last_request_id=?,last_request_hash=?", JSON.stringify(form({ name: 'later draft' })), randomUUID(), 'd'.repeat(64)), () => save(form({ name: 'original saved response' }), 0, originalId), false);
  assert.equal(earlier.revision, 1); assert.equal(earlier.lastRequestId, originalId); assert.equal(earlier.draft.name, 'original saved response');
  assert.equal((await read()).revision, 2); assert.equal((await read()).draft.name, 'later draft');
  pass('A later concurrent draft is preserved independently of a previously successful write response');

  reset(); const complete = form({ name: 'Formal updated store', category: '茶饮', floor: 'F1', address: 'Formal actual store address', logo: '🍵' });
  await save(complete); await call('merchantProfileSave', complete);
  assert.equal((await read()).revision, 1); assert.equal((await read()).draft.name, complete.name);
  await save(form({ name: 'newer edit during formal save', expectedImageRevision: 1 }), 1);
  await denied('Old formal-save cleanup cannot delete newer auto-saved input', () => clear(1), 409);
  assert.equal((await read()).draft.name, 'newer edit during formal save'); await clear(2); assert.equal((await read()).draft, null);
  assert.equal(get("SELECT name FROM stores WHERE id='tea'").name, complete.name);
  pass('Official save stays independent; explicit versioned cleanup clears only the intended draft and cannot erase newer input');
  assert.equal(get('PRAGMA integrity_check').integrity_check, 'ok'); assert.deepEqual(all('PRAGMA foreign_key_check'), []);
  pass('All partial/replay/delete/authorization fixtures preserve SQL integrity and foreign keys');
  console.log(JSON.stringify({ status: 'PASS', cases, database: ':memory:', tables: 28, privateDatabaseWrites: 0, cloudRequests: 0, deviceWrites: 0, realEmailsSent: 0 }));
} finally { close(); }
