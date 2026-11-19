'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createHarness,load}=require('./helpers/interaction-fixtures.cjs');
const rig=require('../src/material-rig.js'),{binding,materials,parts}=require('../src/character.js');
const {createDirector}=require('../src/director.js'),{catalog}=require('../src/reference-motion.js');
const area=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
const point=(a,i)=>[a[2*i],a[2*i+1]];
function alpha(im,x,y){return x<0||y<0||x>=im.width||y>=im.height?0:im.data[(Math.floor(y)*im.width+Math.floor(x))*4+3];}
// Shared capability extremes and the actual reauthorized turn both matter.
function* poses(){
 for(const side of [-1,1]){
  const d=createDirector({idleAction:'qianhuili',idle:false});for(let i=0;i<240;i++)d.advance(1/120);
  d.send({type:'down',partId:'head',pointerId:1,x:.56,y:.12});
  for(let i=0;i<720;i++){
   if(i===30)d.send({type:'move',pointerId:1,x:.56+side*.22,y:.22});
   if(i===210)d.send({type:'move',pointerId:1,x:.56-side*.22,y:.08});
   if(i===390)d.send({type:'up',pointerId:1});
   const p=d.advance(1/120).pose;if(i%12===0)yield {name:'head-stroke-'+side,time:i/120,p};
  }
 }
 const flexHair=Object.fromEntries(Object.values(parts).filter(p=>p.flexible).map(p=>[p.name,{nodes:p.centerline,angles:p.centerline.slice(1).map(()=>0)}]));
 for(const lookX of [-1.2,-.6,0,.6,1.2])for(const lookY of [-.9,0,.9])
  yield {name:'head-capability',time:0,p:{referenceMotion:true,lookX,lookY,flexHair}};
 for(const seed of [9,17,20]){
  const d=createDirector({idleAction:'qianhuili',seed});
  for(let i=0;i<1080;i++){const p=d.advance(1/120).pose;if(i%12===0)yield {name:'idle-moment-'+seed,time:i/120,p};}
 }
 for(const name of ['care','lookAround','hum','stretch','doze','wake']){
  const spec=name==='care'?{duration:4.4}:catalog.find(s=>s.id===name),d=createDirector({idleAction:'qianhuili',idle:false,seed:17});
  for(let i=0;i<360;i++)d.advance(1/120);
  assert.equal(d.playAction(name),true,name+' must start before geometry sampling');
  const steps=Math.ceil((spec.duration+(spec.prepareDuration||0)+1.2)*120);
  for(let i=0;i<steps;i++){const p=d.advance(1/120).pose;if(i%12===0)yield {name,time:i/120,p};}
 }
}
test('actual head and neck meshes remain valid through shared poses and retained actions',async()=>{
 const h=await createHarness({idle:false});h.renderer.render({},'3942',false,0,false);
 const defs=[{name:h.meta.head.skin,owner:materials.head,images:[load(h.meta.head.skin),load(h.meta.head.cover)]},{name:h.meta.head.neck,owner:materials.neck,images:[load(h.meta.head.neck)]},{name:h.meta.head.torso,owner:materials.torso,images:[load(h.meta.head.torso)]}];
 const meshes=defs.map(d=>{const draw=h.draws.find(q=>q.texture===d.name),mesh={rest:draw.rest,uv:draw.uv,indices:draw.indices},tris=[];
  for(let i=0;i<mesh.indices.length;i+=3){const ids=Array.from(mesh.indices.slice(i,i+3)),ps=ids.map(n=>point(mesh.rest,n)),center=[0,1].map(k=>ps.reduce((s,p)=>s+p[k],0)/3);
   if(ps.concat([center]).some(p=>d.images.some(im=>alpha(im,...p)>16)))tris.push({ids,ps,a:area(...ps)});}
  return {...d,mesh,tris};});h.runtime.destroy();
 let samples=0,min=Infinity,max=0,worst=null,rootGap=0,minEdge=Infinity,maxEdge=0;
 for(const {name,time,p} of poses()){
   samples++;
   for(const x of meshes){const out=rig.deformMesh(x.mesh,p,binding,x.owner);
    for(const t of x.tris){const q=t.ids.map(n=>point(out,n)),ratio=area(...q)/t.a;
     if(ratio<min){min=ratio;worst={name,time,layer:x.name,ps:t.ps};}max=Math.max(max,ratio);
     assert.ok(Number.isFinite(ratio)&&ratio>.35&&ratio<1.8,JSON.stringify({ratio,...worst}));
     for(let k=0;k<3;k++){const j=(k+1)%3,edge=Math.hypot(q[k][0]-q[j][0],q[k][1]-q[j][1])/Math.hypot(t.ps[k][0]-t.ps[j][0],t.ps[k][1]-t.ps[j][1]);
      minEdge=Math.min(minEdge,edge);maxEdge=Math.max(maxEdge,edge);assert.ok(edge>.35&&edge<1.8,'head/neck edge stretch '+edge);}

    }
   }
   for(const part of Object.values(parts).filter(part=>part.root)){const a=rig.deformPoint(part.root,p,binding,part),b=rig.deformPoint(part.root,p,binding,part.followPart||materials.head);rootGap=Math.max(rootGap,Math.hypot(a[0]-b[0],a[1]-b[1]));}
 }
 assert.ok(rootGap<1e-7,'head/follower root gap '+rootGap);
 console.log('LAYERED_HEAD_GEOMETRY '+JSON.stringify({samples,min,max,minEdge,maxEdge,worst,rootGap,triangles:meshes.map(x=>({name:x.name,count:x.tris.length}))}));
});
test('head local inverse is owner-aware for arm drags and head shadows',()=>{
 for(const owner of [materials.head,materials.torso,materials.neck,{name:'arm-screen-left',elbowRatio:.45}]){
  const pose={referenceMotion:true,lookX:1.2,lookY:.7,headRoll:.1,bodyRoll:-.02,breath:.6};
  for(const rest of [[241,156],[298,116],[298,150]]){
   const p=owner.name==='arm-screen-left'?{...pose,grab:{'arm-screen-left':[6,-3]}}:pose;
   const out=rig.deformPoint(rest,p,binding,owner,owner.name==='arm-screen-left'?[0,0,1]:null),back=rig.unparentPoint(out,rest,p,binding,owner);
   const delta=owner.name==='arm-screen-left'?[6,-3]:[0,0];assert.ok(Math.hypot(back[0]-rest[0]-delta[0],back[1]-rest[1]-delta[1])<1e-6);
  }
 }
});
