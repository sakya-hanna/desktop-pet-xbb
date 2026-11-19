'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createDirector}=require('../src/director.js'),ch=require('../src/character.js'),rig=require('../src/material-rig.js');
function start(){const d=createDirector({idleAction:'qianhuili',idle:false});for(let i=0;i<5;i++){d.send({type:'down',partId:'feet',pointerId:1,x:0,materialPoint:[215,760]});d.send({type:'up',pointerId:1});}return d;}
test('shoe gesture articulates hip and ankle separately and settles between feet',()=>{
 const d=start();let hip=0,ankle=0,peak=0,previous=null,maxStep=0;
 for(let i=0;i<600;i++){
  const p=d.advance(1/120).pose,f=p.feet.legs.left||{};
  hip=Math.max(hip,Math.abs(f.hip||0));ankle=Math.max(ankle,Math.abs(f.ankle||0));peak=Math.max(peak,f.lift||0);
  const point=rig.deformPoint([215,780],{feet:p.feet},ch.binding,ch.parts['leg-left']);
  if(previous)maxStep=Math.max(maxStep,Math.hypot(point[0]-previous[0],point[1]-previous[1]));previous=point;
  assert.deepEqual(rig.deformPoint([250,480],{feet:p.feet},ch.binding,ch.parts['leg-left']),[250,480]);
 }
 assert.ok(hip>.01,'upper leg should prepare the lower-leg movement');assert.ok(ankle>.025,'ankle must articulate independently');assert.ok(peak>6&&peak<15);assert.ok(maxStep<1.5,'no frame-edge snap '+maxStep);
});
test('ankle articulation changes foot pitch without rotating the shin or opening the root',()=>{
 const part=ch.parts['leg-left'],p={feet:{legs:{left:{angle:.05,ankle:.10,hip:.02,lift:6}}}},q={feet:{legs:{left:{angle:.05,ankle:0,hip:.02,lift:6}}}};
 assert.deepEqual(rig.deformPoint([220,650],p,ch.binding,part),rig.deformPoint([220,650],q,ch.binding,part));
 const a=rig.deformPoint([215,780],p,ch.binding,part),b=rig.deformPoint([215,780],q,ch.binding,part);assert.ok(Math.hypot(a[0]-b[0],a[1]-b[1])>3);
});

test('weight shift feeds the real body, head, long-hair and cloth springs',()=>{
 const d=start(),control=start();control.cancelFeet();let body=0,head=0,hair=0,cloth=0,shiftEarly=0,liftEarly=0;
 for(let i=0;i<720;i++){
  const p=d.advance(1/120).pose,q=control.advance(1/120).pose;
  body=Math.max(body,Math.abs(p.bodyX-q.bodyX)*800);head=Math.max(head,Math.abs(p.headRoll-q.headRoll));
  hair=Math.max(hair,...p.flexHair['outer-left'].nodes.map((n,j)=>Math.hypot(n[0]-q.flexHair['outer-left'].nodes[j][0],n[1]-q.flexHair['outer-left'].nodes[j][1])));
  cloth=Math.max(cloth,Math.abs(p.cloth['skirt-front'][0]-q.cloth['skirt-front'][0]));
  if(i===23){shiftEarly=Math.abs(p.bodyX-q.bodyX)*800;liftEarly=p.feet.legs.left?.lift||0;}
  // The support transform fades before the lower legs: no sliding stance foot.
  if(i<280)assert.deepEqual(rig.deformPoint([335,790],p,ch.binding,ch.parts['leg-right']),rig.deformPoint([335,790],q,ch.binding,ch.parts['leg-right']));
 }
 console.log('FOOT_CHAIN '+JSON.stringify({body,head,hair,cloth,shiftEarly,liftEarly}));
 assert.ok(body>8&&body<12);assert.ok(head>.003&&head<.04);assert.ok(hair>20&&hair<90);assert.ok(cloth>.3&&cloth<35);assert.ok(shiftEarly>.01&&liftEarly<.1,'weight shift must start before lift');
});
