'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const rig=require('../src/material-rig.js'),{binding}=require('../src/character.js');
const features=[[258,81],[286,81],[258,109],[286,109],[309,82],[337,82],[309,112],[337,112],[294,118],[304,118]];
test('I21 both eye outlines, pupils and mouth share a coherent face plane during left/right and up/down orientation',()=>{
 for(const lookX of [-0.95,0,0.95])for(const lookY of [-0.4,0,0.4]){
  const pose={lookX,lookY,headRoll:0.04,bodyRoll:-0.012,bodyX:0.001,breath:0.7};
  const zero={...pose,lookX:0,lookY:0};
  const offsets=features.map(p=>{const a=rig.deformPoint(p,pose,binding),b=rig.deformPoint(p,zero,binding);return a.map((v,i)=>v-b[i]);});
  for(const a of offsets)assert.ok(Math.hypot(a[0]-offsets[0][0],a[1]-offsets[0][1])<1e-7,'eyes must not shear or scale differently: '+JSON.stringify({lookX,lookY,offsets}));
 }
});
test('I21 face-plane transition retains head depth without folding the surrounding head mesh',()=>{
 const m=rig.makeMesh({x:210,y:25,w:175,h:155},2);
 for(const lookX of [-0.95,0.95])for(const lookY of [-0.4,0.4]){
  const p=rig.deformMesh(m,{lookX,lookY,headRoll:0.04,bodyRoll:-0.012,breath:0.7},binding);
  const area=(v,a,b,c)=>(v[b]-v[a])*(v[c+1]-v[a+1])-(v[b+1]-v[a+1])*(v[c]-v[a]);
  for(let i=0;i<m.indices.length;i+=3){const ids=Array.from(m.indices.slice(i,i+3),n=>n*2),ratio=area(p,...ids)/area(m.rest,...ids);assert.ok(ratio>0.35,'head transition compression/fold: '+ratio);}
 }
});
