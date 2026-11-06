const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const target=path.join(__dirname,'../puppet/rig/js/hair-motion.js');
test('independent lock bends around its fixed root without stretching radial distance',()=>{
 assert.ok(fs.existsSync(target),'missing independent hair motion');
 const {bendLock}=require(target);
 const part={root:[199,194],start:220,end:475};
 const rest=new Float32Array([199,194,200,215,100,475]);
 const output=new Float32Array(rest.length);
 bendLock(rest,part,0,output);
 assert.deepEqual(output,rest);
 bendLock(rest,part,0.055,output);
 assert.deepEqual(Array.from(output.slice(0,4)),Array.from(rest.slice(0,4)));
 const before=Math.hypot(rest[4]-199,rest[5]-194);
 const after=Math.hypot(output[4]-199,output[5]-194);
 assert.ok(Math.abs(before-after)<0.001);
 assert.ok(Math.abs(output[4]-rest[4])>10,'visible independent tip displacement');
 for(const angle of [NaN,Infinity,-Infinity,1e9,-1e9]){
   bendLock(rest,part,angle,output);
   assert.ok(output.every(Number.isFinite));
 }
});
