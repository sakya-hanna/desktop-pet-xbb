const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');
const target=path.join(__dirname,'../puppet/rig/js/desktop-input.js');
function lifecycle(extra={}){
 const handlers={},calls=[];
 const host={addEventListener:(name,handler)=>handlers[name]=handler};
 require(target).bindDesktopInput(host,{menu:p=>calls.push(['menu',p]),drag:(dx,dy)=>calls.push(['drag',dx,dy])},()=>calls.push(['click']),{
  begin:()=>calls.push(['begin']),end:()=>calls.push(['end']),...extra
 });
 const event=(overrides={})=>({button:0,pointerId:1,screenX:10,screenY:20,target:{setPointerCapture(){}},preventDefault(){},...overrides});
 return {handlers,calls,event};
}
test('left pointer lifecycle ends before click and ignores non-left down',()=>{
 const {handlers,calls,event}=lifecycle();
 handlers.pointerdown(event({button:2}));assert.deepEqual(calls,[]);
 handlers.pointerdown(event());assert.deepEqual(calls,[['begin']]);
 handlers.pointerup(event());assert.deepEqual(calls,[['begin'],['end'],['click']]);
});
test('cancellation releases only the active pointer and never clicks',()=>{
 for(const finish of ['pointercancel','lostpointercapture','blur']){
  const {handlers,calls,event}=lifecycle();
  handlers.pointerdown(event());
  if(finish!=='blur'){
   handlers.pointerup(event({pointerId:2}));
   assert.equal(typeof handlers[finish],'function');
   handlers[finish](event({pointerId:2}));
   assert.deepEqual(calls,[['begin']],`${finish} must ignore another pointer`);
  }
  handlers[finish](event());
  handlers[finish](event());handlers.pointerup(event());
  assert.deepEqual(calls,[['begin'],['end']],finish);
 }
});
test('pointercancel without an id conservatively ends an active hold once',()=>{
 const {handlers,calls,event}=lifecycle();
 handlers.pointercancel({});assert.deepEqual(calls,[]);
 handlers.pointerdown(event());handlers.pointercancel({});handlers.pointercancel({});
 handlers.pointerup(event());assert.deepEqual(calls,[['begin'],['end']]);
});
test('repeated down ends the previous hold before starting the replacement',()=>{
 const {handlers,calls,event}=lifecycle();
 handlers.pointerdown(event());handlers.pointerdown(event({pointerId:2}));
 assert.deepEqual(calls,[['begin'],['end'],['begin']]);
 handlers.pointerup(event());handlers.pointercancel(event());handlers.lostpointercapture(event());
 assert.deepEqual(calls,[['begin'],['end'],['begin']]);
 handlers.pointerup(event({pointerId:2}));handlers.lostpointercapture(event({pointerId:2}));
 assert.deepEqual(calls,[['begin'],['end'],['begin'],['end'],['click']]);
});
test('contextmenu interrupts briefly without latching a native menu hold',()=>{
 const {handlers,calls,event}=lifecycle();
 handlers.contextmenu(event({preventDefault:()=>calls.push(['prevent'])}));
 assert.deepEqual(calls,[['prevent'],['begin'],['menu',{x:10,y:20}],['end']]);
 handlers.blur();assert.equal(calls.length,4);
 calls.length=0;handlers.pointerdown(event());handlers.contextmenu(event());handlers.pointerup(event());
 assert.deepEqual(calls,[['begin'],['end'],['begin'],['menu',{x:10,y:20}],['end']]);
});
test('drag threshold keeps the hold active until release and never clicks after dragging back',()=>{
 const {handlers,calls,event}=lifecycle();
 handlers.pointerdown(event());handlers.pointermove(event({screenX:13}));
 assert.deepEqual(calls,[['begin']]);
 handlers.pointermove(event({screenX:14}));handlers.pointermove(event());
 assert.deepEqual(calls,[['begin'],['drag',4,0],['drag',-4,0]]);
 handlers.pointerup(event());handlers.lostpointercapture(event());handlers.blur();
 assert.deepEqual(calls,[['begin'],['drag',4,0],['drag',-4,0],['end']]);
 calls.length=0;handlers.pointerdown(event());handlers.pointerup(event({screenX:14}));
 assert.deepEqual(calls,[['begin'],['end']]);
 calls.length=0;handlers.pointerdown(event());handlers.pointermove(event({screenX:13}));handlers.pointerup(event({screenX:13}));
 assert.deepEqual(calls,[['begin'],['end'],['click']]);
});
test('same-pointer repeated down balances hooks and blur ends only once',()=>{
 const {handlers,calls,event}=lifecycle();
 handlers.pointerdown(event());handlers.pointerdown(event());handlers.blur();handlers.blur();handlers.pointerup(event());
 assert.deepEqual(calls,[['begin'],['end'],['begin'],['end']]);
});
test('right click reaches native menu; click cycles once but dragging never changes face',()=>{
 assert.ok(fs.existsSync(target),'missing rig-to-desktop input bridge');
 const {bindDesktopInput}=require(target);const handlers={};const calls=[];
 const host={addEventListener:(n,fn)=>handlers[n]=fn};
 bindDesktopInput(host,{menu:p=>calls.push(['menu',p]),drag:(dx,dy)=>calls.push(['drag',dx,dy])},()=>calls.push(['click']));
 const ev=(x,y)=>({button:0,pointerId:1,screenX:x,screenY:y,target:{setPointerCapture(){}},preventDefault(){}});
 handlers.contextmenu(ev(100,200));assert.deepEqual(calls.pop(),['menu',{x:100,y:200}]);
 handlers.pointerdown(ev(10,20));handlers.pointerup(ev(10,20));assert.deepEqual(calls.pop(),['click']);
 handlers.pointerdown(ev(10,20));handlers.pointermove(ev(20,25));handlers.pointermove(ev(23,27));handlers.pointerup(ev(23,27));
 assert.deepEqual(calls,[['drag',10,5],['drag',3,2]]);
 calls.length=0;handlers.pointerdown(ev(0,0));handlers.pointercancel(ev(0,0));handlers.pointerup(ev(0,0));assert.deepEqual(calls,[]);
});

test('desktop mode only moves windows from grip, never from character or blank',()=>{
 const {handlers,calls,event}=lifecycle({canStart:e=>e.zone!=='blank',isDragHandle:e=>e.zone==='grip'});
 handlers.pointerdown(event({zone:'blank'}));handlers.pointerup(event());assert.deepEqual(calls,[]);
 handlers.pointerdown(event({zone:'body'}));handlers.pointermove(event({screenX:30}));handlers.pointerup(event({screenX:30}));
 assert.deepEqual(calls,[['begin'],['end']]);calls.length=0;
 handlers.pointerdown(event({zone:'body'}));handlers.pointerup(event());assert.deepEqual(calls,[['begin'],['end'],['click']]);calls.length=0;
 handlers.pointerdown(event({zone:'grip'}));handlers.pointermove(event({screenX:30}));handlers.pointerup(event({screenX:30}));
 assert.deepEqual(calls,[['begin'],['drag',20,0],['end']]);calls.length=0;
 handlers.pointerdown(event({zone:'grip'}));handlers.pointerup(event());assert.deepEqual(calls,[['begin'],['end']]);
});

test('unavailable pointer capture does not crash the interaction lifecycle',()=>{
 const {handlers,calls,event}=lifecycle();
 assert.doesNotThrow(()=>handlers.pointerdown(event({target:{setPointerCapture(){throw Error('not active');}}})));
 handlers.pointerup(event());assert.deepEqual(calls,[['begin'],['end'],['click']]);
});

test('gesture hooks receive subthreshold motion and release can consume default click',()=>{
 const seen=[];const r=lifecycle({isDragHandle:()=>false,pointerBegin:(e,m)=>seen.push(['start',e.pointerId,m.grip]),pointerMove:e=>seen.push(['move',e.clientX]),pointerEnd:(e,m)=>{seen.push(['end',m.reason]);return true;}});
 r.handlers.pointerdown(r.event({clientX:20}));r.handlers.pointermove(r.event({clientX:21,screenX:11}));r.handlers.pointerup(r.event({clientX:21,screenX:11}));
 assert.deepEqual(seen,[['start',1,false],['move',21],['end','release']]);assert.ok(!r.calls.some(c=>c[0]==='click'));
});

test('cancellation reasons cannot be mistaken for release; returned cancel handle clears hold once',()=>{
 for(const reason of ['pointercancel','lostpointercapture','blur']){
  const seen=[],r=lifecycle({pointerEnd:(_e,m)=>seen.push(m.reason)});
  r.handlers.pointerdown(r.event());r.handlers[reason](r.event());assert.deepEqual(seen,[reason]);
 }
 const handlers={},seen=[];const api=require(target).bindDesktopInput({addEventListener:(k,f)=>handlers[k]=f},null,()=>seen.push('click'),{begin:()=>seen.push('begin'),end:()=>seen.push('end'),pointerEnd:(_e,m)=>seen.push(m.reason)});
 handlers.pointerdown({button:0,pointerId:1,screenX:0,screenY:0,target:{}});
 assert.equal(typeof api?.cancel,'function');api.cancel();api.cancel();
 assert.deepEqual(seen,['begin','cancel','end']);
});
