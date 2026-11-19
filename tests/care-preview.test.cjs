'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{createDirector}=require('../src/director');
const rig=require('../src/material-rig'),ch=require('../src/character');
test('care has a readable side-look and shoulder follow at desktop size, then faces forward with a held smile',()=>{
 const scale=348*.8/800;
 for(const warm of [0,17,39]){
  const d=createDirector({idleAction:'qianhuili',idle:false}),base=createDirector({idleAction:'qianhuili',idle:false});for(let i=0;i<warm*120;i++){d.advance(1/120);base.advance(1/120);}d.playAction('care');
  let head=0,shoulder=0,neck=0,peakLook=0,smileTime=0;
  for(let i=0;i<600;i++){const s=d.advance(1/120),p=s.pose,q=base.advance(1/120).pose;peakLook=Math.max(peakLook,Math.abs(p.lookX));neck=Math.max(neck,Math.abs(p.headRoll-q.headRoll)*180/Math.PI);if(s.face==='3901')smileTime+=1/120;
   for(const [id,point,part]of [['head',[298,104],ch.materials.head],['shoulder',[235,200],ch.materials.torso]]){const a=rig.deformPoint(point,p,ch.binding,part),b=rig.deformPoint(point,q,ch.binding,part),delta=Math.hypot(a[0]-b[0],a[1]-b[1])*scale;if(id==='head')head=Math.max(head,delta);else shoulder=Math.max(shoulder,delta);}
   if(i>=360&&i<420){assert.ok(Math.abs(p.lookX)<.04,'attention must settle forward rather than continue idle gaze');assert.equal(s.face,'3901');}
  }
  assert.ok(head>3&&head<7,'side-look must survive normal desktop scaling');assert.ok(shoulder>1.5,'shoulders must follow');assert.ok(neck<4.5,'do not replace the gesture with large neck sway');assert.ok(peakLook>.6&&smileTime>=2.5);
 }
});
test('care preview plays with automatic idle off, moves the head, smiles, finishes and can replay immediately',()=>{
 const d=createDirector({idleAction:'qianhuili',idle:false}),base=createDirector({idleAction:'qianhuili',idle:false});assert.equal(d.playAction('care'),true);
 let delta=0,smile=false;
 for(let i=0;i<600;i++){const s=d.advance(1/120),b=base.advance(1/120);delta=Math.max(delta,Math.abs(s.pose.lookY-b.pose.lookY));smile||=s.face==='3901';assert.equal(s.feedback,undefined);if(i<500){assert.equal(s.referenceMotion.micro.id,'care');assert.equal(s.referenceMotion.micro.automatic,false);}}
 assert.ok(delta>.04);assert.ok(smile);assert.equal(d.snapshot().referenceMotion.micro,null);assert.equal(d.snapshot().referenceMotion.care,null);assert.equal(d.playAction('care'),true);
});
test('touch interrupts care preview continuously without queuing another response',()=>{
 const d=createDirector({idleAction:'qianhuili',idle:false});d.playAction('care');for(let i=0;i<120;i++)d.advance(1/120);const before=d.snapshot().pose;
 d.send({type:'down',partId:'head',pointerId:1,x:0});assert.deepEqual(d.snapshot().pose,before);d.advance(1/120);assert.equal(d.snapshot().referenceMotion.micro,null);d.send({type:'cancel',pointerId:1});for(let i=0;i<1200;i++)d.advance(1/120);assert.equal(d.snapshot().referenceMotion.micro,null);
});
