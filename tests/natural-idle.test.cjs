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
 assert.ok(look>.3&&look<.6,'head tilt should use a modest side look');
 assert.ok(lean>.02&&lean<.08,'head tilt should carry the body through its slower spring');
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

test('short looks, tilts and weight shifts settle back before the next decision and leave hair follow-through',()=>{
 for(const seed of [9,17,20]){
  const a=createDirector({idleAction:'qianhuili',idle:true,seed}),base=createDirector({idleAction:'qianhuili',idle:false,seed});
  let peakLook=0,peakRoll=0,peakBody=0,peakHair=0,lateHead=0,lateHair=0;
  for(let i=1;i<=1080;i++){
   const s=a.advance(dt),b=base.advance(dt),p=s.pose,q=b.pose;
   assert.equal(s.referenceMotion.active,null,'small moment must not start a full action');
   if(i>480){
    peakLook=Math.max(peakLook,Math.abs(p.lookX-q.lookX));
    peakRoll=Math.max(peakRoll,Math.abs(p.headRoll-q.headRoll));
    peakBody=Math.max(peakBody,Math.abs(p.bodyRoll-q.bodyRoll));
   }
   if(i%12===0&&i>480){
    const hair=parts['outer-left'],tip=hair.centerline.at(-1);
    const tipDelta=distance(rig.deformPoint(tip,p,binding,hair),rig.deformPoint(tip,q,binding,hair));
    peakHair=Math.max(peakHair,tipDelta);
    if(i>=960){lateHead=Math.max(lateHead,Math.abs(p.lookX-q.lookX),Math.abs(p.headRoll-q.headRoll));lateHair=Math.max(lateHair,tipDelta);}
   }
   for(const foot of [[215,798],[315,798]])assert.ok(distance(rig.deformPoint(foot,p,binding,materials.torso),foot)<1e-8);
  }
  if(seed===9)assert.ok(peakLook>.7,'side look has no readable excursion');
  if(seed===17)assert.ok(peakRoll>.05,'head tilt has no distinct posture');
  if(seed===20)assert.ok(peakBody>.03,'weight shift has no distinct posture');
  const p=a.snapshot().pose,q=base.snapshot().pose;
  for(const key of ['lookX','lookY','headRoll','bodyRoll'])assert.ok(Math.abs(p[key]-q[key])<.002,'moment held until next decision '+key);
  assert.ok(peakHair>1,'the actual long hair did not follow the short moment');
  assert.ok(lateHead<.005&&lateHair>.05,'hair should still settle after the head returns');
  console.log('IDLE_MOMENT '+JSON.stringify({seed,peakLook,peakRoll,peakBody,peakHair,lateHead,lateHair}));
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
   for(const part of Object.values(parts)){
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
