import http from 'node:http';
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const ACCESS_COOKIE = 'wander_demo_access';
const ORIGIN = 'https://123.60.8.174', TTL = 12 * 60 * 60, BODY_LIMIT = 4096;
const escape = value => String(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
export function safeReturn(value) {
  if (typeof value !== 'string' || value.length > 2000 || /[\\\x00-\x20\x7f]/.test(value) || /%(?:2f|5c|00|0a|0d|25)/i.test(value.split('?')[0])) return '/demo/';
  try {
    const url = new URL(value, ORIGIN);
    if (!value.startsWith('/demo') || url.origin !== ORIGIN || url.username || url.password || url.hash ||
      (url.pathname !== '/demo' && !url.pathname.startsWith('/demo/'))) return '/demo/';
    if (url.pathname === '/demo/access' || url.pathname.startsWith('/demo/access/')) return '/demo/';
    return (url.pathname === '/demo' ? '/demo/' : url.pathname) + url.search;
  } catch { return '/demo/'; }
}
function cookie(req) {
  const parts = (req.headers.cookie || '').split(';').map(part => part.trim()).filter(part => part.startsWith(ACCESS_COOKIE + '='));
  return parts.length === 1 ? parts[0].slice(ACCESS_COOKIE.length + 1) : '';
}
function page(next, message = '') {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>演示访问验证 · 逛道宝</title><style>
  *{box-sizing:border-box}body{margin:0;min-height:100svh;display:grid;place-items:center;padding:24px;background:#edf2e7;color:#183f31;font:16px/1.65 system-ui,-apple-system,"Segoe UI",sans-serif}main{width:min(100%,440px);padding:36px;border:1px solid #dce4d7;border-radius:28px;background:#fff;box-shadow:0 20px 70px #203d2510}.eyebrow{font-size:12px;letter-spacing:.2em;color:#6b7c68}h1{font-size:30px;line-height:1.3;margin:12px 0}p{color:#657769}label{display:block;font-weight:650;margin-bottom:8px}input,button{font:inherit;width:100%;min-height:52px;border-radius:14px}input{border:1px solid #cfd9cb;padding:12px 16px;background:#fafcf8;outline:none}input:focus{border-color:#27634b;box-shadow:0 0 0 3px #27634b16}button{border:0;background:#214f3a;color:#fff;font-weight:650;margin-top:18px;cursor:pointer}button:hover{background:#183f31}a{color:#315a45}.error{color:#b43131;font-size:14px;margin:12px 0}.footer{font-size:13px;margin-top:24px;margin-bottom:0}@media(max-width:420px){main{padding:26px}h1{font-size:27px}}</style></head><body><main>
  <div class="eyebrow">WANDER ABOUT · DEMO</div><h1>进入演示空间</h1><p>输入演示访问密码，体验金币设备与网页的完整流程。</p>
  <form action="/demo/access" method="post"><input type="hidden" name="return" value="${escape(next)}"><label for="demo-password">访问密码</label><input id="demo-password" name="password" type="password" autocomplete="current-password" placeholder="请输入演示访问密码" required maxlength="128" autofocus>${message ? `<p class="error" role="alert">${escape(message)}</p>` : ''}<button type="submit">进入演示</button></form>
  <p class="footer"><a href="/official/">返回官网</a> · <a href="/">大众产品入口</a></p></main></body></html>`;
}
export function createGateway(config, now = () => Date.now()) {
  if (!/^[a-f0-9]{32}$/i.test(config.passwordSalt || '') || !/^[a-f0-9]{64}$/i.test(config.passwordHash || '') || !/^[a-f0-9]{64}$/i.test(config.signingKey || '')) throw new Error('Invalid private demo gateway configuration');
  const key = Buffer.from(config.signingKey, 'hex'), expected = Buffer.from(config.passwordHash, 'hex'), attempts = new Map();
  const sign = body => createHmac('sha256', key).update(body).digest('base64url');
  function token() { const body = Buffer.from(JSON.stringify({ exp: Math.floor(now()/1000) + TTL, nonce: randomBytes(16).toString('hex') })).toString('base64url'); return body + '.' + sign(body); }
  function valid(value) {
    try {
      if (value.length > 512 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(value)) return false;
      const [body, signature] = value.split('.'), actual = Buffer.from(signature, 'base64url'), wanted = Buffer.from(sign(body), 'base64url');
      if (actual.length !== wanted.length || !timingSafeEqual(actual, wanted)) return false;
      const parsed = JSON.parse(Buffer.from(body, 'base64url').toString()), seconds = Math.floor(now()/1000);
      return Number.isSafeInteger(parsed.exp) && parsed.exp > seconds && parsed.exp <= seconds + TTL && /^[a-f0-9]{32}$/.test(parsed.nonce);
    } catch { return false; }
  }
  function respond(res, status, body = '', headers = {}) {
    res.writeHead(status, { 'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff',
      'Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'self'", ...headers });
    res.end(body);
  }
  async function handler(req, res) {
    const mode = req.headers['x-demo-gate-route'], url = new URL(req.url, ORIGIN);
    if (mode === 'check') return respond(res, valid(cookie(req)) ? 204 : 401);
    const original = mode === 'login' ? req.headers['x-demo-return'] : url.searchParams.get('return');
    const next = safeReturn(original || '/demo/');
    if (mode === 'login') {
      const requested = String(original || '');
      const pathname = requested.split('?')[0];
      const resource = /\.(?:js|mjs|css|map|json|png|jpe?g|svg|webp|gif|ico|woff2?|ttf|mp4|webm)$/i.test(pathname);
      if (pathname.startsWith('/demo/api/') || pathname.startsWith('/demo/_next/') || resource || req.headers['x-demo-original-method'] !== 'GET')
        return respond(res, 401, JSON.stringify({error:{message:'演示访问验证尚未完成或已过期，请重新打开演示页面验证。'}}),{'Content-Type':'application/json; charset=utf-8'});
      return respond(res, 200, page(next), {'Content-Type':'text/html; charset=utf-8'});
    }
    if (url.pathname !== '/demo/access' && url.pathname !== '/demo/access/logout') return respond(res, 404);
    if (req.method === 'GET' && url.pathname === '/demo/access') return respond(res, 200, page(next), {'Content-Type':'text/html; charset=utf-8'});
    if (req.method !== 'POST') return respond(res, 405, '', {Allow:'GET, POST'});
    if (req.headers.origin !== ORIGIN) return respond(res, 403, '请求来源不正确。', {'Content-Type':'text/plain; charset=utf-8'});
    if (url.pathname === '/demo/access/logout') return respond(res, 303, '', {Location:'/demo/', 'Set-Cookie':`${ACCESS_COOKIE}=; Path=/demo; HttpOnly; Secure; SameSite=Lax; Max-Age=0`});
    if (!/^application\/x-www-form-urlencoded(?:;|$)/i.test(req.headers['content-type'] || '')) return respond(res, 415);
    if (Number(req.headers['content-length'] || 0) > BODY_LIMIT) return respond(res, 413);
    const ip = String(req.headers['x-real-ip'] || req.socket.remoteAddress), stamp = now(), old = attempts.get(ip);
    const bucket = old && stamp - old.start < 300_000 ? old : {start:stamp,count:0};
    if (bucket.count >= 8) return respond(res, 429, page(next,'尝试较频繁，请稍后再试。'), {'Content-Type':'text/html; charset=utf-8','Retry-After':'300'});
    let size = 0, chunks = [];
    for await (const chunk of req) { size += chunk.length; if (size > BODY_LIMIT) return respond(res, 413); chunks.push(chunk); }
    const form = new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
    if (form.getAll('password').length !== 1 || form.getAll('return').length > 1) return respond(res, 400);
    const password = form.get('password') || '', destination = safeReturn(form.get('return') || '/demo/');
    if (attempts.size > 2000) for (const [address, value] of attempts) if (stamp - value.start >= 300_000) attempts.delete(address);
    if (attempts.size >= 2000 && !attempts.has(ip)) attempts.delete(attempts.keys().next().value);
    bucket.count++; attempts.set(ip, bucket);
    const digest = password.length > 0 && password.length <= 128 ? scryptSync(password, config.passwordSalt, 32) : null;
    if (!digest || !timingSafeEqual(digest, expected)) return respond(res, 401, page(destination,'访问密码不正确，请重试。'), {'Content-Type':'text/html; charset=utf-8'});
    attempts.delete(ip);
    return respond(res, 303, '', {Location:destination,'Set-Cookie':`${ACCESS_COOKIE}=${token()}; Path=/demo; HttpOnly; Secure; SameSite=Lax; Max-Age=${TTL}`});
  }
  return http.createServer((req,res) => { void handler(req,res).catch(error => { console.error('Demo access gateway request failed:',error.name); if (!res.headersSent) respond(res,500); else res.end(); }); });
}
// PM2 imports ESM through its own entrypoint; an explicit private config also
// selects service mode. Ordinary module imports in tests remain side-effect free.
if (process.env.DEMO_GATE_CONFIG || (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)) {
  const file = process.env.DEMO_GATE_CONFIG;
  if (file !== '/etc/mall-quest/demo-access-gateway.json') throw new Error('Explicit private gateway configuration required');
  const server = createGateway(JSON.parse(readFileSync(file,'utf8')));
  server.listen(8789,'127.0.0.1',() => console.log('Demo access gateway ready on 127.0.0.1:8789'));
}
