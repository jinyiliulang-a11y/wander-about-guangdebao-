import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

// Real TypeScript module bodies with only the two packaging literals changed in memory.
// Database access is an explicitly forbidden boundary, not a substitute database.
const root = fileURLToPath(new URL('../', import.meta.url));
const actualModules = new Set(['lib/application-scope.ts', 'lib/session-scope.ts', 'lib/game-server.ts', 'lib/account-auth.ts', 'lib/game-error.ts']);
let cases = 0, databaseAccesses = 0;
const pass = name => console.log(`PASS ${++cases}: ${name}`);
function instance(basePath, demo) {
  const cache = new Map();
  const environment = { RECORDING_SHORTCUT_LOGIN: 'true' };
  Object.defineProperty(environment, 'DB', { get() { databaseAccesses++; throw new Error('Database access forbidden in scope tests'); } });
  function load(relative) {
    if (cache.has(relative)) return cache.get(relative).exports;
    if (!actualModules.has(relative)) return {}; // Unused business/external boundaries.
    const loaded = { exports: {} }; cache.set(relative, loaded);
    let source = readFileSync(path.join(root, relative), 'utf8');
    if (relative === 'lib/application-scope.ts') {
      assert.match(source, /export const APP_BASE_PATH: string = "[^"]*";/);
      assert.match(source, /export const HARDWARE_DEMO_INSTANCE: boolean = (?:true|false);/);
      source = source.replace(/export const APP_BASE_PATH: string = "[^"]*";/, `export const APP_BASE_PATH: string = ${JSON.stringify(basePath)};`)
        .replace(/export const HARDWARE_DEMO_INSTANCE: boolean = (?:true|false);/, `export const HARDWARE_DEMO_INSTANCE: boolean = ${demo};`);
    }
    const output = ts.transpileModule(source, { fileName: relative, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const require = name => {
      if (name === 'cloudflare:workers') return { env: environment };
      if (name.startsWith('./')) return load(path.posix.join(path.posix.dirname(relative), name) + '.ts');
      throw new Error('Unexpected dependency: ' + name);
    };
    vm.runInNewContext(output, { module: loaded, exports: loaded.exports, require, Request, Response, Headers, URL, Date, TextEncoder, crypto: webcrypto, console }, { filename: relative });
    return loaded.exports;
  }
  return { scope: load('lib/application-scope.ts'), cookies: load('lib/session-scope.ts'), server: load('lib/game-server.ts'), account: load('lib/account-auth.ts'), environment };
}
const request = (url = 'https://123.60.8.174/', cookie = '') => new Request(url, { headers: cookie ? { Cookie: cookie } : {} });
const attrs = value => Object.fromEntries(value.split(';').map(part => { const [key, ...rest] = part.trim().split('='); return [key, rest.length ? rest.join('=') : true]; }));

const normal = instance('', false), isolated = instance('/hardware-demo', true);
assert.equal(normal.cookies.sessionCookieName('mall_player'), 'mall_player');
assert.equal(normal.cookies.sessionCookieName('mall_staff'), 'mall_staff');
assert.equal(normal.cookies.sessionCookiePath(), '/');
pass('Default build retains public player/staff cookie names and root Path');

for (const staff of [false, true]) {
  const value = attrs(normal.server.sessionCookie(request('http://localhost/'), 'test-only', staff));
  assert.equal(value[staff ? 'mall_staff' : 'mall_player'], 'test-only');
  assert.equal(value.Path, '/');
  assert.equal(value.HttpOnly, true); assert.equal(value.SameSite, 'Lax');
  assert.equal(value['Max-Age'], staff ? '43200' : '2592000');
  assert.equal(Object.hasOwn(value, 'Secure'), false);
  assert.equal(attrs(normal.server.sessionCookie(request(), 'test-only', staff)).Secure, true);
}
pass('Actual default session headers preserve lifetime, HttpOnly, SameSite and HTTPS-only Secure');

const mixed = 'mall_player=public-player; mall_staff=public-staff; hardware_demo_mall_player=demo-player; hardware_demo_mall_staff=demo-staff';
assert.equal(normal.server.cookie(request(undefined, mixed), 'mall_player'), 'public-player');
assert.equal(normal.server.cookie(request(undefined, mixed), 'mall_staff'), 'public-staff');
assert.equal(normal.server.cookie(request(undefined, 'hardware_demo_mall_player=demo-player; hardware_demo_mall_staff=demo-staff'), 'mall_player'), undefined);
assert.equal(normal.server.cookie(request(undefined, 'hardware_demo_mall_player=demo-player; hardware_demo_mall_staff=demo-staff'), 'mall_staff'), undefined);
pass('Default parser reads only public cookies and ignores demo-only sessions');

assert.equal(isolated.cookies.sessionCookieName('mall_player'), 'hardware_demo_mall_player');
assert.equal(isolated.cookies.sessionCookieName('mall_staff'), 'hardware_demo_mall_staff');
assert.equal(isolated.cookies.sessionCookieName('unrelated'), 'unrelated');
assert.equal(isolated.cookies.sessionCookiePath(), '/hardware-demo');
pass('Demo build prefixes only its player/staff sessions and confines cookie Path');

for (const staff of [false, true]) for (const url of ['http://127.0.0.1/hardware-demo/', 'https://123.60.8.174/hardware-demo/']) {
  const value = attrs(isolated.server.sessionCookie(request(url), 'test-only', staff));
  assert.equal(value[staff ? 'hardware_demo_mall_staff' : 'hardware_demo_mall_player'], 'test-only');
  assert.equal(value.Path, '/hardware-demo');
  assert.equal(value.Secure, true); assert.equal(value.HttpOnly, true); assert.equal(value.SameSite, 'Lax');
  assert.equal(Object.hasOwn(value, 'Domain'), false);
}
pass('Actual isolated session headers remain Secure even behind an HTTP reverse proxy');

const publicOnly = request(undefined, 'mall_player=public-player; mall_staff=public-staff');
assert.equal(isolated.server.cookie(publicOnly, 'mall_player'), undefined);
assert.equal(isolated.server.cookie(publicOnly, 'mall_staff'), undefined);
assert.equal(await isolated.server.session(publicOnly), null);
assert.equal(await isolated.server.session(publicOnly, true), null);
assert.equal(databaseAccesses, 0);
pass('Demo parser and session resolver never read or query public-site credentials');

assert.equal(isolated.server.cookie(request(undefined, mixed), 'mall_player'), 'demo-player');
assert.equal(isolated.server.cookie(request(undefined, mixed), 'mall_staff'), 'demo-staff');
const lookalikes = 'other_hardware_demo_mall_player=wrong; hardware_demo_mall_player_extra=wrong; mall_player=public';
assert.equal(isolated.server.cookie(request(undefined, lookalikes), 'mall_player'), undefined);
pass('Mixed-cookie requests select exact isolated names and reject misleading prefixes');

const loggedOut = await isolated.account.accountAction(publicOnly, { action: 'playerLogout' });
assert.equal(loggedOut.setCookie.length, 2);
for (const [index, name] of ['hardware_demo_mall_player', 'hardware_demo_mall_staff'].entries()) {
  const value = attrs(loggedOut.setCookie[index]);
  assert.equal(value[name], ''); assert.equal(value.Path, '/hardware-demo');
  assert.equal(value['Max-Age'], '0'); assert.equal(value.Secure, true);
  assert.equal(Object.hasOwn(value, name.replace('hardware_demo_', '')), false);
}
assert.equal(databaseAccesses, 0);
pass('Actual demo logout clears only demo cookies and does not access public sessions');

const normalLogout = await normal.account.accountAction(request('http://localhost/'), { action: 'staffLogout' });
const cleared = attrs(normalLogout.setCookie);
assert.equal(cleared.mall_staff, ''); assert.equal(cleared.Path, '/');
assert.equal(cleared['Max-Age'], '0'); assert.equal(Object.hasOwn(cleared, 'Secure'), false);
pass('Public staff logout remains on the root cookie namespace');

assert.equal(normal.account.recordingShortcutAllowed(request()), false);
assert.equal(normal.account.recordingShortcutAllowed(request('http://localhost/')), true);
assert.equal(isolated.account.recordingShortcutAllowed(request('https://123.60.8.174/hardware-demo/')), true);
assert.equal(normal.account.recordingShortcutAllowed(request('https://123.60.8.174/?HARDWARE_DEMO_INSTANCE=true')), false);
for (const flag of ['false', '1', true, undefined]) {
  isolated.environment.RECORDING_SHORTCUT_LOGIN = flag;
  assert.equal(isolated.account.recordingShortcutAllowed(request()), false);
}
pass('Recording permission needs the exact environment gate plus checked build instance or localhost');

assert.equal(normal.scope.appPath('/client/map?from=demo#here'), '/client/map?from=demo#here');
assert.equal(normal.scope.stripAppPath('/client/map?from=demo#here'), '/client/map?from=demo#here');
assert.equal(isolated.scope.appPath('/client/map?from=demo#here'), '/hardware-demo/client/map?from=demo#here');
assert.equal(isolated.scope.appPath('/hardware-demo/client/map?from=demo#here'), '/hardware-demo/client/map?from=demo#here');
assert.equal(isolated.scope.appPath('/hardware-demo'), '/hardware-demo/');
assert.equal(isolated.scope.stripAppPath('/hardware-demo/client/map?from=demo#here'), '/client/map?from=demo#here');
pass('Real scoped navigation prefixes once and preserves query/hash while default routes remain intact');

assert.equal(isolated.scope.isAppPath('/client/nfc/quest-tea?device=coin-tea-01'), false);
assert.equal(isolated.scope.isAppPath('/hardware-demo/client/nfc/quest-tea?device=coin-tea-01'), true);
assert.equal(isolated.scope.isAppPath('/hardware-demo-other/client'), false);
assert.equal(isolated.scope.stripAppPath('/hardware-demo-other/client'), '/hardware-demo-other/client');
for (const target of ['//outside.example/', 'https://outside.example/', '\\client', '/client\\map']) assert.throws(() => isolated.scope.appPath(target));
pass('A production tag or lookalike path cannot select the isolated demo navigation scope');

for (const invalid of ['/hardware-demo/', 'hardware-demo', '//hardware-demo', '/hardware demo', '/hardware-demo?x=1']) assert.throws(() => instance(invalid, true));
assert.equal(databaseAccesses, 0);
pass('Invalid build prefixes fail immediately with no database or network access');
console.log(JSON.stringify({ status: 'PASS', cases, boundary: 'pure-vm', realModules: [...actualModules], databaseAccesses, networkRequests: 0, buildVariants: ['public-default', 'hardware-demo-isolated'] }));
