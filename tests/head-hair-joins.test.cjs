'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const rig=require('../src/material-rig.js'),ch=require('../src/character.js'),{createMotion}=require('../src/reference-motion.js');
const {createHarness,load}=require('./helpers/interaction-fixtures.cjs');
test('pat keeps a centered downward attitude for either stroke direction',()=>{
 for(const side of [-1,1]){
  const m=createMotion({binding:ch.binding,idle:false}),base=createMotion({binding:ch.binding,idle:false});
  for(let i=0;i<480;i++){m.step(1/120,true,i>=240?{x:side*220,y:80}:null);base.step(1/120,true);}
  const p=m.snapshot().pose,b=base.snapshot().pose,roll=(p.headRoll-b.headRoll)*side,shift=(p.headX-b.headX)*800*side;
  assert.ok(Math.abs(p.headRoll)<1e-5,'held head should not sway');assert.ok(Math.abs(p.headX)<1e-7,'held head should not translate sideways');
  assert.ok(p.lookY-b.lookY>.6,'downward acceptance must remain');
 }
});
test('real side-hair cut samples share one field and matching uploaded meshes, including the old large tilt',async t=>{
 const h=await createHarness({idle:false});t.after(()=>h.runtime.destroy());
 const head=load(h.meta.head.cover),body=load(h.meta.head.torso),source=load('baijie-arms-skirts-body.png'),seams=[];
 const px=(im,x,y)=>Array.from(im.data.slice((y*im.width+x)*4,(y*im.width+x)*4+4));
 for(let y=120;y<175;y++)for(let x=220;x<365;x++){
  const a=px(head,x,y);if(a[3]<250||x>275&&x<327)continue;
  for(const [dx,dy]of [[1,0],[-1,0],[0,1],[0,-1]]){
   const nx=x+dx,ny=y+dy,b=px(source,nx,ny),o=px(source,x,y);
   if(px(head,nx,ny)[3]||px(body,nx,ny)[3]<250||b[3]<250||Math.hypot(...o.slice(0,3).map((v,k)=>v-b[k]))>45)continue;
   if(b[2]-b[0]>12&&ny>=139&&ny<166&&nx>258&&nx<337||b[0]-b[2]+.5*(b[0]-b[1])>45)continue;
   seams.push([nx+.5,ny+.5]);
  }
 }
 assert.ok(seams.length>100,'inspect actual hair cuts, not just named roots');
 function uploaded(draw,p){
  for(let n=0;n<draw.indices.length;n+=3){
   const ids=Array.from(draw.indices.slice(n,n+3)),q=ids.map(i=>[draw.rest[i*2],draw.rest[i*2+1]]),[a,b,c]=q;
   const det=(b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1]);
   const u=((b[1]-c[1])*(p[0]-c[0])+(c[0]-b[0])*(p[1]-c[1]))/det,v=((c[1]-a[1])*(p[0]-c[0])+(a[0]-c[0])*(p[1]-c[1]))/det,w=1-u-v;
   if(Math.min(u,v,w)>=-1e-7)return [0,1].map(axis=>[u,v,w].reduce((s,k,i)=>s+k*draw.positions[ids[i]*2+axis],0));
  }throw Error('seam outside mesh');
 }
 let maxGap=0;
 for(const side of [-1,1]){
  const p={referenceMotion:true,headRoll:side*.124,headX:side*.0085,headY:.0016,lookY:.825,lookX:side*1.2};
  h.renderer.render(p,'3625',false,0,false);const hd=h.draws.find(d=>d.texture===h.meta.head.skin),bd=h.draws.find(d=>d.texture===h.meta.head.torso);
  for(const rest of seams){
   const a=rig.deformPoint(rest,p,ch.binding,ch.materials.head),b=rig.deformPoint(rest,p,ch.binding,ch.materials.torso);
   assert.ok(Math.hypot(a[0]-b[0],a[1]-b[1])<1e-7,'cut keeps inconsistent material identity '+rest);
   const x=uploaded(hd,rest),y=uploaded(bd,rest);maxGap=Math.max(maxGap,Math.hypot(x[0]-y[0],x[1]-y[1]));
  }
  const unjoined={...ch.binding,headSupport:undefined};
  for(const rest of [[298,180],[280,205],[315,205],[265,260]])assert.deepEqual(rig.deformPoint(rest,p,ch.binding,ch.materials.torso),rig.deformPoint(rest,p,unjoined,ch.materials.torso),'central neck/chest must keep its original field');
  for(const part of Object.values(ch.grabs).filter(p=>!p.hairGrab))assert.deepEqual(rig.deformPoint([260,160],p,ch.binding,part,[1,0,0]),rig.deformPoint([260,160],p,unjoined,part,[1,0,0]),'arm/skirt ownership must remain unchanged');
 }
 assert.ok(maxGap<.35,'uploaded cut gap '+maxGap);console.log('SIDE_HAIR_CUT '+JSON.stringify({samples:seams.length,maxGap}));
});
