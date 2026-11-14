'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createDirector}=require('../src/director.js');
const tick=(e,n)=>{for(let i=0;i<n;i++)e.advance(1/120);};
const tap=e=>{e.send({type:'down',partId:'chest',pointerId:1,x:0.5});tick(e,12);e.send({type:'up',pointerId:1});};
test('chest reply composes brief surprise then the new shy face and restores independently of the bubble',()=>{
 const e=createDirector({idle:false}),base=e.snapshot();tap(e);
 assert.equal(e.snapshot().expression?.semantic,'surprised');
 assert.equal(e.snapshot().expression.face,'3563');assert.equal(e.snapshot().expression.id,e.snapshot().feedback.id);
 assert.equal(e.snapshot().face,base.face,'base expression remains independently owned');
 assert.deepEqual(e.snapshot().pose,base.pose,'no chest/head geometry added');
 tick(e,48);assert.equal(e.snapshot().expression.semantic,'shy');assert.equal(e.snapshot().expression.face,'9002');
 tick(e,240);assert.equal(e.snapshot().expression,null);assert.ok(e.snapshot().bubble,'face may recover before speech expires');
 tick(e,180);assert.equal(e.snapshot().bubble,null);assert.equal(e.snapshot().expression,null);
});
test('I11 both hands and skirts hold through contact and recover after release without new speech',()=>{
 for(const partId of ['arm-screen-left','arm-screen-right','skirt-front','skirt-right']){
  const e=createDirector({idle:false});
  e.send({type:'grab-down',partId,pointerId:1});assert.equal(e.snapshot().expression??null,null);
  e.send({type:'grab-move',pointerId:1,x:8,y:0});const first=e.snapshot();
  assert.equal(first.expression.kind,partId.startsWith('arm-')?'hand':'skirt');
  assert.equal(first.expression.semantic,partId.startsWith('arm-')?'shy':'awkward');
  tick(e,24);e.send({type:'grab-up',pointerId:1});
  assert.equal(e.snapshot().expression.phase,'recover');assert.equal(e.snapshot().expression.semantic,partId.startsWith('arm-')?'gentle':first.expression.semantic);
  assert.deepEqual(e.snapshot().feedback,first.feedback,'release does not speak again or change expiry');
  tick(e,84);assert.equal(e.snapshot().expression,null);assert.ok(e.snapshot().bubble);
  e.send({type:'grab-down',partId,pointerId:2});e.send({type:'grab-move',pointerId:2,x:8,y:0});
  for(let i=0;i<300;i++){e.send({type:'grab-move',pointerId:2,x:i%2?8:-8,y:0});e.advance(1/120);}
  assert.equal(e.snapshot().expression.phase,'hold','gesture keeps the final expression without a new event');
  e.send({type:'grab-up',pointerId:2});assert.equal(e.snapshot().expression.phase,'recover');tick(e,84);assert.equal(e.snapshot().expression,null);
 }
});
test('I10 new contact replaces old expression; pending, foreign cancel and cancellation remain distinct',()=>{
 const e=createDirector({idle:false});tap(e);assert.ok(e.snapshot().expression);
 e.send({type:'grab-down',partId:'skirt-front',pointerId:2});assert.equal(e.snapshot().expression,null,'a new pending contact retires the old response');
 e.send({type:'grab-move',pointerId:2,x:8,y:0});const first=e.snapshot().expression;
 e.send({type:'grab-cancel',pointerId:99});assert.deepEqual(e.snapshot().expression,first);
 e.send({type:'grab-cancel',pointerId:2});assert.equal(e.snapshot().expression,null);assert.equal(e.snapshot().bubble,null);
 tick(e,600);assert.equal(e.snapshot().expression,null);
 tap(e);e.send({type:'down',partId:'head',pointerId:3,x:0.5});e.send({type:'cancel',pointerId:3});assert.equal(e.snapshot().expression,null);
});
test('I10 legacy head response smiles then enjoys without disturbing idle movement or blink',()=>{
 const e=createDirector({idle:true,seed:17}),control=createDirector({idle:true,seed:17});
 e.send({type:'down',partId:'head',pointerId:1,x:0.5});
 e.send({type:'move',pointerId:1,x:0.6});
 for(let i=0;i<36;i++){e.advance(1/120);control.advance(1/120);}
 e.send({type:'up',pointerId:1});
 assert.equal(e.snapshot().expression.semantic,'smile');assert.equal(e.snapshot().bubble,'怎么突然模姐姐的头，是希望姐姐做什么呢。');
 const id=e.snapshot().feedback.id;
 for(let i=0;i<300;i++){
  const state=e.advance(1/120),base=control.advance(1/120);
  assert.deepEqual(state.pose,base.pose);assert.equal(state.blink,base.blink);
  if(i===72)assert.equal(state.expression.semantic,'enjoy');
  if(i===240)assert.equal(state.expression,null);
  assert.equal(state.feedback.id,id,'face stages never produce another line');
 }
});
test('I11 release starts its own brief recovery; snapshots cannot mutate internal response',()=>{
 const e=createDirector({idle:false});e.send({type:'grab-down',partId:'skirt-front',pointerId:1});e.send({type:'grab-move',pointerId:1,x:8,y:0});
 e.snapshot().expression.semantic='mutated';assert.equal(e.snapshot().expression.semantic,'awkward');
 tick(e,228);e.send({type:'grab-up',pointerId:1});assert.equal(e.snapshot().expression.phase,'recover');
 tick(e,24);assert.equal(e.snapshot().expression.semantic,'pout','post-release hold does not inherit the old deadline');
 tick(e,60);assert.equal(e.snapshot().expression,null);
 e.clearFeedback();tick(e,120);assert.equal(e.snapshot().bubble,null);assert.equal(e.snapshot().expression,null);
});
