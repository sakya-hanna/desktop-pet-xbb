'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const rig=require('../src/material-rig.js'),character=require('../src/character.js');
const close=(a,b)=>a.forEach((v,i)=>assert.ok(Math.abs(v-b[i])<1e-10,JSON.stringify({actual:a,expected:b})));
test('I4 material: passive skirt motion shares authored influence without leaking into hands or fixed lining',()=>{
 const rest=[265,530],weights=[0,0.2,0.8];
 for(const id of ['skirt-front','skirt-right']){
  const part=character.grabs[id],grab=[3,-2],cloth=[2,1],pose={grab:{[id]:grab},cloth:{[id]:cloth}},w=rig.grabInfluence(part,weights);
  // I5: passive inputs feed one continuous garment, rather than two cuts.
  close(rig.localPoint(rest,pose,part,weights),rest.map((v,i)=>v+(grab[i]+cloth[i]*0.5)*w));
  close(rig.localPoint(rest,pose,part,[1,0,0]),rest);
  close(rig.localPoint(rest,pose,null,weights),rest);
 }
 const id='arm-screen-left',part=character.grabs[id],pose={grab:{[id]:[3,-2]},cloth:{[id]:[2,1]}};
 close(rig.localPoint(rest,pose,part,weights),rest.map((v,i)=>v+pose.grab[id][i]*rig.grabInfluence(part,weights)));
});
test('I4 material: combined local pull and secondary cloth cannot enlarge the existing skirt envelope',()=>{
 const rest=[265,530];
 for(const id of ['skirt-front','skirt-right']){
  const part=character.grabs[id];
  for(const grab of [[part.limit[0],0],[0,-part.limit[1]],[part.limit[0]*0.7,part.limit[1]*0.7]])for(const cloth of [[2,1],[-2,-1]]){
   const pose={grab:{[id]:grab},cloth:{[id]:cloth}},before=JSON.stringify(pose),actual=rig.localPoint(rest,pose,part,[0,0,1]).map((v,i)=>v-rest[i]);
   assert.ok(Math.hypot(...actual.map((v,i)=>v/part.limit[i]))<=1+1e-10,'combined local skirt envelope was enlarged');
   assert.equal(JSON.stringify(pose),before,'drawing cannot mutate shared pose');
  }
 }
});
