'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {create}=require('../awareness/controller.cjs');
const image=Buffer.from([255,216,255,217]);
const clock={setTimeout:()=>1,clearTimeout(){}};

test('capture selects a display by display_id and can capture non-Codex windows',async()=>{
 const requests=[],encoded=[];
 const source=(id,display_id)=>({id,display_id,thumbnail:{isEmpty:()=>false,getSize:()=>({width:1280,height:720}),toJPEG:()=>{encoded.push(id);return image;}}});
 const native=require('../awareness/native.cjs').create({
  screen:{getCursorScreenPoint:()=>({x:-500,y:200}),getDisplayNearestPoint:p=>{assert.equal(p.x,-500);return {id:22};}},
  desktopCapturer:{getSources:async options=>{requests.push(options);return options.types[0]==='screen'
   ?[source('screen:0:0','11'),source('screen:1:0','22')]:[source('window:88:0','')];}}
 });
 const target=native.screenTarget();assert.deepEqual(target,{kind:'screen',id:22});
 assert.equal(await native.capture(target),image);assert.deepEqual(encoded,['screen:1:0']);
 await native.capture({id:88,owner:{path:'C:\\OtherApp.exe'}});
 assert.deepEqual(encoded,['screen:1:0','window:88:0']);
 assert.deepEqual(requests.map(r=>r.types),[['screen'],['window']]);
 await assert.rejects(native.capture({kind:'screen',id:33}),/capture-unavailable/);
 assert.equal(encoded.length,2,'missing display must not fall back to another monitor');
});

test('manual image analysis survives foreground polling; an unsupported scene produces no Codex encouragement',async()=>{
 let finish,signal,deliveries=0,captures=0;
 const c=create({enabled:true,clock,activeWindow:async()=>({id:8,owner:{path:'C:\\electron.exe'}}),manualTarget:()=>({kind:'screen',id:22}),
  getConfig:()=>({baseUrl:'https://test.invalid',model:'fixture'}),capture:async()=>{captures++;return image;},
  classify:args=>{signal=args.signal;return new Promise(r=>finish=r);},deliver:async()=>{deliveries++;return true;}});
 try{
  const pending=c.tick(true);for(let i=0;i<8;i++)await Promise.resolve();
  await c.tick();assert.equal(signal.aborted,false);
  finish({codex:false,working:false,activity:'gaming'});
  assert.equal(await pending,false);assert.equal(captures,1);assert.equal(deliveries,0);assert.equal(c.state().code,'no-match');
 }finally{c.destroy();}
});

test('a different interaction rule can use the same automatic observation pipeline',async()=>{
 let captures=0,reply;
 const c=create({enabled:true,dwellMs:0,clock,activeWindow:async()=>({id:8,owner:{path:'C:\\Reader.exe'}}),
  rule:{accepts:w=>w?.owner.path.endsWith('Reader.exe'),matches:s=>s.activity==='reading',lines:['fixture response'],watchingLabel:'fixture waiting'},
  getConfig:()=>({baseUrl:'https://test.invalid',model:'fixture'}),capture:async()=>{captures++;return image;},
  classify:async()=>({codex:false,working:false,activity:'reading'}),deliver:async value=>{reply=value.text;return true;}});
 try{assert.equal(await c.tick(),true);assert.equal(captures,1);assert.equal(reply,'fixture response');}finally{c.destroy();}
});
