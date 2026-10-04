import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { createHmac, randomBytes, scryptSync } from 'node:crypto';
import { createGateway, safeReturn, ACCESS_COOKIE } from './demo-access-gateway.mjs';

// Local ephemeral HTTP server, fixture credentials and fake clock only. No DB or remote requests.
const fixturePassword = 'fixture-gateway-only';
const config = { passwordSalt: randomBytes(16).toString('hex'), signingKey: randomBytes(32).toString('hex') };
config.passwordHash = scryptSync(fixturePassword, config.passwordSalt, 32).toString('hex');
let now = 1791057000000, cases = 0, requests = 0;
const server = createGateway(config, () => now);
server.listen(0, '127.0.0.1'); await once(server, 'listening');
const port = server.address().port;
const pass = name => console.log(`PASS ${++cases}: ${name}`);
const request = ({ method = 'GET', path = '/demo/access', headers = {}, body = '', chunks } = {}) => new Promise((resolve, reject) => {
  requests++;
  const req = http.request({ host: '127.0.0.1', port, path, method, headers }, res => {
    const data = []; res.on('data', chunk => data.push(chunk));
    res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(data).toString('utf8') }));
    res.on('error', reject);
  });
  req.on('error', reject); req.setTimeout(5000, () => req.destroy(new Error('Fixture request timed out')));
  if (chunks) for (const chunk of chunks) req.write(chunk);
  else if (body) req.write(body);
  req.end();
});
const form = (password = fixturePassword, next = '/demo/') => new URLSearchParams({ password, return: next }).toString();
const submit = (password = fixturePassword, next = '/demo/', patch = {}) => request({ method: 'POST', body: form(password, next), ...patch,
  headers: { Origin: 'https://123.60.8.174', 'Content-Type': 'application/x-www-form-urlencoded', ...patch.headers } });
const check = value => request({ path: '/private/auth', headers: { 'X-Demo-Gate-Route': 'check', ...(value ? { Cookie: value } : {}) } });
const signed = payload => { const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return body + '.' + createHmac('sha256', Buffer.from(config.signingKey, 'hex')).update(body).digest('base64url'); };
const noChallenge = value => assert.equal(value.headers['www-authenticate'], undefined);
const cookieValue = response => response.headers['set-cookie'][0].split(';')[0];
const nfc = '/demo/client/nfc/quest-tea?device=coin-tea-01&entry=fixture_token';

try {
  const entry = await request({ path: '/demo/access?return=' + encodeURIComponent(nfc) });
  assert.equal(entry.status, 200); assert.match(entry.headers['content-type'], /^text\/html/);
  assert.match(entry.body, /type="password"/); assert.match(entry.body, /访问密码/);
  assert.match(entry.body, /name="return" value="\/demo\/client\/nfc\/quest-tea\?device=coin-tea-01&amp;entry=fixture_token"/);
  noChallenge(entry); assert.equal(entry.headers['cache-control'], 'no-store');
  pass('Ordinary HTML password entry has no Basic Auth challenge and preserves the NFC query');

  assert.equal(safeReturn(nfc), nfc); assert.equal(safeReturn('/demo'), '/demo/');
  assert.equal(safeReturn('/demo/client/nfc/quest-tea?device=coin-tea-01%26x%3Dy'), '/demo/client/nfc/quest-tea?device=coin-tea-01%26x%3Dy');
  for (const value of [undefined, null, '', 'https://outside.example/demo/', '//outside.example/demo/', '/official/', '/demo-other/',
    '/demo/../official/', '/demo/%2f%2foutside.example/', '/demo/%252foutside/', '/demo/\\outside', '/demo/access', '/demo/access/logout',
    '/demo/client/nfc/quest-tea#fragment', '/demo/\nclient', '/demo/\0client', '/demo/' + 'a'.repeat(2001)]) assert.equal(safeReturn(value), '/demo/');
  pass('Return validation keeps exact scoped NFC paths and rejects external, traversal and ambiguous destinations');

  const wrong = await submit('incorrect-fixture');
  assert.equal(wrong.status, 401); assert.match(wrong.body, /访问密码不正确/); noChallenge(wrong);
  assert.equal(wrong.headers['set-cookie'], undefined);
  pass('Incorrect fixture password returns visible HTML feedback without an access cookie or Basic challenge');

  const accepted = await submit(fixturePassword, nfc);
  assert.equal(accepted.status, 303); assert.equal(accepted.headers.location, nfc); noChallenge(accepted);
  const sessionCookie = cookieValue(accepted), header = accepted.headers['set-cookie'][0];
  assert(header.startsWith(ACCESS_COOKIE + '=')); assert.match(header, /; Path=\/demo;/);
  assert.match(header, /; HttpOnly;/); assert.match(header, /; Secure;/); assert.match(header, /; SameSite=Lax;/);
  assert.match(header, /; Max-Age=43200$/); assert.equal((await check(sessionCookie)).status, 204);
  pass('Correct fixture password grants a signed Secure HttpOnly scoped cookie and redirects to the original NFC entry');

  const external = await submit(fixturePassword, 'https://outside.example/demo/');
  assert.equal(external.status, 303); assert.equal(external.headers.location, '/demo/');
  pass('Successful authentication cannot redirect to an external site');

  for (const origin of [undefined, 'https://outside.example', 'null', 'https://123.60.8.174.evil.example', 'http://123.60.8.174']) {
    const headers = { 'Content-Type': 'application/x-www-form-urlencoded', ...(origin === undefined ? {} : { Origin: origin }) };
    const denied = await request({ method: 'POST', headers, body: form() });
    assert.equal(denied.status, 403); assert.equal(denied.headers['set-cookie'], undefined); noChallenge(denied);
  }
  pass('Password submissions require the exact HTTPS Origin, including rejection of missing or null origins');

  assert.equal((await check()).status, 401);
  assert.equal((await check(ACCESS_COOKIE + '=forged')).status, 401);
  const raw = sessionCookie.slice(ACCESS_COOKIE.length + 1);
  const [body, signature] = raw.split('.');
  const altered = body + '.' + (signature[0] === 'A' ? 'B' : 'A') + signature.slice(1);
  assert.equal((await check(ACCESS_COOKIE + '=' + altered)).status, 401);
  assert.equal((await check('mall_player=unrelated; ' + ACCESS_COOKIE + '_extra=' + raw)).status, 401);
  assert.equal((await check(sessionCookie + '; ' + sessionCookie)).status, 401);
  assert.equal((await check(sessionCookie + '; ' + ACCESS_COOKIE + '=bad')).status, 401);
  pass('Unsigned, altered, lookalike and duplicate access cookies are rejected');

  const seconds = Math.floor(now / 1000), nonce = 'a'.repeat(32);
  for (const payload of [{ exp: seconds, nonce }, { exp: seconds - 1, nonce }, { exp: seconds + 43201, nonce },
    { exp: String(seconds + 100), nonce }, { exp: seconds + 100, nonce: 'invalid' }, { exp: seconds + 100 }]) {
    assert.equal((await check(ACCESS_COOKIE + '=' + signed(payload))).status, 401);
  }
  assert.equal((await check(ACCESS_COOKIE + '=' + signed({ exp: seconds + 100, nonce }))).status, 204);
  now += 43200001;
  assert.equal((await check(sessionCookie)).status, 401);
  pass('Expired, excessive-TTL and malformed signed payloads are denied while a valid bounded payload is accepted');

  const pageGate = await request({ path: '/private/login', headers: { 'X-Demo-Gate-Route': 'login', 'X-Demo-Return': nfc, 'X-Demo-Original-Method': 'GET' } });
  assert.equal(pageGate.status, 200); assert.match(pageGate.body, /进入演示空间/); noChallenge(pageGate);
  for (const [returnPath, method] of [['/demo/api/game', 'GET'], ['/demo/_next/static/test.js', 'GET'], [nfc, 'POST'], [nfc, 'PUT'], [nfc, 'DELETE']]) {
    const denied = await request({ path: '/private/login', headers: { 'X-Demo-Gate-Route': 'login', 'X-Demo-Return': returnPath, 'X-Demo-Original-Method': method } });
    assert.equal(denied.status, 401); assert.match(denied.headers['content-type'], /^application\/json/);
    assert.equal(typeof JSON.parse(denied.body).error.message, 'string'); assert(!denied.body.includes('<html')); noChallenge(denied);
  }
  pass('Unauthorized navigation receives HTML; API, static assets and non-GET requests receive explicit JSON denial');

  const logoutWrong = await request({ method: 'POST', path: '/demo/access/logout', headers: { Origin: 'https://outside.example' } });
  assert.equal(logoutWrong.status, 403); assert.equal(logoutWrong.headers['set-cookie'], undefined);
  const logout = await request({ method: 'POST', path: '/demo/access/logout', headers: { Origin: 'https://123.60.8.174', Cookie: sessionCookie } });
  assert.equal(logout.status, 303); assert.equal(logout.headers.location, '/demo/');
  assert.equal(logout.headers['set-cookie'][0], ACCESS_COOKIE + '=; Path=/demo; HttpOnly; Secure; SameSite=Lax; Max-Age=0');
  noChallenge(logout);
  pass('Logout is Origin-protected and clears only the scoped gateway cookie');

  const malformed = [form() + '&password=second', form() + '&return=%2Fdemo%2Fother', 'return=%2Fdemo%2F'];
  for (const value of malformed) assert.equal((await request({ method: 'POST', headers: { Origin: 'https://123.60.8.174', 'Content-Type': 'application/x-www-form-urlencoded' }, body: value })).status, 400);
  assert.equal((await submit(fixturePassword, '/demo/', { headers: { 'Content-Type': 'application/json' } })).status, 415);
  const missingType = await request({ method: 'POST', headers: { Origin: 'https://123.60.8.174' }, body: form() });
  assert.equal(missingType.status, 415);
  assert.equal((await request({ method: 'PUT' })).status, 405);
  assert.equal((await request({ path: '/unrelated' })).status, 404);
  pass('Duplicate form fields, missing password, wrong content type and unsupported routes/methods fail closed');

  const declared = await request({ method: 'POST', headers: { Origin: 'https://123.60.8.174', 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': '4097' }, body: 'x'.repeat(4097) });
  assert.equal(declared.status, 413);
  const chunked = await request({ method: 'POST', headers: { Origin: 'https://123.60.8.174', 'Content-Type': 'application/x-www-form-urlencoded', 'Transfer-Encoding': 'chunked' }, chunks: ['x'.repeat(2048), 'x'.repeat(2049)] });
  assert.equal(chunked.status, 413);
  pass('Both declared and chunked form bodies are limited to 4096 bytes');

  const limited = { headers: { 'X-Real-IP': '198.51.100.37' } };
  for (let i = 0; i < 8; i++) assert.equal((await submit('wrong-fixture-rate', '/demo/', limited)).status, 401);
  const ninth = await submit('wrong-fixture-rate', '/demo/', limited);
  assert.equal(ninth.status, 429); assert.equal(ninth.headers['retry-after'], '300'); assert.match(ninth.body, /尝试较频繁/); noChallenge(ninth);
  assert.equal((await submit(fixturePassword, nfc, limited)).status, 429);
  now += 300001;
  assert.equal((await submit(fixturePassword, nfc, limited)).status, 303);
  pass('Eight failed attempts exhaust one address window; the ninth is limited and a fresh window permits login');

  const reset = { headers: { 'X-Real-IP': '198.51.100.38' } };
  for (let i = 0; i < 7; i++) assert.equal((await submit('wrong-fixture-reset', '/demo/', reset)).status, 401);
  assert.equal((await submit(fixturePassword, '/demo/', reset)).status, 303);
  for (let i = 0; i < 8; i++) assert.equal((await submit('wrong-fixture-reset', '/demo/', reset)).status, 401);
  assert.equal((await submit('wrong-fixture-reset', '/demo/', reset)).status, 429);
  pass('A successful password verification resets only its address failure bucket');

  for (const invalid of [{ ...config, signingKey: 'bad' }, { ...config, passwordSalt: 'bad' }, { ...config, passwordHash: 'bad' }]) assert.throws(() => createGateway(invalid));
  pass('Invalid private gateway configuration cannot start a listener');
  console.log(JSON.stringify({ status: 'PASS', cases, localRequests: requests, listener: '127.0.0.1 ephemeral port', databaseAccesses: 0, externalNetworkRequests: 0, credentials: 'fixture only' }));
} finally {
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}
