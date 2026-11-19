'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
test('manual model failure remains inspectable after menu interrupts and automatic polling',async()=>{
 let time=0;const records=[];
 const c=require('../awareness/controller.cjs').create({enabled:true,clock:{now:()=>time,setTimeout:()=>1,clearTimeout(){}},
  activeWindow:async()=>({id:1,owner:{path:'C:\\Codex.exe',processId:2}}),
  capture:async()=>{throw Error('must not capture');},classify:async()=>{},deliver:async()=>true,
  getConfig:()=>{throw Error('secure store unavailable');},onDiagnostic:e=>records.push(e)});
 try{await c.tick(true);assert.equal(c.state().code,'model-error');c.interrupt();time+=5000;await c.tick();
 assert.equal(c.state().lastManual?.code,'model-error');
 assert.ok(records.some(e=>e.phase==='model-error'&&e.manual===true));
 }finally{c.destroy();}
});
test('journal writes bounded metadata, omits keys/screenshots/content, and rotates',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'baijie-awareness-log-'));
 const file=path.join(dir,'awareness.jsonl'),journal=require('../awareness/journal.cjs').create({file,maxBytes:256});
 journal.write({phase:'model-error',manual:true,apiKey:'PRIVATE',image:'IMAGE',evidence:'SCREEN-TEXT'});
 const text=fs.readFileSync(file,'utf8');assert.equal(text.includes('PRIVATE'),false);assert.equal(text.includes('IMAGE'),false);assert.equal(text.includes('SCREEN-TEXT'),false);
 assert.equal(JSON.parse(text.trim()).phase,'model-error');
 for(let i=0;i<20;i++)journal.write({phase:'armed',manual:true});
 assert.ok(fs.statSync(file).size<512);assert.ok(fs.existsSync(file+'.previous'));
});

test('delivery journal distinguishes gesture, bubble window and cancellation without storing speech',async()=>{
 const {harness,settle}=require('./i13-backend.test.cjs'),h=harness({mode:'visible'});
 try{
  await h.shell.ready;
  const event=h.event(h.shell.window);
  h.electron.ipcMain.emit('awareness:event',{}, {phase:'gesture-started'});
  const read=()=>fs.readFileSync(path.join(h.profileRoot,'logs','awareness.jsonl'),'utf8');
  assert.equal(read().includes('gesture-started'),false);
  h.electron.ipcMain.emit('awareness:event',event,{phase:'gesture-started'});
  h.electron.ipcMain.emit('awareness:event',event,{phase:'bubble-sent'});
  h.electron.ipcMain.emit('desktop:feedback',event,{id:1,text:'PRIVATE-SPEECH',durationMs:5000});
  await settle();
  h.electron.ipcMain.emit('awareness:event',event,{phase:'response-ended',reason:'shell-cancel'});
  h.electron.ipcMain.emit('desktop:feedback',event,null);
  const rows=read().trim().split('\n').map(JSON.parse),phases=rows.map(r=>r.phase);
  for(const phase of ['gesture-started','bubble-sent','bubble-received','bubble-window-ready','bubble-window-shown','response-ended','bubble-cleared'])assert.ok(phases.includes(phase),phase);
  assert.equal(rows.find(r=>r.phase==='response-ended').reason,'shell-cancel');
  assert.equal(read().includes('PRIVATE-SPEECH'),false);
 }finally{h.dispose();}
 assert.equal(h.electron.ipcMain.listenerCount('awareness:event'),0);
});
