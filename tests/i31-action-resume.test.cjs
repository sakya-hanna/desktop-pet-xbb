'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createDirector}=require('../src/director.js'),{catalog}=require('../src/reference-motion.js');
const {createHarness}=require('./helpers/interaction-fixtures.cjs');
test('I31 actual runtime menu selection survives a just-finished head response',async t=>{
 const h=await createHarness({idle:false});t.after(()=>h.runtime.destroy());h.runtime.start();h.tick(2);
 const p=h.renderer.headInputPoint();assert.equal(h.renderer.hitPart(p.x,p.y)?.partId,'head');
 h.emit(h.canvas,'pointerdown',{clientX:p.x,clientY:p.y});h.tick(20);
 h.emit(h.win,'pointermove',{clientX:p.x+12,clientY:p.y});h.emit(h.win,'pointerup',{clientX:p.x+12,clientY:p.y,buttons:0});h.tick(3);
 assert.ok(h.runtime.status().motion.expression,'actual head response established');
 h.action('idle:hold');h.action('motion:stretch');h.action('idle:release');h.tick(2);
 assert.equal(h.runtime.status().motion.referenceMotion.active,'stretch');assert.deepEqual(h.errors,[]);
});
function advance(d,seconds){for(let i=0;i<Math.ceil(seconds*120);i++)d.advance(1/120);}
function afterTouch(){const d=createDirector({idleAction:'qianhuili',idle:false});advance(d,1);d.send({type:'down',pointerId:7,x:.5});advance(d,.3);d.send({type:'move',pointerId:7,x:.6});d.send({type:'up',pointerId:7});advance(d,.1);return d;}
test('I31 explicit motion selection after touch feedback starts without losing its first request',()=>{
 for(const action of catalog){const d=afterTouch();assert.ok(d.snapshot().expression,'fixture is in touch response');
  // Opening the real menu cancels presentation, then selection calls this entry.
  d.cancelIdleAction();d.cancelGrab();d.setIdleBlocked(false);
  assert.equal(d.playAction(action.id),true,action.id+' first selection');advance(d,.1);
  assert.equal(d.snapshot().referenceMotion.active,action.id);assert.equal(d.snapshot().expression,null);
 }
});
test('I31 explicit showcase after touch response starts and retains all queued actions',()=>{
 const d=afterTouch();d.cancelIdleAction();d.cancelGrab();d.setIdleBlocked(false);
 assert.equal(d.playAll(),true);advance(d,.1);assert.equal(d.snapshot().referenceMotion.active,catalog[0].id);assert.equal(d.snapshot().referenceMotion.demoRemaining,catalog.length-1);
});
test('I31 held gestures and lifecycle blocks still reject action selection',()=>{
 const d=createDirector({idleAction:'qianhuili',idle:false});d.send({type:'grab-down',pointerId:7,partId:'skirt-front'});advance(d,.1);
 for(const action of catalog)assert.equal(d.playAction(action.id),false);assert.equal(d.playAll(),false);
 d.send({type:'grab-cancel',pointerId:7});d.setIdleBlocked(true);assert.equal(d.playAction('hum'),false);assert.equal(d.playAll(),false);
});
