'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createDirector}=require('../src/director.js'),{catalog}=require('../src/reference-motion.js');
const step=(d,t)=>{for(let i=0;i<Math.ceil(t*120);i++)d.advance(1/120);return d.snapshot();};
test('I31 waking demonstrations establish the reference sleepy posture before their first wake cue',()=>{
 for(const id of ['wake','rouse']){const a=catalog.find(a=>a.id===id),prepareDuration=id==='wake'?1.6:1.2;
  const d=createDirector({idleAction:'qianhuili',idle:false});step(d,3);d.playAction(id);
  const s=step(d,prepareDuration-.1);assert.ok(s.blink>(id==='wake'?.9:.25),id+' eyes already sleepy before wake');
  assert.equal(s.face,id==='wake'?'3625':'3599');assert.equal(s.referenceMotion.phase,'preparing');assert.equal(s.referenceMotion.completed,0);assert.equal(a.prepareDuration,prepareDuration);const r=step(d,.8);assert.equal(r.referenceMotion.phase,'playing');
  const end=step(d,a.duration+3.5);assert.equal(end.referenceMotion.active,null);assert.equal(end.referenceMotion.completed,1);assert.equal(end.face,'3942');
 }
});
test('I31 interrupting waking preparation retires its wake events without teleporting the body',()=>{
 const d=createDirector({idleAction:'qianhuili',idle:false});step(d,3);d.playAction('wake');step(d,.8);const p=d.snapshot().pose;
 d.cancelIdleAction();assert.deepEqual(d.snapshot().pose,p);step(d,8);assert.equal(d.snapshot().referenceMotion.completed,0);assert.equal(d.snapshot().feedback,undefined);
});
