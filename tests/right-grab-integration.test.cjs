'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {createHarness:handHarness,root}=require('./helpers/interaction-fixtures.cjs');
// Hand-only regression configuration; combined layer behavior is covered by I3.
const createHarness=(options={})=>handHarness({...options,mutateManifest:meta=>{meta.interaction.skirts.enabled=false;options.mutateManifest?.(meta);}});
const character=require('../src/character.js'),rig=require('../src/material-rig.js');
const target='arm-screen-right',left='baijie-arm-screen-left.png';
const material=(x,y)=>[x*character.binding.width/2612,y*character.binding.height/3941];
const draw=(h,name)=>h.draws.find(d=>d.texture===name);
const alpha=(image,x,y)=>x<0||y<0||x>=image.width||y>=image.height?0:image.data[(y*image.width+x)*4+3];
function handContact(h){
 const config=h.meta.interaction.rightArm,hand=config.parts.find(p=>p.id==='right-hand').texture,wrist=config.parts.find(p=>p.id==='right-wrist').texture;
 const image=h.load(hand),cover=h.load(config.cloth),ornament=h.load(wrist),[x0,y0,x1,y1]=h.meta.images[hand].alpha_bbox;
 let best=null,distance=Infinity,handPixels=0,clothCovered=0;
 for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++){
  if(alpha(image,x,y)>16){handPixels++;if(alpha(cover,x,y)>16)clothCovered++;}
  if(![-4,0,4].every(dy=>[-4,0,4].every(dx=>alpha(image,x+dx,y+dy)>240&&alpha(ornament,x+dx,y+dy)===0)))continue;
  const score=(x-(x0+x1)/2)**2+(y-(y0+y1)/2)**2;if(score<distance){distance=score;best=[x+0.5,y+0.5];}
 }
 assert.ok(best,'contact must be inside real opaque palm pixels, away from the wrist edge');
 return {source:best,point:material(...best),handPixels,clothCovered,texture:hand};
}
function intake(h){return rig.importRightHandMeshes(JSON.parse(fs.readFileSync(path.join(root,'assets',h.meta.interaction.rightArm.mesh))),character.binding,character.grabs);}
function assertMeshes(h,source,pose){
 for(const p of source.parts){
  const entry=h.meta.interaction.rightArm.parts.find(e=>e.id===p.id),actual=draw(h,entry.texture);
  assert.ok(actual,'actual GL draw is required for '+p.id);
  assert.deepEqual(actual.indices,p.mesh.indices);assert.deepEqual(actual.uv,p.mesh.uv);
  assert.deepEqual(actual.positions,rig.deformMesh(p.mesh,pose,character.binding,character.grabs[target]),p.id+' uses the imported authored mesh and shared local target');
 }
}
function otherMeshes(h){
 return {left:rig.authoredMesh(JSON.parse(fs.readFileSync(path.join(root,'assets',h.meta.interaction.leftArm.mesh))),character.binding),
  cloth:{rest:new Float32Array(draw(h,h.meta.interaction.rightArm.cloth).rest)}};
}
function assertOtherMeshes(h,meshes,pose){
 // Keep this frame's shared parent and passive channels; remove only the right local target.
 const withoutRight={...pose,grab:{...pose.grab,[target]:[0,0]}};
 assert.deepEqual(draw(h,left).positions,rig.deformMesh(meshes.left,withoutRight,character.binding,character.grabs['arm-screen-left']),'right local weights must not pull the left arm');
 assert.deepEqual(draw(h,h.meta.interaction.rightArm.cloth).positions,rig.deformMesh(meshes.cloth,withoutRight,character.binding,null),'fixed skirt follows the shared parent only');
}
const parentPose=pose=>{const copy={...pose};delete copy.grab;delete copy.cloth;return copy;};
// Match the runtime's seed and director's fixed step, not the pre-cancel reaction pose.
const baseAt=time=>{const e=require('../src/director.js').createDirector({idle:true,seed:17});for(let i=0;i<Math.round(time*120);i++)e.advance(1/120);return e.snapshot().pose;};
test('I2 renderer: real right palm down/threshold/drag/release uses the three authored meshes and same-frame picking',async t=>{
 const h=await createHarness({idle:false});t.after(()=>h.runtime.destroy());h.runtime.start();
 const config=h.meta.interaction.rightArm,contact=handContact(h),source=intake(h);
 console.log('I2_RIGHT_CONTACT '+JSON.stringify(contact));
 assert.equal(h.draws[0].texture,config.body,'both independent arms require the double-arm cleaned body, not the old left-only body');
 assertMeshes(h,source,h.runtime.status().motion.pose);
 assert.ok(draw(h,left));assert.ok(draw(h,config.cloth));
 assert.equal(h.draws.some(d=>[h.meta.front.body,h.meta.interaction.leftArm.body,'baijie-body.png'].includes(d.texture)),false,'no baked-arm fallback is drawn');
 assert.ok(contact.clothCovered<contact.handPixels,'the real fixed skirt leaves the neutral palm visible; no layer-order guess or tiny motion workaround');
 const localTextures=new Map([...config.parts.map(p=>[p.id,p.texture]),['fixed-skirt',config.cloth]]);
 assert.deepEqual(h.draws.filter(d=>[...localTextures.values()].includes(d.texture)).map(d=>d.texture),config.localLayerOrder.map(id=>localTextures.get(id)),'preserve the source order supported by the actual alpha');
 const p=h.css(contact.point),hit=h.renderer.hitPart(p.clientX,p.clientY);
 assert.equal(hit?.partId,target);assert.equal(hit.layer,contact.texture);assert.ok(Math.abs(hit.influence-1)<1e-6);
 assert.ok(Math.hypot(...hit.materialPoint.map((v,i)=>v-contact.point[i]))<0.0001);
 assert.equal(h.renderer.frameState().frameId,hit.frameId);assert.equal(h.renderer.frameState().viewportId,hit.viewportId);
 const others=otherMeshes(h);
 h.emit(h.canvas,'pointerdown',p);assert.equal(h.runtime.status().pointerKind,'grab-pending');
 h.emit(h.win,'pointermove',{...p,clientX:p.clientX+3});h.tick(3);
 assert.equal(h.runtime.status().pointerKind,'grab-pending');assertMeshes(h,source,{});
 h.emit(h.win,'pointermove',{...p,clientX:p.clientX+28,clientY:p.clientY+10});h.tick(60);
 const state=h.runtime.status(),delta=state.motion.pose.grab[target];
 assert.equal(state.pointerKind,'grab');assert.ok(Math.hypot(...delta)>15,'keep the existing visible grab envelope, not a micro-shift');
 assert.ok((delta[0]/character.grabs[target].limit[0])**2+(delta[1]/character.grabs[target].limit[1])**2<=1.000001);
 assertMeshes(h,source,state.motion.pose);
 assertOtherMeshes(h,others,state.motion.pose);
 let roots=0,rigidVertices=0;
 for(const part of source.parts){const actual=draw(h,config.parts.find(p=>p.id===part.id).texture).positions;
  for(let i=0;i<part.mesh.rest.length;i+=2){
   const w=part.mesh.weights.subarray(i/2*3,i/2*3+3),rest=[part.mesh.rest[i],part.mesh.rest[i+1]];
   if(w[0]===1){const parent=rig.deformPoint(rest,state.motion.pose,character.binding);roots++;assert.equal(actual[i],Math.fround(parent[0]));assert.equal(actual[i+1],Math.fround(parent[1]));}
   if(part.rigidJoint==='wrist'){const local=rig.unparentPoint([actual[i],actual[i+1]],rest,state.motion.pose,character.binding);rigidVertices++;assert.ok(Math.abs(local[0]-rest[0]-delta[0])<0.0001);assert.ok(Math.abs(local[1]-rest[1]-delta[1])<0.0001);}
  }
 }
 assert.ok(roots>0&&rigidVertices>0);
 const handMesh=source.parts.find(part=>part.id==='right-hand').mesh;
 const world=materialHit.pickMaterial({rest:draw(h,contact.texture).positions,indices:handMesh.indices},handMesh.rest,hit.materialPoint);assert.ok(world);
 const moved=h.css(world),movedHit=h.renderer.hitPart(moved.clientX,moved.clientY);
 assert.equal(movedHit?.partId,target,'picking must use this frame\'s deformed palm triangles');assert.equal(movedHit.layer,contact.texture);
 assert.ok(Math.hypot(...movedHit.materialPoint.map((v,i)=>v-contact.point[i]))<0.0001);
 assert.equal(movedHit.frameId,h.renderer.frameState().frameId);
 assert.equal(h.renderer.clientToMaterial(p.clientX,p.clientY,hit),null,'previous frame token is stale');
 assert.notEqual(h.renderer.hitPart(p.clientX,p.clientY)?.layer,contact.texture,'old palm location must not retain a stale hit');
 assert.equal(h.raf.size,1);assert.equal(h.calls.some(c=>c[0]==='drag'),false);
 h.emit(h.win,'pointerup',{...moved,buttons:0});
 assert.equal(h.runtime.status().activePointer,null);assert.equal(h.runtime.status().motion.pointerId,null);assert.equal(h.captured(),null);
 assert.deepEqual(h.runtime.status().motion.pose.grab[target],delta,'normal release must preserve a spring rebound rather than snap to zero');
 h.tick();assert.ok(Math.hypot(...h.runtime.status().motion.pose.grab[target])>1);
 h.tick(150);assert.ok(Math.hypot(...h.runtime.status().motion.pose.grab[target])<0.001);
 assertMeshes(h,source,h.runtime.status().motion.pose);assertOtherMeshes(h,others,h.runtime.status().motion.pose);
 assert.equal(h.runtime.status().motion.bubble,null);assert.equal(h.runtime.status().motion.completedGestures,0);assert.equal(h.raf.size,1);assert.deepEqual(h.errors,[]);
});

test('I2 cancel: pointercancel restores actual right geometry to seeded parent motion without resetting face or the one RAF',async t=>{
 const h=await createHarness({idle:true});t.after(()=>h.runtime.destroy());h.runtime.start();h.tick(60);h.action('face:3831');
 const source=intake(h),others=otherMeshes(h),contact=handContact(h),p=h.css(rig.deformPoint(contact.point,h.runtime.status().motion.pose,character.binding));
 assert.equal(h.renderer.hitPart(p.clientX,p.clientY)?.partId,target);
 h.emit(h.canvas,'pointerdown',p);h.emit(h.win,'pointermove',{...p,clientX:p.clientX+22});h.tick(12);
 const before=h.runtime.status(),frame=h.renderer.frameState().frameId;
 assert.equal(before.pointerKind,'grab');assert.ok(Math.hypot(...before.motion.pose.grab[target])>1);
 h.emit(h.win,'pointercancel',{pointerId:99});assert.equal(h.runtime.status().activePointer,7,'foreign cancellation cannot acquire ownership');
 h.emit(h.win,'pointercancel');const after=h.runtime.status();
 assert.equal(after.activePointer,null);assert.equal(after.motion.pointerId,null);assert.equal(after.motion.grab,null);assert.equal(h.captured(),null);
 assert.deepEqual(after.motion.pose.grab[target],[0,0]);assert.equal(after.motion.time,before.motion.time);assert.equal(after.renderedFace,'3831');
 const baseline=baseAt(after.motion.time);assert.deepEqual(parentPose(after.motion.pose),baseline,'cancel clears interaction response without resetting the seeded idle timeline');
 assert.ok(Object.values(after.motion.pose.cloth).flat().every(v=>v===0),'cancel also clears passive interaction cloth');
 assert.ok(h.renderer.frameState().frameId>frame,'cancel draws a synchronous restored frame');assertMeshes(h,source,after.motion.pose);
 assertOtherMeshes(h,others,baseline);
 const head=h.renderer.headInputPoint();assert.equal(h.renderer.hitPart(head.x,head.y)?.partId,'head');assert.ok(h.renderer.hitTest(head.x,head.y));
 const palm=h.css(rig.deformPoint(material(784,1814),after.motion.pose,character.binding));assert.equal(h.renderer.hitPart(palm.clientX,palm.clientY)?.partId,'arm-screen-left');
 h.emit(h.canvas,'pointerdown',palm);assert.equal(h.runtime.status().pointerKind,'grab-pending');h.emit(h.win,'pointercancel');
 h.tick(8);const settled=h.runtime.status();assert.deepEqual(settled.motion.pose.grab[target],[0,0]);
 assert.deepEqual(parentPose(settled.motion.pose),baseAt(settled.motion.time),'cancelled reaction velocity must not revive');assert.ok(Object.values(settled.motion.pose.cloth).flat().every(v=>v===0));
 assert.equal(h.raf.size,1);assert.deepEqual(h.errors,[]);
});

const materialHit=require('../src/hit-test.js');
function alphaUV(h,name,uv){
 if(!uv)return 0;const image=h.load(name),x=uv[0]*image.width-0.5,y=uv[1]*image.height-0.5,ix=Math.floor(x),iy=Math.floor(y),fx=x-ix,fy=y-iy;
 return alpha(image,ix,iy)*(1-fx)*(1-fy)+alpha(image,ix+1,iy)*fx*(1-fy)+alpha(image,ix,iy+1)*(1-fx)*fy+alpha(image,ix+1,iy+1)*fx*fy;
}
function alphaAt(h,m,point){return alphaUV(h,m.texture,materialHit.pickMaterial({rest:m.uv,indices:m.indices},m.positions,point));}
function triangleSample(m,accept){
 for(let i=0;i<m.indices.length;i+=3){const vertices=m.indices.subarray(i,i+3),point=[0,0],uv=[0,0];
  for(const v of vertices)for(let axis=0;axis<2;axis++){point[axis]+=m.positions[v*2+axis]/3;uv[axis]+=m.uv[v*2+axis]/3;}
  if(accept(point,uv))return point;
 }
 return null;
}
function pick(h,point){assert.ok(point,'a real-alpha triangle sample must exist');const p=h.css(point);return h.renderer.hitPart(p.clientX,p.clientY);}
test('I2 layers: real alpha and drawn triangles preserve shared arm/wrist hits, fixed cloth and moving front-hair occlusion',async t=>{
 const h=await createHarness({idle:false});t.after(()=>h.runtime.destroy());h.runtime.start();
 const config=h.meta.interaction.rightArm,names=Object.fromEntries(config.parts.map(p=>[p.id,p.texture]));
 for(const id of ['right-arm','right-wrist']){
  const m=draw(h,names[id]),point=triangleSample(m,(p,uv)=>alphaUV(h,m.texture,uv)>240&&pick(h,p)?.layer===m.texture&&pick(h,p)?.influence>0.05),hit=pick(h,point);
  assert.equal(hit.partId,target,id+' must share the same grab group');
 }
 const hand=draw(h,names['right-hand']),wrist=draw(h,names['right-wrist']);
 const hole=triangleSample(hand,(p,uv)=>alphaUV(h,hand.texture,uv)===0&&alphaAt(h,wrist,p)===0);
 assert.notEqual(pick(h,hole)?.partId,target,'transparent material inside the hand mesh must not create a rectangle hit');
 h.emit(h.canvas,'pointerdown',h.css(hole));assert.equal(h.runtime.status().activePointer,null);
 h.renderer.render({grab:{[target]:[-24,-6]}},'3942',false,0,false);
 const movedHand=draw(h,names['right-hand']),cloth=draw(h,config.cloth),movedWrist=draw(h,names['right-wrist']);
 const blocked=triangleSample(movedHand,(p,uv)=>alphaUV(h,movedHand.texture,uv)>240&&alphaAt(h,cloth,p)>240&&alphaAt(h,movedWrist,p)<=16),blockedHit=pick(h,blocked);
 assert.equal(blockedHit.layer,config.cloth);assert.equal(blockedHit.partId,null,'fixed cloth occludes through-grabs, never becomes a skirt target');
 const oldHair=h.draws.filter(d=>d.texture==='baijie-front-right.png').at(-1).positions;
 h.renderer.render({grab:{[target]:[6,0]},hair:{'front-right':[0.03,0.06,0.09]}},'3942',false,0,false);
 // The last draw for this texture is the main hair, after its shadow pass.
 const hair=h.draws.filter(d=>d.texture==='baijie-front-right.png').at(-1),arm=draw(h,names['right-arm']);
 assert.notDeepEqual(hair.positions,oldHair,'front hair must actually have moved');
 const covered=triangleSample(hair,(p,uv)=>alphaUV(h,hair.texture,uv)>240&&alphaAt(h,arm,p)>240),top=pick(h,covered);
 assert.equal(top.layer,hair.texture);assert.equal(top.partId,null,'current front-hair alpha wins over current right-arm geometry');
 h.emit(h.canvas,'pointerdown',h.css(covered));assert.equal(h.runtime.status().activePointer,null);
 assert.equal(h.meta.interaction.skirts.enabled,false);assert.equal(h.raf.size,1);assert.deepEqual(h.errors,[]);
});

test('I2 intake: explicit identity mapping and enabled resource failures cannot silently draw the old body',async t=>{
 const h=await createHarness({idle:false,mutateManifest:m=>m.interaction.rightArm.parts.reverse()});t.after(()=>h.runtime.destroy());h.runtime.start();
 assertMeshes(h,intake(h),{});assert.equal(h.draws[0].texture,h.meta.interaction.rightArm.body);
 const failures=[
  [{failMesh:h.meta.interaction.rightArm.mesh},/Failed to load right-arm mesh/],
  [{mutateMesh:m=>{if(m.kind==='right-hand-runtime-intake-v1')m.parts[0].buffers.weights[0]=NaN;}},/Invalid right-hand intake/],
  [{mutateMesh:m=>{if(m.kind==='right-hand-runtime-intake-v1')m.parts[0].texture.source='arm-screen-right/assets/different-source.png';}},/Invalid right-arm texture mapping/],
  [{mutateManifest:m=>{m.interaction.rightArm.parts[0].texture='missing-local-texture.png';}},/Invalid right-arm texture mapping/],
  [{failImage:h.meta.interaction.rightArm.parts.find(p=>p.id==='right-wrist').texture},/image decode failed/],
  [{badImage:h.meta.interaction.rightArm.body},/Unexpected texture size/],
  [{mutateManifest:m=>{m.interaction.leftArm.enabled=false;}},/Right-arm body requires left-arm layers/]
 ];
 for(const [options,error]of failures)await assert.rejects(createHarness({idle:false,...options}),error);
 const disabled=await createHarness({idle:false,mutateManifest:m=>{m.interaction.rightArm.enabled=false;}});t.after(()=>disabled.runtime.destroy());disabled.runtime.start();
 assert.equal(disabled.draws[0].texture,disabled.meta.interaction.leftArm.body,'explicitly disabled right layers retain the left-only path');
 assert.equal(disabled.draws.some(d=>disabled.meta.interaction.rightArm.parts.some(p=>p.texture===d.texture)),false);
 const p=disabled.css(material(784,1814));assert.equal(disabled.renderer.hitPart(p.clientX,p.clientY)?.partId,'arm-screen-left');
 assert.equal(h.raf.size,1);assert.equal(disabled.raf.size,1);
});
