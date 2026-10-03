const fs=require("node:fs"),path=require("node:path"),crypto=require("node:crypto"),{spawnSync}=require("node:child_process");
const root=path.resolve(process.argv[2]),run=path.resolve(process.argv[3]),spec=JSON.parse(fs.readFileSync(process.argv[4],"utf8"));
const sha=data=>crypto.createHash("sha256").update(data).digest("hex").toUpperCase();
const report={status:"PREPARING",version:"v2.3.44",steps:[],browserQA:"PENDING",liveMigration:"NOT_RUN",serverDeploy:"NOT_RUN",run};
const reportPath=path.join(run,"verification-report.json");
fs.mkdirSync(run,{recursive:true});
function save(){fs.writeFileSync(reportPath,JSON.stringify(report,null,2));}
function target(file){
 const resolved=path.resolve(root,file);
 if(!resolved.startsWith(root+path.sep))throw Error("Path escaped project: "+file);
 return resolved;
}
function uniqueIndex(source,needle,file){
 const start=source.indexOf(needle);
 if(start<0||source.indexOf(needle,start+needle.length)>=0)throw Error("Patch anchor missing/ambiguous: "+file+" / "+needle.slice(0,80));
 return start;
}
function change(source,edit){
 if(edit.kind==="replace"){uniqueIndex(source,edit.from,edit.file);return source.replace(edit.from,()=>edit.to);}
 if(edit.kind==="regex"){
  const re=new RegExp(edit.pattern,edit.options||"");const matches=[...source.matchAll(new RegExp(edit.pattern,(edit.options||"")+"g"))];
  if(matches.length!==1)throw Error("Regex patch mismatch: "+edit.file+" / "+edit.pattern+" / "+matches.length);
  return source.replace(re,()=>edit.value);
 }
 if(edit.kind==="inside"){
  const start=uniqueIndex(source,edit.start,edit.file),end=source.indexOf(edit.end,start);
  if(end<0)throw Error("Block end missing: "+edit.file);
  const finish=end+edit.end.length,block=source.slice(start,finish);uniqueIndex(block,edit.from,edit.file);
  return source.slice(0,start)+block.replace(edit.from,()=>edit.to)+source.slice(finish);
 }
 const start=uniqueIndex(source,edit.start,edit.file),end=source.indexOf(edit.end,start+edit.start.length);
 if(end<0)throw Error("Block end missing: "+edit.file);
 const finish=edit.kind==="between"?end:end+edit.end.length;
 return source.slice(0,start)+edit.value+source.slice(finish);
}
const expected=new Map();
for(const snapshot of spec.snapshotFiles){
 const text=fs.readFileSync(snapshot,"utf8");
 for(const hit of text.matchAll(/^FILE: (.+?) SHA256: ([0-9A-F]{64})\s*$/gm)){
  if(expected.has(hit[1])&&expected.get(hit[1])!==hit[2])throw Error("Conflicting snapshots: "+hit[1]);
  expected.set(hit[1],hit[2]);
 }
}
const planned=new Map(),originals=new Map();
try{
 // Prepare every edit and check every original before any project mutation.
 for(const file of Object.keys(spec.hashes)){
  const raw=fs.readFileSync(target(file));const originalHash=expected.get(file);
  if(!originalHash)throw Error("Original snapshot hash missing: "+file);
  if(sha(raw)!==originalHash)throw Error("Source changed since review; no edits applied: "+file);
  originals.set(file,raw);planned.set(file,raw.toString("utf8").replace(/\r\n/g,"\n"));
 }
 for(const edit of spec.patches){
  if(!planned.has(edit.file))throw Error("Unreviewed patch target: "+edit.file);
  planned.set(edit.file,change(planned.get(edit.file),edit));
 }
 for(const [file,source]of Object.entries(spec.files)){
  const output=target(file);
  if(fs.existsSync(output)&&!originals.has(file))throw Error("New target already exists; refusing overwrite: "+file);
  planned.set(file,source);
 }
 const ts=require(path.join(root,"node_modules/typescript"));
 for(const [file,source] of planned){
  if(!/\.(ts|tsx)$/.test(file))continue;
  const parsed=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,file.endsWith(".tsx")?ts.ScriptKind.TSX:ts.ScriptKind.TS);
  if(parsed.parseDiagnostics.length)throw Error("Source parse error "+file+": "+ts.flattenDiagnosticMessageText(parsed.parseDiagnostics[0].messageText,"\n"));
 }
 report.steps.push({step:"preflight",pass:true,files:planned.size});save();
 for(const [file,raw]of originals){
  const backup=path.join(run,"backup",file);fs.mkdirSync(path.dirname(backup),{recursive:true});fs.writeFileSync(backup,raw);
 }
 for(const [file,source]of planned){
  const output=target(file);fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,source,"utf8");
 }
 report.status="APPLIED_CHECKING";report.modifiedFiles=[...planned.keys()];report.modifiedHashes=Object.fromEntries([...planned].map(([file,source])=>[file,sha(Buffer.from(source,"utf8"))]));save();
 function check(name,args){
  const result=spawnSync(process.execPath,args,{cwd:root,encoding:"utf8",maxBuffer:64*1024*1024,env:{...process.env,CI:"true"}});
  fs.writeFileSync(path.join(run,name+".log"),(result.stdout||"")+(result.stderr||""));
  console.log((result.stdout||"").slice(-7000));if(result.stderr)console.log(result.stderr.slice(-5000));
  const exit=result.status??1;report.steps.push({step:name,exitCode:exit});save();
  if(result.error)throw result.error;if(exit!==0)throw Error(name+" failed; see "+path.join(run,name+".log"));
 }
 check("typecheck",["node_modules/typescript/bin/tsc","--noEmit"]);
 check("map-tests",["scripts/test-map-v2344.mjs",root,path.join(run,"isolated-tests")]);
 check("build",["scripts/run-framework.mjs","build"]);
 const testResult=JSON.parse(fs.readFileSync(path.join(run,"isolated-tests/test-report.json"),"utf8"));report.mapTests=testResult;
 const stage=path.join(run,"delivery","mall-quest");fs.mkdirSync(stage,{recursive:true});
 const skippedDirs=new Set(["node_modules",".git",".wrangler",".sites-runtime",".next","dist",".cache","work","outputs","build",".turbo",".codex"]);
 const files=[];
 function copy(directory,relative=""){
  for(const item of fs.readdirSync(directory,{withFileTypes:true})){
   if(item.isSymbolicLink())continue;
   if(item.isDirectory()){if(!skippedDirs.has(item.name)&&!item.name.startsWith("qa-"))copy(path.join(directory,item.name),path.join(relative,item.name));continue;}
   const name=item.name;
   if((name.startsWith(".env")&&name!==".env.example")||name===".dev.vars"||name.startsWith(".dev.vars.")||/\.(sqlite|sqlite3|db|log|tsbuildinfo|pem|key|pfx)$/i.test(name))continue;
   const file=path.join(relative,name),destination=path.join(stage,file);
   fs.mkdirSync(path.dirname(destination),{recursive:true});const raw=fs.readFileSync(path.join(directory,name));fs.writeFileSync(destination,raw);files.push({file:file.replaceAll("\\","/"),sha256:sha(raw)});
  }
 }
 copy(root);report.status="SOURCE_BUILD_PASS_BROWSER_QA_PENDING";report.sourceFiles=files.length;report.stage=path.dirname(stage);
 fs.writeFileSync(path.join(report.stage,"source-manifest.json"),JSON.stringify({version:"v2.3.44",files},null,2));save();
 fs.writeFileSync(path.join(report.stage,"verification-report.json"),JSON.stringify(report,null,2));
 console.log("SOURCE_BUILD_PASS_BROWSER_QA_PENDING");console.log("REPORT: "+reportPath);
}catch(error){report.status="FAILED";report.error=error.message;save();console.error("FAILED: "+error.message);console.error("REPORT: "+reportPath);process.exitCode=1;}
