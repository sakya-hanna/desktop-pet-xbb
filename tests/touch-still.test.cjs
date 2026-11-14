'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {createDirector}=require('../src/director.js');

test('head contact, direction changes, hold and release never add a deformation pose',()=>{
  const engine=createDirector({idle:false,seed:17}),rest=engine.snapshot().pose;
  assert.equal(engine.send({type:'down',pointerId:6,x:0.55}),true);
  assert.equal(engine.send({type:'move',pointerId:6,x:0.4}),true);
  for(let i=0;i<720;i++){
    if(i===90)engine.send({type:'move',pointerId:6,x:0.7});
    if(i===180)engine.send({type:'move',pointerId:6,x:0.4});
    if(i===210){assert.equal(engine.send({type:'up',pointerId:99}),false);assert.equal(engine.snapshot().pointerId,6);}
    if(i===360){
      assert.equal(engine.send({type:'up',pointerId:6}),true);
      assert.equal(engine.snapshot().completedGestures,1);
      assert.equal(engine.snapshot().bubble,'怎么突然模姐姐的头，是希望姐姐做什么呢。');
    }
    const state=engine.advance(1/120);
    assert.deepEqual(state.pose,rest,'Touch added head/body/hair movement at fixed step '+i);
  }
  assert.equal(engine.snapshot().pointerId,null);
});

test('touch does not reset, pause or reseed the normal idle pose or blink timeline',()=>{
  const engine=createDirector({idle:true,seed:17}),control=createDirector({idle:true,seed:17});
  const events=new Map([
    [200,{type:'down',pointerId:1,x:0.55}], [230,{type:'move',pointerId:1,x:0.4}], [350,{type:'up',pointerId:1}],
    [400,{type:'down',pointerId:2,x:0.55}], [440,{type:'move',pointerId:2,x:0.7}], [600,{type:'cancel',pointerId:2}],
    [1000,{type:'down',pointerId:3,x:0.55}], [1080,{type:'move',pointerId:3,x:0.4}], [1200,{type:'move',pointerId:3,x:0.7}], [1400,{type:'up',pointerId:3}],
  ]);
  for(let i=0;i<2400;i++){
    if(events.has(i))assert.equal(engine.send(events.get(i)),true);
    const actual=engine.advance(1/120),untouched=control.advance(1/120);
    assert.deepEqual(actual.pose,untouched.pose,'Touch changed normal idle motion at fixed step '+i);
    assert.equal(actual.blink,untouched.blink,'Touch changed idle blink scheduling');
  }
  assert.equal(engine.snapshot().completedGestures,2);
  assert.equal(engine.snapshot().pointerId,null);
});

// Captured by tools/record-untouched-baseline.cjs BEFORE the production change.
// Hashes cover every complete snapshot, not only a chosen head channel.
const unchanged={
  'false-false':'fb9e888d923c3e03186965eb50f90b09624409dd8b7c856a08fefa9d4ae177fe',
  'false-true':'d0160e6b481358740b127ef8ed324ad9167bcfcb4aea33ac1ae561ecccd634d8',
  'true-false':'de1e344e0d4698bacf87606482bc9cae2524a3c541adc65dd4fd7e93617871a4',
  'true-true':'b9e3fb7037f5615e367caab356c71a45e5f7759c0f0f3bd760aa5edf402e9e04',
};
for(const idle of [false,true])for(const jump of [false,true])test(`idle=${idle} jump=${jump}: preserve untouched quiet/jump behavior while allowing the authorized head retiming`,()=>{
  const engine=createDirector({idle,seed:17}),quiet=createDirector({idle:false,seed:17}),hash=crypto.createHash('sha256');
  for(let i=0;i<2400;i++){
    if(jump&&(i===120||i===1200)){assert.equal(engine.send({type:'jump'}),true);assert.equal(quiet.send({type:'jump'}),true);}
    const actual=engine.advance(1/120),control=quiet.advance(1/120);
    if(!idle)hash.update(JSON.stringify(actual)+'\n');
    else{
      for(const key of ['hop','compression','headY'])assert.equal(actual.pose[key],control.pose[key],'idle head retiming must not change '+key);
      assert.equal(actual.completedJumps,control.completedJumps);assert.equal(actual.pointerId,null);assert.equal(actual.bubble,null);
    }
  }
  if(!idle)assert.equal(hash.digest('hex'),unchanged[`${idle}-${jump}`]);
});
