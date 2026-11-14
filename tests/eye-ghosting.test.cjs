'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createHarness}=require('./helpers/interaction-fixtures.cjs');
// Check visible pigment, not a duplicate of the renderer's blending equation.
// These points cover the irises above/below the closed lashes in material space.
function ghostCount(h,reference){
 const layer=h.draws.find(d=>d.texture==='expression-face');assert.ok(layer);
 const x0=Math.min(...Array.from(layer.rest).filter((_,i)=>i%2===0)),y0=Math.min(...Array.from(layer.rest).filter((_,i)=>i%2===1));
 let blue=0;
 for(let y=0;y<layer.height;y++)for(let x=0;x<layer.width;x++){
  const X=x0+x+.5,Y=y0+y+.5;
  if(!((X>=260&&X<=286)||(X>=312&&X<=337))||Y<86||Y>109)continue;
  const k=(y*layer.width+x)*4;
  // The character's closed lashes themselves contain blue-violet ink.
  // Count added iris pigment relative to the fully closed authored endpoint.
  const baseline=reference[k+2]-reference[k];
  if(layer.pixels[k+2]-layer.pixels[k]-baseline>8&&layer.pixels[k+3]>8)blue++;
 }
 return blue;
}
test('sustained closure and closed-expression transitions never show blue iris through closed lashes',async()=>{
 const h=await createHarness({idle:false});
 h.renderer.render({},'3942',false,1,true,[{face:'3942',weight:1}]);
 const baseline=new Uint8Array(h.draws.find(d=>d.texture==='expression-face').pixels);
 h.renderer.render({},'3942',false,.1,true,[{face:'3942',weight:1}]);assert.ok(ghostCount(h,baseline)>50,'positive control sees the actual painted blue iris');
 for(const amount of [.5,.6,.9,1]){
  h.renderer.render({},'3942',false,amount,true,[{face:'3942',weight:1}]);
  assert.equal(ghostCount(h,baseline),0,'blink '+amount+' must remove iris, not just reduce its opacity');
 }
 for(const closed of ['3625','9001']){
  h.renderer.render({},closed,false,1,true,[{face:'3942',weight:.5},{face:closed,weight:.5}]);
  const reference=new Uint8Array(h.draws.find(d=>d.texture==='expression-face').pixels);
  h.renderer.render({},closed,false,.1,true,[{face:'3942',weight:.5},{face:closed,weight:.5}]);
  assert.equal(ghostCount(h,reference),0,'closed expression '+closed+' must not crossfade a translucent iris');
 }
});
