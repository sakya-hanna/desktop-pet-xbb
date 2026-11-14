'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const rig=require('../src/material-rig.js'),{binding,grabs}=require('../src/character.js');
const delta=(p,pose)=>rig.deformPoint(p,pose,binding).map((x,i)=>x-p[i]);
const near=(a,b,t=1e-7)=>a.forEach((v,i)=>assert.ok(Math.abs(v-b[i])<t,JSON.stringify({a,b,t})));
test('I20 head orientation has material-space depth, not only uniform head translation',()=>{
 // The face-plane revision widens the transition beyond the painted features.
 // Sample its actual outer rim rather than the superseded dome radius.
 const center=binding.headTurn.center,rim=[center[0]+binding.headTurn.radius[0],center[1]],p={lookX:0.7,lookY:-0.4};
 const c=delta(center,p),r=delta(rim,p);
 assert.ok(c[0]-r[0]>4,'face centre must move relative to head outline');
 assert.ok(c[1]<r[1]-1,'pitch depth must reach the face');
 near(delta([295,220],p),[0,0]);near(delta([270,798],p),[0,0]);
});
test('I20 breath raises supported head/shoulders and expands the torso without widening the face or moving feet',()=>{
 const p={breath:1},a=[230,200],b=[360,200],aa=rig.deformPoint(a,p,binding),bb=rig.deformPoint(b,p,binding);
 assert.ok(aa[1]<a[1]-2);assert.ok(bb[0]-aa[0]>b[0]-a[0]+1,'chest expands, not just a bodyY bob');
 near(delta([298,90],p).slice(0,1),[0]);near(delta([270,798],p),[0,0]);
});
test('I20 locked material inverse includes breathing scale and head orientation with local grabs',()=>{
 const pose={lookX:-0.72,lookY:0.4,breath:0.8,headRoll:0.04,bodyRoll:0.02,bodyX:0.002,bodyY:-0.001,grab:{'arm-screen-left':[12,-8]}};
 for(const rest of [[210,160],[220,205],[190,315],[298,95]]){
  const w=[0,0,1],part=grabs['arm-screen-left'];
  const moved=rig.deformPoint(rest,pose,binding,part,w);
  near(rig.unparentPoint(moved,rest,pose,binding),rig.localPoint(rest,pose,part,w));
 }
});
