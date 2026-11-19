'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createDirector}=require('../src/director.js'),rig=require('../src/material-rig.js'),ch=require('../src/character.js');
const {createHarness}=require('./helpers/interaction-fixtures.cjs');
const advance=(d,n)=>{for(let i=0;i<n;i++)d.advance(1/120);};
test('hair follows a caught lock, preserves roots, recoils and cancels independently',()=>{
 for(const id of ['outer-left','outer-right','rear-left','rear-right']){
  const d=createDirector({idleAction:'qianhuili',idle:false}),part=ch.parts[id],at=part.centerline[3];
  assert.ok(d.send({type:'grab-down',partId:id,pointerId:1,materialPoint:at}));
  assert.ok(d.send({type:'grab-move',pointerId:1,x:60,y:20}));advance(d,120);
  const s=d.snapshot(),passive={...s.pose,grab:{}};
  assert.equal(s.expression.kind,'hair');assert.ok(s.pose.grab[id][0]>18);
  assert.deepEqual(rig.deformPoint(part.root,s.pose,ch.binding,part),rig.deformPoint(part.root,passive,ch.binding,part));
  const p=rig.deformPoint(at,s.pose,ch.binding,part),b=rig.deformPoint(at,passive,ch.binding,part);
  assert.ok(Math.hypot(p[0]-b[0],p[1]-b[1])>15);
  d.send({type:'grab-up',pointerId:1});assert.deepEqual(d.snapshot().pose.grab[id],s.pose.grab[id]);
  let crossed=false;for(let i=0;i<240;i++){advance(d,1);if(d.snapshot().pose.grab[id][0]<0)crossed=true;}assert.ok(crossed);
  advance(d,360);assert.ok(Math.abs(d.snapshot().pose.grab[id][0])<.001);
  d.cancelGrab();assert.deepEqual(d.snapshot().pose.grab[id],[0,0]);
 }
});
test('actual hair alpha hit enters runtime capture and release without taking head or garment',async t=>{
 const h=await createHarness({idle:false});t.after(()=>h.runtime.destroy());h.runtime.start();h.tick(3);
 for(const id of ['outer-left','outer-right']){
  let point;
  const candidate=h.css(id.endsWith('left')?[114,302]:[477,290]);
  if(h.renderer.hitPart(candidate.clientX,candidate.clientY)?.partId===id)point=candidate;
  for(let y=210;y<450&&!point;y+=6)for(let x=id.endsWith('left')?30:400;x<(id.endsWith('left')?200:525);x+=6){const p=h.css([x,y]);if(h.renderer.hitPart(p.clientX,p.clientY)?.partId===id){point=p;break;}}
  assert.ok(point,'visible hair hit '+id);
  h.emit(h.canvas,'pointerdown',point);h.emit(h.canvas,'pointermove',{...point,clientX:point.clientX+(id.endsWith('left')?12:-12),clientY:point.clientY+4});h.tick(30);
  assert.equal(h.runtime.status().motion.grab?.partId,id);assert.equal(h.runtime.status().motion.expression?.kind,'hair');
  h.emit(h.canvas,'pointerup',point);h.tick(10);assert.equal(h.runtime.status().activePointer,null);assert.ok(Math.abs(h.runtime.status().motion.pose.grab[id][0])>.01);
  h.tick(160);
 }
 assert.deepEqual(h.errors,[]);
});

test('regrabbing another point preserves unfinished recoil and the attached curl follows its lock',()=>{
 const d=createDirector({idleAction:'qianhuili',idle:false}),id='rear-right',part=ch.parts[id],curl=ch.parts['front-right'];
 d.send({type:'grab-down',partId:id,pointerId:1,materialPoint:part.centerline[3]});d.send({type:'grab-move',pointerId:1,x:50,y:-15});advance(d,90);
 d.send({type:'grab-up',pointerId:1});advance(d,5);const before=d.snapshot().pose;
 d.send({type:'grab-down',partId:id,pointerId:2,materialPoint:part.centerline[4]});const after=d.snapshot().pose;
 for(const surface of [part,curl])for(const p of surface.centerline){
  const a=rig.deformPoint(p,before,ch.binding,surface),b=rig.deformPoint(p,after,ch.binding,surface);
  assert.ok(Math.hypot(a[0]-b[0],a[1]-b[1])<1e-8,'no jump on recatch');
 }
 const rest=curl.root,plain={...before,grab:{}};
 const delta=surface=>rig.deformPoint(rest,before,ch.binding,surface).map((v,i)=>v-rig.deformPoint(rest,plain,ch.binding,surface)[i]);
 assert.ok(Math.hypot(...delta(curl))>1);delta(curl).forEach((v,i)=>assert.ok(Math.abs(v-delta(part)[i])<1e-8));
 d.cancelGrab();assert.equal(d.snapshot().pose.hairRecoil.length,0);
});
