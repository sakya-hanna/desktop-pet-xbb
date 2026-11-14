'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {createHarness,root}=require('./helpers/interaction-fixtures.cjs'),character=require('../src/character.js'),rig=require('../src/material-rig.js'),hitMath=require('../src/hit-test.js');
const rendered=(h,name)=>h.draws.find(d=>d.texture===name);
function contact(h,entry){
 const image=h.load(entry.texture),[x0,y0,x1,y1]=h.meta.images[entry.texture].alpha_bbox,aim=[(x0+x1)/2,y1-80];let best=null,distance=Infinity;
 const alpha=(x,y)=>x<0||y<0||x>=image.width||y>=image.height?0:image.data[(y*image.width+x)*4+3];
 for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++){if(alpha(x,y)<245)continue;const d=(x-aim[0])**2+(y-aim[1])**2;if(d>=distance||![-4,0,4].every(dy=>[-4,0,4].every(dx=>alpha(x+dx,y+dy)>240)))continue;distance=d;best=[x+0.5,y+0.5];}
 assert.ok(best,'opaque skirt contact required');return best.map((v,i)=>v*character.binding[i?'height':'width']/[image.width,image.height][i]);
}
const parsed=entry=>rig.importSkirtMesh(JSON.parse(fs.readFileSync(path.join(root,'assets',entry.mesh))),character.binding,character.grabs);
test('I4 renderer: current-frame picking and grab inverse remove parent motion and effective passive cloth',async t=>{
 const h=await createHarness({idle:false});t.after(()=>h.runtime.destroy());const config=h.meta.interaction.skirts;
 for(const entry of config.parts.filter(p=>p.grab)){
  h.renderer.render({},'3942');const at=contact(h,entry),p=h.css(at),hit=h.renderer.hitPart(p.clientX,p.clientY),part=character.grabs[entry.id],m=parsed(entry).mesh;
  assert.equal(hit?.partId,entry.id);const oldFrame=h.renderer.frameState();
  for(const grab of [[7,-3],[part.limit[0],0]]){
   const other=entry.id==='skirt-front'?'skirt-right':'skirt-front';
   const pose={bodyRoll:0.025,bodyX:0.001,grab:{[entry.id]:grab,[other]:[4,-2]},cloth:{'skirt-front':[1.4,0.5],'skirt-right':[1.1,-0.4]}};
   h.renderer.render(pose,'3942');const frame=h.renderer.frameState(),actual=rendered(h,entry.texture);
   assert.deepEqual(actual.positions,rig.deformMesh(m,pose,character.binding,part));
   const world=hitMath.pickMaterial({rest:actual.positions,indices:m.indices},m.rest,hit.materialPoint),visible=h.css(world),picked=h.renderer.hitPart(visible.clientX,visible.clientY);
   assert.equal(picked?.partId,entry.id);assert.equal(picked.frameId,frame.frameId);
   const weights=[1-hit.influence,0,hit.influence],point=h.css(rig.deformPoint(hit.materialPoint,pose,character.binding,part,weights));
   const mapped=h.renderer.clientToMaterial(point.clientX,point.clientY,frame,hit),target=mapped.point.map((v,i)=>(v-hit.materialPoint[i])/hit.influence);
   target.forEach((v,i)=>assert.ok(Math.abs(v-grab[i])<1e-8,'passive cloth and the other panel recoil must not bias the active grab target: '+JSON.stringify({target,grab})));
   assert.equal(h.renderer.clientToMaterial(point.clientX,point.clientY,oldFrame,hit),null);
   const lining=config.parts.find(p=>!p.grab),liningMesh=parsed(lining).mesh;
   assert.deepEqual(rendered(h,lining.texture).positions,rig.deformMesh(liningMesh,pose,character.binding,null),'lining inherits parent only');
   for(let i=0;i<m.rest.length;i+=2)if(m.weights[i/2*3]===1){
    const parent=rig.deformPoint([m.rest[i],m.rest[i+1]],pose,character.binding);
    assert.equal(actual.positions[i],Math.fround(parent[0]));assert.equal(actual.positions[i+1],Math.fround(parent[1]));
   }
  }
 }
 assert.deepEqual(h.errors,[]);
});
const parentPose=pose=>{const copy={...pose};delete copy.grab;delete copy.cloth;return copy;};
const baseAt=time=>{const e=require('../src/director.js').createDirector({idle:true,seed:17});for(let i=0;i<Math.round(time*120);i++)e.advance(1/120);return e.snapshot().pose;};
function anchors(h){return [
 {id:'arm-screen-left',at:[784*530/2612,1814*800/3941]},
 {id:'arm-screen-right',at:[1828.5*530/2612,1579.5*800/3941]},
 ...h.meta.interaction.skirts.parts.filter(p=>p.grab).map(p=>({id:p.id,at:contact(h,p)}))
];}
test('I4 runtime: all four real targets drive the body and secondary motion, retain normal release, and cancel cleanly',async t=>{
 const h=await createHarness({idle:false});t.after(()=>h.runtime.destroy());h.runtime.start();const entries=anchors(h),base=parentPose(h.runtime.status().motion.pose);
 for(const {id,at}of entries){
  const p=h.css(at),hit=h.renderer.hitPart(p.clientX,p.clientY);assert.equal(hit?.partId,id);
  const body=new Float32Array(rendered(h,h.meta.interaction.skirts.body).positions);
  h.emit(h.canvas,'pointerdown',p);h.emit(h.win,'pointermove',{...p,clientX:p.clientX+3});h.tick();
  assert.equal(h.runtime.status().pointerKind,'grab-pending');assert.deepEqual(parentPose(h.runtime.status().motion.pose),base);
  h.emit(h.win,'pointermove',{...p,clientX:p.clientX+16,clientY:p.clientY+4});h.tick(12);
  const held=h.runtime.status(),pose=held.motion.pose;
  assert.equal(held.pointerKind,'grab');assert.ok(Math.abs(pose.bodyRoll)>0.0004,'drag must reach body');
  assert.ok(Object.values(pose.hair).flat().some(v=>Math.abs(v)>0.0001),'drag must reach secondary hair chain');
  assert.ok(Object.values(pose.cloth||{}).flat().some(v=>Math.abs(v)>0.0001),'drag must reach secondary cloth');
  assert.notDeepEqual(rendered(h,h.meta.interaction.skirts.body).positions,body,'body response must reach drawn vertices');
  h.emit(h.win,'pointercancel',{pointerId:99});assert.equal(h.runtime.status().activePointer,7);
  h.emit(h.win,'pointerup',{...p,buttons:0});assert.equal(h.runtime.status().activePointer,null);assert.equal(h.captured(),null);
  assert.deepEqual(h.runtime.status().motion.pose,pose,'normal release must not snap any channel');
  h.tick(5);assert.notDeepEqual(parentPose(h.runtime.status().motion.pose),base,'normal release retains residual motion');
  h.emit(h.win,'blur');assert.deepEqual(parentPose(h.runtime.status().motion.pose),base,'cancel only the interaction response');
  assert.ok(Object.values(h.runtime.status().motion.pose.cloth||{}).flat().every(v=>v===0));
  h.tick(2);assert.deepEqual(parentPose(h.runtime.status().motion.pose),base);assert.equal(h.raf.size,1);
 }
 assert.equal(h.calls.some(c=>c[0]==='drag'),false);assert.deepEqual(h.errors,[]);
});
test('I4 lifecycle: active and released coupling clears on common interruptions without resetting idle or selected face',async t=>{
 const h=await createHarness({idle:true});t.after(()=>h.runtime.destroy());h.runtime.start();h.tick(2);h.action('face:3831');
 const entries=h.meta.interaction.skirts.parts.filter(p=>p.grab).map(p=>({id:p.id,at:contact(h,p)}));let index=0;
 for(const kind of ['blur','invalid-up','visibility','stop','rebound-blur','destroy']){
  const {id,at}=entries[index++%entries.length],point=rig.deformPoint(at,h.runtime.status().motion.pose,character.binding),p=h.css(point);
  assert.equal(h.renderer.hitPart(p.clientX,p.clientY)?.partId,id);h.emit(h.canvas,'pointerdown',p);h.emit(h.win,'pointermove',{...p,clientX:p.clientX+18});h.tick(8);
  assert.ok(Math.abs(h.runtime.status().motion.pose.bodyRoll)>0.0001,'nonzero interaction is required before cancellation');
  if(kind==='rebound-blur'){h.emit(h.win,'pointerup',{...p,buttons:0});h.tick(2);}
  const before=h.runtime.status();
  if(kind==='invalid-up')h.emit(h.win,'pointerup',{clientX:NaN,buttons:0});
  else if(kind==='visibility'){h.doc.hidden=true;h.emit(h.doc,'visibilitychange');}
  else if(kind==='stop')h.runtime.stop();else if(kind==='destroy')h.runtime.destroy();else h.emit(h.win,'blur');
  const after=h.runtime.status();assert.equal(after.activePointer,null);assert.equal(after.motion.pointerId,null);assert.equal(h.captured(),null);
  assert.equal(after.motion.time,before.motion.time);assert.equal(after.renderedFace,'3831');
  assert.deepEqual(parentPose(after.motion.pose),baseAt(after.motion.time),kind+' must restore only the independent base motion');
  assert.ok(Object.values(after.motion.pose.grab).flat().every(v=>v===0));assert.ok(Object.values(after.motion.pose.cloth||{}).flat().every(v=>v===0));
  assert.equal(h.raf.size,['visibility','stop','destroy'].includes(kind)?0:1);
  if(kind==='visibility'){h.doc.hidden=false;h.emit(h.doc,'visibilitychange');}else if(kind==='stop')h.runtime.start();
  if(kind!=='destroy'){h.tick(2);assert.deepEqual(parentPose(h.runtime.status().motion.pose),baseAt(h.runtime.status().motion.time),'cancelled reaction velocity must not revive');}
 }
 assert.deepEqual(h.errors,[]);
});
