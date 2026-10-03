import assert from 'node:assert/strict';
import {createHmac,randomBytes} from 'node:crypto';
import {reset as resetDb,run,get,all,action,load,request,d1,demoToken,sha,close} from './business-fixture.mjs';
import { fixtureLocation, setupFixtureGeofences } from './geofence-fixture.mjs';
const reset = options => { const value = resetDb(options); setupFixtureGeofences(); return value; };

// Production handlers and SQL run only against disposable SQLite fixtures.
// No live D1, HTTP request, credential file or serial device is used.
// Historical entry/answer compatibility uses explicit nfc_claim=0 fixture tasks;
// mandatory hardware NFC awards and legacy bypass refusal have their own suite.
let cases=0;
const pass=name=>{cases++;console.log(`PASS ${cases}: ${name}`);};
const reject=async(name,fn,status=400)=>{await assert.rejects(fn,error=>error.status===status);pass(name);};
const deviceId='coin-tea-01';
const route=()=>load('app/api/hardware/entry/route.ts');
const entryRequest=(url='http://localhost/api/hardware/entry?deviceId='+deviceId,authorization='Bearer '+demoToken)=>new Request(url,{headers:authorization?{Authorization:authorization}:{}});
const snapshot=()=>sha(JSON.stringify(all("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").map(({name})=>[name,all('SELECT * FROM '+name+' ORDER BY rowid')])));
async function issue(expected=200,req=entryRequest()){
  const response=await route().GET(req),data=await response.json();
  assert.equal(response.status,expected);assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(response.headers.get('set-cookie'),null);
  return data;
}
const entryToken=result=>new URL(result.entryUrl).searchParams.get('entry');
const check=(token,taskId='quest-tea',player='a')=>action('coinCheckIn',{taskId,location:fixtureLocation(),...(token===undefined?{}:{entryToken:token})},player);
const claim=(token,player='a',taskId='quest-tea')=>action('claim',{taskId,answer:'茉莉',location:fixtureLocation(),...(token===undefined?{}:{entryToken:token})},player);
const preview=code=>action('couponPreview',{code},'merchant','merchant');
const fixtureTicket=(expirySeconds,{taskId='quest-tea',storeId='tea'}={})=>{
  const expiry=expirySeconds.toString(36),nonce=randomBytes(16).toString('base64url');
  const signature=createHmac('sha256',sha(demoToken)).update(JSON.stringify(['mall-48h:coin-entry:v1',deviceId,storeId,taskId,expiry,nonce])).digest('base64url');
  return `v1.${deviceId}.${expiry}.${nonce}.${signature}`;
};
try{
  reset();const before=snapshot(),tableCount=get("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").n,first=await issue(),second=await issue();
  assert.deepEqual(Object.keys(first).sort(),['deviceId','storeId','taskId','entryUrl','expiresAt','ttlSeconds'].sort());
  assert.equal(first.deviceId,deviceId);assert.equal(first.taskId,'quest-tea');assert.equal(first.storeId,'tea');
  assert(first.ttlSeconds>=1&&first.ttlSeconds<=120);assert(first.expiresAt>Date.now()&&first.expiresAt-Date.now()<=120000);
  assert.notEqual(entryToken(first),entryToken(second));assert.equal(new URL(first.entryUrl).pathname,'/client/coin/quest-tea');
  const segments=entryToken(first).split('.');assert.equal(segments.length,5);assert.equal(segments[0],'v1');
  assert.equal(Number.parseInt(segments[2],36)*1000,first.expiresAt);assert.match(segments[3],/^[A-Za-z0-9_-]{22}$/);assert.match(segments[4],/^[A-Za-z0-9_-]{43}$/);
  const independentSignature=createHmac('sha256',sha(demoToken)).update(JSON.stringify(['mall-48h:coin-entry:v1',deviceId,'tea','quest-tea',segments[2],segments[3]])).digest('base64url');
  assert.equal(segments[4],independentSignature);assert.equal(Buffer.from(segments[3],'base64url').byteLength,16);
  assert(Buffer.byteLength(first.entryUrl,'ascii')<=160);assert(/^[\x20-\x7e]+$/.test(first.entryUrl));
  assert(!JSON.stringify(first).includes(demoToken));assert(!JSON.stringify(first).includes(sha(demoToken)));
  assert.equal((await check(entryToken(first))).method,'dynamic');assert.equal((await check(entryToken(second))).expiresAt,second.expiresAt);
  assert.equal((await check()).method,'link');assert(!Object.hasOwn(await check(),'expiresAt'));
  assert.equal(snapshot(),before);assert.equal(get("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").n,tableCount);
  pass('Random entry URLs and inside-fence dynamic/static check-in are read-only; earlier URL remains valid and every current fixture table stays unchanged');

  for(const authorization of ['', 'Bearer short', 'Bearer '+'X'.repeat(40)])await issue(401,entryRequest(undefined,authorization));
  for(const query of ['', '?deviceId=.', '?deviceId='+deviceId+'&deviceId='+deviceId])await issue(400,entryRequest('http://localhost/api/hardware/entry'+query));
  await issue(401,entryRequest('http://localhost/api/hardware/entry?deviceId=missing-device'));
  const method=route().POST();assert.equal(method.status,405);assert.equal(method.headers.get('allow'),'GET');assert.equal(method.headers.get('cache-control'),'no-store');
  pass('Device authentication, identifier ambiguity and HTTP method checks reject invalid requests without creating player cookies');
  const longURL=await issue(503,entryRequest('http://'+'long'.repeat(30)+'.test/api/hardware/entry?deviceId='+deviceId));
  assert.match(longURL.error.message,/160/);assert.deepEqual(Object.keys(longURL),['error']);
  pass('An oversized absolute URL reports a configuration error instead of truncating the signed QR entry');

  const good=entryToken(first);
  for(const value of ['', null, 1, 'x'.repeat(161),good.replace('v1.','v2.'),good+'.extra'])await reject('Malformed supplied entry never falls back to the static link',()=>check(value));
  for(const value of ['', null, 1])await reject('Claim also refuses an empty or non-string supplied token',()=>claim(value));
  await reject('Expired valid signature requires rescanning',()=>check(fixtureTicket(Math.floor(Date.now()/1000)-1)),409);
  await reject('Signed timestamps outside the maximum entry lifetime are rejected',()=>check(fixtureTicket(Math.floor(Date.now()/1000)+240)));
  const corrupted=good.slice(0,-43)+(good.at(-43)==='A'?'B':'A')+good.slice(-42);
  await reject('A canonical-looking forged signature cannot confirm a coin',()=>check(corrupted),403);
  await reject('Signature is bound to the requested task and store',()=>check(good,'quest-book'),409);
  assert.equal(snapshot(),before);pass('Rejected entry validation does not issue rewards, debit points or write a check-in record');

  reset();let ticket=entryToken(await issue());run("UPDATE hardware_devices SET enabled=0 WHERE id=?",deviceId);
  await reject('Maintenance disables a previously issued dynamic entry',()=>check(ticket),409);await issue(401);
  reset();ticket=entryToken(await issue());run("UPDATE hardware_devices SET token_hash=? WHERE id=?",sha('rotated-fixture-device-token-0123456789'),deviceId);
  await reject('Device credential rotation invalidates the original signed entry',()=>check(ticket),403);await issue(401);
  reset();ticket=entryToken(await issue());run("UPDATE hardware_devices SET bound_task_id=NULL WHERE id=?",deviceId);
  await reject('An explicitly unbound device cannot validate an old entry',()=>check(ticket),409);await issue(409);
  reset();ticket=entryToken(await issue());run("UPDATE hardware_devices SET store_id='book',bound_task_id='quest-book' WHERE id=?",deviceId);run("UPDATE stores SET point_mode='hardware' WHERE id='book'");
  await reject('Store rebinding cannot reuse a previous entry',()=>check(ticket),409);await issue(403);

  for(const sql of ["UPDATE stores SET status='inactive' WHERE id='tea'", "UPDATE tasks SET status='offline' WHERE id='quest-tea'", "UPDATE tasks SET deleted_at=1 WHERE id='quest-tea'", "UPDATE tasks SET expires_at=1 WHERE id='quest-tea'", "UPDATE stores SET stock_total=0 WHERE id='tea'"]){
    reset();run(sql);await issue(409);await reject('Unavailable, removed, expired or sold-out coins cannot be checked in',()=>check(),409);
  }
  reset();const tpl=await action('couponCreate',{title:'Entry fixture coupon',type:'gift',value:0,minAmount:0,totalCount:1,validStart:null,validEnd:null,status:'active'},'merchant','merchant');
  run("UPDATE tasks SET reward_coupon_id=? WHERE id='quest-tea'",tpl.templateId);const templateTicket=entryToken(await issue());
  run('UPDATE coupon_templates SET status=? WHERE id=?','inactive',tpl.templateId);await issue(409);await reject('An inactive template prevents confirmation of a still-valid signed entry',()=>check(templateTicket),409);
  run('UPDATE coupon_templates SET status=?,deleted_at=? WHERE id=?','active',1,tpl.templateId);await issue(409);
  run('UPDATE coupon_templates SET deleted_at=NULL,valid_start=? WHERE id=?',Date.now()+86400000,tpl.templateId);await issue(409);
  run('UPDATE coupon_templates SET valid_start=NULL,valid_end=1 WHERE id=?',tpl.templateId);await issue(409);
  run('UPDATE coupon_templates SET valid_end=NULL WHERE id=?',tpl.templateId);await claim();await issue(409);
  pass('Dynamic entry checks current reward template availability, dates, soft deletion and exact remaining stock');

  reset();ticket=entryToken(await issue());const outcomes=await Promise.all([claim(ticket),claim(ticket)]);
  assert.equal(get('SELECT COUNT(*) AS n FROM claims').n,1);assert.equal(outcomes.filter(x=>x.newlyIssued).length,1);
  assert.equal(get("SELECT COUNT(*) AS n FROM points_ledger WHERE kind='claim'").n,1);
  await claim(ticket,'b');assert.equal(get('SELECT COUNT(*) AS n FROM claims').n,2);
  const originalClaims=snapshot();await reject('A supplied expired ticket is rejected even if that player already has a coupon',()=>claim(fixtureTicket(Math.floor(Date.now()/1000)-1)),409);
  assert.equal(snapshot(),originalClaims);pass('A QR can serve multiple visitors while concurrent repeat claims retain the original once-per-player/store quota');
  reset();await claim();assert.equal(get('SELECT COUNT(*) AS n FROM claims').n,1);pass('Inside-fence static NFC and ordinary answer claims do not require a dynamic entryToken');

  for(const [race,status] of [["UPDATE hardware_devices SET enabled=0",409], ["UPDATE hardware_devices SET bound_task_id=NULL",409], ["UPDATE hardware_devices SET token_hash='rotated-at-insert'",403], ["UPDATE stores SET point_mode='static' WHERE id='tea'",409]]){
    reset();ticket=entryToken(await issue());const prepare=d1.prepare;let ran=false;
    d1.prepare=sql=>{const statement=prepare(sql);if(/^\s*INSERT INTO claims/i.test(sql)){const originalRun=statement.run;statement.run=async()=>{ran=true;run(race);return originalRun();};}return statement;};
    try{await reject('Device state changed between token verification and the claim INSERT cannot award a reward',()=>claim(ticket),status);assert(ran);assert.equal(get('SELECT COUNT(*) AS n FROM claims').n,0);assert.equal(get("SELECT COUNT(*) AS n FROM points_ledger WHERE kind='claim'").n,0);}finally{d1.prepare=prepare;}
  }
  reset();const shortExpiry=Math.floor(Date.now()/1000)+2;ticket=fixtureTicket(shortExpiry);
  const prepare=d1.prepare;let waited=false;
  d1.prepare=sql=>{const statement=prepare(sql);if(/^\s*INSERT INTO claims/i.test(sql)){const originalRun=statement.run;statement.run=async()=>{waited=true;await new Promise(resolve=>setTimeout(resolve,Math.max(0,shortExpiry*1000-Date.now()+25)));return originalRun();};}return statement;};
  try{await reject('An INSERT queued until after expiry cannot award a reward and tells the visitor to rescan',()=>claim(ticket),409);assert(waited);assert.equal(get('SELECT COUNT(*) AS n FROM claims').n,0);}finally{d1.prepare=prepare;}

  reset();const awarded=await claim(),beforePreview=snapshot();
  let result=await preview(' '+awarded.coupon.code.toLowerCase()+' ');assert(result.canRedeem);assert.equal(result.coupon.id,awarded.coupon.id);assert.equal(result.coupon.status,'unused');
  assert.equal(snapshot(),beforePreview);pass('Merchant preview normalizes a known exact coupon code and returns its actual snapshot without redemption or any write');
  await reject('An unauthenticated player cannot preview merchant coupon data',()=>action('couponPreview',{code:awarded.coupon.code}),403);
  await reject('Administrator identity does not imply merchant redemption permissions',()=>action('couponPreview',{code:awarded.coupon.code},'admin','admin'),403);
  const foreign=await claim(undefined,'a','quest-book');await reject('Cross-store coupon preview is denied without leaking that store or player',()=>preview(foreign.coupon.code));
  await reject('Unknown coupon codes are denied',()=>preview('GTB-FFFFFFFFFFFF'));
  for(const code of ['',null,100,'x'.repeat(129)])await reject('Malformed coupon preview requests are bounded',()=>preview(code));
  run("UPDATE claims SET valid_start=? WHERE id=?",Date.now()+86400000,awarded.coupon.id);result=await preview(awarded.coupon.code);assert(!result.canRedeem);assert.equal(result.coupon.status,'upcoming');
  run("UPDATE claims SET valid_start=NULL,valid_end=1 WHERE id=?",awarded.coupon.id);result=await preview(awarded.coupon.code);assert(!result.canRedeem);assert.equal(result.coupon.status,'expired');
  run("UPDATE claims SET redeemed_at=0 WHERE id=?",awarded.coupon.id);result=await preview(awarded.coupon.code);assert(!result.canRedeem);assert.equal(result.coupon.status,'used');
  await reject('A stored redemption timestamp of zero still denotes an already used coupon',()=>action('redeem',{code:awarded.coupon.code},'merchant','merchant'));
  pass('Preview distinguishes upcoming, expired and used coupons from current claim snapshot fields');

  reset();run("UPDATE tasks SET reward_type='points',reward_value=50 WHERE id='quest-tea'");await claim();const pointCode=get('SELECT coupon_code FROM claims').coupon_code;
  await reject('Points rewards cannot masquerade as redeemable coupons',()=>preview(pointCode));
  reset();const historical=await claim();run("UPDATE claims SET issued_at=1 WHERE id=?",historical.coupon.id);run("UPDATE tasks SET deleted_at=1,status='offline' WHERE id='quest-tea'");
  run("UPDATE stores SET reward_title='Changed current store reward',conditions='Changed current store terms' WHERE id='tea'");
  result=await preview(historical.coupon.code);assert(result.canRedeem);assert.equal(result.coupon.reward,historical.coupon.reward);assert.equal(result.coupon.conditions,historical.coupon.conditions);
  pass('Exact old coupon preview works after task soft deletion and store edits while preserving its issued terms');
  const redeemed=await Promise.allSettled([action('redeem',{code:historical.coupon.code},'merchant','merchant'),action('redeem',{code:historical.coupon.code},'merchant','merchant')]);
  assert.equal(redeemed.filter(x=>x.status==='fulfilled').length,1);assert.equal((await preview(historical.coupon.code)).canRedeem,false);
  assert.equal(get('SELECT COUNT(*) AS n FROM claims').n,1);pass('Explicit redemption remains atomic; only one concurrent confirmation can redeem a previewed coupon');

  const sync=await load('lib/hardware-server.ts').hardwareStoreSync(new Request('http://localhost',{headers:{Authorization:'Bearer '+demoToken}}),{deviceId});
  assert.deepEqual(Object.keys(sync).sort(),['available','claimCount','storeId','storeName','taskId']);
  const after=snapshot();const api=load('app/api/game/route.ts');const response=await api.POST(new Request('http://localhost/api/game',{method:'POST',headers:{Cookie:request('merchant','merchant').headers.get('cookie')},body:JSON.stringify({action:'couponPreview',code:historical.coupon.code})}));
  assert.equal(response.status,200);assert.equal((await response.json()).data.coupon.status,'used');assert.equal(snapshot(),after);
  pass('Root preview API is read-only and the legacy five-field device sync contract remains unchanged');
  console.log(JSON.stringify({status:'PASS',cases,isolatedDatabase:':memory:',persistentD1Opened:false,networkRequests:0,serialAccess:false,tables:get("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").n}));
}finally{close();}
