import assert from "node:assert/strict";
import {readFileSync,writeFileSync,mkdirSync} from "node:fs";
import path from "node:path";
import {pathToFileURL} from "node:url";
import {createRequire} from "node:module";
import {DatabaseSync} from "node:sqlite";
const root=path.resolve(process.argv[2]||"."),out=path.resolve(process.argv[3]||".sites-runtime/map-v2344-tests");
mkdirSync(out,{recursive:true});const ts=createRequire(path.join(root,"package.json"))("typescript");
const compile=(name,replacements=[])=>{
 let source=readFileSync(path.join(root,"lib",name+".ts"),"utf8");
 for(const [from,to] of replacements)source=source.replaceAll(from,to);
 const result=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext},reportDiagnostics:true,fileName:name+".ts"});
 const errors=(result.diagnostics||[]).filter(d=>d.category===ts.DiagnosticCategory.Error);
 assert.equal(errors.length,0,ts.formatDiagnosticsWithColorAndContext(errors,{getCanonicalFileName:f=>f,getCurrentDirectory:()=>root,getNewLine:()=>"\n"}));
 writeFileSync(path.join(out,name+".mjs"),result.outputText);
};
compile("polygon-geofence");compile("geofence",[['"./polygon-geofence"','"./polygon-geofence.mjs"']]);
compile("amap-coordinates");
const polygon=await import(pathToFileURL(path.join(out,"polygon-geofence.mjs")));
const {checkGeofence,distanceMeters,validFenceGeometry}=await import(pathToFileURL(path.join(out,"geofence.mjs")));
const {wgs84ToGcj02,gcj02ToWgs84}=await import(pathToFileURL(path.join(out,"amap-coordinates.mjs")));
let passed=0;const test=async(name,fn)=>{await fn();passed++;console.log("PASS",name);};
const p=(lat,lng)=>({latitude:lat,longitude:lng}),anchor=p(31.23,121.47);
const square=[p(31.229,121.469),p(31.229,121.471),p(31.231,121.471),p(31.231,121.469)];
const now=Date.now(),position={...anchor,accuracy:3,timestamp:now};
const fence={storeId:"a",storeName:"店A",enabled:true,...anchor,radiusMeters:200,revision:1,updatedAt:now,coordinateSystem:"WGS84",shapeType:"polygon",polygonVertices:square};
await test("polygon center inside",()=>assert.equal(checkGeofence(fence,position,now).reason,"inside"));
await test("polygon outside its rectangle but inside compatibility envelope",()=>assert.equal(checkGeofence(fence,{...position,latitude:31.2312,accuracy:0},now).reason,"outside"));
await test("precision disk crossing boundary uncertain",()=>assert.equal(checkGeofence(fence,{...position,latitude:31.23099,accuracy:10},now).reason,"uncertain"));
await test("stale position rejected",()=>assert.equal(checkGeofence(fence,{...position,timestamp:now-30001},now).reason,"stale-location"));
await test("future position rejected",()=>assert.equal(checkGeofence(fence,{...position,timestamp:now+5001},now).reason,"stale-location"));
await test("disabled fence rejected",()=>assert.equal(checkGeofence({...fence,enabled:false},position,now).reason,"disabled"));
await test("unconfigured fence rejected",()=>assert.equal(checkGeofence({...fence,revision:0},position,now).reason,"not-configured"));
await test("invalid shape rejected",()=>assert.equal(checkGeofence({...fence,shapeType:"square"},position,now).reason,"invalid-config"));
await test("malformed polygon does not fall back to circle",()=>assert.equal(checkGeofence({...fence,polygonVertices:[]},position,now).reason,"invalid-config"));
await test("invalid accuracy rejected",()=>assert.equal(checkGeofence(fence,{...position,accuracy:-1},now).reason,"invalid-location"));
await test("circle compatibility unchanged",()=>assert.equal(checkGeofence({...fence,shapeType:"circle",radiusMeters:20,polygonVertices:null},position,now).reason,"inside"));
await test("circle precision overlap unchanged",()=>assert.equal(checkGeofence({...fence,shapeType:"circle",radiusMeters:20,polygonVertices:null},{...position,accuracy:21},now).reason,"uncertain"));
await test("closing point normalized",()=>assert.equal(polygon.normalizePolygon([...square,square[0]]).length,4));
await test("winding independent",()=>assert.equal(polygon.inspectPolygon(anchor,[...square].reverse()).inside,true));
await test("self intersection rejected",()=>assert.throws(()=>polygon.normalizePolygon([square[0],square[2],square[1],square[3]])));
await test("duplicate point rejected",()=>assert.throws(()=>polygon.normalizePolygon([square[0],square[0],square[1],square[2]])));
await test("collinear ring rejected",()=>assert.throws(()=>polygon.normalizePolygon([p(31.23,121.47),p(31.23,121.471),p(31.23,121.472)])));
await test("vertex count rejected",()=>assert.throws(()=>polygon.normalizePolygon(Array.from({length:66},()=>anchor))));
await test("out of range coordinates rejected",()=>assert.throws(()=>polygon.normalizePolygon([p(91,121.47),square[1],square[2]])));
await test("far polygon rejected",()=>assert.equal(validFenceGeometry({...fence,polygonVertices:square.map(v=>({...v,latitude:v.latitude+.1}))}),false));
await test("anchor distance API semantics retained",()=>assert.equal(checkGeofence(fence,position,now).distanceMeters,0));
await test("WGS84 GCJ02 roundtrip",()=>assert.ok(distanceMeters(anchor,gcj02ToWgs84(wgs84ToGcj02(anchor)))<.2));
let grid=0;
await test("rectangle analytic grid",()=>{
 for(let i=-12;i<=12;i++)for(let j=-12;j<=12;j++){
  const q=p(anchor.latitude+i*.0001,anchor.longitude+j*.0001);
  // Skip exact boundary points, tested separately; no physical tolerance added.
  if(Math.abs(i)===10||Math.abs(j)===10)continue;
  assert.equal(polygon.inspectPolygon(q,square).inside,Math.abs(i)<10&&Math.abs(j)<10);grid++;
 }
});
const sql=new DatabaseSync(":memory:");
try{
 sql.exec("PRAGMA foreign_keys=ON;CREATE TABLE stores(id TEXT PRIMARY KEY,event_id TEXT,name TEXT);INSERT INTO stores VALUES('a','mall-48h','店A'),('b','mall-48h','店B');");
 sql.exec(readFileSync(path.join(root,"drizzle/0006_store_geofences.sql"),"utf8"));
 sql.exec("INSERT INTO store_geofences(store_id,enabled,latitude,longitude,radius_meters,revision,updated_at)VALUES('a',1,31.23,121.47,100,4,123),('b',0,NULL,NULL,NULL,1,456);");
 const old=sql.prepare("SELECT * FROM store_geofences ORDER BY store_id").all();
 await test("actual 0016 preserves existing fields and defaults circle",()=>{
  sql.exec(readFileSync(path.join(root,"drizzle/0016_store_geofence_polygons.sql"),"utf8"));
  const rows=sql.prepare("SELECT * FROM store_geofences ORDER BY store_id").all();
  assert.deepEqual(rows.map(({shape_type,polygon_json,...rest})=>rest),old.map(row=>({...row})));
  assert.ok(rows.every(r=>r.shape_type==="circle"&&r.polygon_json===null));
 });
 const update=sql.prepare("UPDATE store_geofences SET shape_type=?,polygon_json=? WHERE store_id='a'");
 for(const [name,shape,json] of [
  ["null polygon","polygon",null],["bad JSON","polygon","{"],["object JSON","polygon","{}"],
  ["two vertices","polygon","[{},{}]"],["unknown shape","square",null],["circle with polygon","circle",JSON.stringify(square)],
  ["oversized JSON","polygon"," ".repeat(16385)+JSON.stringify(square)],
 ])await test("SQL rejects "+name,()=>assert.throws(()=>update.run(shape,json)));
 await test("atomic polygon switch accepted",()=>assert.equal(update.run("polygon",JSON.stringify(square)).changes,1));
 await test("invalid intermediate shape rejected",()=>assert.throws(()=>sql.exec("UPDATE store_geofences SET shape_type='circle' WHERE store_id='a'")));
 await test("circle restoration accepted",()=>assert.equal(update.run("circle",null).changes,1));
 await test("original radius constraint retained",()=>assert.throws(()=>sql.exec("UPDATE store_geofences SET radius_meters=19 WHERE store_id='a'")));
 sql.exec("CREATE TABLE test_staff_sessions(token_hash TEXT PRIMARY KEY,role TEXT,store_id TEXT,expires_at INTEGER);");
 sql.prepare("INSERT INTO test_staff_sessions VALUES(?,?,?,?)").run("merchant-a","merchant","a",now+3600000);
 sql.prepare("INSERT INTO test_staff_sessions VALUES(?,?,?,?)").run("admin","admin",null,now+3600000);
 globalThis.__mapTestDB=sql;
 writeFileSync(path.join(out,"test-game-error.mjs"),'export class GameError extends Error{constructor(message,status=400){super(message);this.status=status}}');
 writeFileSync(path.join(out,"test-game-server.mjs"),[
  'import {GameError} from "./test-game-error.mjs";',
  'export function db(){return{prepare(sql){let args=[];return{bind(...values){args=values;return this},async all(){return{results:globalThis.__mapTestDB.prepare(sql).all(...args)}},async run(){return{meta:{changes:globalThis.__mapTestDB.prepare(sql).run(...args).changes}}}}}}}',
  'export const cookie=req=>req.headers.get("x-test-token");export const hash=async value=>value;',
  'export async function staff(req){const row=globalThis.__mapTestDB.prepare("SELECT * FROM test_staff_sessions WHERE token_hash=? AND expires_at>?").get(cookie(req),Date.now());if(!row)throw new GameError("Unauthorized",401);return row;}',
 ].join("\n"));
 writeFileSync(path.join(out,"test-account-authorization.mjs"),'export const staffAuthorizationSQL=column=>"EXISTS(SELECT 1 FROM test_staff_sessions WHERE token_hash=? AND expires_at>? AND (role=\'admin\' OR store_id="+column+"))";');
 compile("geofence-server",[
  ['"./game-server"','"./test-game-server.mjs"'],['"./game-error"','"./test-game-error.mjs"'],
  ['"./account-authorization"','"./test-account-authorization.mjs"'],['"./geofence"','"./geofence.mjs"'],['"./polygon-geofence"','"./polygon-geofence.mjs"'],
 ]);
 const api=await import(pathToFileURL(path.join(out,"geofence-server.mjs")));
 const req=token=>new Request("https://example.test",{headers:{"x-test-token":token}});
 await test("actual save handler retains merchant ownership",()=>assert.rejects(()=>api.saveGeofence(req("merchant-a"),{storeId:"b",enabled:false,expectedRevision:1}),e=>e.status===403));
 await test("actual save handler stores polygon and increments revision",async()=>{
  const result=await api.saveGeofence(req("merchant-a"),{storeId:"a",enabled:true,...anchor,shapeType:"polygon",polygonVertices:square,expectedRevision:4});
  assert.equal(result.fence.revision,5);assert.equal(result.fence.shapeType,"polygon");assert.equal(result.fence.polygonVertices.length,4);assert.equal(checkGeofence(result.fence,position,now).inside,true);
 });
 await test("actual save handler rejects stale revision",()=>assert.rejects(()=>api.saveGeofence(req("merchant-a"),{storeId:"a",enabled:true,...anchor,radiusMeters:100,expectedRevision:4}),e=>e.reason==="config-changed"));
 await test("actual save handler rejects invalid polygon",()=>assert.rejects(()=>api.saveGeofence(req("merchant-a"),{storeId:"a",enabled:true,...anchor,shapeType:"polygon",polygonVertices:[],expectedRevision:5}),e=>e.status===400));
 await test("actual save handler switches back to legacy circle",async()=>{
  const result=await api.saveGeofence(req("merchant-a"),{storeId:"a",enabled:true,...anchor,radiusMeters:100,expectedRevision:5});
  assert.equal(result.fence.shapeType,"circle");assert.equal(result.fence.polygonVertices,null);assert.equal(result.fence.revision,6);
 });
 await test("actual read handler returns both stores",async()=>assert.equal((await api.readGeofences()).fences.length,2));
 await test("fixture integrity retained",()=>{assert.deepEqual(sql.prepare("PRAGMA foreign_key_check").all(),[]);assert.equal(Object.values(sql.prepare("PRAGMA quick_check").get())[0],"ok");});
}finally{sql.close();delete globalThis.__mapTestDB;}
const result={status:"PASS",passed,analyticGridChecks:grid,scope:"actual geometry modules and actual 0016 on in-memory SQLite; save handler with isolated auth/session fixtures; real D1/browser/AMap not tested"};
writeFileSync(path.join(out,"test-report.json"),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
