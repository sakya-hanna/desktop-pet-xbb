'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {createHarness,root}=require('./helpers/interaction-fixtures.cjs');
const ch=require('../src/character.js'),rig=require('../src/material-rig.js');
const area=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);

test('captured grabs survive delayed frames, but losing capture still ends them without revival',async t=>{
 const h=await createHarness({idle:false});t.after(()=>h.runtime.destroy());h.runtime.start();h.tick(2);
 for(const [id,point]of [['arm-screen-left',[784*530/2612,1814*800/3941]],['arm-screen-right',[1828.5*530/2612,1579.5*800/3941]],['skirt-front',[260,430]],['skirt-right',[380,390]]]){
  const p=h.css(rig.deformPoint(point,h.runtime.status().motion.pose,ch.binding,ch.grabs[id],[0,0,1]));
  h.emit(h.canvas,'pointerdown',p);h.tick(1,650);assert.equal(h.runtime.status().motion.grab?.state,'pending','native capture still owns contact');
  h.emit(h.win,'pointermove',{...p,clientX:p.clientX+12});h.tick(4);
  const time=h.runtime.status().motion.time;h.tick(1,650);
  assert.equal(h.runtime.status().motion.grab?.state,'active');assert.ok(h.runtime.status().motion.time-time<.11,'physics still caps catch-up');
  h.canvas.releasePointerCapture(7);assert.equal(h.runtime.status().activePointer,null);assert.equal(h.runtime.status().motion.expression,null);
  h.emit(h.win,'pointerup',{...p,buttons:0});h.tick(5);assert.equal(h.runtime.status().motion.grab,null);
 }
 assert.deepEqual(h.errors,[]);
});

test('both real palms preserve shoulder roots, wrist joins and arm triangles through pull, hold, reverse and release',async t=>{
 const h=await createHarness({idle:false});t.after(()=>h.runtime.destroy());h.runtime.start();h.tick(2);
 const left=rig.authoredMesh(JSON.parse(fs.readFileSync(path.join(root,'assets',h.meta.interaction.leftArm.mesh))),ch.binding);
 const right=rig.importRightHandMeshes(JSON.parse(fs.readFileSync(path.join(root,'assets',h.meta.interaction.rightArm.mesh))),ch.binding,ch.grabs);
 const specs=[{id:'arm-screen-left',point:[784*530/2612,1814*800/3941],meshes:[{texture:'baijie-arm-screen-left.png',mesh:left}]},
  {id:'arm-screen-right',point:[1828.5*530/2612,1579.5*800/3941],meshes:right.parts.map(p=>({texture:h.meta.interaction.rightArm.parts.find(q=>q.id===p.id).texture,mesh:p.mesh}))}];
 let minArea=Infinity,maxArea=0,rootChecks=0,rigidChecks=0;
 function inspect(){
  const p=h.runtime.status().motion.pose;
  for(const spec of specs)for(const {texture,mesh}of spec.meshes){
   const draw=h.draws.find(q=>q.texture===texture);assert.ok(draw);const owner=ch.grabs[spec.id],delta=p.grab?.[spec.id]||[0,0];
   for(let i=0;i<mesh.rest.length/2;i++){
    const rest=[mesh.rest[2*i],mesh.rest[2*i+1]],weights=mesh.weights.subarray(3*i,3*i+3),local=rig.localPoint(rest,p,owner,weights);
    if(weights[0]===1){
     const parent=rig.deformPoint(rest,{...p,grab:{}},ch.binding,owner,weights);
     assert.equal(draw.positions[2*i],Math.fround(parent[0]));assert.equal(draw.positions[2*i+1],Math.fround(parent[1]));rootChecks++;
    }
    if(weights[2]===1){for(let k=0;k<2;k++)assert.ok(Math.abs(local[k]-rest[k]-delta[k])<1e-6);rigidChecks++;}
   }
   for(let i=0;i<mesh.indices.length;i+=3){
    const indices=Array.from(mesh.indices.slice(i,i+3)),points=buffer=>indices.map(n=>[buffer[2*n],buffer[2*n+1]]);
    const ratio=area(...points(draw.positions))/area(...points(mesh.rest));minArea=Math.min(minArea,ratio);maxArea=Math.max(maxArea,ratio);assert.ok(ratio>.35&&ratio<1.8,'arm triangle stretch '+ratio);
   }
  }
 }
 for(const spec of specs){
  h.action('shell:cancel');h.tick(3);
  const p=h.css(rig.deformPoint(spec.point,h.runtime.status().motion.pose,ch.binding,ch.grabs[spec.id],[0,0,1]));
  assert.equal(h.renderer.hitPart(p.clientX,p.clientY)?.partId,spec.id);
  h.emit(h.canvas,'pointerdown',p);h.emit(h.win,'pointermove',{...p,clientX:p.clientX+16,clientY:p.clientY-6});
  for(let i=0;i<22;i++){h.tick(1,100);if(i%4===0)inspect();}
  assert.equal(h.runtime.status().motion.expression.phase,'hold');assert.equal(h.runtime.status().renderedFace,'3901');
  h.emit(h.win,'pointermove',{...p,clientX:p.clientX-16,clientY:p.clientY+6});
  for(let i=0;i<12;i++){h.tick(1,100);if(i%3===0)inspect();}
  const held=h.runtime.status().motion.pose;h.emit(h.win,'pointerup',{...p,buttons:0});assert.deepEqual(h.runtime.status().motion.pose,held);
  h.tick(2,100);assert.equal(h.runtime.status().renderedFace,'3942');inspect();
  h.tick(15,100);inspect();assert.equal(h.runtime.status().motion.expression,null);
 }
 assert.ok(rootChecks>100&&rigidChecks>100);assert.deepEqual(h.errors,[]);
 console.log('HAND_MESH '+JSON.stringify({minArea,maxArea,rootChecks,rigidChecks}));
});
