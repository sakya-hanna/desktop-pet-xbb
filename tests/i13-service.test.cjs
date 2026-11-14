'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {memory,file,safe}=require('./i13-settings-store.test.cjs');
const createService=require('../chat-service').create;
function createStore(options){const module={exports:{}};const source=require('node:fs').readFileSync(require.resolve('../conversation-store'),'utf8');new Function('require','module','exports',source)(name=>name==='node:fs'?options.fsImpl:require(name.startsWith('./')?'../'+name.slice(2):name),module,module.exports);return module.exports.create(options);}
function setup(config={},request=async()=>({reply:'姐姐在呢',face:3901,action:'blink'})){
 const io=memory(),store=createStore({file,fsImpl:io}),replies=[],clears=[];
 const settings={getRequestConfig:()=>config};const service=createService({store,settings,request,onReply:r=>replies.push(r),onCancel:()=>clears.push(true),system:'LOCAL FIXTURE'});
 return {io,store,replies,clears,service,settings};
}
module.exports={setup};
if(require.main===module){
 test('I13 service has explicit saved success settings-error request-error outcomes',async()=>{
  let h=setup();assert.equal((await h.service.send('本地')).outcome,'saved');assert.equal(h.service.state().messages.length,2);assert.equal(h.replies.length,0);
  h=setup({baseUrl:'https://local.invalid',model:'LOCAL'});assert.equal((await h.service.send('你好')).outcome,'success');assert.equal(h.replies.length,1);assert.equal(h.service.state().pending,false);assert.equal(h.clears.length,1);
  h.settings.getRequestConfig=()=>{throw Error('do not leak');};assert.equal((await h.service.send('配置坏了')).outcome,'settings-error');assert.equal(h.store.snapshot().at(-1).source,'settings-error');
  for(const message of ['AI endpoint returned HTTP 401','AI request timed out','AI request failed']){h=setup({baseUrl:'https://local.invalid',model:'LOCAL'},async()=>{throw Error(message);});const r=await h.service.send('失败');assert.equal(r.outcome,'request-error');assert.equal(r.messages.at(-1).source,'request-error');assert.equal(h.replies.length,0);}
 });
 test('I13 service cancel clear destroy cannot persist or present stale replies',async()=>{
  for(const operation of ['cancel','clear','destroy']){let resolve,signal;const h=setup({baseUrl:'https://local.invalid',model:'LOCAL'},r=>{signal=r.signal;return new Promise(ok=>resolve=ok);});const pending=h.service.send('挂起');assert.equal(h.service.state().pending,true);h.service[operation]();const before=h.store.snapshot();assert.equal(signal.aborted,true);resolve({reply:'过期',face:3901,action:'hop'});assert.equal((await pending).outcome,'cancelled');assert.deepEqual(h.store.snapshot(),before);assert.equal(h.replies.length,0);if(operation==='destroy')assert.equal((await h.service.send('晚到')).outcome,'cancelled');}
 });
 test('I13 history invalid and unknown loads block append clear and retain original bytes',()=>{
  for(const [raw,status] of [['{','invalid'],['{"version":9}','unknown']]){const io=memory(raw),s=createStore({file,fsImpl:io});assert.equal(s.diagnostics().loadStatus,status);assert.throws(()=>s.clear());assert.throws(()=>s.append('user','x','test'));assert.equal(io.files.get(file),raw);}
  const io=memory(),s=createStore({file,fsImpl:io});s.append('user','kept','test');const before=io.files.get(file);io.fail='collision';assert.throws(()=>s.clear());assert.equal(io.files.get(file),before);assert.equal(io.unlinks.length,0);
 });
}
