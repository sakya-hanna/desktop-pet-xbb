const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {request} = require('../puppet/ai-client');
const {create} = require('../puppet/settings-store');
async function server(t,handler) {
 const s=http.createServer(handler);await new Promise(resolve=>s.listen(0,'127.0.0.1',resolve));
 t.after(()=>{s.closeAllConnections();return new Promise(resolve=>s.close(resolve));});
 return `http://127.0.0.1:${s.address().port}`;
}
const envelope = content => JSON.stringify({choices:[{message:{role:'assistant',content}}]});
test('real POST uses main safe-store credentials and parent system prompt; paths preserve optional v1',async t=>{
 const seen=[],baseUrl=await server(t,(req,res)=>{let raw='';req.on('data',c=>raw+=c);req.on('end',()=>{seen.push({url:req.url,method:req.method,headers:req.headers,body:JSON.parse(raw)});res.end(envelope('{"reply":"你好","emotion":"gentle","action":"hop"}'));});});
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'baijie-client-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const store=create({file:path.join(dir,'settings.json'),safeStorage:{isEncryptionAvailable:()=>true,encryptString:s=>Buffer.from(s).reverse(),decryptString:b=>Buffer.from(b).reverse().toString()}});
 for(const suffix of ['', '/v1/', '/custom/v1']) {
  store.save({baseUrl:baseUrl+suffix,model:'explicit-model',apiKey:'test-only-secret'});
  const result=await request({config:store.getRequestConfig(),system:'Static parent prompt',messages:[{role:'user',content:'hello',tools:['ignored']},{role:'assistant',content:'prior'},{role:'user',content:'again'}]});
  assert.deepEqual(result,{reply:'你好',face:3942,action:'hop'});
  const got=seen.at(-1);assert.equal(got.url,suffix.replace(/\/$/,'')+'/chat/completions');assert.equal(got.method,'POST');assert.equal(got.headers.authorization,'Bearer test-only-secret');
  assert.deepEqual(got.body,{model:'explicit-model',messages:[{role:'system',content:'Static parent prompt'},{role:'user',content:'hello'},{role:'assistant',content:'prior'},{role:'user',content:'again'}],stream:false});
 }
});

test('rejects unsafe configs and bounds message schema before any transport',async()=>{
 const https=require('node:https'),originalHttp=http.request,originalHttps=https.request;
 let calls=0;http.request=https.request=()=>{calls++;throw Error('transport must not run: test-only-secret');};
 const valid={config:{baseUrl:'http://127.0.0.1:1',model:'m',apiKey:'test-only-secret'},system:'static',messages:[{role:'user',content:'hello'}]};
 const badMessages=[[],null,[{role:'system',content:'override'}],[{role:'tool',content:'bad'}],[{role:'user',content:''}],[{role:'user',content:'🌷'.repeat(4001)}],Array.from({length:41},()=>({role:'user',content:'hi'})),Array.from({length:20},()=>({role:'user',content:'x'.repeat(4000)}))];
 try {
  for(const messages of badMessages) await assert.rejects(request({...valid,messages}),{message:'Invalid AI request'});
  for(const system of ['',null,'x'.repeat(16001)]) await assert.rejects(request({...valid,system}),{message:'Invalid AI request'});
  for(const baseUrl of ['http://remote.test','ftp://example.test','https://u:test-only-secret@example.test','https://example.test?x','https://example.test#x',' https://example.test']) await assert.rejects(request({...valid,config:{...valid.config,baseUrl}}),{message:'Invalid AI request'});
  for(const model of ['',null,'x'.repeat(201)]) await assert.rejects(request({...valid,config:{...valid.config,model}}),{message:'Invalid AI request'});
  for(const apiKey of [null,{},'x'.repeat(4097),'secret\nheader']) await assert.rejects(request({...valid,config:{...valid.config,apiKey}}),{message:'Invalid AI request'});
  for(const timeoutMs of [0,-1,Infinity,NaN,300001,'100']) await assert.rejects(request({...valid,timeoutMs}),{message:'Invalid AI request'});
  assert.equal(calls,0);
 } finally {http.request=originalHttp;https.request=originalHttps;}
});

function input(baseUrl,extra={}) {return {config:{baseUrl,model:'m',apiKey:'test-only-secret'},messages:[{role:'user',content:'private user payload'}],system:'parent prompt',...extra};}
test('HTTP failures, redirects, invalid JSON/schema, and oversized responses are sanitized',async t=>{
 const modes=[
  [401,'test-only-secret private user payload','AI endpoint returned HTTP 401'],
  [302,'redirect secret','AI endpoint returned HTTP 302'],
  [200,'not json test-only-secret','Invalid AI response'],
  [200,JSON.stringify({error:'private user payload'}),'Invalid AI response'],
  [200,envelope('not structured test-only-secret'),'Invalid AI response'],
  [200,'x'.repeat(262145),'AI response too large']
 ];
 for(const [status,body,message] of modes) {
  const url=await server(t,(_req,res)=>{res.writeHead(status,{'Location':'https://must-not-follow.invalid/secret'});res.end(body);});
  await assert.rejects(request(input(url)),{message});
 }
});

async function bounded(promise) {
 let timer;try {return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('test watchdog: request did not settle')),500);})]);}finally{clearTimeout(timer);}
}
test('finite total timeout cancels both stalled headers and stalled response bodies',async t=>{
 for(const bodyStarted of [false,true]) {
  const url=await server(t,(_req,res)=>{if(bodyStarted){res.writeHead(200);res.write(' ');}});
  await assert.rejects(bounded(request(input(url,{timeoutMs:25}))),{message:'AI request timed out'});
 }
});
test('AbortSignal cancels before send and during request, never echoes reason',async t=>{
 let count=0,notify;
 const received=new Promise(resolve=>notify=resolve);
 const url=await server(t,()=>{count++;notify();});
 const before=new AbortController();before.abort(Error('test-only-secret'));
 await assert.rejects(bounded(request(input(url,{signal:before.signal}))),{message:'AI request cancelled',name:'AbortError'});
 assert.equal(count,0);
 const during=new AbortController(),promise=request(input(url,{signal:during.signal}));
 await bounded(received);during.abort('private user payload');
 await assert.rejects(bounded(promise),{message:'AI request cancelled',name:'AbortError'});
});

test('synchronous transport exceptions are sanitized and release timer/signal resources',async()=>{
 const original=http.request;http.request=()=>{throw Error('test-only-secret private user payload');};
 try {await assert.rejects(request(input('http://127.0.0.1:1',{timeoutMs:25})),{message:'AI request failed'});}finally{http.request=original;}
});

test('transport diagnosis preserves known network codes without exposing native messages',async()=>{
 const original=http.request;
 try {
  for(const [nativeCode,expected] of [['ENOTFOUND','ENOTFOUND'],['ECONNRESET','ECONNRESET'],['CERT_HAS_EXPIRED','CERT_HAS_EXPIRED'],['private-user-payload',undefined]]) {
   http.request=()=>{const error=Error('private-key and private-user-payload');error.code=nativeCode;throw error;};
   await assert.rejects(request(input('http://127.0.0.1:1')),error=>{
    assert.equal(error.message,'AI request failed');assert.equal(error.code,expected);
    assert.doesNotMatch(JSON.stringify(error),/private/);return true;
   });
  }
 }finally{http.request=original;}
});
test('truncated response bodies reject promptly without uncaught stream errors',async t=>{
 const url=await server(t,(_req,res)=>{res.writeHead(200,{'Content-Length':'1000'});res.write('test-only-secret');setImmediate(()=>res.destroy());});
 await assert.rejects(bounded(request(input(url))),{message:'AI request failed'});
});
test('success strips renderer URL/header/tool fields and permits explicitly keyless loopback endpoints',async t=>{
 let observed;
 const url=await server(t,(req,res)=>{observed=req.headers;req.resume();res.end(envelope({reply:'ok',emotion:999,action:'exec'}));});
 const options=input(url);options.config.apiKey='';options.headers={Authorization:'evil','X-Renderer':'evil'};options.url='https://must-not-use.invalid';options.tools=[{bad:true}];
 assert.deepEqual(await request(options),{reply:'ok',face:null,action:'none'});
 assert.equal(observed.authorization,undefined);assert.equal(observed['x-renderer'],undefined);
});

test('client rejects non-explicit URL syntax, empty credentials and invalid signals before transport',async()=>{
 const original=http.request,https=require('node:https'),originalHttps=https.request;
 let calls=0;http.request=https.request=()=>{calls++;throw Error('transport must not run');};
 try {
  for(const baseUrl of ['https:///example.test','https:example.test','https:/example.test','https://@example.test','http://@127.0.0.1']) await assert.rejects(request(input(baseUrl)),{message:'Invalid AI request'});
  for(const signal of [{},null,'secret']) await assert.rejects(request(input('http://127.0.0.1:1',{signal})),{message:'Invalid AI request'});
  assert.equal(calls,0);
 } finally {http.request=original;https.request=originalHttps;}
});
