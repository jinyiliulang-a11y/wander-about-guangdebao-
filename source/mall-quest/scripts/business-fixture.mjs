import { createHash,webcrypto,pbkdf2Sync as cryptoPbkdf2 } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync,readdirSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

export const root=fileURLToPath(new URL('../',import.meta.url));
export const sha=value=>createHash('sha256').update(value).digest('hex');
export const demoToken='isolated_business_device_token_0123456789';
let database;
export const environment={DB:null,DEMO_ADMIN_PASSWORD:'111'};
const modules=new Map();
// Dedicated suites may replace an external boundary with a purely in-memory fake.
export const mockModule=(relative,exports)=>modules.set(relative,exports);
const raw=(sql,values)=>database.prepare(sql).run(...values);
const result=(sql,values)=>({meta:{changes:Number(raw(sql,values).changes)}});
export const d1={prepare(sql){
  let values=[];
  const statement={
    bind(...bound){values=bound;return statement;},
    async first(){return database.prepare(sql).get(...values)??null;},
    async all(){return{results:database.prepare(sql).all(...values)};},
    async run(){return result(sql,values);},
    execute(){return result(sql,values);},
  };
  return statement;
},async batch(statements){
  database.exec('BEGIN');
  try{const results=statements.map(statement=>statement.execute());database.exec('COMMIT');return results;}
  catch(error){database.exec('ROLLBACK');throw error;}
}};
environment.DB=d1;
export function load(relative){
  if(modules.has(relative))return modules.get(relative);
  const loaded={exports:{}};modules.set(relative,loaded.exports);
  const source=ts.transpileModule(readFileSync(path.join(root,relative),'utf8'),{
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},fileName:relative,
  }).outputText;
  const require=name=>{
    if(name==='cloudflare:workers')return{env:environment};
    if(name==='cloudflare:sockets')return{connect(){throw new Error('External sockets are disabled in disposable fixtures');}};
    if(name.startsWith('@/'))return load(name.slice(2)+'.ts');
    if(name.startsWith('.'))return load(path.posix.join(path.posix.dirname(relative),name)+'.ts');
    throw new Error('Unexpected production dependency: '+name);
  };
  vm.runInNewContext(source,{module:loaded,exports:loaded.exports,require,crypto:webcrypto,Request,Response,Headers,TextEncoder,URL,Date,console}, {filename:relative});
  return loaded.exports;
}
export const run=(sql,...values)=>raw(sql,values);
export const get=(sql,...values)=>database.prepare(sql).get(...values);
export const all=(sql,...values)=>database.prepare(sql).all(...values);
export const exec=sql=>database.exec(sql);
export function reset({legacy=false,hardwareConfirmation=false}={}){
  if(database)database.close();database=new DatabaseSync(':memory:');
  const files=readdirSync(path.join(root,'drizzle')).filter(file=>file.endsWith('.sql')).sort();
  for(const file of files.filter(file=>!legacy||file<'0003'))database.exec(readFileSync(path.join(root,'drizzle',file),'utf8'));
  database.exec('PRAGMA foreign_keys=ON');
  const now=Date.now(),clues=JSON.stringify(['第一条完整线索','第二条完整线索','第三条私密线索','第四条私密线索','第五条私密线索']);
  for(const id of ['author','a','b','c','merchant','admin']){
    run('INSERT INTO players(id,nickname,created_at) VALUES(?,?,?)',id,'Fixture '+id,now);
    run('INSERT INTO sessions(token_hash,role,player_id,expires_at) VALUES(?,?,?,?)',sha('player-'+id),'player',id,now+86400000);
  }
  for(const id of ['tea','book','craft']){
    run(`INSERT INTO stores(id,event_id,name,floor,area,category,question,answer,code_hash,reward_title,conditions,stock_total,x,y,artwork,point_mode)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,id,'mall-48h','Fixture '+id,'F1','A','Demo','观察题至少四字','茉莉','unused','Legacy reward','Legacy conditions',24,20,30,0,id==='tea'?'hardware':'static');
    run('INSERT INTO tasks(id,author_id,store_id,title,clues,status,created_at) VALUES(?,?,?,?,?,?,?)','quest-'+id,'author',id,'Fixture quest',clues,'published',now);
  }
  for(const [id,role,store]of[['merchant','merchant','tea'],['admin','admin',null]])
    run('INSERT INTO sessions(token_hash,role,player_id,store_id,expires_at) VALUES(?,?,?,?,?)',sha('staff-'+id),role,id,store,now+86400000);
  run('INSERT INTO hardware_devices(id,store_id,token_hash,enabled,created_at) VALUES(?,?,?,?,?)','coin-tea-01','tea',sha(demoToken),1,now);
  if(!legacy)run("UPDATE hardware_devices SET bound_task_id='quest-tea' WHERE id='coin-tea-01'");
  if(!legacy)bindFixtureAccounts();
  // Existing business/account suites exercise the historical web-answer path.
  // The dedicated NFC suite opts into real sticky hardware semantics.
  if(!legacy&&!hardwareConfirmation)run('UPDATE tasks SET nfc_claim=0');
  return {now,clues};
}
export function applyBusinessMigration(){
  for(const file of readdirSync(path.join(root,'drizzle')).filter(file=>file.endsWith('.sql')&&file>='0003').sort())
    database.exec(readFileSync(path.join(root,'drizzle',file),'utf8'));
  bindFixtureAccounts();
  run('UPDATE tasks SET nfc_claim=0');
}
export function bindFixtureAccounts(){
  for(const p of all("SELECT id,nickname FROM players WHERE id IN ('author','a','b','c','merchant','admin')")){
    const role=p.id==='admin'?'admin':p.id==='merchant'?'merchant':'player';
    const salt='0123456789abcdef0123456789abcdef';
    const actual=cryptoPbkdf2('fixture-password',Buffer.from(salt,'hex'),100000,32,'sha256').toString('hex');
    run('INSERT OR IGNORE INTO accounts(id,request_hash,username,role,password_salt,password_hash,password_iterations,player_id,store_id,nickname,merchant_json,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      'fixture-'+p.id,'fixture','fixture-'+p.id,role,salt,actual,100000,p.id,role==='merchant'?'tea':null,p.nickname,role==='merchant'?'{}':null,'approved',Date.now(),Date.now());
    run('UPDATE sessions SET account_id=? WHERE player_id=?','fixture-'+p.id,p.id);
    if(role!=='player')run('INSERT OR IGNORE INTO sessions(token_hash,role,player_id,store_id,expires_at,account_id) VALUES(?,?,?,?,?,?)',sha('staff-'+p.id),role,p.id,role==='merchant'?'tea':null,Date.now()+86400000,'fixture-'+p.id);
  }
}
export const request=(player='a',staff,origin='http://localhost')=>new Request(origin+'/api/game',{headers:{Cookie:`mall_player=player-${player}${staff?'; mall_staff=staff-'+staff:''}`}});
export const action=(name,input={},player='a',staff)=>load('lib/game-server.ts').execute(request(player,staff),{action:name,...input});
export const state=(player='a',staff)=>load('lib/game-server.ts').state(request(player,staff),player);
export function close(){if(database){database.close();database=null;}}
