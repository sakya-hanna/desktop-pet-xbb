'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const rig=require('../src/material-rig.js'),{binding,parts}=require('../src/character.js');
const {createDirector}=require('../src/director.js'),{catalog}=require('../src/reference-motion.js');
const {load}=require('./helpers/interaction-fixtures.cjs');
const area=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
// Actual new renderer topology and four relevant actions: layered-head-geometry.test.cjs.
test('material cached mesh and uncached points share one field including local-offset inverse',()=>{
 const mesh=rig.makeMesh({x:210,y:0,w:180,h:210},5);
 for(const pose of [{},{referenceMotion:true,lookX:1.2,lookY:-.9,headRoll:.13,bodyRoll:-.02,breath:.7},{referenceMotion:true,lookX:-1.2,lookY:.9,headY:.006,squash:.02}]){
  const out=rig.deformMesh(mesh,pose,binding,null);
  for(let i=0;i<out.length;i+=2){const rest=[mesh.rest[i],mesh.rest[i+1]],p=rig.deformPoint(rest,pose,binding);assert.ok(Math.hypot(out[i]-p[0],out[i+1]-p[1])<.0001);}
  const grab={name:'arm-screen-left',elbowRatio:.45},p={...pose,grab:{'arm-screen-left':[7,-4]}};
  for(const rest of [[298,97],[298,151],[260,158],[265,260]]){
   const projected=rig.deformPoint(rest,p,binding,grab,[0,0,1]),local=rig.unparentPoint(projected,rest,p,binding,grab);
   assert.ok(Math.hypot(local[0]-rest[0]-7,local[1]-rest[1]+4)<1e-7,'affine inverse at '+rest);
  }
 }
});
