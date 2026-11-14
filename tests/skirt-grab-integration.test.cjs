'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {createHarness,root}=require('./helpers/interaction-fixtures.cjs'),character=require('../src/character.js'),rig=require('../src/material-rig.js'),hitMath=require('../src/hit-test.js');
const rendered=(h,name)=>h.draws.find(d=>d.texture===name);
function contact(h,entry){
 const image=h.load(entry.texture),[x0,y0,x1,y1]=h.meta.images[entry.texture].alpha_bbox,aim=[(x0+x1)/2,y1-80];let best=null,distance=Infinity;
 const alpha=(x,y)=>x<0||y<0||x>=image.width||y>=image.height?0:image.data[(y*image.width+x)*4+3];
 for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++){if(alpha(x,y)<245)continue;const d=(x-aim[0])**2+(y-aim[1])**2;if(d>=distance||![-4,0,4].every(dy=>[-4,0,4].every(dx=>alpha(x+dx,y+dy)>240)))continue;distance=d;best=[x+0.5,y+0.5];}
 assert.ok(best,'opaque skirt contact must exist');return best.map((v,i)=>v*character.binding[i?'height':'width']/[image.width,image.height][i]);
}
function parsed(entry){return rig.importSkirtMesh(JSON.parse(fs.readFileSync(path.join(root,'assets',entry.mesh))),character.binding,character.grabs);}
function worldPoint(mesh,positions,point){const world=hitMath.pickMaterial({rest:positions,indices:mesh.indices},mesh.rest,point);assert.ok(world,'contact must map through the current authored triangles');return world;}
const parentPose=pose=>{const copy={...pose};delete copy.grab;delete copy.cloth;return copy;};
const baseAt=time=>{const e=require('../src/director.js').createDirector({idle:true,seed:17});for(let i=0;i<Math.round(time*120);i++)e.advance(1/120);return e.snapshot().pose;};
test('I3 renderer/runtime: both real skirts use authored meshes, connected cloth, same-frame hits and release rebound',async t=>{
 const h=await createHarness({idle:false});t.after(()=>h.runtime.destroy());h.runtime.start();const config=h.meta.interaction.skirts;
 const control=await createHarness({idle:false});t.after(()=>control.runtime.destroy());
 assert.equal(h.draws[0].texture,config.body,'renderer must use the body without baked skirts');
 const meshes=new Map();for(const entry of config.parts){const mesh=parsed(entry);meshes.set(entry.id,mesh);const actual=rendered(h,entry.texture);assert.ok(actual,'actual skirt draw required');assert.deepEqual(actual.indices,mesh.mesh.indices);assert.deepEqual(actual.uv,mesh.mesh.uv);}
 assert.equal(h.draws.some(d=>[h.meta.interaction.rightArm.body,h.meta.interaction.leftArm.body,h.meta.interaction.leftArm.cloth,h.meta.interaction.rightArm.cloth].includes(d.texture)),false,'old baked skirt copies must not be drawn');
 const lining=config.parts.find(p=>!p.grab),bodyMesh={rest:new Float32Array(rendered(h,config.body).rest)};
 for(const entry of config.parts.filter(p=>p.grab)){
  const mesh=meshes.get(entry.id).mesh,material=contact(h,entry),p=h.css(worldPoint(mesh,rendered(h,entry.texture).positions,material)),hit=h.renderer.hitPart(p.clientX,p.clientY);assert.equal(hit?.partId,entry.id);assert.equal(hit.layer,entry.texture);assert.ok(hit.influence>0.05);
  console.log('I3_CONTACT '+JSON.stringify({id:entry.id,material,influence:hit.influence}));

  h.emit(h.canvas,'pointerdown',p);assert.equal(h.runtime.status().pointerKind,'grab-pending');h.emit(h.win,'pointermove',{...p,clientX:p.clientX+3});h.tick(2);assert.equal(h.runtime.status().pointerKind,'grab-pending');
  h.emit(h.win,'pointermove',{...p,clientX:p.clientX+(entry.id==='skirt-front'?-24:24),clientY:p.clientY+10});h.tick(35);
  const state=h.runtime.status(),delta=state.motion.pose.grab[entry.id],part=character.grabs[entry.id],actual=rendered(h,entry.texture);
  assert.equal(state.pointerKind,'grab');assert.ok(Math.hypot(...delta)>8,'candidate pull must be visible rather than historical source micro-shifts');assert.ok((delta[0]/part.limit[0])**2+(delta[1]/part.limit[1])**2<=1.000001);
  assert.deepEqual(actual.positions,rig.deformMesh(mesh,state.motion.pose,character.binding,part));
  let roots=0;for(let i=0;i<mesh.rest.length;i+=2)if(mesh.weights[i/2*3]===1){const parent=rig.deformPoint([mesh.rest[i],mesh.rest[i+1]],state.motion.pose,character.binding);roots++;assert.equal(actual.positions[i],Math.fround(parent[0]));assert.equal(actual.positions[i+1],Math.fround(parent[1]));}assert.ok(roots>0);
  // Removing the active input affects BOTH connected skirt panels, not unrelated
  // materials. Parent/hair pose and other release recoil remain identical.
  const withoutActive={...state.motion.pose,grab:{...state.motion.pose.grab,[entry.id]:[0,0]}};
  control.renderer.render(withoutActive,state.renderedFace,false,state.motion.blink);
  assert.equal(h.draws.length,control.draws.length);
  const garmentTextures=config.parts.filter(p=>p.grab).map(p=>p.texture);
  for(let n=0;n<h.draws.length;n++){assert.equal(h.draws[n].texture,control.draws[n].texture);if(!garmentTextures.includes(h.draws[n].texture))assert.deepEqual(h.draws[n].positions,control.draws[n].positions,'unrelated material receives no '+entry.id+' local displacement: '+h.draws[n].texture);else assert.notDeepEqual(h.draws[n].positions,control.draws[n].positions,'both joined cloth panels must respond: '+h.draws[n].texture);}
  for(const other of config.parts.filter(p=>p.id!==entry.id))assert.deepEqual(rendered(h,other.texture).positions,rig.deformMesh(meshes.get(other.id).mesh,state.motion.pose,character.binding,other.grab?character.grabs[other.id]:null),'connected garment uses common drive and authored weights; lining stays fixed: '+other.id);
  assert.deepEqual(rendered(h,config.body).positions,rig.deformMesh(bodyMesh,state.motion.pose,character.binding,null));
  assert.deepEqual(rendered(h,lining.texture).positions,rig.deformMesh(meshes.get(lining.id).mesh,state.motion.pose,character.binding,null),'fixed lining follows the body, never local grab or passive cloth');
  const moved=h.css(worldPoint(mesh,actual.positions,hit.materialPoint)),picked=h.renderer.hitPart(moved.clientX,moved.clientY);assert.equal(picked?.partId,entry.id);assert.equal(picked.layer,entry.texture);assert.equal(picked.frameId,h.renderer.frameState().frameId);
  assert.equal(h.renderer.clientToMaterial(p.clientX,p.clientY,hit),null);assert.equal(h.raf.size,1);
  h.emit(h.win,'pointerup',{...moved,buttons:0});assert.equal(h.runtime.status().activePointer,null);assert.equal(h.captured(),null);assert.deepEqual(h.runtime.status().motion.pose.grab[entry.id],delta,'normal release preserves rebound');
  h.tick(160);assert.ok(Math.hypot(...h.runtime.status().motion.pose.grab[entry.id])<0.001);assert.equal(h.raf.size,1);
 }
 const center=contact(h,lining),centerPoint=h.css(worldPoint(meshes.get(lining.id).mesh,rendered(h,lining.texture).positions,center)),centerHit=h.renderer.hitPart(centerPoint.clientX,centerPoint.clientY);assert.equal(centerHit?.layer,lining.texture);assert.equal(centerHit.partId,null,'fixed inner lining is not an interactive skirt');
 const pose=h.runtime.status().motion.pose,left=h.css(rig.deformPoint([784*530/2612,1814*800/3941],pose,character.binding));assert.equal(h.renderer.hitPart(left.clientX,left.clientY)?.partId,'arm-screen-left');
 const right=h.css(rig.deformPoint([1828.5*530/2612,1579.5*800/3941],pose,character.binding));assert.equal(h.renderer.hitPart(right.clientX,right.clientY)?.partId,'arm-screen-right');
 assert.equal(h.runtime.status().motion.bubble,null,'bubble feedback is the next feature, not changed here');assert.equal(h.calls.some(c=>c[0]==='drag'),false);assert.deepEqual(h.errors,[]);assert.deepEqual(control.errors,[]);
});
test('I3 cancellation: invalid release and focus loss restore skirt geometry while preserving parent motion and chosen face',async()=>{
 for(const [id,kind]of [['skirt-front','invalid-up'],['skirt-right','blur'],['skirt-front','rebound-blur']]){
  const h=await createHarness({idle:true});try{h.runtime.start();h.tick(20);h.action('face:3831');
   const entry=h.meta.interaction.skirts.parts.find(p=>p.id===id),m=parsed(entry),at=contact(h,entry),p=h.css(rig.deformPoint(at,h.runtime.status().motion.pose,character.binding));
   assert.equal(h.renderer.hitPart(p.clientX,p.clientY)?.partId,id);h.emit(h.canvas,'pointerdown',p);h.emit(h.win,'pointermove',{...p,clientX:p.clientX+20});h.tick(12);
   assert.ok(Math.hypot(...h.runtime.status().motion.pose.grab[id])>1);h.emit(h.win,'pointercancel',{pointerId:99});assert.equal(h.runtime.status().activePointer,7);
   if(kind==='rebound-blur'){h.emit(h.win,'pointerup',{...p,buttons:0});h.tick(3);assert.ok(Math.hypot(...h.runtime.status().motion.pose.grab[id])>1);}
   const before=h.runtime.status(),frame=h.renderer.frameState().frameId;
   if(kind==='invalid-up')h.emit(h.win,'pointerup',{clientX:NaN,buttons:0});else h.emit(h.win,'blur');
   const after=h.runtime.status();
   assert.equal(after.activePointer,null);assert.equal(after.motion.pointerId,null);assert.equal(h.captured(),null);assert.deepEqual(after.motion.pose.grab[id],[0,0]);
   assert.equal(after.motion.time,before.motion.time);assert.equal(after.renderedFace,'3831');assert.deepEqual(parentPose(after.motion.pose),baseAt(after.motion.time),'cancel restores the same seeded idle timeline, not the interaction reaction');
   assert.ok(Object.values(after.motion.pose.cloth).flat().every(v=>v===0),'cancel clears passive interaction cloth');
   assert.ok(h.renderer.frameState().frameId>frame);assert.deepEqual(rendered(h,entry.texture).positions,rig.deformMesh(m.mesh,after.motion.pose,character.binding,character.grabs[id]));
   h.tick(8);const settled=h.runtime.status();assert.deepEqual(settled.motion.pose.grab[id],[0,0]);
   assert.deepEqual(parentPose(settled.motion.pose),baseAt(settled.motion.time),'cancelled reaction velocity must not revive');assert.ok(Object.values(settled.motion.pose.cloth).flat().every(v=>v===0));
   assert.equal(h.raf.size,1);assert.deepEqual(h.errors,[]);
  }finally{h.runtime.destroy();}
 }
});
test('I3 loading: invalid enabled skirt resources fail closed and explicit disable preserves the hand-only scene',async t=>{
 for(const [options,error]of [
  [{failMesh:'baijie-skirt-front.mesh.json'},/Failed to load skirt mesh/],
  [{mutateManifest:m=>{m.interaction.skirts.parts[0].source='skirt-kit/assembly-v2/layers/wrong.png';}},/Invalid skirt texture mapping/],
  [{mutateManifest:m=>{m.interaction.skirts.parts.find(p=>!p.grab).grab=true;}},/Invalid skirt target mapping/],
  [{mutateManifest:m=>{m.interaction.skirts.layerOrder=['skirt-front','skirt-front','skirt-right'];}},/Invalid skirt layer mapping/]
 ])await assert.rejects(createHarness({idle:false,...options}),error);
 const h=await createHarness({idle:false,mutateManifest:m=>{m.interaction.skirts.enabled=false;}});t.after(()=>h.runtime.destroy());h.runtime.start();
 assert.equal(h.draws[0].texture,h.meta.interaction.rightArm.body);assert.equal(h.draws.some(d=>h.meta.interaction.skirts.parts.some(p=>p.texture===d.texture)),false);
 const p=h.css([784*530/2612,1814*800/3941]);assert.equal(h.renderer.hitPart(p.clientX,p.clientY)?.partId,'arm-screen-left');assert.equal(h.raf.size,1);
});
