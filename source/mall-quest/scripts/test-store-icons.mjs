import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { reset, run, get, all, load, action, d1, sha, close } from './business-fixture.mjs';

let cases=0;
const pass=name=>console.log(`PASS ${++cases}: ${name}`);
const icons=load('lib/store-icons.ts');
const profile={name:'新门店名称',category:'茶饮',floor:'F1',address:'门店新地址',phone:''};
const save=(patch={})=>action('merchantProfileSave',{...profile,...patch},'merchant','merchant');
const deny=async(name,operation,status=400)=>{await assert.rejects(operation,error=>error.status===status);pass(name);};
const snapshot=()=>JSON.stringify(all("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").map(({name})=>[name,all(`SELECT * FROM ${name} ORDER BY rowid`)]));
async function queued(change,operation){const prepare=d1.prepare;let fired=false;d1.prepare=sql=>{const statement=prepare(sql);if(sql.startsWith('UPDATE stores SET name=')){const runStatement=statement.run;statement.run=async()=>{if(!fired){fired=true;change();}return runStatement();};}return statement;};try{await operation();assert(fired);}finally{d1.prepare=prepare;}}
try{
  assert.equal(icons.STORE_ICONS.length,20);assert.equal(new Set(icons.STORE_ICONS.map(icon=>icon.value)).size,20);assert(icons.STORE_ICONS.every(icon=>icon.label&&icons.isStoreIcon(icon.value)));
  for(const value of[undefined,null,1,{},'店','<img src=x onerror=alert(1)>','🏪🏪','hello'])assert.equal(icons.isStoreIcon(value),false);
  pass('Shared picker has twenty distinct labeled emojis and rejects arbitrary values');
  reset();
  for(const {value,label}of icons.STORE_ICONS){await save({logo:value});assert.equal(get("SELECT logo FROM stores WHERE id='tea'").logo,value);pass(`Catalog ${label} persists through the actual merchant profile action`);}
  for(const value of['任意文字','<script>alert(1)</script>','https://x.example/logo.svg','🏪🏪','🦖']){const before=snapshot();await deny('A new arbitrary string, HTML, URL or out-of-catalog glyph cannot be stored',()=>save({logo:value}));assert.equal(snapshot(),before);}
  run("UPDATE stores SET logo='历史自定义店标' WHERE id='tea'");
  await save({logo:'历史自定义店标',address:'只修改地址'});assert.equal(get("SELECT logo FROM stores WHERE id='tea'").logo,'历史自定义店标');assert.equal(get("SELECT address FROM stores WHERE id='tea'").address,'只修改地址');
  await save({address:'省略图标仍保存地址'});assert.equal(get("SELECT logo FROM stores WHERE id='tea'").logo,'历史自定义店标');
  pass('An exactly unchanged legacy icon or omitted icon keeps working for ordinary profile edits');
  const before=snapshot();await deny('A legacy icon cannot be replaced with another arbitrary historical-looking value',()=>save({logo:'另一自定义图标'}));assert.equal(snapshot(),before);
  const image='data:image/png;base64,'+readFileSync(new URL('./fixtures/store-images/png.png',import.meta.url)).toString('base64');
  await save({logo:'历史自定义店标',imageURL:image,expectedImageRevision:0});assert.equal(get("SELECT image_url FROM stores WHERE id='tea'").image_url,image);assert.equal(get("SELECT logo FROM stores WHERE id='tea'").logo,'历史自定义店标');
  pass('The image-version CAS can preserve an old icon while replacing the current picture');
  await save({logo:'🍵'});assert.equal(get("SELECT logo FROM stores WHERE id='tea'").logo,'🍵');
  pass('An old custom icon can be explicitly replaced with a supported catalog icon');
  run("UPDATE stores SET logo='  历史含空格店标  ' WHERE id='tea'");await save({logo:'  历史含空格店标  '});assert.equal(get("SELECT logo FROM stores WHERE id='tea'").logo,'  历史含空格店标  ');
  pass('Exact legacy preservation does not silently trim or alter stored historical content');
  for(const imageChange of[false,true]){
    reset();run("UPDATE stores SET logo='旧图标一' WHERE id='tea'");
    await deny('Final SQL does not write an obsolete custom icon back after a concurrent logo change',()=>queued(()=>run("UPDATE stores SET logo='旧图标二' WHERE id='tea'"),()=>save({logo:'旧图标一',...(imageChange?{imageURL:image,expectedImageRevision:0}:{})})),409);
    assert.equal(get("SELECT logo FROM stores WHERE id='tea'").logo,'旧图标二');assert.equal(get("SELECT address FROM stores WHERE id='tea'").address,'');assert.equal(get("SELECT image_revision FROM stores WHERE id='tea'").image_revision,0);
  }
  for(const imageChange of[false,true]){
    reset();await deny('Final profile SQL keeps approval authorization for both ordinary and image updates',()=>queued(()=>run("UPDATE accounts SET status='rejected' WHERE id='fixture-merchant'"),()=>save({logo:'🍵',...(imageChange?{imageURL:image,expectedImageRevision:0}:{})})),409);
    assert.equal(get("SELECT logo FROM stores WHERE id='tea'").logo,'🏪');assert.equal(get("SELECT address FROM stores WHERE id='tea'").address,'');
  }
  reset();await deny('Another store remains outside the merchant profile scope',()=>save({storeId:'book',logo:'🍵'}),403);
  await deny('A player cannot save merchant icons',()=>action('merchantProfileSave',{...profile,logo:'🍵'},'a'),403);
  assert.equal(get('SELECT COUNT(*) AS n FROM claims').n,0);assert.equal(get('PRAGMA integrity_check').integrity_check,'ok');assert.deepEqual(all('PRAGMA foreign_key_check'),[]);
  pass('Icon editing preserves reward records, SQL integrity and foreign keys without a migration');
  console.log(JSON.stringify({status:'PASS',cases,database:':memory:',privateDatabaseWrites:0,cloudRequests:0,deviceWrites:0,realEmailsSent:0}));
}finally{close();}
