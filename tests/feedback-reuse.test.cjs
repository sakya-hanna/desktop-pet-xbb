'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createDirector}=require('../src/director.js'),{defaults}=require('../src/response-config.js');
const create=()=>createDirector({idleAction:'qianhuili',idle:false});
const step=(d,t)=>{for(let i=0;i<t*120;i++)d.advance(1/120);};
function down(d,partId='feet'){return d.send({type:'down',partId,pointerId:1,x:0,materialPoint:[215,760]});}
function tap(d,partId='feet'){assert.ok(down(d,partId));d.send({type:'up',pointerId:1});}
function pull(d){
 assert.ok(d.send({type:'grab-down',partId:'outer-left',pointerId:1,materialPoint:[100,350]}));
 d.send({type:'grab-move',pointerId:1,x:8,y:0});
}
test('repeated taps retain a visible bubble through pointerdown and retain its original expiry',()=>{
 const d=create();tap(d);const first=d.snapshot().feedback,expression=d.snapshot().expression;
 step(d,1);assert.ok(down(d));assert.deepEqual(d.snapshot().feedback,first);
 d.send({type:'up',pointerId:1});assert.deepEqual(d.snapshot().feedback,first);
 assert.notEqual(d.snapshot().expression.id,expression.id,'response animation still restarts independently');
 step(d,first.durationMs/1000-1+.05);assert.equal(d.snapshot().feedback,undefined,'same action must not extend the bubble');
 tap(d);assert.ok(d.snapshot().feedback.id>first.id,'after expiry a new bubble is allowed');
});
test('repeated foot taps still count and the shoe action replaces the tickle bubble',()=>{
 const d=create();tap(d);const first=d.snapshot().feedback;
 for(let i=0;i<3;i++){tap(d);assert.deepEqual(d.snapshot().feedback,first);}
 tap(d);assert.equal(d.snapshot().expression.kind,'shoesOff');assert.ok(d.snapshot().feedback.id>first.id);
 assert.equal(d.snapshot().feedback.text,defaults.lines.shoesOff);
});
test('a different action replaces immediately even when its configured words match',()=>{
 const d=createDirector({idleAction:'qianhuili',idle:false,responseConfig:{lines:{feet:'same',body:'same'}}});
 tap(d);const first=d.snapshot().feedback;tap(d,'body');assert.ok(d.snapshot().feedback.id>first.id);
});
test('repeated hair pulls reuse the bubble but renew held expressions, and explicit clear prevents revival',()=>{
 const d=create();pull(d);const first=d.snapshot().feedback,expression=d.snapshot().expression;
 d.send({type:'grab-up',pointerId:1});step(d,.2);pull(d);
 assert.deepEqual(d.snapshot().feedback,first);assert.notEqual(d.snapshot().expression.id,expression.id);
 assert.equal(d.snapshot().expression.kind,'hair');step(d,2);assert.equal(d.snapshot().expression.phase,'hold');
 d.send({type:'grab-up',pointerId:1});d.clearFeedback();assert.equal(d.snapshot().feedback,undefined);
 pull(d);assert.ok(d.snapshot().feedback.id>first.id);
});
