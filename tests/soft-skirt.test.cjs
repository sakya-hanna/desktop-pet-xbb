'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const rig=require('../src/material-rig.js'),ch=require('../src/character.js'),hit=require('../src/hit-test.js'),{createDirector}=require('../src/director.js');
const ids=['skirt-front','skirt-right'],dt=1/120;
const tick=(d,n)=>{for(let i=0;i<n;i++)d.advance(dt);return d.snapshot().pose;};
const send=(d,type,extra={})=>assert.equal(d.send({type,pointerId:7,...extra}),true);
const local=(p,point,id='skirt-front')=>rig.localPoint(point,p,ch.grabs[id],[0,0,1]);
test('pinched cloth moves around its actual contact, not every point at the same hem weight',()=>{
 const d=createDirector({idle:false});send(d,'grab-down',{partId:ids[0],materialPoint:[260,430]});send(d,'grab-move',{x:18,y:0});
 const p=tick(d,120),near=local(p,[260,430])[0]-260,far=local(p,[400,430])[0]-400;
 assert.ok(near>17&&Math.abs(far)<near*.2,'the skirt still translates as one rigid panel');
 for(const id of ids)assert.deepEqual(local(p,[320,430],id),local(p,[320,430]),'both materials must share one spatial cloth field');
 assert.deepEqual(rig.localPoint([300,300],p,ch.grabs[ids[0]],[1,0,0]),[300,300]);
});
test('released cloth keeps velocity, rebounds and settles; moving a new pinch preserves the old fold',()=>{
 const d=createDirector({idle:false});send(d,'grab-down',{partId:ids[0],materialPoint:[260,430]});send(d,'grab-move',{x:18,y:-5});
 tick(d,120);const before=d.snapshot().pose;send(d,'grab-up');assert.deepEqual(d.snapshot().pose,before);
 let min=0;for(let i=0;i<360;i++){const p=d.advance(dt).pose;min=Math.min(min,p.grab[ids[0]][0]);}
 assert.ok(min<-2,'cloth returns rigidly without any rebound');assert.ok(Math.abs(d.snapshot().pose.grab[ids[0]][0])<.01);
 send(d,'grab-down',{partId:ids[0],materialPoint:[260,430]});send(d,'grab-move',{x:18,y:0});tick(d,120);send(d,'grab-up');tick(d,6);
 const points=[[260,430],[320,400],[380,430]],old=d.snapshot().pose;
 send(d,'grab-down',{partId:ids[0],materialPoint:[380,430]});const next=d.snapshot().pose;
 for(const p of points)assert.deepEqual(local(next,p),local(old,p),'unfinished fold jumped to new pinch');
 send(d,'grab-move',{x:-12,y:4});tick(d,40);assert.ok(d.snapshot().pose.skirtRecoil?.length);
 d.cancelGrab();for(const p of points)assert.deepEqual(local(d.snapshot().pose,p),p);
 tick(d,300);assert.equal(d.snapshot().pose.skirtRecoil,undefined);
});
test('localized pull stays joined across the real two-panel seam and keeps authored triangles oriented',()=>{
 const meshes=ids.map(id=>rig.importSkirtMesh(JSON.parse(fs.readFileSync(path.join(__dirname,'../assets/baijie-'+id+'.mesh.json'))),ch.binding,ch.grabs).mesh);
 const seam=[[347,310.5],[349,320.5],[343,330.5],[334,340.5],[322,350.5],[313,360.5],[307,370.5],[305,380.5],[322,390.5],[340,400.5],[335,410.5]];
 let maxGap=0,minArea=Infinity;
 for(const id of ids)for(const contact of [[260,430],[350,380]])for(const delta of [[18,0],[-18,0],[0,-14],[0,14],[12,-8]]){
  const p={referenceMotion:true,skirtContacts:{[id]:contact},grab:{[id]:delta},bodyRoll:.03};
  const out=meshes.map((m,i)=>rig.deformMesh(m,p,ch.binding,ch.grabs[ids[i]]));
  for(const at of seam){const mapped=meshes.map((m,i)=>hit.pickMaterial({rest:out[i],indices:m.indices},m.rest,at));const gap=Math.hypot(mapped[0][0]-mapped[1][0],mapped[0][1]-mapped[1][1]);maxGap=Math.max(maxGap,gap);assert.ok(gap<.035,'seam opens '+gap);}
  meshes.forEach((m,j)=>{for(let i=0;i<m.indices.length;i+=3){const [a,b,c]=Array.from(m.indices.slice(i,i+3)).map(n=>n*2),area=v=>(v[b]-v[a])*(v[c+1]-v[a+1])-(v[b+1]-v[a+1])*(v[c]-v[a]);const ratio=area(out[j])/area(m.rest);minArea=Math.min(minArea,ratio);assert.ok(ratio>.2,'cloth triangle folds');}});
 }
 console.log('SOFT_SKIRT_GEOMETRY '+JSON.stringify({maxGap,minArea}));
});
