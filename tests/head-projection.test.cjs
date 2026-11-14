'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const rig=require('../src/material-rig.js'),{binding,materials}=require('../src/character.js');
const distance=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
const moved=(p,pose)=>rig.deformPoint(p,pose,binding);
// Regress the rejected projection, not an invented requirement to narrow the
// whole face. In the upstream parallax field, opposite gaze reverses the offset.
test('head gaze has signed depth parallax, not an equally compressed feature plane or shared torso translation',()=>{
 const nose=[298,116],rim=[298,8];
 for(const pt of [[258,97],[338,97],nose,rim,[298,142]]){
  const left=moved(pt,{referenceMotion:true,lookX:-1.2}),right=moved(pt,{referenceMotion:true,lookX:1.2});
  assert.ok(Math.hypot(left[0]+right[0]-2*pt[0],left[1]+right[1]-2*pt[1])<1e-8,'even-in-yaw flattening returned at '+pt);
 }
 for(const lookX of [-1.2,1.2]){
  const pose={referenceMotion:true,lookX};
  const noseDx=moved(nose,pose)[0]-nose[0],rimDx=moved(rim,pose)[0]-rim[0];
  assert.ok(Math.sign(lookX)*rimDx>0,'crown must participate, without an arbitrary face/crown gain ratio');
  assert.ok(Math.sign(lookX)*(noseDx-rimDx)>.2,'retain front/back depth without making the face slide alone');
  // Core torso points have zero head ownership; the side-hair feather at
  // x=260 is intentionally nonzero and is bounded by i25-neck, not frozen here.
  for(const pt of [[280,180],[316,180],[295,220],[265,798]])assert.deepEqual(rig.deformPoint(pt,pose,binding,materials.torso),pt,'body follows its own spring, not an immediate gaze copy');
 }
});

test('neutral pose and accepted hand/skirt and flexible-hair mechanics are preserved for unchanged parent input',()=>{
 const previous=require('../verification/final-head-rebuild/before-source/src/character.js');
 const oldRig=require('../verification/final-head-rebuild/before-source/src/material-rig.js');
 const current=require('../src/character.js');
 const expectedParts=structuredClone(previous.parts);
 for(const id of ['fringe','front-left'])expectedParts[id].material='head';
 assert.deepEqual(current.parts,expectedParts,'only the declared head attachment identity may change');
 for(const key of ['grabs','coupling','headMotion'])assert.deepEqual(current[key],previous[key],key+' was not authorized for retuning');
 const input={referenceMotion:true,lookX:0,lookY:0,headRoll:.08,headY:.005,bodyRoll:-.02,breath:.6,squash:.01,grab:{'arm-screen-left':[15,-9],'arm-screen-right':[-11,8],'skirt-front':[12,6]},cloth:{'skirt-front':[1,.2],'skirt-right':[.8,.1]}};
 for(const part of Object.values(current.grabs)){
  const points=part?[[260,180],[210,260],[300,400],[350,480]]:[[298,97],[298,151],[260,180],[265,798]];
  for(const p of points){assert.deepEqual(rig.deformPoint(p,{},binding,part,[0,.4,.6]),p,'rest image geometry');assert.deepEqual(rig.localPoint(p,input,part,[0,.4,.6]),oldRig.localPoint(p,input,part,[0,.4,.6]));}
 }
 for(const part of Object.values(current.parts).filter(p=>p.flexible)){
  const a=rig.createFlexibleHair(part,previous.binding),b=oldRig.createFlexibleHair(part,previous.binding);
  for(let i=0;i<180;i++){const p={...input,headRoll:.08*Math.sin(i/40),headY:.005*Math.sin(i/20)};a.step(1/120,p);b.step(1/120,p);assert.deepEqual(a.snapshot(),b.snapshot(),part.name+' flexible integration');}
 }
});
