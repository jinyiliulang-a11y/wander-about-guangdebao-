import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { reset,run,get,all,action,load,request,d1,sha,environment,mockModule,close } from './business-fixture.mjs';
import { setupFixtureGeofences,fixtureLocation } from './geofence-fixture.mjs';

// Real production handlers/SQL on disposable SQLite. Revoke approval after the
// handler's initial auth read but immediately before its actual D1 mutation.
let cases=0;
let emailCode;
mockModule('lib/smtp-mail.ts',{mailConfigured:()=>true,sendVerificationEmail:async(_email,code)=>{emailCode=code;}});
environment.MAIL_PASS='isolated-authorization-mail-pepper';
const pass=name=>console.log(`PASS ${++cases}: ${name}`);
const fresh=()=>{reset();setupFixtureGeofences();};
const snapshot=tables=>sha(JSON.stringify(tables.map(name=>[name,all(`SELECT * FROM ${name} ORDER BY rowid`)])));
const coupon={title:'Account guard coupon',type:'cash',value:5,minAmount:20,totalCount:15,validStart:null,validEnd:null,status:'active'};
const clues=['第一条完整线索','第二条完整线索','第三条完整线索','第四条完整线索','第五条完整线索'];
const claim=()=>action('claim',{taskId:'quest-tea',answer:'茉莉',location:fixtureLocation()});
const publish={title:'门店有效观察任务',clues,question:'观察这里有什么图案',answer:'茉莉',difficulty:2,rewardType:'points',rewardValue:50,expiresAt:null};
async function race(match,mutate,operation){
  const original=d1.prepare;let triggered=false;
  d1.prepare=sql=>{
    const statement=original(sql);
    if(match(sql))for(const method of ['run','execute']){
      const execute=statement[method];statement[method]=(...args)=>{if(!triggered){triggered=true;mutate();}return execute(...args);};
    }
    return statement;
  };
  try{await operation();assert(triggered,'test must intercept the actual SQL write');}finally{d1.prepare=original;}
}
const revoke=actor=>()=>run("UPDATE accounts SET status='rejected' WHERE id=?",'fixture-'+actor);
const denied=async operation=>{await assert.rejects(operation,error=>[400,401,403,404,409].includes(error.status));};
const addCoupon=async()=>{const result=await action('couponCreate',coupon,'merchant','merchant');return result.templateId;};
const addFeedback=async()=>{await claim();await action('feedback',{taskId:'quest-tea',clarity:3,comment:'隔离测试留言'});return get('SELECT id FROM feedback').id;};
const activity=()=>({storeId:'tea',title:'本店位置活动',description:'请到店体验本活动。',startAt:Date.now()-1000,endAt:Date.now()+86400000,expectedRevision:0,requestId:randomUUID()});
const scenarios=[
  ['player place','a',()=>{},sql=>sql.includes('INSERT INTO tasks'),()=>action('place',{requestId:randomUUID(),storeId:'book',title:'玩家投稿完整标题',clues,rewardType:'points',rewardValue:50}),['tasks','points_ledger']],
  ['player claim','a',()=>{},sql=>sql.includes('INSERT INTO claims'),claim,['claims','points_ledger','players']],
  ['paid clue unlock','a',()=>{},sql=>sql.includes('INSERT INTO clue_unlocks'),()=>action('unlockClue',{taskId:'quest-tea',index:2}),['clue_unlocks','points_ledger','players']],
  ['share generation','a',()=>{},sql=>sql.includes('INSERT INTO share_events'),()=>action('recordShare',{taskId:'quest-tea'}),['share_events','points_ledger','players']],
  ['feedback save','a',claim,sql=>sql.includes('INSERT INTO feedback'),()=>action('feedback',{taskId:'quest-tea',clarity:2,comment:'不应保存'}),['feedback']],
  ['feedback delete','a',addFeedback,sql=>sql.includes('UPDATE feedback SET deleted_at'),id=>action('feedbackDelete',{feedbackId:id}),['feedback']],
  ['own task delete','author',()=>{},sql=>sql.includes('INSERT INTO task_reviews'),()=>action('taskDelete',{taskId:'quest-tea'},'author'),['tasks','task_reviews','hardware_devices']],
  ['coupon create','merchant',()=>{},sql=>sql.includes('INSERT INTO coupon_templates'),()=>action('couponCreate',coupon,'merchant','merchant'),['coupon_templates']],
  ['coupon update','merchant',addCoupon,sql=>sql.includes('UPDATE coupon_templates SET title'),id=>action('couponUpdate',{...coupon,templateId:id,title:'不应保存修改'},'merchant','merchant'),['coupon_templates']],
  ['coupon deactivate','merchant',addCoupon,sql=>sql.includes("UPDATE coupon_templates SET status='inactive'"),id=>action('couponDeactivate',{templateId:id},'merchant','merchant'),['coupon_templates']],
  ['coupon delete','merchant',addCoupon,sql=>sql.includes('UPDATE coupon_templates SET deleted_at'),id=>action('couponDelete',{templateId:id},'merchant','merchant'),['coupon_templates']],
  ['merchant profile','merchant',()=>{},sql=>sql.includes('UPDATE stores SET name'),()=>action('merchantProfileSave',{name:'不应保存店名',logo:'🏪',category:'茶饮',floor:'F1',address:'测试地址',phone:''},'merchant','merchant'),['stores']],
  ['device bind','merchant',()=>{},sql=>sql.includes('UPDATE hardware_devices SET bound_task_id'),()=>action('deviceBind',{deviceId:'coin-tea-01',taskId:'quest-tea'},'merchant','merchant'),['hardware_devices']],
  ['device withdraw','merchant',()=>{},sql=>sql.includes("UPDATE tasks SET status='offline'"),()=>action('deviceWithdraw',{deviceId:'coin-tea-01'},'merchant','merchant'),['hardware_devices','tasks']],
  ['device maintain','merchant',()=>{},sql=>sql.includes('UPDATE hardware_devices SET enabled'),()=>action('deviceMaintain',{deviceId:'coin-tea-01'},'merchant','merchant'),['hardware_devices']],
  ['device resume','merchant',()=>run('UPDATE hardware_devices SET enabled=0'),sql=>sql.includes('UPDATE hardware_devices SET enabled'),()=>action('deviceResume',{deviceId:'coin-tea-01'},'merchant','merchant'),['hardware_devices']],
  ['merchant publication','merchant',()=>{},sql=>sql.includes('INSERT INTO tasks'),()=>action('merchantPublish',publish,'merchant','merchant'),['tasks','hardware_devices']],
  ['merchant fence save','merchant',()=>{},sql=>sql.includes('INSERT INTO store_geofences'),()=>action('geofenceSave',{storeId:'tea',enabled:true,latitude:31.23,longitude:121.47,radiusMeters:180,expectedRevision:1},'merchant','merchant'),['store_geofences']],
  ['activity save','merchant',()=>{},sql=>sql.includes('INSERT INTO store_activities'),()=>action('storeActivitySave',activity(),'merchant','merchant'),['store_activities']],
  ['activity withdraw','merchant',async()=>(await action('storeActivitySave',activity(),'merchant','merchant')).activity,sql=>sql.includes('UPDATE store_activities SET status'),item=>action('storeActivityWithdraw',{id:item.id,expectedRevision:item.revision},'merchant','merchant'),['store_activities']],
  ['activity review','admin',async()=>(await action('storeActivitySave',activity(),'merchant','merchant')).activity,sql=>sql.includes('UPDATE store_activities SET status'),item=>action('storeActivityReview',{id:item.id,expectedRevision:item.revision,decision:'publish'},'admin','admin'),['store_activities']],
  ['coupon redemption','merchant',claim,sql=>sql.includes('UPDATE claims SET redeemed_at'),result=>action('redeem',{code:result.coupon.code},'merchant','merchant'),['claims']],
  ['operator user status','admin',()=>{},sql=>sql.includes('UPDATE players SET banned'),()=>action('opsUserStatus',{playerId:'b',banned:true},'admin','admin'),['players']],
  ['operator points adjustment','admin',()=>{},sql=>sql.includes('INSERT INTO points_ledger'),()=>action('opsPointsAdjust',{playerId:'b',delta:10,reason:'测试调账',requestId:'auth-guard-adjustment'},'admin','admin'),['points_ledger','players']],
  ['operator store status','admin',()=>{},sql=>sql.includes('UPDATE stores SET status'),()=>action('opsStoreStatus',{storeId:'tea',status:'inactive'},'admin','admin'),['stores']],
  ['operator settings','admin',()=>{},sql=>sql.includes('UPDATE game_settings SET daily_limit'),()=>action('opsSettingsSave',{dailyLimit:7,clueCosts:[0,0,10,20,30],contributionRatio:0.2,ugcReview:true},'admin','admin'),['game_settings']],
  ['operator task review','admin',()=>run("UPDATE tasks SET status='pending' WHERE id='quest-book'"),sql=>sql.includes('INSERT INTO task_reviews'),()=>action('review',{taskId:'quest-book',status:'published'},'admin','admin'),['tasks','task_reviews']],
  ['operator task feature','admin',()=>{},sql=>sql.includes('INSERT INTO task_reviews'),()=>action('feature',{taskId:'quest-book',featured:true},'admin','admin'),['tasks','task_reviews']],
];
try{
  for(const [name,actor,setup,match,operation,tables]of scenarios){fresh();const input=await setup(),before=snapshot(tables);await race(match,revoke(actor),()=>denied(()=>operation(input)));assert.equal(snapshot(tables),before);pass(`Approval revoked before ${name} prevents resource/ledger changes`);}
  fresh();const before=snapshot(['coupon_templates']);await race(sql=>sql.includes('INSERT INTO coupon_templates'),()=>run("UPDATE accounts SET store_id='book' WHERE id='fixture-merchant'"),()=>denied(()=>action('couponCreate',coupon,'merchant','merchant')));assert.equal(snapshot(['coupon_templates']),before);pass('Merchant account store reassignment invalidates the stale scoped SQL write');
  fresh();const draft=load('lib/creator-draft-server.ts'),req=new Request('http://localhost/api/creator-draft',{headers:{Cookie:request().headers.get('Cookie'),'X-Mall-Quest-Player':'a'}});
  const input={storeId:'tea',title:'测试草稿',clues:['','','','',''],options:{difficulty:3,expiresAt:null,rewardType:'points',rewardValue:50,rewardCouponId:null,photoURLs:['','','','','']},step:0,submissionId:null};
  await race(sql=>sql.includes('INSERT OR IGNORE INTO creator_drafts'),revoke('a'),()=>denied(()=>draft.writeCreatorDraft(req,{expectedRevision:0,requestId:'auth-draft-create',draft:input})));assert.equal(get('SELECT COUNT(*) AS n FROM creator_drafts').n,0);pass('Account revocation before draft batch creates no placeholder or saved draft');
  fresh();await race(sql=>sql.includes('INSERT INTO sessions'),revoke('b'),()=>denied(()=>action('accountLogin',{role:'player',username:'fixture-b',password:'fixture-password'})));
  assert.equal((await load('lib/game-server.ts').session(request())).account_id,'fixture-a');assert.equal(get("SELECT COUNT(*) AS n FROM sessions WHERE player_id='b'").n,1);pass('Login CAS rejects approval changed after password verification and preserves the previous account session');
  fresh();await race(sql=>sql.includes('INSERT INTO sessions'),()=>run("UPDATE accounts SET store_id='book' WHERE id='fixture-merchant'"),()=>denied(()=>action('staffLogin',{role:'merchant',username:'fixture-merchant',password:'fixture-password'})));
  assert.equal((await load('lib/game-server.ts').session(request())).account_id,'fixture-a');pass('Login CAS rejects store rebinding after password verification instead of issuing a mismatched session');
  fresh();const applicationId=randomUUID(),mailbox='review-race-shop@example.test';
  const proof=await action('emailCodeSend',{requestId:randomUUID(),role:'merchant',email:mailbox,purpose:'register'});
  await action('accountRegister',{requestId:applicationId,role:'merchant',username:mailbox,email:mailbox,emailCode,emailChallengeId:proof.challengeId,password:'111',merchant:{name:'隔离审核门店',address:'隔离测试地址',floor:'F1',area:'中庭',category:'茶饮',phone:'',latitude:31.23,longitude:121.47,radiusMeters:150,coupon:{title:'满20减5',type:'cash',value:5,minAmount:20,totalCount:5,conditions:'仅隔离测试',validStart:null,validEnd:null}}});
  const resources=snapshot(['stores','store_geofences','coupon_templates']);await race(sql=>sql.includes('UPDATE accounts AS a SET review_token'),revoke('admin'),()=>denied(()=>action('accountReview',{id:applicationId,expectedRevision:1,status:'approved'},'admin','admin')));
  assert.equal(snapshot(['stores','store_geofences','coupon_templates']),resources);assert.equal(get('SELECT status FROM accounts WHERE id=?',applicationId).status,'pending');pass('Review decision CAS rechecks admin approval and creates no partial merchant resources');
  console.log(JSON.stringify({status:'PASS',cases,isolatedDatabase:':memory:',persistentD1Opened:false,networkRequests:0,serialAccess:false}));
}finally{delete environment.MAIL_PASS;close();}
