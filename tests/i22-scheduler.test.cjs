'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createMotion}=require('../src/reference-motion.js'),{binding}=require('../src/character.js');
test('I22 reference drowsy weighting measures quiet time since contact, while disabling automatic actions keeps baseline alive',()=>{
 const d=createMotion({binding,idle:false});for(let i=0;i<9600;i++)d.step(1/120);
 assert.equal(d.snapshot().referenceMotion.drowsyEligible,true);
 d.setBlocked(true);assert.equal(d.snapshot().referenceMotion.drowsyEligible,false);
 d.setBlocked(false);for(let i=0;i<120;i++)d.step(1/120);
 assert.equal(d.snapshot().referenceMotion.drowsyEligible,false);assert.equal(d.snapshot().referenceMotion.automatic,false);
 assert.ok(d.snapshot().pose.breath>0);assert.equal(d.snapshot().referenceMotion.active,null);
});
