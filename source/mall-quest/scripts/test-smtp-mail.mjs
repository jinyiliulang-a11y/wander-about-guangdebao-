import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import ts from 'typescript';

const root=new URL('../',import.meta.url),variables={},connections=[];
let behavior={},cases=0;
const pass=label=>{console.log(`PASS ${++cases}: ${label}`);};
const modules=new Map();
function fakeConnect(address,options){
  const data={address,options,writes:[],closed:false,accepted:false};connections.push(data);
  const encoder=new TextEncoder();let input;
  const readable=new ReadableStream({start(controller){input=controller;if(!behavior.hang)controller.enqueue(encoder.encode(behavior.greeting||'220 smtp.example.test ready\r\n'));}});
  let phase=0;
  const writable=new WritableStream({write(bytes){
    const text=new TextDecoder().decode(bytes);data.writes.push(text);
    if(behavior.rejectQuit&&text==='QUIT\r\n')throw Error('quit disconnected');
    const responses=['250-smtp.example.test\r\n250 AUTH LOGIN\r\n','334 VXNlcm5hbWU6\r\n','334 UGFzc3dvcmQ6\r\n','235 authenticated\r\n','250 sender ok\r\n','250 recipient ok\r\n','354 start data\r\n','250 queued\r\n','221 bye\r\n'];
    const reply=behavior.rejectAt===phase?'535 PRIVATE_ECHO_SECRET\r\n':behavior.longReply&&phase===0?'250-'+('x'.repeat(5000))+'\r\n':responses[phase];
    if(phase===7)data.accepted=true;phase++;
    if(reply)input.enqueue(encoder.encode(reply));
  }});
  return {opened:Promise.resolve({remoteAddress:'isolated.test'}),closed:Promise.resolve(),readable,writable,close:async()=>{if(!data.closed){data.closed=true;input.close();}if(behavior.closeHang)return new Promise(()=>{});}};
}
function load(name){
  if(modules.has(name))return modules.get(name);
  const loaded={exports:{}};modules.set(name,loaded.exports);
  const source=ts.transpileModule(readFileSync(new URL(name,root),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const require=dependency=>dependency==='cloudflare:workers'?{env:variables}:dependency==='cloudflare:sockets'?{connect:fakeConnect}:dependency==='./game-error'?load('lib/game-error.ts'):(()=>{throw Error('Unexpected dependency');})();
  vm.runInNewContext(source,{module:loaded,exports:loaded.exports,require,crypto:webcrypto,TextEncoder,TextDecoder,btoa,ReadableStream,WritableStream,Date,
    setTimeout:(fn,delay)=>setTimeout(fn,behavior.hang||behavior.closeHang?20:delay),clearTimeout,console:{log(){throw Error('Production mail logged');},error(){throw Error('Production mail logged');}}});
  return loaded.exports;
}
const mail=load('lib/smtp-mail.ts');
function configured(){Object.assign(variables,{MAIL_HOST:'smtp.example.test',MAIL_PORT:'465',MAIL_SECURE:'true',MAIL_USER:'sender@example.test',MAIL_PASS:'isolated-private-password',MAIL_FROM:'sender@example.test'});behavior={};connections.length=0;}
const send=(email='receiver@example.test',code='654321',purpose='login',role='player')=>mail.sendVerificationEmail(email,code,purpose,role);
await assert.rejects(()=>send(),e=>e.status===503);assert.equal(mail.mailConfigured(),false);assert.equal(connections.length,0);pass('Missing config fails without printing or returning a code');
for(const [key,value]of [['MAIL_PORT','25'],['MAIL_SECURE','false'],['MAIL_HOST','smtp\r\nINJECT'],['MAIL_USER','wrong address'],['MAIL_FROM','receiver@example.test\r\nBCC:other@example.test'],['MAIL_PASS','bad\npassword']]){
  configured();variables[key]=value;assert.equal(mail.mailConfigured(),false);await assert.rejects(()=>send(),e=>e.status===503);assert.equal(connections.length,0);pass(`Invalid ${key} does not connect or leak credentials`);
}
configured();for(const args of [['receiver@example.test\r\nINJECT','654321','login','player'],['receiver@example.test','12x321','login','player'],['receiver@example.test','654321','unknown','player'],['receiver@example.test','654321','login','unknown']])await assert.rejects(()=>send(...args),e=>e.status===400);assert.equal(connections.length,0);pass('Mail recipient, code, purpose and role are validated before socket creation');
configured();await send();const socket=connections[0];assert.equal(socket.options.secureTransport,'on');assert.equal(socket.address.port,465);assert(socket.closed);assert.equal(socket.writes[0],'EHLO mail.wanderabout.local\r\n');assert.equal(Buffer.from(socket.writes[2].trim(),'base64').toString(),'sender@example.test');assert.equal(Buffer.from(socket.writes[3].trim(),'base64').toString(),variables.MAIL_PASS);const message=socket.writes[7];assert(message.endsWith('\r\n.\r\n'));const body=Buffer.from(message.split('\r\n\r\n')[1].replace(/\r\n\.$/,''),'base64').toString();assert(body.includes('654321'));assert(body.includes('玩家账号登录'));assert(body.includes('5分钟'));assert(!message.includes(variables.MAIL_PASS));pass('Actual SMTP command sequence uses implicit TLS and MIME UTF-8 base64 with a bounded single recipient');
for(const [purpose,role,label]of [['register','merchant','商家账号注册'],['bind','admin','运营账号绑定邮箱']]){configured();await send('receiver@example.test','123456',purpose,role);const body=Buffer.from(connections[0].writes[7].split('\r\n\r\n')[1].replace(/\r\n\.$/,''),'base64').toString();assert(body.includes(label));pass(`Message purpose/role matches ${label}`);}
configured();behavior.rejectAt=3;await assert.rejects(()=>send(),e=>e.status===503&&!e.message.includes('PRIVATE_ECHO_SECRET')&&!e.message.includes(variables.MAIL_PASS));assert(connections[0].closed);assert(!connections[0].accepted);pass('SMTP authentication rejection yields a generic error and closes the connection');
configured();behavior.longReply=true;await assert.rejects(()=>send(),e=>e.status===503);assert(connections[0].closed);pass('Oversized SMTP response aborts within bounded parser limits');
configured();behavior.hang=true;await assert.rejects(()=>send(),e=>e.status===503);assert(connections[0].closed);pass('Whole SMTP deadline aborts an unresponsive server');
configured();behavior.rejectQuit=true;await send();assert(connections[0].accepted);assert(connections[0].closed);pass('DATA 250 acceptance stays successful if the peer closes before QUIT');
configured();behavior.closeHang=true;let start=Date.now();await send();assert(connections[0].accepted);assert(connections[0].closed);assert(Date.now()-start<1000);pass('DATA 250 acceptance returns success even when socket cleanup never resolves');
configured();behavior.hang=true;behavior.closeHang=true;start=Date.now();await assert.rejects(()=>send(),e=>e.status===503);assert(connections[0].closed);assert(Date.now()-start<1000);pass('SMTP deadline remains bounded when socket cleanup also stalls');
console.log(`PASS: ${cases} SMTP transport cases; fake streams only; no network or real recipients`);
