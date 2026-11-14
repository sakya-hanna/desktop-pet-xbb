'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const rig=require('../src/material-rig.js'),ch=require('../src/character.js');
test('I27 long hair follows a head-side root with independent delayed joint states',()=>{
 assert.equal(typeof rig.createLongHairDynamics,'function','long hair dynamics is not implemented');
 const part={name:'outer-left',root:[235,65],centerline:[[235,65],[220,128],[180,213],[114,302],[98,402],[80,488]],rootLockY:80,rootBlendY:100,longHair:true};
 const d=rig.createLongHairDynamics(part,ch.binding),samples=[];
 for(let i=0;i<480;i++){const u=i/120,p={referenceMotion:true,lookX:u<1?0:u<2?1:u<3?-1:0,headRoll:u<2?.08:0};d.step(1/120,p);samples.push(d.snapshot());}
 assert.ok(samples.some(a=>Math.abs(a[0]-a[3])>.01),'joint states must not be one scaled angle');
 assert.ok(samples.slice(360).some(a=>a.some(v=>Math.abs(v)>.002)),'motion must retain a decaying release');
 assert.ok(samples.every(a=>a.every(Number.isFinite)));
 const pose={referenceMotion:true,lookX:1.2,headRoll:.08,longHair:{'outer-left':samples[200]}};
 const a=rig.deformPoint(part.root,pose,ch.binding,part),b=rig.deformPoint(part.root,pose,ch.binding);
 assert.ok(Math.hypot(a[0]-b[0],a[1]-b[1])<1e-8,'root matches head-side cut');
});
test('I27 production director supplies long-hair states and jump-specific inertia',()=>{
 const {createDirector}=require('../src/director.js'),a=createDirector({idleAction:'qianhuili',idle:false,seed:17}),b=createDirector({idleAction:'qianhuili',idle:false,seed:17});
 for(let i=0;i<360;i++){a.advance(1/120);b.advance(1/120);}b.playAction('bounce');let delta=0;
 for(let i=0;i<480;i++){const x=a.advance(1/120).pose,y=b.advance(1/120).pose;assert.ok(x.longHair&&y.longHair,'runtime pose has no long-hair chain');
  const p=x.longHair['outer-left'],q=y.longHair['outer-left'];delta=Math.max(delta,...p.map((v,j)=>Math.abs(v-q[j])));
 }
 assert.ok(delta>.002,'jump must produce local hair inertia, not only global movement');
});
test('I27 keeps the original body mesh layout while splitting hair ownership',async()=>{
 const {createHarness}=require('./helpers/interaction-fixtures.cjs'),h=await createHarness();
 h.renderer.render({},'3942',false,0,true,[{face:'3942',weight:1}]);
 const body=h.draws.find(d=>d.texture==='baijie-arms-skirts-body.png');assert.ok(body);
 assert.equal(body.rest[0],102,'hair separation must not retessellate the accepted face/body');
});
