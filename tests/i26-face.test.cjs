'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const rig=require('../src/material-rig.js'),{binding,materials}=require('../src/character.js');
// Measure the painted eye extents; do not require the retired affine islands.
test('near and far eyes change width oppositely on one continuous face surface',()=>{
 const pairs=[[[258,97],[286,97]],[[309,97],[337,97]]];
 for(const lookX of [-1.2,-.6,0,.6,1.2]){
  const pose={referenceMotion:true,lookX},out=p=>rig.deformPoint(p,pose,binding,materials.head);
  const widths=[];
  for(let side=0;side<2;side++){
   const [a,b]=pairs[side],pa=out(a),pb=out(b),width=(pb[0]-pa[0])/(b[0]-a[0]);widths.push(width);
   assert.ok(width>.75&&width<1.25,'eye width outside the character envelope');
   assert.equal(pb[1]-pa[1],0);
  }
  if(lookX){assert.ok((widths[0]-1)*lookX>0&&(widths[1]-1)*lookX<0,'turn must preserve near/far perspective');}
  else assert.deepEqual(widths,[1,1]);
 }
});
