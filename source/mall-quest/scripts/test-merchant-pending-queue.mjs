import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { reset, run, get, all, load, request, d1, sha, close } from './business-fixture.mjs';
import { setupFixtureGeofences, fixtureLocation } from './geofence-fixture.mjs';

let cases=0;
const pass=name=>console.log(`PASS ${++cases}: ${name}`);
const merchant=()=>new Request('http://localhost/api/game',{headers:{Cookie:'mall_staff=staff-merchant'}});
const call=(action,input={},actor=merchant())=>load('lib/game-server.ts').execute(actor,{action,...input});
const queue=(input={},actor)=>call('merchantPendingQueue',input,actor);
const deny=async(name,operation,status)=>{await assert.rejects(operation,error=>error.status===status);pass(name);};
const snapshot=()=>JSON.stringify(all("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").map(({name})=>[name,all(`SELECT * FROM ${name} ORDER BY rowid`)]));
async function fixture(){reset({hardwareConfirmation:true});setupFixtureGeofences();const drafts=[];for(const player of['a','b','c'])drafts.push((await call('nfcClaim',{taskId:'quest-tea',requestId:randomUUID(),location:fixtureLocation()},request(player))).draft);return drafts;}
async function noWrites(operation){const prepare=d1.prepare,batch=d1.batch,before=snapshot();d1.prepare=sql=>{assert(!/^\s*(?:INSERT|UPDATE|DELETE|REPLACE|CREATE|ALTER|DROP)\b/i.test(sql),'queue must not prepare a write');return prepare(sql);};d1.batch=async()=>{throw new Error('Queue must not batch writes');};try{const result=await operation();assert.equal(snapshot(),before);return result;}finally{d1.prepare=prepare;d1.batch=batch;}}
async function queuedRead(change,operation){const prepare=d1.prepare;let fired=false,afterChange;d1.prepare=sql=>{const statement=prepare(sql);if(sql.includes('FROM nfc_claim_drafts d JOIN players p')&&sql.includes("d.state='pending'")){const read=statement.all;statement.all=async()=>{if(!fired){fired=true;change();afterChange=snapshot();}return read();};}return statement;};try{await operation();assert(fired);assert.equal(snapshot(),afterChange);}finally{d1.prepare=prepare;}}
try{
  const drafts=await fixture();const page1=await noWrites(()=>queue({page:1,pageSize:2})),page2=await noWrites(()=>queue({page:2,pageSize:2}));
  assert.equal(page1.total,3);assert.equal(page1.totalPages,2);assert.equal(page1.items.length,2);assert.equal(page2.items.length,1);assert.equal(new Set([...page1.items,...page2.items].map(d=>d.id)).size,3);
  assert(page1.items.every(d=>d.storeId==='tea'&&d.state==='pending'&&d.deviceId==='coin-tea-01'&&d.canConfirm));
  pass('A real approved merchant browses its entire pending queue without scanning, with bounded stable pagination and zero writes');
  for(const d of page1.items)for(const key of['request_hash','device_token_hash','player_session_hash','player_account_id','latitude','longitude','coupon_code'])assert(!Object.hasOwn(d,key));
  pass('Queue DTOs expose the matching device and eligibility but no credentials, raw GPS or unissued coupon code');
  run("UPDATE stores SET point_mode='hardware' WHERE id='book'");run("INSERT INTO hardware_devices(id,store_id,token_hash,enabled,created_at,bound_task_id) VALUES('coin-book','book',?,1,?,'quest-book')",sha('private-book-device'),Date.now());
  const foreign=await call('nfcClaim',{taskId:'quest-book',requestId:randomUUID(),location:fixtureLocation(),deviceId:'coin-book'},request('a'));
  const scoped=await noWrites(()=>queue());assert.equal(scoped.total,3);assert(!scoped.items.some(d=>d.id===foreign.draft.id));
  await deny('Body-selected foreign store cannot broaden queue scope',()=>queue({storeId:'book'}),403);
  pass('The general queue excludes real pending applications belonging to another registered merchant store');
  for(const [label,actor]of[['player',request()],['operator',request('admin','admin')],['anonymous',new Request('http://localhost/api/game')]])await deny(`${label} cannot browse merchant-only pending applications`,()=>queue({},actor),403);
  for(const input of[{page:0},{page:1.5},{pageSize:21},{pageSize:0},{page:'1'}])await deny('Queue rejects invalid or unbounded pagination',()=>queue(input),400);
  const empty=await noWrites(()=>queue({page:100,pageSize:2}));assert.equal(empty.items.length,0);assert.equal(empty.total,3);
  pass('Past-last-page browsing is a read-only empty page rather than issuing or materializing records');
  await deny('Selecting a queue row cannot issue without the explicitly scanned fixed device code',()=>call('merchantIssueClaim',{draftId:drafts[0].id,requestId:randomUUID(),expectedRevision:1,receivedDevice:true}),400);
  await deny('A coupon QR cannot substitute for the missing device scan',()=>call('merchantIssueClaim',{draftId:drafts[0].id,requestId:randomUUID(),expectedRevision:1,receivedDevice:true,deviceCode:'GTB-0123456789AB'}),400);
  assert.equal(get('SELECT COUNT(*) AS n FROM claims').n,0);
  pass('Queue visibility does not bypass the exact fixed-device-code issuance guard');
  await call('nfcDraftDelete',{draftId:drafts[0].id,requestId:randomUUID(),expectedRevision:1},request('a'));
  assert.equal((await queue()).total,2);
  await call('merchantIssueClaim',{draftId:drafts[1].id,requestId:randomUUID(),expectedRevision:1,deviceCode:'GTB-DEVICE:coin-tea-01',receivedDevice:true});
  const remaining=await noWrites(()=>queue());assert.equal(remaining.total,1);assert.equal(remaining.items[0].id,drafts[2].id);
  pass('Deleted and officially issued applications disappear from the general queue while the outstanding record remains');
  run('UPDATE nfc_claim_drafts SET permit_until=0 WHERE id=?',drafts[2].id);assert.equal((await queue()).items[0].canConfirm,false);
  pass('A saved application with stale location remains browsable but cannot be confirmed');
  for(const [label,change]of[
    ['approval revoked',()=>run("UPDATE accounts SET status='rejected' WHERE id='fixture-merchant'")],
    ['merchant banned',()=>run("UPDATE players SET banned=1 WHERE id='merchant'")],
    ['session logged out',()=>run("DELETE FROM sessions WHERE token_hash=?",sha('staff-merchant'))],
    ['session expired',()=>run("UPDATE sessions SET expires_at=0 WHERE token_hash=?",sha('staff-merchant'))],
    ['store rebound',()=>run("UPDATE accounts SET store_id='book' WHERE id='fixture-merchant'")],
    ['role changed',()=>run("UPDATE accounts SET role='admin',store_id=NULL,merchant_json=NULL WHERE id='fixture-merchant'")],
  ]){
    await fixture();await deny(`Approval/session final read recheck rejects queued ${label} without any queue mutation`,()=>queuedRead(change,()=>queue()),403);
  }
  await fixture();const stale=await load('app/api/game/route.ts').POST(new Request('http://localhost/api/game',{method:'POST',headers:{Cookie:'mall_player=player-merchant; mall_staff=staff-merchant','X-Mall-Quest-Player':'a'},body:JSON.stringify({action:'merchantPendingQueue'})}));
  assert.equal(stale.status,409);assert.equal(get('SELECT COUNT(*) AS n FROM claims').n,0);
  const http=await noWrites(()=>load('app/api/game/route.ts').POST(new Request('http://localhost/api/game',{method:'POST',headers:merchant().headers,body:JSON.stringify({action:'merchantPendingQueue',page:1,pageSize:2})})));
  assert.equal(http.status,200);assert.equal((await http.json()).data.total,3);
  pass('Actual HTTP queue supports its approved staff cookie and preserves the global page identity-snapshot guard');
  assert.equal(get('PRAGMA integrity_check').integrity_check,'ok');assert.deepEqual(all('PRAGMA foreign_key_check'),[]);
  pass('General queue and follow-up workflows retain SQLite integrity and foreign keys');
  console.log(JSON.stringify({status:'PASS',cases,database:':memory:',privateDatabaseWrites:0,cloudRequests:0,deviceWrites:0,realEmailsSent:0}));
}finally{close();}
