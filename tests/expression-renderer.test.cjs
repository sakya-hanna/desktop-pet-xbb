'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createHarness}=require('./helpers/interaction-fixtures.cjs');
test('I10 real renderer composites aligned premultiplied faces once and shares protection with shadows',async t=>{
 const h=await createHarness({idle:false});t.after(()=>h.runtime.destroy());
 h.renderer.render({},'3665',false,0.6,false,[{face:'3563',weight:0.4},{face:'3665',weight:0.6}]);
 const mixed=h.draws.filter(d=>d.texture==='expression-face');assert.equal(mixed.length,1);
 assert.equal(h.draws.filter(d=>/^baijie-(face|blink)-/.test(d.texture)).length,0);
 const m=mixed[0];assert.ok(m.pixels instanceof Uint8Array);
 const shadows=h.draws.filter(d=>d.uniforms.u_shadow===1);assert.equal(shadows.length,3);
 assert.ok(shadows.every(d=>d.bound[2]==='expression-face'));
 // CPU expected is independent bilinear premultiplied sampling at the union
 // material pixel center. Different face rect origins must not be stretched.
 const r=shadows[0].uniforms.u_faceRect;
 const sample=(name,face,x,y)=>{
  const image=h.load(name),fr=h.meta.character.faces[face],u=(x-fr.x)/fr.w,v=(y-fr.y)/fr.h;
  if(u<0||v<0||u>1||v>1)return [0,0,0,0];
  const px=u*image.width-0.5,py=v*image.height-0.5,ix=Math.floor(px),iy=Math.floor(py),fx=px-ix,fy=py-iy,out=[0,0,0,0];
  for(let j=0;j<2;j++)for(let i=0;i<2;i++){
   const k=(Math.max(0,Math.min(image.height-1,iy+j))*image.width+Math.max(0,Math.min(image.width-1,ix+i)))*4,a=image.data[k+3]/255,w=(i?fx:1-fx)*(j?fy:1-fy);
   for(let c=0;c<4;c++)out[c]+=w*(c===3?a:image.data[k+c]/255*a);
  }return out;
 };
 let checked=0;
 for(let y=0;y<m.height;y+=7)for(let x=0;x<m.width;x+=7){
  const expected=[0,0,0,0];for(const [face,w]of [['3563',0.4],['3665',0.6]]){
   const a=sample('baijie-face-'+face+'.png',face,r[0]+x+0.5,r[1]+y+0.5),b=sample(h.meta.blink.textures[face],face,r[0]+x+0.5,r[1]+y+0.5);
   // Blink assets are complete replacement faces with erased eye alpha.
   for(let c=0;c<4;c++)expected[c]+=w*(a[c]*(1-0.6)+b[c]*0.6);
  }
  for(let c=0;c<4;c++)assert.ok(Math.abs(m.pixels[(y*m.width+x)*4+c]-Math.round(expected[c]*255))<=1);checked++;
 }assert.ok(checked>50);
 h.renderer.render({},'3942',false,0,false);assert.ok(h.draws.some(d=>d.texture==='baijie-face-3942.png'),'five-argument caller remains direct');
 assert.deepEqual(h.errors,[]);
});
