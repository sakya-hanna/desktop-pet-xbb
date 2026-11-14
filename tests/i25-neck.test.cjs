'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const rig=require('../src/material-rig.js'),ch=require('../src/character.js'),{createDirector}=require('../src/director.js'),{catalog}=require('../src/reference-motion.js');
const dist=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
test('I25 head turn and tilt do not rotate clavicles or the crossed chest straps',()=>{
 for(const side of [-1,1]){
  const pose={referenceMotion:true,lookX:side*1.2,lookY:.25,headRoll:side*.13,headX:side*.001,headY:.006,bodyRoll:.018,bodyX:.002};
  // Only the existing nod support belongs to the common body. Gaze must use
  // the reference's independent body springs, never an instantaneous copy.
  const parent={...pose,lookX:0,lookY:0,headRoll:0,headX:0,headY:0,
   bodyY:(pose.bodyY||0)+pose.headY*(ch.binding.neckTransition?.verticalSupport||0)};
  for(const p of [[260,158],[332,158],[280,164],[298,165],[320,164],[265,175],[330,175]]){
   const movement=dist(rig.deformPoint(p,pose,ch.binding,ch.materials.torso),rig.deformPoint(p,parent,ch.binding,ch.materials.torso));
   assert.ok(movement<.12,`independent head deformation leaked to chest ${p}: ${movement} material pixels`);
  }
  const stationary={...pose,lookX:0,lookY:0,headRoll:0,headX:0,headY:0};
  assert.ok(dist(rig.deformPoint([298,97],pose,ch.binding),rig.deformPoint([298,97],stationary,ch.binding))>5,'head total travel must remain visibly active');
 }
});
test('I25 head vertical travel is preserved while the upper torso supports the neck',()=>{
 const pose={referenceMotion:true,headY:.006};
 const face=rig.deformPoint([298,100],pose,ch.binding);assert.ok(Math.abs(face[1]-100-4.8)<1e-8,'do not hide the defect by shrinking head travel');
 for(const pt of [[260,185],[298,165],[330,185]]){const q=rig.deformPoint(pt,pose,ch.binding,ch.materials.torso);assert.ok(q[1]-pt[1]>2.4,'torso must carry most of the translation, not compress it into the neck');assert.ok(Math.abs(q[0]-pt[0])<1e-8);}
 // Dome depth gives the chin and neck different vertical displacement.
 // Keep their anatomical order; do not flatten them into a common plane.
 const up={referenceMotion:true,lookY:1},chin=rig.deformPoint([298,142],up,ch.binding),neck=rig.deformPoint([298,150],up,ch.binding,ch.materials.neck),collar=rig.deformPoint([298,166],up,ch.binding,ch.materials.torso);
 assert.ok(neck[1]>chin[1]&&neck[1]<collar[1],'neck remains between the moving jaw and collar');
 assert.ok(neck[1]>150,'pitch response must not be disabled');
});
// Actual topology, four affected actions, roots and inverse: layered-head-geometry.test.cjs.
