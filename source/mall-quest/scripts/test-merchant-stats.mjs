import assert from 'node:assert/strict';
import {reset,run,get,all,action,load,close} from './business-fixture.mjs';

// All production handlers run against business-fixture's :memory: SQLite only.
const realNow=Date.now,now=Date.parse('2026-10-03T04:00:00Z'),day=86400000;
Date.now=()=>now;
const since=Math.floor((now+28800000)/day)*day-28800000-6*day;
let cases=0,sequence=0;
const pass=label=>console.log(`PASS ${++cases}: ${label}`);
const merchant=range=>action('workbenchState',{range:range||7},'merchant','merchant');
async function fresh(){
  reset();sequence=0;
  // Production initialization is cached by the module across fixture resets.
  // Seed each disposable DB explicitly rather than depend on cached bootstrap.
  template('legacy-tea',{total:24});
}
function claim({store='tea',event='mall-48h',issued=now,redeemed=null,start=null,end=null,type='coupon',template='legacy-tea'}={}){
  const id='stats-'+(++sequence),player='stats-player-'+sequence;
  run('INSERT INTO players(id,nickname,created_at) VALUES(?,?,?)',player,player,now);
  run(`INSERT INTO claims(id,player_id,event_id,store_id,task_id,coupon_code,issued_at,redeemed_at,reward_type,reward_value,template_id,valid_start,valid_end)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,id,player,event,store,'quest-'+store,'STATS-CODE-'+sequence,issued,redeemed,type,0,type==='coupon'?template:null,start,end);
  return id;
}
function template(id,{total=10,status='active',start=null,end=null,deleted=null}={}){
  run(`INSERT INTO coupon_templates(id,store_id,title,type,value,min_amount,total_count,valid_start,valid_end,status,created_at,updated_at,deleted_at)
    VALUES(?, 'tea', ?, 'gift',0,0,?,?,?,?,?,?,?)`,id,id,total,start,end,status,now,now,deleted);
}
try{
  await fresh();
  let w=await merchant(),s=w.stats.merchantCoupons;
  assert.equal(s.issued,0);assert.equal(s.redemptionRate,null);assert.equal(s.asOf,now);
  assert.equal(s.daily.length,7);assert.equal(s.daily.every(d=>d.issued===0&&d.redeemed===0),true);
  assert.equal(Object.hasOwn((await action('workbenchState',{},'admin','admin')).stats,'merchantCoupons'),false);
  pass('Empty coupon cohort is no sample; operator response has no merchant-only field');

  claim({type:'points'});claim({store:'book',template:'legacy-book'});claim({event:'old-activity'});claim();
  w=await merchant();s=w.stats.merchantCoupons;
  assert.equal(w.stats.claims,2,'Legacy all-reward count remains separate');
  assert.equal(s.issued,1);assert.equal(s.recipients,1);assert.equal(s.inventory.storeRewardRemaining,22);
  assert.equal(s.daily.reduce((n,d)=>n+d.issued,0),1);
  pass('Real SQL isolates current store/event and excludes points from coupon metrics');

  await fresh();
  claim({redeemed:now-1,end:now-1});claim({end:null});claim({end:now});claim({start:now+1,end:now+day});
  s=(await merchant()).stats.merchantCoupons;
  assert.deepEqual([s.issued,s.unused,s.upcoming,s.redeemed,s.expired,s.redemptionRate],[4,2,1,1,1,25]);
  assert.equal(s.issued,s.unused+s.redeemed+s.expired);
  pass('Redeemed takes priority over expiry; upcoming is unused subset and cohort partitions exactly');

  claim({issued:since-1,redeemed:now});
  s=(await merchant()).stats.merchantCoupons;
  assert.equal(s.issued,4);assert.equal(s.redeemed,1);assert.equal(s.redemptions,2);assert.equal(s.redemptionRate,25);
  assert.equal(s.daily.reduce((n,d)=>n+d.redeemed,0),2);
  pass('Earlier-issued coupon redeemed this period changes occurrence trend, not current cohort rate');

  await fresh();
  claim({issued:since-1});claim({issued:since});claim({issued:now+1});claim({issued:now,redeemed:now+1});claim({issued:now,redeemed:now});
  s=(await merchant()).stats.merchantCoupons;
  assert.deepEqual([s.issued,s.redeemed,s.unused,s.redemptions],[3,1,2,1]);
  assert.equal(s.daily[0].issued,1);assert.equal(s.daily.at(-1).issued,2);
  pass('Inclusive start/current snapshot exclude future issuance and future redemption');

  await fresh();
  const midnight=Math.floor((now+28800000)/day)*day-28800000;
  claim({issued:midnight-1});claim({issued:midnight,redeemed:midnight});
  s=(await merchant()).stats.merchantCoupons;
  assert.equal(s.daily.at(-2).issued,1);assert.equal(s.daily.at(-1).issued,1);assert.equal(s.daily.at(-1).redeemed,1);
  assert.equal(s.daily.at(-1).date,'2026-10-03');
  pass('Shanghai midnight puts millisecond boundary records into separate real SQL date buckets');

  await fresh();
  run("UPDATE coupon_templates SET status='inactive' WHERE id='legacy-tea'");
  template('valid',{total:10,start:now,end:now+day});
  template('stopped',{total:50,status:'inactive'});template('upcoming',{total:50,start:now+1});
  template('expired',{total:50,end:now});template('removed',{total:50,deleted:now});
  claim({template:'valid',event:'old-activity'});claim({template:'valid'});claim({type:'points'});
  s=(await merchant()).stats.merchantCoupons;
  assert.deepEqual({...s.inventory},{activeTemplates:1,total:10,remaining:8,used:2,storeRewardTotal:24,storeRewardRemaining:22,issuableUpperBound:8});
  assert.equal(s.issued,1);
  pass('Effective template quota matches lifetime claim guard; store shared slots count current activity points/coupons only');

  run("UPDATE stores SET stock_total=3 WHERE id='tea'");
  s=(await merchant()).stats.merchantCoupons;
  assert.equal(s.inventory.storeRewardRemaining,1);assert.equal(s.inventory.issuableUpperBound,1);
  pass('Shared reward stock separately caps template quota without overstating collectible rewards');

  run("UPDATE coupon_templates SET deleted_at=? WHERE id='valid'",now);
  s=(await merchant()).stats.merchantCoupons;
  assert.equal(s.issued,1);assert.equal(s.unused,1);assert.equal(s.inventory.activeTemplates,0);assert.equal(s.inventory.total,0);
  pass('Deleting template removes stock eligibility while preserving issued coupon cohort/history');

  template('valid-two',{total:9});
  run("UPDATE stores SET status='inactive' WHERE id='tea'");
  s=(await merchant()).stats.merchantCoupons;
  assert.equal(s.inventory.remaining,0);assert.equal(s.inventory.issuableUpperBound,0);assert.equal(s.issued,1);
  pass('Inactive store has no effective template issuance quota but history remains visible');

  await fresh();
  const id=claim();const code=get('SELECT coupon_code FROM claims WHERE id=?',id).coupon_code;
  await action('redeem',{code},'merchant','merchant');s=(await merchant()).stats.merchantCoupons;
  assert.equal(s.redeemed,1);assert.equal(s.redemptions,1);assert.equal(s.redemptionRate,100);assert.equal(s.inventory.remaining,23);
  pass('Actual redeem handler updates cohort and occurrence metrics without replenishing stock');

  claim({type:'points'});claim({store:'book',template:'legacy-book'});
  const admin=await action('workbenchState',{range:30},'admin','admin');
  assert.equal(admin.stats.claims,get('SELECT COUNT(*) AS n FROM claims WHERE event_id=? AND issued_at>=?','mall-48h',since-23*day).n);
  assert.equal(admin.stats.redeemed,1);assert.equal(admin.stats.distinctPlayers,3);
  assert.equal(admin.stats.daily.length,30);assert.equal(admin.stats.claimRate,33.3);
  assert.equal(Object.hasOwn(admin.stats,'merchantCoupons'),false);
  pass('Operator legacy all-reward statistics, 30-day response and fields remain unchanged');

  const before=JSON.stringify(['claims','players','points_ledger','coupon_templates','stores','hardware_devices']
    .map(table=>all(`SELECT * FROM ${table} ORDER BY id`)));
  const spoofed=await action('workbenchState',{storeId:'book'},'merchant','merchant');
  assert.equal(spoofed.scope.storeId,'tea');assert.equal(spoofed.store.id,'tea');
  assert.equal(spoofed.stores.length,1);assert.equal(spoofed.users.length,0);
  assert.equal(spoofed.stats.merchantCoupons.issued,1);
  await assert.rejects(()=>action('workbenchState'),error=>error.status===403);
  const after=JSON.stringify(['claims','players','points_ledger','coupon_templates','stores','hardware_devices']
    .map(table=>all(`SELECT * FROM ${table} ORDER BY id`)));
  assert.equal(before,after);
  pass('Authenticated merchant scope ignores client store spoofing, refuses players and reporting performs no business mutation');

  const {workbenchWorkbookParts}=load('lib/workbench-export.ts');
  w=await merchant();
  const parts=workbenchWorkbookParts(w,new Date(now));
  const summary=parts['xl/worksheets/sheet1.xml'],trend=parts['xl/worksheets/sheet2.xml'];
  assert.equal(summary.includes('发放优惠券'),true);assert.equal(summary.includes('本批核销率'),true);
  assert.equal(summary.includes('成功领奖'),false);assert.equal(trend.includes('发放优惠券（份）'),true);
  assert.equal(summary.includes('当前发券额度上限'),true);
  const rows=load('lib/merchant-stats.ts').merchantCouponReportRows(w.stats.merchantCoupons,7);
  assert.equal(rows.find(row=>row[0]==='本批核销率')[1],1);
  const legacy={...w,stats:{...w.stats,merchantCoupons:undefined}};
  assert.equal(workbenchWorkbookParts(legacy,new Date(now))['xl/worksheets/sheet1.xml'].includes('待统计'),true);
  const operatorParts=workbenchWorkbookParts(admin,new Date(now));
  assert.equal(operatorParts['xl/worksheets/sheet1.xml'].includes('成功领奖'),true);
  assert.equal(operatorParts['xl/worksheets/sheet1.xml'].includes('当前发券额度上限'),false);
  assert.equal(operatorParts['xl/worksheets/sheet3.xml'].includes('待审核的投放申请'),true);
  pass('Merchant shared report rows and Excel use coupon metrics; old response unknown; operator report retained');

  for(const range of [30,90]){
    const result=(await merchant(range)).stats.merchantCoupons;
    assert.equal(result.daily.length,range);assert.equal(result.daily.at(-1).date,'2026-10-03');
  }
  assert.equal(all('PRAGMA foreign_key_check').length,0);
  pass('Supported calendar ranges zero-fill correctly and isolated database retains FK integrity');
  console.log(`Merchant stats: ${cases} passed; in-memory SQLite only.`);
}finally{Date.now=realNow;close();}
