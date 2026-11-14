'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {createHarness}=require('./helpers/interaction-fixtures.cjs');
const rig=require('../src/material-rig.js'),{binding}=require('../src/character.js');
test('authored turn separates facial midline from eye frame without transferring it into the neck',()=>{
 for(const lookX of [-1.2,1.2]){
  const pose={referenceMotion:true,lookX},d=p=>rig.deformPoint(p,pose,binding).map((v,i)=>v-p[i]);
  const le=d([271.5,96.5]),re=d([325.5,97]),nose=d([298,116]);
  assert.ok(Math.sign(lookX)*(nose[0]-(le[0]+re[0])/2)>3,'the nose/eye-frame turn must not collapse back to common translation');
  const neck=rig.deformPoint([298,150],pose,binding,{material:'neck'});
  assert.ok(Math.abs(neck[0]-298)<3.1,'face-depth parallax must not slide the neck');
 }
});
test('fringe shadow receives the actual deformed head mesh, not the old frozen-rest parent',async()=>{
 const h=await createHarness({idle:false}),pick=require('../src/hit-test.js').pickMaterial;
 h.renderer.render({referenceMotion:true,lookX:1.2,headRoll:.08,bodyRoll:-.02,hair:{fringe:[.04,.06,.08]}},'3942',false,0,false);
 const head=h.draws.find(d=>d.texture===h.meta.head.skin),spec=h.meta.front.parts.find(p=>p.name==='fringe'),shadow=h.draws.find(d=>d.texture===spec.caster&&d.uniforms.u_shadow===1);
 let sampled=0;
 for(let i=0;i<shadow.positions.length;i+=62){
  const world=Array.from(shadow.positions.slice(i,i+2)),expected=pick({rest:head.rest,indices:head.indices},head.positions,world);
  if(!expected)continue;sampled++;
  assert.ok(Math.hypot(shadow.rest[i]-expected[0],shadow.rest[i+1]-expected[1])<1e-3,'receiver does not map to this frame head surface');
 }
 assert.ok(sampled>20);h.runtime.destroy();
});
test('front hair and its caster reuse identical geometry without moving the visible hair buffer',async()=>{
 const h=await createHarness({idle:false}),before=rig.deformMesh,calls=new Map();
 rig.deformMesh=(mesh,pose,binding,part)=>{if(['fringe','front-left','front-right'].includes(part?.name))calls.set(part.name,(calls.get(part.name)||0)+1);return before(mesh,pose,binding,part);};
 try{h.renderer.render({referenceMotion:true,lookX:1.2,hair:{fringe:[.02,.04,.07]}},'3942',false,0,false);
  for(const name of ['fringe','front-left','front-right'])assert.equal(calls.get(name),1,'duplicate deformation of identical main/caster mesh: '+name);
 }finally{rig.deformMesh=before;h.runtime.destroy();}
});
test('head-only gaze does not pull alpha-supported arm vertices',async()=>{
 const h=await createHarness({idle:false});h.renderer.render({},'3942',false,0,false);const base=h.draws.slice();
 h.renderer.render({referenceMotion:true,lookX:1.2},'3942',false,0,false);
 for(const name of ['baijie-arm-screen-left.png','baijie-arm-screen-right.png']){
  const a=base.find(d=>d.texture===name),b=h.draws.find(d=>d.texture===name);assert.ok(a&&b);
  for(let i=0;i<a.positions.length;i++)assert.ok(Math.abs(a.positions[i]-b.positions[i])<1e-5,name+' is consuming head-local gaze at vertex '+(i>>1));
 }h.runtime.destroy();
});
test('runtime draws real separated head materials on the same head master geometry as expressions',async()=>{
 const h=await createHarness({idle:false});assert.ok(h.meta.head?.enabled,'head materials not registered');
 h.renderer.render({referenceMotion:true,lookX:1.2},'3942',false,0,false);
 const face=h.draws.find(d=>d.texture==='baijie-face-3942.png');
 for(const id of ['skin']){
  const head=h.draws.find(d=>d.texture===h.meta.head[id]);assert.ok(head,'missing drawn '+id);
  assert.equal(head.bound[4],h.meta.head.cover,'head skin/cover must sum in one pass, not alpha-over their complementary filtered edges');
  assert.equal(head.uniforms.u_headPair,1);
  assert.ok(!h.draws.some(d=>d.texture===h.meta.head.cover),'cover must not be drawn a second time');
  assert.deepEqual(head.positions,face.positions,'expression and '+id+' do not share actual submitted geometry');
  assert.deepEqual(head.indices,face.indices);
 }
 h.renderer.render({referenceMotion:true,lookX:-1.2},'3942',false,.6,false,[{face:'3942',weight:1}]);
 const mixed=h.draws.find(d=>d.texture==='expression-face'),skin=h.draws.find(d=>d.texture===h.meta.head.skin);
 assert.deepEqual(mixed.positions,skin.positions,'blink/mixed face must also use the master');h.runtime.destroy();
});
