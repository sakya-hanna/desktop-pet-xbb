'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const perf=require('../src/idle-performance.js'),{createMotion}=require('../src/reference-motion.js');
const {createDirector}=require('../src/director.js'),{binding,materials,grabs,parts}=require('../src/character.js'),rig=require('../src/material-rig.js');
test('five distinct moments are scheduled without repeats, with pauses and cooldowns',()=>{
 const a=perf.create({seed:17}),b=perf.create({seed:17}),seen=[],end={};let last=null;
 for(let i=0;i<300*120;i++){const t=i/120;assert.deepEqual(a.step(t,true),b.step(t,true));const m=a.snapshot(t);
  if(m?.id!==last){if(last)end[last]=t;if(m){assert.ok(!seen.slice(-2).includes(m.id));assert.ok(t-(end[m.id]??-Infinity)>=perf.catalog.find(x=>x.id===m.id).cooldown);seen.push(m.id);}last=m?.id;}
 }
 assert.equal(new Set(seen).size,5);assert.ok(seen.length>=20&&seen.length<=45);
});
test('actual director carries every moment to pose, hair and anchored feet; cancel releases arms',()=>{
 const d=createDirector({idleAction:'qianhuili',idle:true,seed:17});const seen=new Set();let arm=0,smile=false,head=0,hair=0;
 for(let i=0;i<120*180;i++){const s=d.advance(1/120),p=s.pose;if(!s.referenceMotion.micro)continue;seen.add(s.referenceMotion.micro.id);
  arm=Math.max(arm,...Object.values(p.idleArms).flat().map(Math.abs));smile||=s.face==='3901';head=Math.max(head,Math.abs(p.lookX));
  if(i%120===0){const part=parts['outer-left'],tip=part.centerline.at(-1);hair=Math.max(hair,Math.hypot(...rig.deformPoint(tip,p,binding,part).map((v,j)=>v-tip[j])));for(const f of [[215,798],[315,798]])assert.ok(Math.hypot(...rig.deformPoint(f,p,binding,materials.torso).map((v,j)=>v-f[j]))<1e-6);}
 }
 assert.equal(seen.size,5);assert.ok(arm>5&&head>.4&&hair>2&&smile);
 const m=createMotion({binding,idle:true,seed:17});for(let i=0;i<9000;i++)m.step(1/120);const before=m.snapshot().pose;m.setBlocked(true);assert.deepEqual(m.snapshot().pose,before);for(let i=0;i<1200;i++)m.step(1/120,true);assert.ok(Object.values(m.snapshot().pose.idleArms).flat().every(v=>Math.abs(v)<1e-6));assert.equal(m.snapshot().referenceMotion.micro,null);
});
test('autonomous arm deformation reaches hand but preserves shoulder root and real grab',()=>{
 const part=grabs['arm-screen-left'],point=[200,300],p={idleArms:{'arm-screen-left':[7,5]}};
 assert.deepEqual(rig.localPoint(point,p,part,[1,0,0]),point);
 assert.deepEqual(rig.localPoint(point,p,part,[0,0,1]),[207,305]);
 assert.deepEqual(rig.localPoint(point,{...p,grab:{'arm-screen-left':[2,-1]}},part,[0,0,1]),[209,304]);
});
test('real runtime loads new moments and remains interactive',async()=>{
 const {createHarness}=require('./helpers/interaction-fixtures.cjs'),h=await createHarness({idle:true});
 try{await h.runtime.start();h.tick(400);assert.deepEqual(h.errors,[]);assert.ok(h.runtime.status().renderedFrames>100);h.action('idle:off');h.tick(300);assert.deepEqual(h.errors,[]);}finally{h.runtime.destroy();}
});
