'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createMotion}=require('../src/reference-motion.js'),ch=require('../src/character.js');
test('stroking in any direction holds one downward pose without following the finger',()=>{
 const make=()=>createMotion({binding:ch.binding,idle:false,seed:17});const still=make(),moving=make();
 for(let i=0;i<720;i++){
  still.step(1/120,true,{x:0,y:0});moving.step(1/120,true,{x:220*Math.sin(i*.14),y:160*Math.cos(i*.09)});
  assert.deepEqual(moving.snapshot().pose,still.snapshot().pose);
 }
 const p=moving.snapshot().pose;assert.ok(Math.abs(p.headRoll)<1e-7);assert.ok(Math.abs(p.headX)<1e-7);assert.ok(Math.abs(p.lookX)<1e-7);assert.ok(p.lookY>.6);
 const before=p.headY;moving.step(1/120,true,{x:-200,y:200});assert.ok(Math.abs(moving.snapshot().pose.headY-before)<1e-7);
});
