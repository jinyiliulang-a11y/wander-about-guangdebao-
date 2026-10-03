import assert from 'node:assert/strict';
import { readFileSync,readdirSync } from 'node:fs';
import path from 'node:path';
import { reset,run,get,all,exec,load,request,d1,sha,root,environment,bindFixtureAccounts,mockModule,close } from './business-fixture.mjs';

// Production handlers and SQL, disposable SQLite, fake SMTP boundary only.
let cases=0,sequence=0,configured=true,delivery=async()=>{},messages=[];
const pass=label=>console.log(`PASS ${++cases}: ${label}`);
const id=()=>`e0000000-0000-4000-8000-${String(++sequence).padStart(12,'0')}`;
mockModule('lib/smtp-mail.ts',{
  mailConfigured:()=>configured,
  sendVerificationEmail:async(email,code,purpose,role)=>{messages.push({email,code,purpose,role});await delivery();},
});
const call=(action,input={},req=request())=>load('lib/game-server.ts').execute(req,{action,...input});
const deny=async(label,fn,status)=>{await assert.rejects(fn,e=>status===undefined||e.status===status);pass(label);};
const count=table=>get(`SELECT COUNT(*) AS n FROM ${table}`).n;
const send=(role='player',email='player@example.test',purpose='register',requestId=id(),req=request())=>
  call('emailCodeSend',{role,email,purpose,requestId},req);
const latest=()=>messages.at(-1).code;
const wrong=code=>code==='000000'?'999999':'000000';
const cookies=result=>new Request('http://localhost/api/game',{headers:{Cookie:result.setCookie.map(c=>c.split(';')[0]).join('; ')}});
function fresh(){reset();configured=true;delivery=async()=>{};messages=[];environment.MAIL_PASS='isolated-mail-pepper-no-real-secret';}
async function challenge(role='player',email='player@example.test',purpose='register'){
  const result=await send(role,email,purpose);
  return{role,email:email.trim().toLowerCase(),code:latest(),challengeId:result.challengeId};
}
const register=(proof,extra={})=>({requestId:id(),role:proof.role,email:proof.email,emailCode:proof.code,
  emailChallengeId:proof.challengeId,password:'new-password',confirmPassword:'new-password',nickname:'邮箱玩家',...extra});
async function race(change,fn){
  const original=d1.batch,prepare=d1.prepare;let done=false;
  d1.prepare=sql=>{const statement=prepare(sql);statement.fixtureSQL=sql;return statement;};
  d1.batch=async statements=>{
    if(!done&&statements.some(statement=>statement.fixtureSQL.includes('UPDATE email_challenges SET consumed_at'))){done=true;change();}
    return original(statements);
  };
  try{return await fn();}
  finally{d1.batch=original;d1.prepare=prepare;assert(done,'race must intercept the actual proof-consumption batch');}
}
const unused=proof=>assert.equal(get('SELECT consumed_at FROM email_challenges WHERE id=?',proof.challengeId).consumed_at,null);
const noRegistration=input=>{
  assert.equal(get('SELECT COUNT(*) AS n FROM accounts WHERE request_id=?',input.requestId).n,0);
  assert.equal(get('SELECT COUNT(*) AS n FROM players WHERE id=?','account-player-'+input.requestId).n,0);
};

try{
  reset({legacy:true});
  for(const file of readdirSync(path.join(root,'drizzle')).filter(f=>f.endsWith('.sql')&&f>='0003'&&f<'0011').sort())
    exec(readFileSync(path.join(root,'drizzle',file),'utf8'));
  bindFixtureAccounts();
  const names=all("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").map(r=>r.name);
  const before=Object.fromEntries(names.map(name=>[name,all(`SELECT * FROM ${name} ORDER BY rowid`)]));
  assert.equal(names.length,24);exec(readFileSync(path.join(root,'drizzle/0011_email_accounts.sql'),'utf8'));
  assert.equal(all("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").length,25);
  for(const name of names){
    const rows=all(`SELECT * FROM ${name} ORDER BY rowid`);assert.equal(rows.length,before[name].length);
    for(let i=0;i<rows.length;i++)for(const [key,value]of Object.entries(before[name][i]))assert.equal(rows[i][key],value);
  }
  assert(all('SELECT email FROM accounts').every(r=>r.email===null));assert.equal(count('email_challenges'),0);
  pass('0011 adds email/challenges without rewriting any existing business or account values');

  exec(readFileSync(path.join(root,'drizzle/0012_store_image.sql'),'utf8'));
  run("UPDATE accounts SET email='legacy@example.test' WHERE id='fixture-a'");
  run("UPDATE accounts SET status='pending',review_note='保留审核记录' WHERE id='fixture-merchant'");
  run(`INSERT INTO email_challenges(id,role,email,purpose,code_hash,send_status,created_at,expires_at,attempts)
    VALUES(?,?,?,?,?,'sent',?,?,2)`,id(),'player','legacy@example.test','register',sha('migration-fixture'),Date.now(),Date.now()+300000);
  const migrationNames=all("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").map(r=>r.name);
  const migrationRows=Object.fromEntries(migrationNames.map(name=>[name,all(`SELECT * FROM ${name} ORDER BY rowid`)]));
  // D1/Wrangler applies each migration file as one transaction. Autocommit would
  // reset defer_foreign_keys between statements and does not model that runner.
  exec('BEGIN');
  try{exec(readFileSync(path.join(root,'drizzle/0013_email_usernames.sql'),'utf8'));exec('COMMIT');}
  catch(error){exec('ROLLBACK');throw error;}
  for(const name of migrationNames)assert.deepEqual(all(`SELECT * FROM ${name} ORDER BY rowid`),migrationRows[name]);
  assert.equal(get('PRAGMA integrity_check').integrity_check,'ok');assert.deepEqual(all('PRAGMA foreign_key_check'),[]);
  pass('0013 widens username storage while preserving every account/session/business/email-proof value and foreign key');

  fresh();configured=false;const sessionCount=count('sessions');
  await deny('Missing SMTP fails closed without mail, challenge, fallback code or session',()=>send(),503);
  assert.equal(messages.length,0);assert.equal(count('email_challenges'),0);assert.equal(count('sessions'),sessionCount);
  // Normal password login remains available when the mail service is down.
  const legacy=await call('accountLogin',{role:'player',username:'fixture-a',password:'fixture-password'});
  assert.equal(legacy.accountId,'fixture-a');pass('Legacy password login needs no SMTP service');

  fresh();
  for(const extra of [{email:'bad'},{email:'a@example.test\r\nBcc:private'},{role:'other'},
    {purpose:'reset-password'},{requestId:'not-uuid'}])
    await deny('Malformed mailbox/scope and independent OTP-login send are refused',()=>call('emailCodeSend',
      {role:'player',email:'player@example.test',purpose:'register',requestId:id(),...extra}),400);
  assert.equal(messages.length,0);
  await deny('Independent OTP-login mail purpose is retired',()=>send('player','player@example.test','login'),410);
  await deny('The retired emailLogin API cannot issue sessions even with forged proof',()=>call('emailLogin',
    {role:'player',email:'player@example.test',code:'111111',challengeId:id()}),410);
  assert.equal(count('sessions'),sessionCount);

  const sentId=id(),sent=await send('player','  Player@Example.Test ','register',sentId);
  assert.equal(sent.challengeId,sentId);assert.equal(sent.retryAfter,60);
  assert(sent.expiresAt>Date.now()&&sent.expiresAt-Date.now()<=300000);assert(/^\d{6}$/.test(latest()));
  assert(!JSON.stringify(sent).includes(latest()));
  const stored=get('SELECT * FROM email_challenges WHERE id=?',sentId);
  assert.equal(stored.email,'player@example.test');assert.equal(stored.send_status,'sent');assert.equal(stored.code_hash.length,64);
  assert(!JSON.stringify(stored).includes(`"${latest()}"`));assert(!JSON.stringify(stored).includes(environment.MAIL_PASS));
  pass('Successful SMTP stores only scoped HMAC and returns challenge metadata without code or pepper');
  assert.deepEqual(await send('player','player@example.test','register',sentId),sent);assert.equal(messages.length,1);
  pass('Exact send UUID replay returns the original challenge without another mail');
  for(const extra of [{role:'merchant'},{email:'other@example.test'},{purpose:'bind'}])
    await deny('Changing role/mailbox/purpose cannot replay the original send UUID',()=>call('emailCodeSend',
      {role:'player',email:'player@example.test',purpose:'register',requestId:sentId,...extra}),409);
  await deny('Fresh UUID observes the 60-second subject cooldown',()=>send(),429);assert.equal(messages.length,1);

  fresh();delivery=async()=>{throw new Error('isolated SMTP failure');};const failedId=id();
  await deny('Transport failure never publishes usable proof',()=>send('player','player@example.test','register',failedId),503);
  assert.equal(get('SELECT send_status FROM email_challenges WHERE id=?',failedId).send_status,'failed');
  const failedRow=get('SELECT * FROM email_challenges WHERE id=?',failedId),failedProof={role:'player',email:'player@example.test',code:latest(),challengeId:failedId};
  await deny('Known failed send UUID replay is definite 409 and never resends',()=>send('player','player@example.test','register',failedId),409);
  assert.equal(messages.length,1);assert.deepEqual(get('SELECT * FROM email_challenges WHERE id=?',failedId),failedRow);
  await deny('Failed delivery code cannot register',()=>call('accountRegister',register(failedProof)),400);unused(failedProof);
  delivery=async()=>{};
  await deny('New send after failure still observes cooldown',()=>send(),429);
  run('UPDATE email_challenges SET created_at=created_at-61000,expires_at=expires_at-61000 WHERE id=?',failedId);
  const recovered=await send();assert.equal(messages.length,2);assert.notEqual(recovered.challengeId,failedId);
  await deny('Failed original UUID remains known-failed after recovery',()=>send('player','player@example.test','register',failedId),409);

  fresh();let release;delivery=()=>new Promise(resolve=>release=resolve);
  const pendingId=id(),pending=send('player','player@example.test','register',pendingId);
  while(!release)await new Promise(resolve=>setTimeout(resolve,0));
  await deny('Concurrent same UUID observes pending delivery without duplicate mail',()=>send('player','player@example.test','register',pendingId),409);
  const pendingProof={role:'player',email:'player@example.test',code:latest(),challengeId:pendingId};
  await deny('Pending SMTP delivery cannot register',()=>call('accountRegister',register(pendingProof)),400);
  release();await pending;assert.equal(messages.length,1);assert.equal(get('SELECT send_status FROM email_challenges WHERE id=?',pendingId).send_status,'sent');

  fresh();await load('lib/account-auth.ts').ensureDemoAdmin();
  const proof=await challenge(),base=register(proof),beforeAccounts=count('accounts');
  for(const patch of [{email:undefined},{email:''},{emailCode:undefined},{emailCode:''},{emailCode:'12345'},
    {emailChallengeId:undefined},{emailChallengeId:'bad'},{username:'other@example.test'},{username:'standalone-user'}]){
    const input={...base,...patch};await deny('Registration requires complete mailbox proof and rejects independent username',()=>call('accountRegister',input),400);
    unused(proof);noRegistration(input);assert.equal(count('accounts'),beforeAccounts);
  }
  for(const patch of [{role:'admin'},{email:'another@example.test'},{emailChallengeId:id()}]){
    const input={...base,...patch};await deny('Register proof is bound to exact role/mailbox/challenge',()=>call('accountRegister',input),400);
    unused(proof);noRegistration(input);
  }
  for(let i=0;i<5;i++)await deny('Wrong OTP increments attempts but creates no account',()=>call('accountRegister',register(proof,{emailCode:wrong(proof.code)})),400);
  assert.equal(get('SELECT attempts FROM email_challenges WHERE id=?',proof.challengeId).attempts,5);
  await deny('Five wrong attempts lock the challenge even for correct code',()=>call('accountRegister',register(proof)),400);unused(proof);

  fresh();const bindingPurpose=await challenge('player','bound-purpose@example.test','bind');
  await deny('Bind-purpose proof cannot substitute for registration proof',()=>call('accountRegister',register(bindingPurpose)),400);unused(bindingPurpose);
  fresh();const retiredProof=await challenge(),retiredSessions=count('sessions');
  await deny('Even a correctly sent registration OTP cannot authenticate via retired emailLogin',()=>call('emailLogin',retiredProof),410);
  unused(retiredProof);assert.equal(count('sessions'),retiredSessions);

  fresh();const canonicalProof=await challenge('player','  New.Owner@Example.Test '),registration=register(canonicalProof,
    {email:' New.Owner@Example.Test ',username:'  NEW.OWNER@EXAMPLE.TEST  '}),priorSessions=count('sessions');
  const created=await call('accountRegister',registration),row=get('SELECT * FROM accounts WHERE request_id=?',registration.requestId);
  assert.equal(created.registered,true);assert.equal(created.username,'new.owner@example.test');assert.equal(row.username,row.email);
  assert.equal(row.email,'new.owner@example.test');assert.equal(row.status,'approved');assert.equal(row.password_iterations,100000);
  assert.match(row.password_salt,/^[0-9a-f]{32}$/);assert.match(row.password_hash,/^[0-9a-f]{64}$/);
  assert(get('SELECT consumed_at FROM email_challenges WHERE id=?',canonicalProof.challengeId).consumed_at);
  assert.equal(count('sessions'),priorSessions);assert(!Object.hasOwn(created,'setCookie'));
  assert(!JSON.stringify(created).includes(registration.password));pass('Verified registration canonicalizes email as username, hashes password and does not log in');
  const passwordLogin=await call('accountLogin',{role:'player',username:' NEW.OWNER@EXAMPLE.TEST ',password:registration.password});
  assert.equal(passwordLogin.accountId,registration.requestId);assert.equal(passwordLogin.role,'player');
  assert.equal(await load('lib/account-auth.ts').registeredPlayer(cookies(passwordLogin)),row.player_id);
  assert(passwordLogin.setCookie.every(c=>c.includes('HttpOnly')));pass('Normal login uses mailbox plus password and protected existing account cookies');
  await deny('Correct mailbox never replaces the required password',()=>call('accountLogin',
    {role:'player',username:row.email,password:'wrong'}),401);
  run('UPDATE email_challenges SET created_at=?,expires_at=? WHERE id=?',Date.now()-600000,Date.now()-1,canonicalProof.challengeId);
  assert.equal((await call('accountRegister',registration)).replayed,true);
  pass('Exact successful request replay survives consumed and expired registration proof without another mail');
  for(const patch of [{email:'other@example.test'},{emailChallengeId:id()},{emailCode:wrong(registration.emailCode)},{password:'changed-password',confirmPassword:'changed-password'},
    {nickname:'不同昵称'},{requestId:id()}])await deny('Registration replay cannot alter original email/challenge/password/profile/request identity',
      ()=>call('accountRegister',{...registration,...patch,username:patch.email??registration.username}),409);
  const reused={...registration,requestId:id()};await deny('Consumed proof cannot register a duplicate account with a new request',()=>call('accountRegister',reused),409);

  fresh();const longEmail='u'.repeat(64)+'@'+'a'.repeat(63)+'.'+'b'.repeat(63)+'.'+'c'.repeat(61);
  assert.equal(longEmail.length,254);const longProof=await challenge('player',longEmail),longInput=register(longProof,{nickname:undefined});
  const longResult=await call('accountRegister',longInput);assert.equal(longResult.username,longEmail);
  assert.equal(get('SELECT nickname FROM accounts WHERE id=?',longInput.requestId).nickname,'u'.repeat(24));
  assert.equal((await call('accountLogin',{role:'player',username:longEmail,password:longInput.password})).accountId,longInput.requestId);
  pass('A valid 254-character email persists/logs in, with no legacy 32-character username limit or nickname failure');
  await deny('A mailbox longer than 254 cannot send proof',()=>send('player',longEmail+'a'),400);
  await deny('A mailbox longer than 254 cannot register',()=>call('accountRegister',{...longInput,requestId:id(),email:longEmail+'a'}),400);
  await deny('A mailbox longer than 254 cannot log in',()=>call('accountLogin',{role:'player',username:longEmail+'a',password:'wrong'}),400);

  fresh();const sameEmail='shared@example.test',passwords={player:'player-pass',merchant:'merchant-pass',admin:'admin-pass'},results={};
  const merchant={name:'邮箱隔离门店',address:'上海测试地址',floor:'F1',area:'中庭',category:'茶饮',phone:'',latitude:31.23,
    longitude:121.47,radiusMeters:150,coupon:{title:'满20减5',type:'cash',value:5,minAmount:20,totalCount:5,conditions:'仅测试',validStart:null,validEnd:null}};
  for(const role of ['player','merchant','admin']){
    if(role!=='player')run('UPDATE email_challenges SET created_at=created_at-61000,expires_at=expires_at-61000');
    const roleProof=await challenge(role,sameEmail),input=register(roleProof,{password:passwords[role],confirmPassword:passwords[role],
      ...(role==='merchant'?{merchant}:{})}),result=await call('accountRegister',input);results[role]=input;
    assert.equal(result.status,role==='player'?'approved':'pending');assert.equal(get('SELECT username FROM accounts WHERE id=?',input.requestId).username,sameEmail);
    if(role!=='player'){
      await deny('Mail verification never bypasses merchant/operator approval',()=>call('staffLogin',{role,username:sameEmail,password:passwords[role]}),403);
      await call('accountReview',{id:input.requestId,expectedRevision:1,status:'approved'},request('admin','admin'));
    }
  }
  assert.equal(get('SELECT COUNT(*) AS n FROM accounts WHERE username=?',sameEmail).n,3);
  assert.equal(new Set(all('SELECT player_id FROM accounts WHERE username=?',sameEmail).map(r=>r.player_id)).size,3);
  for(const role of ['player','merchant','admin']){
    const login=await call(role==='player'?'accountLogin':'staffLogin',{role,username:sameEmail,password:passwords[role]});
    assert.equal(login.accountId,results[role].requestId);assert.equal(login.role,role);
    if(role!=='player')await deny('Workspace mailbox login never authenticates client rewards',()=>load('lib/account-auth.ts').registeredPlayer(cookies(login)),401);
    await deny('Same mailbox cannot reuse another role password',()=>call(role==='player'?'accountLogin':'staffLogin',
      {role,username:sameEmail,password:passwords[role==='admin'?'player':'admin']}),401);
  }
  pass('One email has independent player, merchant and operator identities, passwords, approval and history');

  fresh();const timedProof=await challenge('merchant','timed-merchant@example.test'),couponEnd=Date.now()+60000;
  const timedInput=register(timedProof,{merchant:{...merchant,coupon:{...merchant.coupon,validEnd:couponEnd}}});
  assert.equal((await call('accountRegister',timedInput)).status,'pending');
  const expiredProof=await challenge('merchant','new-expired-merchant@example.test');
  const expiredInput=register(expiredProof,{merchant:timedInput.merchant}),actualNow=Date.now;
  const publicBefore=sha(JSON.stringify(['stores','store_geofences','coupon_templates'].map(table=>all(`SELECT * FROM ${table} ORDER BY rowid`))));
  Date.now=()=>couponEnd+1;
  try{
    assert.equal((await call('accountRegister',timedInput)).replayed,true);
    pass('Successful merchant submission can recover its exact request after the included coupon expires');
    await deny('New expired-coupon submission still fails before creating or consuming proof',()=>call('accountRegister',expiredInput),400);
    unused(expiredProof);noRegistration(expiredInput);
    await deny('Expired-coupon pending application cannot approve expired public resources',()=>call('accountReview',
      {id:timedInput.requestId,expectedRevision:1,status:'approved'},request('admin','admin')),400);
    assert.equal(sha(JSON.stringify(['stores','store_geofences','coupon_templates'].map(table=>all(`SELECT * FROM ${table} ORDER BY rowid`)))),publicBefore);
  }finally{Date.now=actualNow;}

  fresh();const duplicateProof=await challenge('player','duplicate@example.test');
  run("UPDATE accounts SET email='duplicate@example.test' WHERE id='fixture-b'");
  const duplicateInput=register(duplicateProof);
  await deny('Legacy same-role mailbox collision consumes no proof and creates no orphan',()=>call('accountRegister',duplicateInput),409);
  unused(duplicateProof);noRegistration(duplicateInput);

  for(const [label,change]of[
    ['mailbox claimed by a same-role account',()=>run("UPDATE accounts SET email='register@example.test' WHERE id='fixture-b'")],
    ['username claimed by another same-role account',()=>run("UPDATE accounts SET username='register@example.test' WHERE id='fixture-b'")],
    ['OTP revoked',()=>run("UPDATE email_challenges SET send_status='failed'")],
    ['OTP expires',()=>run('UPDATE email_challenges SET created_at=?,expires_at=?',Date.now()-600000,Date.now()-1)],
  ]){
    fresh();const queued=await challenge('player','register@example.test'),input=register(queued);
    await deny(`Final registration CAS rejects queued ${label}`,()=>race(change,()=>call('accountRegister',input)),409);
    noRegistration(input);unused(queued);
  }
  fresh();const oneProof=await challenge(),oneInput=register(oneProof);
  const competing=await Promise.allSettled([call('accountRegister',oneInput),call('accountRegister',{...oneInput,requestId:id()})]);
  assert.equal(competing.filter(r=>r.status==='fulfilled').length,1);assert.equal(get('SELECT COUNT(*) AS n FROM accounts WHERE email=?',oneProof.email).n,1);
  assert(get('SELECT consumed_at FROM email_challenges WHERE id=?',oneProof.challengeId).consumed_at);pass('Two competing UUIDs consume one mailbox proof for exactly one account');
  fresh();const sameProof=await challenge(),sameInput=register(sameProof);
  const exact=await Promise.all([call('accountRegister',sameInput),call('accountRegister',sameInput)]);
  assert(exact.every(r=>r.registered));assert.equal(get('SELECT COUNT(*) AS n FROM accounts WHERE email=?',sameProof.email).n,1);
  pass('Concurrent identical registration UUIDs reconcile as one successful creation/replay');

  for(const [label,change,restore]of[
    ['reusable guest is banned',()=>run("UPDATE players SET banned=1 WHERE id='a'"),()=>run("UPDATE players SET banned=0 WHERE id='a'")],
    ['reusable guest is bound by another account',()=>run(`INSERT INTO accounts(id,request_hash,username,role,password_salt,password_hash,password_iterations,player_id,nickname,status,created_at,updated_at)
      SELECT 'guest-binding-winner','fixture','guest-binding-winner','player',password_salt,password_hash,password_iterations,'a','先完成的注册','approved',?,? FROM accounts WHERE id='fixture-b'`,Date.now(),Date.now()),()=>{}],
  ]){
    fresh();run("UPDATE sessions SET account_id=NULL WHERE player_id='a'");run("DELETE FROM accounts WHERE id='fixture-a'");
    const guestProof=await challenge('player','guest@example.test'),input=register(guestProof);
    await deny(`Queued ${label} leaves OTP unused and creates no orphan`,()=>race(change,()=>call('accountRegister',input)),409);
    unused(guestProof);noRegistration(input);restore();assert.equal((await call('accountRegister',input)).registered,true);
    const actual=get('SELECT player_id FROM accounts WHERE request_id=?',input.requestId).player_id;
    assert.equal(label.includes('another account')?actual!=='a':actual==='a',true);
  }

  fresh();await load('lib/account-auth.ts').ensureDemoAdmin();
  const rollbackProof=await challenge(),rollbackInput=register(rollbackProof),accountsBefore=count('accounts'),playersBefore=count('players');
  exec("CREATE TRIGGER fixture_fail_email_account BEFORE INSERT ON accounts BEGIN SELECT RAISE(ABORT,'isolated account failure'); END;");
  await deny('Account insert failure rolls back consumed proof and player/account changes',()=>call('accountRegister',rollbackInput));
  unused(rollbackProof);assert.equal(count('accounts'),accountsBefore);assert.equal(count('players'),playersBefore);

  fresh();const boundProof=await challenge('player','bound@example.test','bind'),boundSessions=count('sessions');
  const bound=await call('accountEmailBind',{...boundProof,username:'fixture-a',password:'fixture-password'});
  assert.equal(bound.bound,true);assert.equal(bound.email,boundProof.email);assert.equal(count('sessions'),boundSessions);assert(!Object.hasOwn(bound,'setCookie'));
  assert.equal(get("SELECT username FROM accounts WHERE id='fixture-a'").username,'fixture-a');
  assert.equal((await call('accountLogin',{role:'player',username:'bound@example.test',password:'fixture-password'})).accountId,'fixture-a');
  pass('Legacy mailbox upgrade verifies password/proof, retains historical username and then supports mailbox+password login');

  fresh();const canonicalBindProof=await challenge('player','canonical@example.test'),canonicalInput=register(canonicalBindProof);
  await call('accountRegister',canonicalInput);
  const immutableAccount=get('SELECT * FROM accounts WHERE id=?',canonicalInput.requestId);
  const differentMailbox=await challenge('player','different@example.test','bind');
  await deny('Canonical email-as-username account cannot rebind a different mailbox through the legacy bind endpoint',()=>call('accountEmailBind',
    {...differentMailbox,username:canonicalInput.email,password:canonicalInput.password}),409);
  unused(differentMailbox);assert.deepEqual(get('SELECT * FROM accounts WHERE id=?',canonicalInput.requestId),immutableAccount);
  run('UPDATE email_challenges SET created_at=created_at-61000,expires_at=expires_at-61000 WHERE email=?',canonicalInput.email);
  const sameMailbox=await challenge('player',canonicalInput.email,'bind');
  assert.equal((await call('accountEmailBind',{...sameMailbox,username:canonicalInput.email,password:canonicalInput.password})).bound,true);
  assert.deepEqual(get('SELECT * FROM accounts WHERE id=?',canonicalInput.requestId),immutableAccount);
  assert(get('SELECT consumed_at FROM email_challenges WHERE id=?',sameMailbox.challengeId).consumed_at);
  pass('Same-mailbox verified binding consumes proof without changing account revision, timestamp, password or identity');
  fresh();const wrongPassword=await challenge('player','bound@example.test','bind');
  await deny('Mailbox proof alone cannot take over a legacy password account',()=>call('accountEmailBind',
    {...wrongPassword,username:'fixture-a',password:'wrong'}),401);unused(wrongPassword);
  fresh();run("UPDATE accounts SET email='bound@example.test' WHERE id='fixture-b'");const bindCollision=await challenge('player','bound@example.test','bind');
  await deny('Legacy bind mailbox collision retains unconsumed proof',()=>call('accountEmailBind',
    {...bindCollision,username:'fixture-a',password:'fixture-password'}),409);unused(bindCollision);
  for(const [label,change]of[
    ['password rotation',()=>run("UPDATE accounts SET password_hash=? WHERE id='fixture-a'",sha('changed credential'))],
    ['mailbox rebound',()=>run("UPDATE accounts SET email='other@example.test' WHERE id='fixture-a'")],
    ['historical username renamed',()=>run("UPDATE accounts SET username='renamed@example.test' WHERE id='fixture-a'")],
    ['account ban',()=>run("UPDATE players SET banned=1 WHERE id='a'")],
  ]){
    fresh();const binding=await challenge('player','bind@example.test','bind');
    await deny(`Binding final CAS rejects ${label}`,()=>race(change,()=>call('accountEmailBind',
      {...binding,username:'fixture-a',password:'fixture-password'})),409);unused(binding);
  }

  fresh();const older=await challenge();run('UPDATE email_challenges SET created_at=created_at-61000,expires_at=expires_at-61000');
  const newer=await challenge();assert.equal(get('SELECT send_status FROM email_challenges WHERE id=?',older.challengeId).send_status,'failed');
  await deny('Successful same-purpose resend invalidates older proof',()=>call('accountRegister',register(older)),400);
  assert.equal((await call('accountRegister',register(newer))).registered,true);
  fresh();const preserved=await challenge();run('UPDATE email_challenges SET created_at=created_at-61000,expires_at=expires_at-61000');
  delivery=async()=>{throw new Error('isolated resend failure');};await deny('Failed resend preserves previously delivered proof',()=>send(),503);
  assert.equal(get('SELECT send_status FROM email_challenges WHERE id=?',preserved.challengeId).send_status,'sent');
  assert.equal((await call('accountRegister',register(preserved))).registered,true);
  fresh();const retained=await challenge();run('UPDATE email_challenges SET created_at=created_at-61000,expires_at=expires_at-61000');
  await challenge('player','player@example.test','bind');assert.equal(get('SELECT send_status FROM email_challenges WHERE id=?',retained.challengeId).send_status,'sent');
  assert.equal((await call('accountRegister',register(retained))).registered,true);pass('New delivery replaces only identical role/mailbox/purpose');

  fresh();let lateRelease;delivery=()=>new Promise(resolve=>lateRelease=resolve);const lateId=id(),late=send('player','player@example.test','register',lateId);
  const lateRejected=deny('Late older delivery cannot supersede a newer successful challenge',()=>late,503);
  while(!lateRelease)await new Promise(resolve=>setTimeout(resolve,0));run('UPDATE email_challenges SET created_at=created_at-61000,expires_at=expires_at-61000');
  delivery=async()=>{};const newest=await send();lateRelease();await lateRejected;
  assert.equal(get('SELECT send_status FROM email_challenges WHERE id=?',lateId).send_status,'failed');
  assert.equal(get('SELECT send_status FROM email_challenges WHERE id=?',newest.challengeId).send_status,'sent');

  fresh();for(let i=0;i<6;i++){
    if(i)run('UPDATE email_challenges SET created_at=created_at-61000,expires_at=expires_at-61000');
    await send('player','limited@example.test');
  }
  await deny('Hashed subject send budget prevents unbounded requests',()=>send('player','limited@example.test'),429);
  assert.equal(messages.length,6);assert(all('SELECT key FROM account_rate_limits').every(r=>/^[0-9a-f]{64}$/.test(r.key)));
  fresh();let scopedLast;
  for(let i=0;i<6;i++){
    if(i)run('UPDATE email_challenges SET created_at=created_at-61000,expires_at=expires_at-61000');
    scopedLast=await send(['player','merchant','admin'][i%3],'shared-send-budget@example.test',i%2?'bind':'register');
  }
  const countersBeforeReplay=all('SELECT * FROM account_rate_limits ORDER BY key');
  for(let i=0;i<20;i++)assert.deepEqual(await send('admin','shared-send-budget@example.test','bind',scopedLast.challengeId),scopedLast);
  assert.deepEqual(all('SELECT * FROM account_rate_limits ORDER BY key'),countersBeforeReplay);assert.equal(messages.length,6);
  pass('Known delivered UUID replay sends no mail and consumes no send budget even after six distinct deliveries');
  run('UPDATE email_challenges SET created_at=created_at-61000,expires_at=expires_at-61000');
  await deny('Rotating role or purpose cannot bypass the shared mailbox send budget',()=>send('player','shared-send-budget@example.test','bind'),429);

  fresh();let verifyLast;
  for(let i=0;i<6;i++){
    if(i)run('UPDATE email_challenges SET created_at=created_at-61000,expires_at=expires_at-61000');
    const scopedRole=['player','merchant','admin'][i%3],scopedPurpose=i%2?'bind':'register';
    const scopedResult=await send(scopedRole,'shared-verify-budget@example.test',scopedPurpose);
    verifyLast={role:scopedRole,email:'shared-verify-budget@example.test',purpose:scopedPurpose,code:latest(),challengeId:scopedResult.challengeId};
    for(let attempt=0;attempt<5;attempt++)await assert.rejects(()=>load('lib/email-auth.ts').verifyEmailProof(request(),
      {...verifyLast,code:wrong(verifyLast.code)}),error=>error.status===400);
  }
  await deny('Verification budget is shared across mailbox roles and purposes independently of password/session creation',
    ()=>load('lib/email-auth.ts').verifyEmailProof(request(),verifyLast),429);
  assert.equal(count('sessions'),sessionCount);

  fresh();for(let i=0;i<30;i++)await send('player',`isolated-${i}@example.test`);
  await deny('Origin/IP budget also limits rotating mailbox subjects',()=>send('player','next@example.test'),429);assert.equal(messages.length,30);
  assert.equal(get('PRAGMA integrity_check').integrity_check,'ok');assert.deepEqual(all('PRAGMA foreign_key_check'),[]);
  pass('Register, bind and password login preserve SQLite integrity/FKs without SMTP/network/private D1/hardware');
  console.log(JSON.stringify({status:'PASS',cases,database:':memory:',privateDatabaseWrites:0,realEmailsSent:0,cloudRequests:0,deviceWrites:0}));
}finally{delete environment.MAIL_PASS;close();}
