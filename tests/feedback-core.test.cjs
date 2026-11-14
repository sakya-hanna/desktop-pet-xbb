'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createDirector}=require('../src/director.js');
const tick=(e,n)=>{for(let i=0;i<n;i++)e.advance(1/120);};
test('I9 holding past expiry never renews; pending click and zero move never count as a drag',()=>{
 const e=createDirector({idle:false});
 e.send({type:'grab-down',partId:'skirt-front',pointerId:1});e.send({type:'grab-move',pointerId:1,x:0,y:0});assert.equal(e.snapshot().bubble,null);e.send({type:'grab-up',pointerId:1});assert.equal(e.snapshot().bubble,null);
 e.send({type:'grab-down',partId:'skirt-front',pointerId:2});e.send({type:'grab-move',pointerId:2,x:8,y:0});const id=e.snapshot().feedback.id;
 for(let i=0;i<600;i++){e.send({type:'grab-move',pointerId:2,x:i%2?8:-8,y:0});e.advance(1/120);}
 assert.equal(e.snapshot().bubble,null);e.send({type:'grab-up',pointerId:2});assert.equal(e.snapshot().bubble,null);
 e.send({type:'grab-down',partId:'skirt-right',pointerId:3});e.send({type:'grab-move',pointerId:3,x:8,y:0});assert.equal(e.snapshot().feedback.id,id+1);
});
test('I9 chest tap and head stroke preserve fixed text, use one feedback slot and never deform the body',()=>{
 const e=createDirector({idle:false}),rest=e.snapshot().pose;
 assert.equal(e.send({type:'down',partId:'chest',pointerId:1,x:0.55}),true);tick(e,12);e.send({type:'up',pointerId:1});
 assert.equal(e.snapshot().bubble,'姆，弟弟你这个色鬼。');const id=e.snapshot().feedback.id;assert.deepEqual(e.snapshot().pose,rest);
 e.send({type:'down',pointerId:2,x:0.55});assert.equal(e.snapshot().bubble,null);e.send({type:'move',pointerId:2,x:0.4});tick(e,30);e.send({type:'up',pointerId:2});
 assert.equal(e.snapshot().bubble,'怎么突然模姐姐的头，是希望姐姐做什么呢。');assert.ok(e.snapshot().feedback.id>id);assert.deepEqual(e.snapshot().pose,rest);
 e.send({type:'down',partId:'chest',pointerId:3,x:0.55});e.send({type:'move',pointerId:3,x:0.8});e.send({type:'up',pointerId:3});assert.equal(e.snapshot().bubble,null,'drag is not a tap');
 e.send({type:'down',partId:'chest',pointerId:4,x:0.55});tick(e,100);e.send({type:'up',pointerId:4});assert.equal(e.snapshot().bubble,null,'long hold is not a tap');
 assert.equal(e.send({type:'down',partId:'unknown',pointerId:5,x:0.5}),false);
});
test('I9 cancel removes feedback including released recoil, without changing parent motion',()=>{
 const e=createDirector({idle:false});e.send({type:'grab-down',partId:'skirt-front',pointerId:1});e.send({type:'grab-move',pointerId:1,x:12,y:0});tick(e,20);
 e.send({type:'grab-cancel',pointerId:99});assert.ok(e.snapshot().bubble,'foreign cancel must not clear');
 e.send({type:'grab-up',pointerId:1});assert.ok(e.snapshot().bubble);e.cancelGrab();assert.equal(e.snapshot().bubble,null);
 tick(e,20);assert.equal(e.snapshot().bubble,null);
});
test('I9 valid hand/skirt start emits one feedback; held frames, release and recoil never refresh it',()=>{
 for(const partId of ['arm-screen-left','arm-screen-right','skirt-front','skirt-right']){
  const e=createDirector({idle:false});
  assert.equal(e.send({type:'grab-down',pointerId:1,partId}),true);assert.equal(e.snapshot().bubble,null);
  e.send({type:'grab-move',pointerId:99,x:12,y:0});assert.equal(e.snapshot().bubble,null);
  e.send({type:'grab-move',pointerId:1,x:12,y:0});
  const first=e.snapshot();assert.equal(first.bubble,partId.startsWith('arm-')?'想牵姐姐的手吗？那就轻轻握住吧。':'慢一点，姐姐的裙子可经不起这样拽哦。');
  assert.ok(first.feedback.id>0);assert.equal(first.feedback.text,first.bubble);
  for(let i=0;i<120;i++){e.send({type:'grab-move',pointerId:1,x:i%2?12:-12,y:1});e.advance(1/120);assert.equal(e.snapshot().feedback.id,first.feedback.id);}
  e.send({type:'grab-up',pointerId:1});assert.equal(e.snapshot().feedback.id,first.feedback.id);
  tick(e,300);assert.equal(e.snapshot().bubble,null);assert.equal(e.snapshot().feedback,undefined);
  e.send({type:'grab-down',pointerId:2,partId});e.send({type:'grab-move',pointerId:2,x:12,y:0});assert.ok(e.snapshot().feedback.id>first.feedback.id);
 }
});
