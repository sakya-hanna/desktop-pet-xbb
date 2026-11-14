'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createHarness}=require('./helpers/interaction-fixtures.cjs');
function point(h,part){for(let y=58;y<340;y+=3)for(let x=30;x<230;x+=3)if(h.renderer.hitPart(x,y)?.partId===part)return {clientX:x,clientY:y};throw Error('Material missing '+part);}
function report(h,stage){const s=h.runtime.status();console.log('I14_TRACE '+JSON.stringify({stage,manualFace:s.manualFace,renderedFace:s.renderedFace,expression:s.motion.expression,chat:!!s.chatPresentation,cancelReasons:s.cancelReasons}));}
test('I14 short head contact must not lock out subsequent skirt and hand expressions',async t=>{
 const h=await createHarness({idle:false});t.after(()=>h.runtime.destroy());h.runtime.start();h.tick(2);
 const p=point(h,'head');h.emit(h.canvas,'pointerdown',p);h.tick(1,80);h.emit(h.win,'pointerup',{...p,buttons:0});report(h,'after-head-tap');
 const failures=[];
 for(const part of ['skirt-front','arm-screen-left']){
  const q=point(h,part);h.emit(h.canvas,'pointerdown',q);h.emit(h.win,'pointermove',{...q,clientX:q.clientX+12});h.tick(18,100);
  const s=h.runtime.status();report(h,part);
  assert.ok(s.motion.expression,'physical gesture really activated');
  if(s.renderedFace!==s.motion.expression.face)failures.push({part,expected:s.motion.expression.face,actual:s.renderedFace,manualFace:s.manualFace});
  h.emit(h.win,'pointerup',{...q,buttons:0});h.tick(10,100);
 }
 assert.deepEqual(failures,[],'touch expressions must reach rendered face after a head tap');assert.equal(h.runtime.status().manualFace,'auto');assert.deepEqual(h.errors,[]);
});
test('I14 short contacts on every interactive region never choose or replace a manual face',async t=>{
 const h=await createHarness({idle:false});t.after(()=>h.runtime.destroy());h.runtime.start();h.tick(2);
 for(const selected of ['auto','3831']){
  h.action('face:'+selected);h.tick(3,100);
  for(const part of ['head','chest','arm-screen-left','arm-screen-right','skirt-front','skirt-right']){
   const p=point(h,part);h.emit(h.canvas,'pointerdown',p);h.tick(1,80);h.emit(h.win,'pointerup',{...p,buttons:0});
   assert.equal(h.runtime.status().manualFace,selected,part+' must not enter face-next');
  }
 }
 assert.deepEqual(h.errors,[]);
});
test('I14 short valid head stroke preserves its own expression instead of latching a manual face',async t=>{
 const h=await createHarness({idle:false});t.after(()=>h.runtime.destroy());h.runtime.start();h.tick(2);
 const p=point(h,'head');h.emit(h.canvas,'pointerdown',p);
 for(let i=0;i<6;i++){h.emit(h.win,'pointermove',{...p,clientX:p.clientX+(i%2?0:3)});h.tick(1,45);}
 h.emit(h.win,'pointerup',{...p,buttons:0});h.tick(3,70);
 const s=h.runtime.status();assert.equal(s.motion.expression?.kind,'head','stroke met the existing gesture threshold');
 assert.equal(s.manualFace,'auto');assert.equal(s.renderedFace,s.motion.expression.face);
 assert.equal(h.calls.filter(c=>c[0]==='feedback'&&c[1]).length,1);assert.deepEqual(h.errors,[]);
});
