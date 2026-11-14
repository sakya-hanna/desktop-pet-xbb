'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createHarness}=require('./helpers/interaction-fixtures.cjs');
// Real source pixels, independently sampled into the renderer's material rect.
function sample(h,name,fr,x,y){
 const im=h.load(name),u=(x-fr.x)/fr.w,v=(y-fr.y)/fr.h,out=[0,0,0,0];
 if(u<0||v<0||u>1||v>1)return out;
 const px=u*im.width-.5,py=v*im.height-.5,ix=Math.floor(px),iy=Math.floor(py),fx=px-ix,fy=py-iy;
 for(let j=0;j<2;j++)for(let i=0;i<2;i++){
  const k=(Math.max(0,Math.min(im.height-1,iy+j))*im.width+Math.max(0,Math.min(im.width-1,ix+i)))*4,a=im.data[k+3]/255,w=(i?fx:1-fx)*(j?fy:1-fy);
  for(let c=0;c<4;c++)out[c]+=w*(c===3?a:im.data[k+c]/255*a);
 }return out;
}
function verify(h,weights,amount){
 const layer=h.draws.find(d=>d.texture==='expression-face');assert.ok(layer,'one replacement face is drawn');
 assert.equal(h.draws.filter(d=>d.texture?.startsWith('baijie-face-')||d.texture?.startsWith('baijie-blink-')).length,0,'no open face underneath the replacement');
 const x0=Math.min(...Array.from(layer.rest).filter((_,i)=>i%2===0)),y0=Math.min(...Array.from(layer.rest).filter((_,i)=>i%2===1));
 let cleared=0;
 for(let y=0;y<layer.height;y++)for(let x=0;x<layer.width;x++){
  const expected=[0,0,0,0];
  for(const p of weights){
   const fr=h.meta.character.faces[p.face],base=sample(h,'baijie-face-'+p.face+'.png',fr,x0+x+.5,y0+y+.5),name=h.meta.blink.textures[p.face];
   const closed=name?sample(h,name,fr,x0+x+.5,y0+y+.5):base;
   if(base[3]>.95&&closed[3]<.05)cleared++;
   for(let c=0;c<4;c++)expected[c]+=p.weight*(base[c]*(1-amount)+closed[c]*amount);
  }
  const k=(y*layer.width+x)*4;
  for(let c=0;c<4;c++)assert.ok(Math.abs(layer.pixels[k+c]-Math.round(expected[c]*255))<=1,`face ${weights.map(p=>p.face)} blink=${amount} pixel ${x},${y} channel ${c}: actual=${layer.pixels[k+c]}, expected=${Math.round(expected[c]*255)}`);
 }
 assert.ok(cleared>50,'fixture includes erased iris/eye-white pixels, not just lash lines');
}
test('full blink replaces all nine open-eye faces, including transparent iris holes',async()=>{
 const h=await createHarness({idle:false});
 for(const face of Object.keys(h.meta.blink.textures)){
  const weights=[{face,weight:1}];h.renderer.render({},face,false,1,true,weights);verify(h,weights,1);
 }
});
test('partial blink selects one eye pose while changing expressions still blend once',async()=>{
 const h=await createHarness({idle:false});
 for(const amount of [.25,.6,1]){
  const weights=[{face:'3942',weight:.4},{face:'3901',weight:.6}];
  h.renderer.render({lookX:.8,headRoll:.02},'3901',false,amount,true,weights);verify(h,weights,amount<.5?0:1);
 }
 const weights=[{face:'3942',weight:.5},{face:'3625',weight:.5}];
 h.renderer.render({},'3625',false,1,true,weights);verify(h,weights,1);
});
test('unweighted renderer blink also replaces the face; no-blink faces remain unchanged',async()=>{
 const h=await createHarness({idle:false});
 h.renderer.render({},'3942',false,1);verify(h,[{face:'3942',weight:1}],1);
 for(const face of h.meta.blink.noBlink.map(String)){
  h.renderer.render({},face,false,0,true,[{face,weight:1}]);const before=h.draws.map(d=>d.texture);
  h.renderer.render({},face,false,1,true,[{face,weight:1}]);
  assert.deepEqual(h.draws.map(d=>d.texture),before,`naturally closed/comic face ${face} is unchanged`);
 }
 h.renderer.render({},'3942',false,0,true,[{face:'3942',weight:1}]);
 assert.ok(h.draws.some(d=>d.texture==='baijie-face-3942.png'),'reopening uses exact original face');
});
