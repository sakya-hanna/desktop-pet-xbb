const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const target=path.join(__dirname,'../puppet/rig/js/character-hit.js');
const view={s:1,ox:0,oy:0};
test('rejects nonfinite screen coordinates and nonpositive or nonfinite scales',()=>{
 const {makeLayer,hit}=require(target);
 const layer=makeLayer(quad(),rgbaFrom([255]),1,1);
 for(const s of [-1,0,NaN,Infinity,-Infinity])assert.equal(hit([layer],-1,-1,{s,ox:0,oy:0}),false,`scale ${s}`);
 for(const n of [NaN,Infinity,-Infinity]){
  assert.equal(hit([layer],n,1,view),false);
  assert.equal(hit([layer],1,n,view),false);
 }
});
test('deformed vertices remain live while source alpha is captured',()=>{
 const {makeLayer,hit}=require(target);
 const mesh=quad(),rgba=rgbaFrom([255]);
 const layer=makeLayer(mesh,rgba,1,1);
 rgba[3]=0;
 assert.equal(hit([layer],1,1,view),true);
 for(let i=0;i<mesh.out.length;i+=2){mesh.out[i]+=10;mesh.out[i+1]+=20;}
 assert.equal(hit([layer],1,1,view),false);
 assert.equal(hit([layer],11,21,view),true);
 mesh.out=new Float32Array([20,30,24,30,24,34,20,34]);
 assert.equal(hit([layer],21,31,view),true);
});
test('scaled CSS coordinates with negative origins map into world space',()=>{
 const {makeLayer,hit}=require(target);
 const layer=makeLayer(quad(),rgbaFrom([255]),1,1);
 assert.equal(hit([layer],-6,-16,{s:2,ox:-10,oy:-20}),true);
 assert.equal(hit([layer],0,-16,{s:2,ox:-10,oy:-20}),false);
});
test('reversed winding and shared triangle edges are accepted',()=>{
 const {makeLayer,hit}=require(target);
 const mesh=quad();mesh.idx.set([2,1,0,3,2,0]);
 const layer=makeLayer(mesh,rgbaFrom([255]),1,1);
 for(const [x,y] of [[1,2],[2,1],[2,2],[0,0],[4,4]])assert.equal(hit([layer],x,y,view),true);
});
test('outside triangle and degenerate triangles never hit',()=>{
 const {makeLayer,hit}=require(target);
 const mesh=quad();mesh.idx=new Uint16Array([0,1,2]);
 const layer=makeLayer(mesh,rgbaFrom([255]),1,1);
 for(const [x,y] of [[-0.01,1],[4.01,1],[1,-0.01],[1,4.01],[1,3]])assert.equal(hit([layer],x,y,view),false);
 mesh.out.set([0,0,2,2,4,4,0,4]);
 assert.equal(hit([layer],2,2,view),false);
 mesh.out.fill(1);
 assert.equal(hit([layer],1,1,view),false);
});
test('body and hair form a union even when another layer is transparent',()=>{
 const {makeLayer,hit}=require(target);
 const body=makeLayer(quad(),rgbaFrom([255]),1,1);
 const hairMesh=quad();
 for(let i=0;i<hairMesh.out.length;i+=2)hairMesh.out[i]+=6;
 const hair=makeLayer(hairMesh,rgbaFrom([255]),1,1);
 const blank=makeLayer(quad(12,12),rgbaFrom([0]),1,1);
 assert.equal(hit([blank,body,hair],2,2,view),true);
 assert.equal(hit([blank,body,hair],8,2,view),true);
 assert.equal(hit([body,hair,blank],2,2,view),true);
 assert.equal(hit([body,hair],5,2,view),false);
 assert.equal(hit([],2,2,view),false);
});
test('browser global and AMD expose the same public API',()=>{
 const vm=require('node:vm'),source=fs.readFileSync(target,'utf8');
 const browser={};vm.runInNewContext(source,browser);
 for(const name of ['makeLayer','hit','pick','sampleAlpha'])assert.equal(typeof browser.CharacterHit[name],'function');
 let amd;
 const define=(deps,factory)=>{amd=factory();};define.amd={};
 vm.runInNewContext(source,{define});
 for(const name of ['makeLayer','hit','pick','sampleAlpha'])assert.equal(typeof amd[name],'function');
});
test('pick interpolates full world rest coordinates from the live deformed triangle',()=>{
 const {makeLayer,pick}=require(target);
 const mesh=quad();
 mesh.rest=new Float32Array([100,200,108,200,112,212,100,212]);
 mesh.out.set([10,20,18,20,22,32,10,32]);
 const layer=makeLayer(mesh,rgbaFrom([255]),1,1);layer.part='face';
 assert.deepEqual(pick([layer],15,23,view),{x:105,y:203,layer,part:'face'});
 assert.equal(pick([layer],1,1,view),null);
 mesh.out.set([20,30,28,30,32,42,20,42]);
 assert.equal(pick([layer],15,23,view),null);
 assert.deepEqual(pick([layer],25,33,view),{x:105,y:203,layer,part:'face'});
});
test('pick maps scaled CSS coordinates with negative origins into rest world space',()=>{
 const {makeLayer,pick}=require(target);
 const mesh=quad();mesh.rest=new Float32Array([100,200,108,200,108,208,100,208]);
 const layer=makeLayer(mesh,rgbaFrom([255]),1,1);
 assert.deepEqual(pick([layer],-8,-16,{s:2,ox:-10,oy:-20}),{x:102,y:204,layer,part:undefined});
 assert.equal(pick([layer],0,-16,{s:2,ox:-10,oy:-20}),null);
});
test('pick selects the last drawn opaque layer and passes through transparent top layers',()=>{
 const {makeLayer,pick}=require(target);
 const mesh=quad();mesh.rest=mesh.out;
 const body=makeLayer(mesh,rgbaFrom([255]),1,1);body.part={name:'body'};
 const hair=makeLayer(mesh,rgbaFrom([255]),1,1);hair.part={name:'hair'};
 assert.equal(pick([body,hair],1,2,view).layer,hair);
 assert.equal(pick([body,hair],1,2,view).part,hair.part);
 assert.equal(pick([hair,body],1,2,view).layer,body);
 hair.alpha[0]=0;
 assert.equal(pick([body,hair],1,2,view).layer,body);
 assert.equal(pick([hair],1,2,view),null);
});
test('pick requires rest coordinates while hit still accepts meshes without rest',()=>{
 const {makeLayer,hit,pick}=require(target);
 const mesh=quad(),layer=makeLayer(mesh,rgbaFrom([255]),1,1);
 assert.equal(hit([layer],1,2,view),true);
 assert.equal(pick([layer],1,2,view),null);
 mesh.rest=new Float32Array([0,0]);
 assert.equal(pick([layer],1,2,view),null);
 mesh.rest=null;
 assert.equal(pick([layer],1,2,view),null);
});
test('pick rejects invalid inputs and nonfinite or degenerate surfaces',()=>{
 const {makeLayer,pick}=require(target);
 const mesh=quad();mesh.rest=new Float32Array(mesh.out);
 const layer=makeLayer(mesh,rgbaFrom([255]),1,1);
 for(const s of [-1,0,NaN,Infinity,-Infinity])assert.equal(pick([layer],-1,-1,{s,ox:0,oy:0}),null,`scale ${s}`);
 for(const n of [NaN,Infinity,-Infinity]){
  assert.equal(pick([layer],n,1,view),null);
  assert.equal(pick([layer],1,n,view),null);
  assert.equal(pick([layer],1,1,{s:1,ox:n,oy:0}),null);
  assert.equal(pick([layer],1,1,{s:1,ox:0,oy:n}),null);
  mesh.rest.fill(n);
  assert.equal(pick([layer],1,2,view),null,`rest ${n}`);
  mesh.rest.set([0,0,4,0,4,4,0,4]);
  mesh.out.fill(n);
  assert.equal(pick([layer],1,2,view),null,`out ${n}`);
  mesh.out.set(mesh.rest);
 }
 mesh.out.set([0,0,2,2,4,4,6,6]);
 assert.equal(pick([layer],2,2,view),null);
 assert.equal(pick([],1,2,view),null);
});
test('pick respects alpha holes and the existing inclusive LINEAR threshold',()=>{
 const {makeLayer,pick}=require(target);
 const mesh=quad();mesh.rest=mesh.out;
 const body=makeLayer(mesh,rgbaFrom([255]),1,1);
 const hair=makeLayer(mesh,rgbaFrom([255,255,255,255,255,0,0,255,255,0,0,255,255,255,255,255]),4,4);
 assert.equal(pick([hair],2,2,view),null);
 assert.equal(pick([body,hair],2,2,view).layer,body);
 assert.equal(pick([body,hair],0.5,0.5,view).layer,hair);
 const edgeMesh=quad(2,1);edgeMesh.rest=edgeMesh.out;
 const edge=makeLayer(edgeMesh,rgbaFrom([16,0]),2,1);
 assert.deepEqual(pick([edge],1,0.5,view),{x:1,y:0.5,layer:edge,part:undefined});
 assert.equal(pick([edge],1.01,0.5,view),null);
});
test('pick keeps rest aliases and replacements live without snapshotting',()=>{
 const {makeLayer,pick}=require(target);
 const mesh=quad(),rest=new Float32Array(mesh.out);mesh.rest=rest;
 const layer=makeLayer(mesh,rgbaFrom([255]),1,1);
 assert.equal(layer.mesh.rest,rest);
 assert.deepEqual(pick([layer],1,2,view),{x:1,y:2,layer,part:undefined});
 for(let i=0;i<rest.length;i+=2){rest[i]+=100;rest[i+1]+=200;}
 assert.deepEqual(pick([layer],1,2,view),{x:101,y:202,layer,part:undefined});
 mesh.rest=new Float32Array([20,30,24,30,24,34,20,34]);
 assert.deepEqual(pick([layer],1,2,view),{x:21,y:32,layer,part:undefined});
 mesh.out=new Float32Array([10,20,14,20,14,24,10,24]);
 assert.equal(pick([layer],1,2,view),null);
 assert.deepEqual(pick([layer],11,22,view),{x:21,y:32,layer,part:undefined});
 mesh.idx.set([2,1,0,3,2,0]);
 assert.deepEqual(pick([layer],12,22,view),{x:22,y:32,layer,part:undefined});
});
function quad(w=4,h=4){
 return {out:new Float32Array([0,0,w,0,w,h,0,h]),idx:new Uint16Array([0,1,2,0,2,3]),uvs:new Float32Array([0,0,1,0,1,1,0,1])};
}
function rgbaFrom(alpha){
 const rgba=new Uint8ClampedArray(alpha.length*4);
 alpha.forEach((a,i)=>{rgba[i*4+3]=a;});
 return rgba;
}
test('visible texels hit but transparent holes inside coarse triangles do not',()=>{
 assert.ok(fs.existsSync(target),'missing CharacterHit implementation');
 const {makeLayer,hit}=require(target);
 const layer=makeLayer(quad(),rgbaFrom([255,255,255,255,255,0,0,255,255,0,0,255,255,255,255,255]),4,4);
 assert.equal(hit([layer],0.5,0.5,view),true);
 assert.equal(hit([layer],2,2,view),false);
});
test('LINEAR sampling preserves thin alpha edges with an inclusive eight-byte threshold',()=>{
 const {makeLayer,hit,sampleAlpha}=require(target);
 const layer=makeLayer(quad(2,1),rgbaFrom([16,0]),2,1);
 assert.equal(sampleAlpha(layer,0.5,0.5),8);
 assert.equal(hit([layer],1,0.5,view),true);
 assert.equal(hit([layer],1.01,0.5,view),false);
 assert.equal(sampleAlpha(layer,-2,-3),16);
 assert.equal(sampleAlpha(layer,2,3),0);
 const vertical=makeLayer(quad(1,2),rgbaFrom([0,32]),1,2);
 assert.equal(sampleAlpha(vertical,0.5,0.5),16);
 const square=makeLayer(quad(2,2),rgbaFrom([0,0,0,64]),2,2);
 assert.equal(sampleAlpha(square,0.5,0.5),16);
});
