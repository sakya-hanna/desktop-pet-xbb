'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const rig=require('../src/material-rig.js'),hit=require('../src/hit-test.js'),ch=require('../src/character.js'),{createDirector}=require('../src/director.js'),{catalog}=require('../src/reference-motion.js');
test('I22 all nine actions preserve the real skirt seam and locked grab inverse under reference body fade and global squash',()=>{
 const ids=['skirt-front','skirt-right'],meshes=ids.map(id=>rig.importSkirtMesh(JSON.parse(fs.readFileSync(path.join(__dirname,'../assets/baijie-'+id+'.mesh.json'))),ch.binding,ch.grabs).mesh);
 const seam=[[347,310.5],[343,330.5],[322,350.5],[307,370.5],[322,390.5],[335,410.5]];let maxGap=0;
 for(const a of catalog){const d=createDirector({idleAction:'qianhuili',idle:false});d.playAction(a.id);
  for(let step=0;step<Math.ceil((a.duration+(a.prepareDuration||0)+1)*2);step++){
   for(let i=0;i<60;i++)d.advance(1/120);const pose=d.snapshot().pose;
   const out=meshes.map((m,i)=>rig.deformMesh(m,pose,ch.binding,ch.grabs[ids[i]]));
   for(const p of seam){const q=meshes.map((m,i)=>hit.pickMaterial({rest:out[i],indices:m.indices},m.rest,p));assert.ok(q.every(Boolean));const gap=Math.hypot(q[0][0]-q[1][0],q[0][1]-q[1][1]);maxGap=Math.max(maxGap,gap);assert.ok(gap<0.035,a.id+' seam '+gap);}
   const g={...pose,grab:{'arm-screen-left':[10,-8]}},part=ch.grabs['arm-screen-left'];
   for(const rest of [[210,180],[190,315],[310,380]]){const moved=rig.deformPoint(rest,g,ch.binding,part,[0,0,1]),back=rig.unparentPoint(moved,rest,g,ch.binding),local=rig.localPoint(rest,g,part,[0,0,1]);assert.ok(Math.hypot(back[0]-local[0],back[1]-local[1])<1e-7,a.id+' inverse');}
  }
 }
 console.log('REFERENCE_SEAM_MAX '+maxGap);
});
