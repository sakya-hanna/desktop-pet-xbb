'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const motion=require('../src/reference-motion.js'),{binding}=require('../src/character.js');
test('Baijie idle weights favor calm humming and doze remains conditional',()=>{
 assert.deepEqual(motion.idleWeights(.3,false),[['lookAround',1.5],['hum',3],['stretch',1],['bounce',.3],['sneeze',.25],['doze',0]]);
 assert.equal(motion.idleWeights(.1,true).at(-1)[1],4);
});
test('idle checks keep their 14-28 second cadence across manual actions and blocked opportunities',()=>{
 const m=motion.createMotion({binding,idle:true,seed:17});let deadline=10,checks=0;
 for(let i=0;i<120*90;i++){
  const t=i/120;if(i===240)m.play('hum');
  m.step(1/120,t>8&&t<50);
  const next=m.snapshot().referenceMotion.nextActionAt;
  if(next!==deadline){assert.ok(t+1/120>=deadline-1e-7,'completion/block must not reschedule');assert.ok(next-t>=14&&next-t<=28.01);deadline=next;checks++;}
  if(t>8&&t<50)assert.equal(m.snapshot().referenceMotion.active,null);
 }
 assert.ok(checks>=4);
});
test('held interaction never accumulates the quiet time needed for dozing',()=>{
 const m=motion.createMotion({binding,idle:false});for(let i=0;i<120*100;i++)m.step(1/120,true,{x:0,y:0});
 assert.equal(m.snapshot().referenceMotion.drowsyEligible,false);
 m.step(1/120,false);assert.equal(m.snapshot().referenceMotion.drowsyEligible,false);
 for(let i=0;i<120*73;i++)m.step(1/120);assert.equal(m.snapshot().referenceMotion.drowsyEligible,true);
});
