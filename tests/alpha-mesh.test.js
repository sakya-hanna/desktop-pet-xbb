const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');
const target=path.join(__dirname,'../puppet/rig/js/alpha-mesh.js');
test('deformed mesh reports flipped triangles instead of accepting a finite but folded layer',()=>{
 const {measureDeformation}=require(target);
 assert.equal(typeof measureDeformation,'function','missing actual-mesh winding diagnostics');
 const m={rest:new Float32Array([0,0,8,0,0,8]),idx:new Uint16Array([0,1,2]),out:new Float32Array([1,1,9,1,1,9])};
 assert.equal(measureDeformation(m).flippedTriangles,0);
 m.out.set([0,0,0,8,8,0]);assert.equal(measureDeformation(m).flippedTriangles,1);
});

test('a thin hair inside a grid cell and edge pixels are never dropped',()=>{
 assert.ok(fs.existsSync(target),'missing pixel-complete alpha mesh');
 const {buildAlphaMesh}=require(target);
 const w=17,h=17,rgba=new Uint8ClampedArray(w*h*4);
 rgba[(4*w+4)*4+3]=1;rgba[(16*w+16)*4+3]=255;
 const m=buildAlphaMesh(rgba,w,h,8);
 assert.equal(m.idx.length,12);
 assert.ok(m.rest.every(Number.isFinite));
 assert.ok(m.uvs.every(x=>x>=0&&x<=1));
 assert.ok(Array.from(m.rest).includes(17));
 assert.equal(buildAlphaMesh(new Uint8ClampedArray(w*h*4),w,h,8).idx.length,0);
 assert.throws(()=>buildAlphaMesh(rgba,w,h,0));
});
