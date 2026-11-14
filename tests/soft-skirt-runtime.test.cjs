'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createHarness}=require('./helpers/interaction-fixtures.cjs'),rig=require('../src/material-rig.js'),ch=require('../src/character.js');
test('real skirt picking carries a locked material pinch through drawing, release and cancellation',async()=>{
 const h=await createHarness({idle:false});
 try{
  h.runtime.start();h.tick(2);
  for(const [id,at] of [['skirt-front',[260,430]],['skirt-right',[380,390]]]){
   const p=h.css(at),hit=h.renderer.hitPart(p.clientX,p.clientY);assert.equal(hit.partId,id);
   h.emit(h.canvas,'pointerdown',p);h.emit(h.win,'pointermove',{...p,clientX:p.clientX+12});h.tick(24);
   let state=h.runtime.status();assert.equal(state.pointerKind,'grab');
   assert.deepEqual(JSON.parse(JSON.stringify(state.motion.pose.skirtContacts[id])),hit.materialPoint);
   assert.ok(Math.abs(state.motion.pose.grab[id][0])>15);
   const draw=h.draws.find(d=>d.texture==='baijie-'+id+'.png'),part=ch.grabs[id];
   const expected=rig.deformMesh({rest:draw.rest,indices:draw.indices,weights:undefined},state.motion.pose,ch.binding,part);
   // Use actual authored weights rather than treating the full mesh as a hem.
   const mesh=rig.importSkirtMesh(require('../assets/baijie-'+id+'.mesh.json'),ch.binding,ch.grabs).mesh;
   assert.deepEqual(draw.positions,rig.deformMesh(mesh,state.motion.pose,ch.binding,part));
   assert.notDeepEqual(draw.positions,expected,'uploaded cloth lost its authored waist-to-hem weights');
   const before=state.motion.pose.grab[id].slice();h.emit(h.win,'pointerup',{...p,clientX:p.clientX+12,buttons:0});
   assert.deepEqual(h.runtime.status().motion.pose.grab[id],before);
   h.tick(16);assert.ok(h.runtime.status().motion.pose.grab[id][0]<-1,'real RAF must show release rebound');
   h.emit(h.win,'blur');state=h.runtime.status();assert.equal(state.activePointer,null);assert.deepEqual(state.motion.pose.grab[id],[0,0]);
   assert.equal(state.motion.pose.skirtContacts,undefined);assert.equal(state.motion.pose.skirtRecoil,undefined);
   h.tick(6);assert.deepEqual(h.runtime.status().motion.pose.grab[id],[0,0]);
  }
  h.action('face:9002');assert.equal(h.runtime.status().renderedFace,'9002');
  assert.deepEqual(h.errors,[]);assert.equal(h.raf.size,1);
 }finally{h.runtime.destroy();}
});
test('chest click reaches the blush texture and blink blend, then yields to manual face and normal recovery',async()=>{
 const h=await createHarness({idle:false});
 try{
  h.runtime.start();h.tick(2);const p=h.css([295,222]);assert.equal(h.renderer.hitPart(p.clientX,p.clientY).partId,'chest');
  h.emit(h.canvas,'pointerdown',p);h.emit(h.win,'pointerup',{...p,buttons:0});h.tick(40);
  const s=h.runtime.status();assert.equal(s.renderedFace,'9002');assert.equal(s.motion.expression.semantic,'shy');
  assert.ok(h.renderer.status().faceBlend.some(f=>f.face==='9002'&&f.weight===1));
  h.renderer.render(s.motion.pose,'9002',false,1,false,[{face:'9002',weight:1}]);
  assert.ok(h.draws.some(d=>d.texture==='expression-face'),'blink must use the expression-specific texture');
  h.action('face:3942');h.tick(3);assert.equal(h.runtime.status().renderedFace,'3942');
  h.action('face:auto');h.tick(140);assert.equal(h.runtime.status().motion.expression,null);
  assert.deepEqual(h.errors,[]);
 }finally{h.runtime.destroy();}
});
