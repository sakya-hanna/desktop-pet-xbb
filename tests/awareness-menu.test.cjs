'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {create}=require('../awareness/controller.cjs');
function fixture(){
 let now=0,menu=false,busy=false;const calls={captures:0};
 const c=create({enabled:true,clock:{now:()=>now,setTimeout:()=>1,clearTimeout(){}},
  paused:()=>menu,busy:()=>busy,activeWindow:async()=>({id:1,owner:{path:'C:\\Codex.exe',processId:1}}),
  getConfig:()=>({baseUrl:'https://test.invalid',model:'fixture'}),
  capture:async()=>{calls.captures++;return Buffer.from([255,216,255,217]);},
  classify:async()=>({codex:true,working:true,activity:'developing'}),deliver:async()=>true});
 return {c,calls,menu:v=>menu=v,busy:v=>busy=v,advance:ms=>now+=ms};
}
test('opening and holding the menu does not replace waiting or cooldown with interaction busy',async()=>{
 const f=fixture();try{
  f.menu(true);f.busy(true);f.c.interrupt();assert.equal(f.c.state().code,'watching');
  for(let i=0;i<4;i++){f.advance(5000);await f.c.tick();}
  assert.equal(f.c.state().code,'watching');assert.equal(f.calls.captures,0);
  f.menu(false);f.busy(false);await f.c.tick(true);assert.equal(f.c.state().code,'cooldown');
  f.menu(true);f.busy(true);f.c.interrupt();f.advance(5000);await f.c.tick();
  assert.equal(f.c.state().code,'cooldown');
 }finally{f.c.destroy();}
});
test('manual countdown is kept while menu is open and observes after close',async()=>{
 const f=fixture();try{
  f.c.arm();f.menu(true);f.busy(true);f.c.interrupt();f.advance(5000);await f.c.tick();
  assert.equal(f.c.state().code,'armed');assert.equal(f.calls.captures,0);
  f.menu(false);f.busy(false);await f.c.tick();assert.equal(f.calls.captures,1);assert.equal(f.c.state().code,'cooldown');
 }finally{f.c.destroy();}
});
test('real shell menu hold builds its submenu from the actual prior state',async()=>{
 const {harness}=require('./i13-backend.test.cjs'),h=harness({mode:'visible'});
 try{await h.shell.ready;h.shell.awareness.setEnabled(true);
  let opened,close;
  h.electron.Menu.buildFromTemplate=template=>Object.assign(new (require('node:events').EventEmitter)(),{popup:options=>{opened=template;close=options.callback;}});
  assert.equal(h.shell.menu({x:50,y:50}),true);
  const menu=opened.find(item=>item.id==='screen-companion');
  assert.ok(menu.submenu.some(item=>item.label==='等待持续使用 Codex'));
  assert.equal(menu.submenu.some(item=>item.label==='先等当前互动结束'),false);
  close();
 }finally{h.dispose();}
});
test('an actual interaction still cancels a pending request and its late result never displays',async()=>{
 let resolve,signal,delivered=0;
 const c=create({enabled:true,clock:{setTimeout:()=>1,clearTimeout(){}},
  activeWindow:async()=>({id:1,owner:{path:'C:\\Codex.exe',processId:1}}),
  getConfig:()=>({baseUrl:'https://test.invalid',model:'fixture'}),capture:async()=>Buffer.from([255,216,255,217]),
  classify:args=>{signal=args.signal;return new Promise(r=>resolve=r);},deliver:async()=>{delivered++;return true;}});
 try{const pending=c.tick(true);for(let i=0;i<8;i++)await Promise.resolve();
  c.interrupt();assert.equal(signal.aborted,true);assert.equal(c.state().code,'interrupted');
  resolve({working:true,activity:'developing'});await pending;assert.equal(delivered,0);
 }finally{c.destroy();}
});

test('manual observation uses the selected screen even when the pet retains foreground',async()=>{
 let now=0,captures=0,delivered=0;
 const c=create({enabled:false,clock:{now:()=>now,setTimeout:()=>1,clearTimeout(){}},
  activeWindow:async()=>{throw Error('manual observation must not require foreground focus');},manualTarget:()=>({kind:'screen',id:2}),
  capture:async target=>{assert.deepEqual(target,{kind:'screen',id:2});captures++;return Buffer.from([255,216,255,217]);},
  classify:async()=>({codex:true,working:true,activity:'reading'}),getConfig:()=>({baseUrl:'https://test.invalid',model:'fixture'}),
  deliver:async()=>{delivered++;return true;}});
 try{
  c.arm();now=4999;await c.tick();assert.equal(captures,0);
  now=5000;await c.tick();assert.equal(captures,1);assert.equal(delivered,1);assert.equal(c.state().lastManual.code,'cooldown');
  now+=65000;await c.tick();assert.equal(captures,1,'manual snapshot does not start automatic screen observation');
 }finally{c.destroy();}
});
