const {test}=require('node:test');const assert=require('node:assert/strict');const hair=require('../puppet/rig/js/hair-motion.js');
test('independent hair inherits root skirt motion only at the attachment, never at its tips',()=>{
 assert.equal(typeof hair.isolateLockWeights,'function','missing material-specific independent lock weights');
 const rest=new Float32Array([410,216,410,247,480,259,480,287,480,438]);
 const W={n:5,head:new Float32Array([1,1,0,0,0]),skirt:new Float32Array([0,0.1,0.2,0.8,1])};
 const out=hair.isolateLockWeights(W,rest,{start:247});
 assert.deepEqual(Array.from(out.skirt),[0,Math.fround(0.1),Math.fround(0.2),0,0]);
 assert.equal(out.head,W.head);assert.notEqual(out.skirt,W.skirt);
 assert.deepEqual(Array.from(W.skirt),[0,Math.fround(0.1),Math.fround(0.2),Math.fround(0.8),1]);
});
