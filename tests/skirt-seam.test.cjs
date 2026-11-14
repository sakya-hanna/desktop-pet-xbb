'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const rig=require('../src/material-rig.js'),ch=require('../src/character.js'),hit=require('../src/hit-test.js');
const ids=['skirt-front','skirt-right'];
const meshes=ids.map(id=>rig.importSkirtMesh(JSON.parse(fs.readFileSync(path.join(__dirname,'../assets/baijie-'+id+'.mesh.json'))),ch.binding,ch.grabs).mesh);
// Actual adjacent opaque front/right edges, measured from current PNG alpha.
const seam=[[347,310.5],[349,320.5],[343,330.5],[334,340.5],[322,350.5],[313,360.5],[307,370.5],[305,380.5],[322,390.5],[340,400.5],[335,410.5]];
const map=(m,positions,p)=>hit.pickMaterial({rest:positions,indices:m.indices},m.rest,p);
test('I5 seam: actual front and right triangles keep the same cloth join under either grab and passive recoil',()=>{
 let maxSeparation=0;
 for(const id of ids)for(const delta of [[-18,0],[18,0],[0,-14],[0,14],[12,-8]]){
  const pose={bodyRoll:-0.027,bodyX:0.001,grab:{[id]:delta},cloth:{'skirt-front':[2.1,-0.8],'skirt-right':[-1.2,0.6]}};
  const out=meshes.map((m,i)=>rig.deformMesh(m,pose,ch.binding,ch.grabs[ids[i]]));
  for(const p of seam){const q=meshes.map((m,i)=>map(m,out[i],p));assert.ok(q.every(Boolean));const gap=Math.hypot(q[0][0]-q[1][0],q[0][1]-q[1][1]);maxSeparation=Math.max(maxSeparation,gap);assert.ok(gap<0.035,JSON.stringify({id,delta,point:p,gap,reason:'continuous cloth edge must not tear apart'}));}
 }
 console.log('I5_MAX_SEAM_MATERIAL_PIXELS '+maxSeparation);
});
test('I5 seam: alternating released springs share one bounded garment without moving roots, hands or lining',()=>{
 const director=require('../src/director.js').createDirector({idle:false,seed:17});
 let maxGap=0,releaseMotion=0;
 for(const [turn,id]of ids.entries()){
  assert.equal(director.send({type:'grab-down',pointerId:7,partId:id}),true);
  assert.equal(director.send({type:'grab-move',pointerId:7,partId:id,x:turn?18:-18,y:turn?-8:8}),true);
  for(let frame=0;frame<42;frame++){
   if(frame===26){const before=director.snapshot().pose;director.send({type:'grab-up',pointerId:7,partId:id});assert.deepEqual(director.snapshot().pose,before,'release must not snap the connected garment');}
   director.advance(1/60);const pose=director.snapshot().pose;
   const out=meshes.map((m,i)=>rig.deformMesh(m,pose,ch.binding,ch.grabs[ids[i]]));
   for(const p of seam){const q=meshes.map((m,i)=>map(m,out[i],p));maxGap=Math.max(maxGap,Math.hypot(q[0][0]-q[1][0],q[0][1]-q[1][1]));}
   for(let i=0;i<ids.length;i++){
    const part=ch.grabs[ids[i]],offset=rig.grabOffset(pose,part);
    assert.ok(Math.hypot(...offset.map((v,j)=>v/part.limit[j]))<=1+1e-10);
    assert.deepEqual(rig.localPoint([330,300],pose,part,[1,0,0]),[330,300]);
   }
   assert.deepEqual(rig.localPoint([330,400],pose,null,[0,0,1]),[330,400]);
   assert.deepEqual(rig.localPoint([180,350],pose,ch.grabs['arm-screen-left'],[0,0,1]),[180,350]);
   if(frame===28)releaseMotion=Math.max(releaseMotion,Math.hypot(...rig.grabOffset(pose,ch.grabs[id])));
  }
 }
 assert.ok(maxGap<0.035,JSON.stringify({maxGap}));assert.ok(releaseMotion>1,'normal release still moves');
 director.cancelGrab();const pose=director.snapshot().pose;for(const id of ids)assert.deepEqual(rig.grabOffset(pose,ch.grabs[id]),[0,0]);
 console.log('I5_RELEASE_SEAM_MAX '+maxGap);
});
test('I5 seam: simultaneous recoil and flutter cannot enlarge either panel envelope or mutate pose',()=>{
 const pose={grab:{'skirt-front':[18,14],'skirt-right':[18,14]},cloth:{'skirt-front':[2.5,1.2],'skirt-right':[2.5,1.2]}},before=JSON.stringify(pose);
 const offsets=ids.map(id=>rig.grabOffset(pose,ch.grabs[id]));assert.deepEqual(offsets[0],offsets[1]);
 for(let i=0;i<ids.length;i++)assert.ok(Math.hypot(...offsets[i].map((v,j)=>v/ch.grabs[ids[i]].limit[j]))<=1+1e-10);
 assert.equal(JSON.stringify(pose),before);
});
