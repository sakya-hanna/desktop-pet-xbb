'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const perf=require('../src/idle-performance'),motion=require('../src/reference-motion'),{binding}=require('../src/character'),{createDirector}=require('../src/director');
const dt=1/120,advance=(d,sec)=>{for(let i=0;i<Math.ceil(sec/dt);i++)d.advance(dt);return d.snapshot();};
function pat(d,release='up'){d.send({type:'down',partId:'head',pointerId:1,x:0,y:0});advance(d,.3);d.send({type:'move',pointerId:1,x:.08,y:0});advance(d,.3);d.send({type:release,pointerId:1});}
function hand(d,release='grab-up',move=true){d.send({type:'grab-down',partId:'arm-screen-left',pointerId:1});if(move)d.send({type:'grab-move',pointerId:1,x:5,y:2});advance(d,.3);d.send({type:release,pointerId:1});}
test('only completed pat and active hand gestures create a single care event',()=>{
 for(const [gesture,kind]of [[pat,'head'],[hand,'hand']]){const d=createDirector({idleAction:'qianhuili',seed:17});gesture(d);assert.equal(d.snapshot().referenceMotion.care.kind,kind);let seen=0,last=null;
  for(let i=0;i<120*80;i++){const s=d.advance(dt),id=s.referenceMotion.micro?.id;if(id==='care'&&last!=='care'){seen++;assert.equal(s.referenceMotion.micro.source,kind);assert.equal(s.expression,null);assert.equal(s.feedback,undefined);assert.equal(s.referenceMotion.care,null);}last=id;}
  assert.equal(seen,1);
 }
 for(const gesture of [d=>pat(d,'cancel'),d=>hand(d,'grab-cancel'),d=>hand(d,'grab-up',false),d=>{d.send({type:'down',partId:'head',pointerId:1,x:0});advance(d,.1);d.send({type:'up',pointerId:1});}]){const d=createDirector({idleAction:'qianhuili'});gesture(d);assert.equal(d.snapshot().referenceMotion.care,null);}
});
test('care waits for continuous quiet, replaces earlier care, expires and consumes on interruption',()=>{
 const p=perf.create({seed:17});assert.equal(p.recordCare('feet',0),false);p.recordCare('head',0);p.recordCare('hand',2);
 for(let t=2;t<12;t+=dt){p.step(t,false);assert.notEqual(p.snapshot(t)?.id,'care');}
 let start=null;
 for(let t=12;t<45;t+=dt){p.step(t,true);if(p.snapshot(t)?.id==='care'){start=t;break;}}
 assert.ok(start>=20&&start<34);assert.equal(p.snapshot(start).source,'hand');assert.equal(p.context(),null);p.cancel(start);
 let repeated=false;for(let t=start;t<start+95;t+=dt){p.step(t,true);repeated||=p.snapshot(t)?.id==='care';}assert.equal(repeated,false);
 p.recordCare('head',200);p.step(291,true);assert.equal(p.context(),null);
 const q=perf.create({seed:3});q.recordCare('head',0);let first;
 for(let t=0;t<40;t+=dt){q.step(t,true);if(q.snapshot(t)?.id==='care'){first=t;break;}}assert.ok(first>8);q.cancel(first);q.recordCare('hand',first+1);
 for(let t=first+1;t<first+120;t+=dt){q.step(t,true);assert.notEqual(q.snapshot(t)?.id,'care');}assert.equal(q.context(),null);
});
test('full automatic actions do not repeat, respect completed cooldowns and stay silent; manual remains available',()=>{
 const m=motion.createMotion({binding,idle:true,seed:11});m.setSystemIdle(0);let last=null,previous=null,starts=0;const ends={};
 for(let i=0;i<120*600;i++){m.step(dt);const s=m.snapshot(),id=s.referenceMotion.active;if(id!==last){if(last)ends[last]=i*dt;if(id){assert.notEqual(id,previous);assert.ok(i*dt-(ends[id]??-Infinity)>=motion.idleCooldowns[id]-dt);assert.notEqual(id,'doze');previous=id;starts++;}last=id;}assert.equal(s.feedback,null);if(i%120===0)m.setSystemIdle(0);}
 assert.ok(starts>=5);m.cancel();assert.equal(m.play('hum'),true);m.step(dt);assert.equal(m.snapshot().feedback.text,'♪～');for(let i=0;i<610;i++)m.step(dt);assert.equal(m.snapshot().face,'3901');assert.equal(m.snapshot().referenceMotion.lastFull,'hum');assert.equal(m.play('hum'),true);
});
test('care and full actions yield continuously, off clears pending care and reminder recovery waits four seconds',()=>{
 const m=motion.createMotion({binding,idle:true,seed:17});m.recordCare('head');let found=false;
 for(let i=0;i<120*60;i++){m.step(dt);if(m.snapshot().referenceMotion.micro?.id==='care'){found=true;break;}}assert.ok(found);
 for(let i=0;i<120;i++)m.step(dt);const before=m.snapshot().pose;m.setBlocked(true,4);assert.deepEqual(m.snapshot().pose,before);m.step(dt,true);assert.equal(m.snapshot().referenceMotion.micro,null);
 m.setBlocked(false);for(let i=0;i<120*3.9;i++){m.step(dt);assert.equal(m.snapshot().referenceMotion.micro,null);assert.equal(m.snapshot().referenceMotion.active,null);}
 m.recordCare('hand');m.setAuto(false);assert.equal(m.snapshot().referenceMotion.care,null);for(let i=0;i<120*20;i++)m.step(dt);assert.equal(m.snapshot().referenceMotion.micro,null);assert.equal(m.play('hum'),true);
});
