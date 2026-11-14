'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createDirector}=require('../src/director.js'),rig=require('../src/material-rig.js'),character=require('../src/character.js');
const step=(d,seconds)=>{for(let i=0;i<Math.round(seconds*120);i++)d.advance(1/120);return d.snapshot();};
test('I19 complete weight-shift reaches full-character poses and returns without moving the shoe support',()=>{
 const d=createDirector({idleAction:'weight-shift',seed:17}),rows=[];
 for(let i=0;i<1200;i++)rows.push(d.advance(1/120));
 assert.ok(rows.some(s=>s.idleAction?.phase==='hold'),'single action must run, not the legacy head-turn');
 const phase=rows.filter(s=>s.idleAction?.phase==='hold');
 const peak=phase.reduce((a,s)=>s.pose.bodyRoll>a.pose.bodyRoll?s:a);
 const b=character.binding,head=rig.deformPoint([298,90],peak.pose,b),foot=rig.deformPoint([270,798],peak.pose,b);
 assert.ok(head[0]-298>15,'default-size torso pose must be visibly displaced, not a tiny head-only sway');
 assert.deepEqual(foot,[270,798],'foot support stays fixed');
 const torso=[[255,170],[310,200],[280,270]],shifted=torso.map(p=>rig.deformPoint(p,peak.pose,b));
 const length=p=>Math.hypot(p[1][0]-p[0][0],p[1][1]-p[0][1]);
 assert.ok(Math.abs(length(shifted)-length(torso))<0.1,'head/shoulders/chest use the shared body, not stretching');
 assert.ok(phase.some(s=>s.face==='3901'),'smile belongs to held posture');
 assert.ok(rows.some(s=>Math.abs(s.pose.cloth?.['skirt-front']?.[0]||0)>0.3),'connected garment actually follows');
 for(const s of rows)assert.deepEqual(s.pose.cloth['skirt-front'],s.pose.cloth['skirt-right']);
 const final=rows.at(-1);assert.ok(Math.abs(final.pose.bodyRoll)<0.001);assert.equal(final.face,'3942');
 assert.equal(final.idleAction.completed,1);assert.equal(final.bubble,null);
});
test('I19 contact interrupts the action without snapping, and long holds cannot restart it',()=>{
 for(const part of ['head','chest','arm-screen-left','arm-screen-right','skirt-front','skirt-right']){
  const d=createDirector({idleAction:'weight-shift'});step(d,5);const before=d.snapshot();
  const grab=part.startsWith('arm-')||part.startsWith('skirt-');
  assert.equal(d.send({type:grab?'grab-down':'down',partId:part,pointerId:1,x:0.5}),true);
  assert.equal(d.snapshot().idleAction.phase,'interrupted',part+' cancels before the next frame');
  const after=d.snapshot().pose;
  assert.deepEqual(Object.fromEntries(Object.keys(before.pose).map(k=>[k,after[k]])),before.pose,'interruption preserves all existing pose fields; newly-owned grab metadata is separate');
  const held=step(d,20);assert.ok(Math.abs(held.pose.bodyRoll)<0.001);assert.equal(held.idleAction.completed,0);
  d.send({type:grab?'grab-up':'up',pointerId:1});step(d,1);
  assert.notEqual(d.snapshot().idleAction.phase,'hold');
 }
});
test('I19 jump and external holds cancel remaining cues and recover instead of resuming an old action',()=>{
 const d=createDirector({idleAction:'weight-shift'});step(d,5);
 const pose=d.snapshot().pose;assert.equal(d.send({type:'jump'}),true);
 assert.equal(d.snapshot().idleAction.phase,'interrupted');assert.equal(d.snapshot().pose.bodyRoll,pose.bodyRoll);
 step(d,2);assert.equal(d.snapshot().completedJumps,1);assert.equal(d.snapshot().idleAction.completed,0);
 d.setIdleBlocked(true);step(d,20);assert.equal(d.snapshot().idleAction.completed,0);
 d.setIdleBlocked(false);step(d,1);assert.equal(d.snapshot().idleAction.phase,'quiet');
 step(d,15);assert.equal(d.snapshot().idleAction.completed,1);
});
