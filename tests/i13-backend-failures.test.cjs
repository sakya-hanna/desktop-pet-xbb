'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {harness,settle}=require('./i13-backend.test.cjs');
const {memory,file,safe,valid}=require('./i13-settings-store.test.cjs');
test('I13 settings disappearing during read is read-error not missing',()=>{
 const io=memory(valid);io.readFileSync=()=>{const e=Error('disappeared after stat');e.code='ENOENT';throw e;};const s=require('../settings-store').create({file,safeStorage:safe,fsImpl:io});assert.equal(s.snapshot().loadStatus,'read-error');assert.equal(s.snapshot().writeBlocked,true);assert.throws(()=>s.save({baseUrl:'https://local-test.invalid',model:'LOCAL'}));assert.equal(io.files.get(file),valid);
});
test('I13 late unavailable decryption latches writes and exposes protected notice',()=>{
 let n=0;const io=memory(valid),storage={...safe,decryptString:b=>{if(++n>=3)throw Error('context lost');return safe.decryptString(b);}};
 const s=require('../settings-store').create({file,safeStorage:storage,fsImpl:io});assert.throws(()=>s.getRequestConfig());assert.equal(s.snapshot().writeBlocked,true);assert.equal(s.snapshot().loadStatus,'decrypt-failure');assert.equal(typeof s.snapshot().notice,'string');assert.throws(()=>s.save({baseUrl:'https://local-test.invalid',model:'LOCAL',apiKey:''}));assert.equal(io.files.get(file),valid);
});
test('I13 no-value commands reject explicit undefined without lazy opening',async()=>{
 const h=harness();try{await h.shell.ready;for(const name of ['chat','settings','chat-cancel','blink','face-next'])assert.equal(h.shell.command({name,value:undefined}),false);assert.equal(h.windows.length,1);}finally{h.dispose();}
});
test('I13 settings explicit test cancellation, hidden replies and late loads never show',async()=>{
 let resolve,signal,calls=0;const h=harness({deferred:true,request:r=>{calls++;signal=r.signal;return new Promise(ok=>resolve=ok);}});
 try{await h.shell.ready;h.shell.command({name:'settings'});h.get('settings').finish();await settle();h.invoke('settings','save',{baseUrl:'https://local-test.invalid',model:'LOCAL'});assert.equal(calls,0);
  let pending=h.invoke('settings','test');assert.equal(calls,1);h.get('settings').destroy();assert.equal(signal.aborted,true);resolve({reply:'test',face:null,action:'none'});assert.equal((await pending).ok,false);assert.equal(fs.existsSync(path.join(h.profileRoot,'conversation.json')),false);
  h.shell.command({name:'chat'});const chat=h.get('chat');chat.finish();await settle();pending=h.invoke('chat','send','隐藏模型回复');resolve({reply:'hidden success',face:3901,action:'blink'});assert.equal((await pending).outcome,'success');assert.ok(!h.shell.window.messages.some(([channel,v])=>channel==='chat:presentation'&&v.reply));
  h.shell.command({name:'settings'});const settings=h.get('settings');h.dispose();settings.finish();await settle();assert.deepEqual(settings.calls,[]);assert.equal(h.handles.size,0);assert.ok(h.windows.every(w=>w.calls.length===0));
 }finally{h.dispose();}
});
