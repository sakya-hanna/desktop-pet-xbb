'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createMotion}=require('../src/reference-motion.js'),{createDirector}=require('../src/director.js');
const {binding,materials,parts}=require('../src/character.js'),rig=require('../src/material-rig.js');
const dt=1/120,distance=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);

test('standing breath has a continuous longer exhale and varying cycles, without moving the feet',()=>{
 const m=createMotion({binding,idle:false}),peaks=[],valleys=[];let last=.5,up=true,maxStep=0,maxHead=0;
 for(let i=0;i<7200;i++){
  m.step(dt);const p=m.snapshot().pose,t=(i+1)*dt;
  if(p.breath<last&&up){peaks.push(t);up=false;}
  if(p.breath>last&&!up){valleys.push(t);up=true;}
  maxStep=Math.max(maxStep,Math.abs(p.breath-last));maxHead=Math.max(maxHead,Math.abs(p.headY)*binding.height);
  assert.ok(p.breath>=0&&p.breath<=1);last=p.breath;
  for(const point of [[215,798],[315,798]])assert.ok(distance(rig.deformPoint(point,p,binding,materials.torso),point)<1e-8);
 }
 const periods=peaks.slice(2).map((v,i)=>v-peaks[i+1]);
 assert.ok(periods.length>10&&Math.min(...periods)>3.5&&Math.max(...periods)<5.1);
 assert.ok(Math.max(...periods)-Math.min(...periods)>.3,'breath repeats an identical metronomic cycle');
 for(const valley of valleys.slice(1,-1)){
  const before=peaks.filter(t=>t<valley).at(-1),after=peaks.find(t=>t>valley);
  assert.ok(valley-before>after-valley,'exhale should outlast the next inhale');
 }
 assert.ok(maxStep<.012,'cycle boundary jumps');assert.ok(maxHead>.3,'head never receives the delayed breathing response');
 console.log('NATURAL_BREATH '+JSON.stringify({periodRange:[Math.min(...periods),Math.max(...periods)],maxStep,maxHeadMaterialPixels:maxHead}));
});

test('quiet attention changes settle into the same head/body springs and yield continuously to actions and contact',()=>{
 const a=createMotion({binding,idle:true,seed:17}),b=createMotion({binding,idle:true,seed:17});
 let look=0,lean=0;
 for(let i=0;i<600;i++){
  a.step(dt);b.step(dt);const s=a.snapshot();assert.deepEqual(s,b.snapshot(),'idle replay is not seeded');
  assert.equal(s.referenceMotion.active,null);look=Math.max(look,Math.abs(s.pose.lookX));lean=Math.max(lean,Math.abs(s.pose.bodyRoll));
 }
 assert.ok(look<.85&&lean<.08,'quiet posture exceeds its envelope');
 for(const operation of [()=>a.play('lookAround'),()=>a.cancel(),()=>a.setBlocked(true),()=>a.setBlocked(false),()=>a.setAuto(false)]){
  const before=a.snapshot().pose;operation();assert.deepEqual(a.snapshot().pose,before,'target switch reset a spring or breath');
  a.step(dt);const next=a.snapshot().pose;
  assert.ok(Math.abs(next.headRoll-before.headRoll)<.01&&Math.abs(next.bodyRoll-before.bodyRoll)<.01&&Math.abs(next.headY-before.headY)<.001);
 }
 for(let i=0;i<1200;i++)a.step(dt);
 const end=a.snapshot();assert.equal(end.referenceMotion.active,null);
 const baseline=createMotion({binding,idle:false});for(let i=0;i<1805;i++)baseline.step(dt);
 for(const key of ['lookX','lookY','headRoll','bodyRoll'])assert.ok(Math.abs(end.pose[key]-baseline.snapshot().pose[key])<1e-6,'disabled idle kept its old target '+key);
});

test('short glance and weight shift carry long hair beyond the continuous idle baseline',()=>{
 for(const seed of [1,4]){
  const a=createDirector({idleAction:'qianhuili',idle:true,seed}),base=createDirector({idleAction:'qianhuili',idle:false,seed});
  const part=parts['outer-left'],tip=part.centerline.at(-1);let peakHair=0,lateHair=0,peakLook=0,peakBody=0,lateHead=0;
  for(let i=1;i<=1188;i++){
   const s=a.advance(dt),p=s.pose,q=base.advance(dt).pose;assert.equal(s.referenceMotion.active,null);
   peakLook=Math.max(peakLook,Math.abs(p.lookX-q.lookX));peakBody=Math.max(peakBody,Math.abs(p.bodyRoll-q.bodyRoll));
   if(i%12===0){const d=distance(rig.deformPoint(tip,p,binding,part),rig.deformPoint(tip,q,binding,part));peakHair=Math.max(peakHair,d);if(i>=1080){lateHead=Math.max(lateHead,Math.abs(p.lookX-q.lookX),Math.abs(p.headRoll-q.headRoll));lateHair=Math.max(lateHair,d);}}
  }
  assert.ok(peakHair>1,'micro gesture must move hair beyond its ordinary breeze');
  if(seed===1){assert.ok(peakLook>.4);assert.ok(lateHead<.005&&lateHair>.05,'hair should continue settling after the glance returns');}
  else assert.ok(peakBody>.02,'weight shift must have its own body posture');
 }
});

test('natural standing reaches real body and hair draw buffers while roots and feet stay joined',async()=>{
 const {createHarness}=require('./helpers/interaction-fixtures.cjs'),h=await createHarness({idle:true});
 const d=createDirector({idleAction:'qianhuili',idle:true}),ranges={shoulder:[Infinity,-Infinity],head:[Infinity,-Infinity]};
 try{
  for(let i=0;i<1080;i++){
   const s=d.advance(dt);if(i%120)continue;const p=s.pose;
   assert.equal(s.referenceMotion.active,null);h.renderer.render(p,'3942',false,0,true);
   for(const [name,point,owner] of [['shoulder',[240,185],materials.torso],['head',[298,95],materials.head]]){
    const moved=rig.deformPoint(point,p,binding,owner);ranges[name][0]=Math.min(ranges[name][0],moved[0]);ranges[name][1]=Math.max(ranges[name][1],moved[0]);
   }
   for(const part of Object.values(parts).filter(p=>p.root)){
    const root=rig.deformPoint(part.root,p,binding,part),parent=rig.deformPoint(part.root,p,binding,part.followPart||materials.head);
    assert.ok(distance(root,parent)<1e-7,'resting pose opens a root '+part.name);
   }
   const draws=h.draws.filter(x=>[h.meta.head.torso,'baijie-outer-left.png','baijie-rear-right.png'].includes(x.texture));assert.equal(draws.length,3);
   for(const draw of draws){
    const part=draw.texture===h.meta.head.torso?materials.torso:parts[draw.texture.slice(7,-4)];
    for(let k=0;k<draw.rest.length;k+=2){const expected=rig.deformPoint([draw.rest[k],draw.rest[k+1]],p,binding,part);assert.ok(distance(expected,[draw.positions[k],draw.positions[k+1]])<.001);}
   }
  }
  assert.ok(ranges.shoulder[1]-ranges.shoulder[0]>1&&ranges.head[1]-ranges.head[0]>1,'only hair moved during idle');
  console.log('NATURAL_IDLE_BODY '+JSON.stringify(ranges));
 }finally{h.runtime.destroy();}
});
