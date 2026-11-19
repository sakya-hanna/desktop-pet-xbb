'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {harness,settle}=require('./i13-backend.test.cjs');
function preview(h){return h.windows.find(w=>w.url==='baijie28://app/studio.html'&&!w.dead);}
function ready(h,w){w.close=()=>w.destroy();h.electron.ipcMain.emit('studio:ready',h.event(w));}
test('studio waits for the real renderer, pauses pet and restores its original window on return',async()=>{
 const h=harness({mode:'visible'});try{
  await h.shell.ready;const original=h.shell.window.getBounds();assert.equal(h.shell.window.isVisible(),true);
  assert.ok(h.shell.menuTemplate().some(m=>m.id==='studio'));
  h.shell.openStudio();const w=preview(h);assert.ok(w);assert.equal(w.visible,false);assert.equal(h.shell.window.visible,true);
  assert.throws(()=>h.handles.get('studio:read')({}),/sender/);
  ready(h,w);assert.equal(w.visible,true);assert.equal(h.shell.window.visible,false);
  assert.equal(h.shell.window.messages.some(m=>m[0]==='action'&&m[1]==='shell:hide'),true);
  const value=h.handles.get('studio:read')(h.event(w));assert.ok(value.faces.length>10);
  h.shell.openStudio();assert.equal(h.windows.filter(w=>w.url==='baijie28://app/studio.html').length,1);
  h.handles.get('studio:command')(h.event(w),'desktop');assert.equal(w.dead,true);assert.equal(h.shell.window.visible,true);
  assert.deepEqual(h.shell.window.getBounds(),original);
 }finally{h.dispose();}
 assert.equal(h.handles.size,0);
});
test('studio reuses model settings and chat history, and receives the existing reply presentation',async()=>{
 const h=harness({mode:'visible',request:async()=>({reply:'已有聊天通道的回复',face:3901,action:'blink'})});try{
  await h.shell.ready;h.shell.openStudio();const w=preview(h);ready(h,w);
  const command=(name,value)=>h.handles.get('studio:command')(h.event(w),name,value);
  assert.equal(command('settings'),true);await settle();
  assert.equal((await h.invoke('settings','save',{baseUrl:'https://fixture.invalid/v1',model:'fixture',apiKey:'fixture-only'})).ok,true);
  assert.equal(command('chat'),true);await settle();
  assert.equal((await h.invoke('chat','send','主窗口测试')).outcome,'success');
  assert.ok(w.messages.some(m=>m[0]==='studio:chat'&&m[1].reply==='已有聊天通道的回复'));
  assert.equal(command('idle',false),true);assert.equal(h.shell.snapshot().idleEnabled,false);
  assert.ok(w.messages.some(m=>m[0]==='studio:state'&&m[1].idleEnabled===false));
  assert.equal(command('arbitrary-command'),false);
 }finally{h.dispose();}
});
test('failed studio load leaves pet available; hidden runs never show a native window',async()=>{
 for(const mode of ['visible','hidden']){
  const h=harness({mode,deferred:true});try{
   await h.shell.ready;h.shell.openStudio();const w=preview(h);
   w.fail(Error('fixture load failure'));await settle();assert.equal(w.dead,true);assert.equal(h.shell.window.visible,mode==='visible');
   h.shell.openStudio();const next=preview(h);next.finish();await settle();ready(h,next);
   if(mode==='hidden')assert.equal(h.windows.some(w=>w.calls.some(c=>['show','focus','showInactive'].includes(c))),false);
  }finally{h.dispose();}
 }
});
