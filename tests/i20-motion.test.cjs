'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createDirector}=require('../src/director.js');
const advance=(d,s)=>{for(let i=0;i<Math.round(s*120);i++)d.advance(1/120);return d.snapshot();};
test('I20 living baseline contains independent orientation, local breath and distinct front/back hair without any complete action',()=>{
 const d=createDirector({idleAction:'soft-look',autoAction:false}),rows=[];
 for(let i=0;i<2400;i++){const s=d.advance(1/120);if(i>120)rows.push(s);}
 assert.ok(rows.every(s=>Number.isFinite(s.pose.lookX)&&Number.isFinite(s.pose.lookY)&&Number.isFinite(s.pose.breath)),'new deformation channels must be driven');
 const span=k=>Math.max(...rows.map(s=>s.pose[k]))-Math.min(...rows.map(s=>s.pose[k]));
 assert.ok(span('lookX')>0.2);assert.ok(span('lookY')>0.1);assert.ok(span('breath')>0.8);
 assert.ok(rows.some(s=>Math.abs(s.pose.hair['outer-left'][2]-s.pose.hair['front-left'][2])>0.01),'front and back cannot use identical states');
 assert.ok(rows.some(s=>Math.abs(s.pose.hair['outer-right'][2]-s.pose.hair['front-right'][2])>0.01));
 assert.ok(rows.every(s=>s.idleAction.completed===0&&s.idleAction.phase==='quiet'));
});
test('I20 one acted look layers over living motion, then yields to contact without stopping baseline or replaying cancelled cues',()=>{
 const d=createDirector({idleAction:'soft-look'}),before=advance(d,4.8);
 assert.equal(before.idleAction.name,'soft-look');assert.ok(before.pose.lookX<-0.4);assert.ok(before.pose.breath>0);
 const beforePose=before.pose;d.send({type:'down',partId:'head',pointerId:1,x:0.5});
 assert.equal(d.snapshot().idleAction.phase,'interrupted');assert.deepEqual(d.snapshot().pose,beforePose);
 const held=advance(d,12);assert.equal(held.idleAction.completed,0);assert.ok(Math.abs(held.pose.lookX)>0.01,'baseline stays alive during an interrupted action');
 d.send({type:'up',pointerId:1});advance(d,1);assert.equal(d.snapshot().idleAction.phase,'quiet');
 advance(d,15);assert.equal(d.snapshot().idleAction.completed,1);assert.equal(d.snapshot().bubble,null);
});
