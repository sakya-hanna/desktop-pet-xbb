'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createHarness}=require('./helpers/interaction-fixtures.cjs');
const ch=require('../src/character.js'),rig=require('../src/material-rig.js');
const contacts=[['head',[298,105]],['arm-screen-left',[784*530/2612,1814*800/3941]],
 ['arm-screen-right',[1828.5*530/2612,1579.5*800/3941]],['skirt-front',[260,430]],['skirt-right',[380,390]]];
const vertices=h=>h.draws.filter(d=>d.texture!=='expression-face'&&!/baijie-(?:face|blink)-/.test(d.texture)).map(d=>({texture:d.texture,positions:Array.from(d.positions)}));
function distance(a,b){assert.equal(a.length,b.length);let max=0;for(let i=0;i<a.length;i++){assert.equal(a[i].texture,b[i].texture);assert.equal(a[i].positions.length,b[i].positions.length);for(let j=0;j<a[i].positions.length;j++)max=Math.max(max,Math.abs(a[i].positions[j]-b[i].positions[j]));}return max;}
async function released(id,point){
 const h=await createHarness({idle:false});h.runtime.start();h.tick(2);
 const part=id==='head'?ch.materials.head:ch.grabs[id];
 const p=h.css(rig.deformPoint(point,h.runtime.status().motion.pose,ch.binding,part,id==='head'?undefined:[0,0,1]));
 assert.equal(h.renderer.hitPart(p.clientX,p.clientY)?.partId,id);
 h.emit(h.canvas,'pointerdown',p);
 h.emit(h.win,'pointermove',{...p,clientX:p.clientX+14,clientY:p.clientY-3});h.tick(22);
 h.emit(h.win,'pointerup',{...p,clientX:p.clientX+14,clientY:p.clientY-3,buttons:0});
 assert.equal(h.runtime.status().activePointer,null);assert.ok(h.runtime.status().motion.expression);
 return h;
}
for(const [id,point]of contacts){
 test(`${id}: moving the cursor away after release preserves the drawn recovery and face`,async t=>{
  const h=await released(id,point);t.after(()=>h.runtime.destroy());
  const motion=h.runtime.status().motion,drawn=vertices(h),face=h.renderer.status().faceBlend;
  for(const [target,event,extra]of [[h.win,'mouseleave',{}],[h.win,'pointerleave',{}],[h.win,'mouseout',{relatedTarget:null}]]){
   h.emit(target,event,{buttons:0,clientX:-20,clientY:-20,...extra});
   const jump=distance(drawn,vertices(h));console.log('RELEASE_EXIT '+JSON.stringify({id,event,meshJump:jump}));
   assert.equal(jump,0,'a hover exit must not teleport the actual material mesh');
   assert.equal(JSON.stringify(h.runtime.status().motion),JSON.stringify(motion),'recovery expression/feedback and springs must keep their lifetime');
   assert.equal(JSON.stringify(h.renderer.status().faceBlend),JSON.stringify(face));
   assert.equal(h.runtime.status().interactive,false,'outside cursor remains click-through');
  }
  h.tick(1);assert.ok(distance(drawn,vertices(h))>0,'recovery keeps animating');
  h.emit(h.win,'blur');assert.equal(h.runtime.status().motion.expression,null,'real focus loss still cancels');
  assert.deepEqual(h.errors,[]);assert.equal(h.raf.size,1);
 });
 test(`${id}: a released long frame has the same bounded recovery as an ordinary 100ms frame`,async t=>{
  const h=await released(id,point),control=await released(id,point);t.after(()=>{h.runtime.destroy();control.runtime.destroy();});
  h.tick(1,650);control.tick(1,100);
  const jump=distance(vertices(h),vertices(control));console.log('RELEASE_GAP '+JSON.stringify({id,meshDifference:jump}));
  assert.equal(jump,0,'time-gap handling must not erase released spring position/velocity');
  assert.equal(JSON.stringify(h.runtime.status().motion),JSON.stringify(control.runtime.status().motion));
  assert.equal(JSON.stringify(h.renderer.status().faceBlend),JSON.stringify(control.renderer.status().faceBlend));
  assert.equal(h.runtime.status().activePointer,null);assert.equal(h.raf.size,1);assert.deepEqual(h.errors,[]);
 });
}
