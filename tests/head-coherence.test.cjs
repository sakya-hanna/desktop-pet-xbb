'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createHarness,load}=require('./helpers/interaction-fixtures.cjs');
const {parts}=require('../src/character.js'),{pickMaterial}=require('../src/hit-test.js');
// Replaces the rejected full-face <0.6-offset / crown-ratio / old pitch-geometry
// contracts. Four-action visible head/neck geometry is in layered-head-geometry.
test('actual fringe and left-curl root bands share the head surface, not just one anchor point',async()=>{
 const h=await createHarness({idle:false});let count=0,maxGap=0;
 for(const lookX of [-1.2,1.2]){
  h.renderer.render({referenceMotion:true,lookX,headRoll:.08,bodyRoll:-.018,hair:{fringe:[.04,.06,.08],'front-left':[.04,.06,.08]}},'3942',false,0,false);
  const head=h.draws.find(d=>d.texture===h.meta.head.skin);
  for(const id of ['fringe','front-left']){
   const spec=h.meta.front.parts.find(s=>s.name===id),part=parts[id],draw=h.draws.find(d=>d.texture===spec.texture),im=load(spec.texture);let used=0;
   for(let i=0;i<draw.rest.length;i+=2){
    const rest=[draw.rest[i],draw.rest[i+1]];if(rest[1]>part.rootLockY||rest[1]<part.root[1]-4)continue;
    const x=Math.max(0,Math.min(im.width-1,Math.floor(draw.uv[i]*im.width))),y=Math.max(0,Math.min(im.height-1,Math.floor(draw.uv[i+1]*im.height)));
    if(im.data[(y*im.width+x)*4+3]<16)continue;
    const expected=pickMaterial({rest:head.positions,indices:head.indices},head.rest,rest);assert.ok(expected);used++;count++;
    const gap=Math.hypot(draw.positions[i]-expected[0],draw.positions[i+1]-expected[1]);maxGap=Math.max(maxGap,gap);
    assert.ok(gap<.15,'root-band interpolation discontinuity: '+id+' '+gap);
   }
   assert.ok(used>0,'no actual alpha-supported root band sampled for '+id);
  }
 }
 console.log('HEAD_ROOT_BANDS '+JSON.stringify({count,maxGap}));h.runtime.destroy();
});
