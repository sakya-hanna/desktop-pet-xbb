'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createHarness}=require('./helpers/interaction-fixtures.cjs');
test('color calibration covers both walking and turning, then leaves every standing material untouched',async()=>{
 const h=await createHarness({idle:false});
 try{
  for(const direction of ['left','right'])for(const phase of ['turn','walk','stop']){
   h.renderer.render({walk:{direction,phase,frame:0}},'3942');
   assert.equal(h.draws.length,1);
   assert.equal(h.draws[0].uniforms.u_walkColor,1);
  }
  h.renderer.render({},'3942');
  assert.ok(h.draws.length>10);
  assert.ok(h.draws.every(d=>d.uniforms.u_walkColor===0));
 }finally{h.runtime.destroy();}
});
