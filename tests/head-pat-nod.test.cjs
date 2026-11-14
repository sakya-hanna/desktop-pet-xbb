'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createMotion}=require('../src/reference-motion.js'),{createDirector}=require('../src/director.js');
const rig=require('../src/material-rig.js'),ch=require('../src/character.js');
function held(y){const m=createMotion({binding:ch.binding,idle:false}),base=createMotion({binding:ch.binding,idle:false});
 for(let i=0;i<480;i++){m.step(1/120,true,i>=240?{x:0,y}:null);base.step(1/120,true);}return [m.snapshot().pose,base.snapshot().pose];}
test('vertical stroking changes head attitude without pressing the head and shoulders farther down',()=>{
 const samples=[0,40,160,-160].map(held),dy=(p,b,point,owner=ch.materials.head)=>rig.deformPoint(point,p,ch.binding,owner)[1]-rig.deformPoint(point,b,ch.binding,owner)[1];
 for(const [p,b] of samples){
  assert.ok((p.headY-b.headY)*800<2,'whole-head drop dominates the nod');
  assert.ok(dy(p,b,[245,178],ch.materials.torso)<1,'shoulder is pushed down with the head');
  assert.ok(dy(p,b,[275,99])-dy(p,b,[298,149])>2,'face must change attitude relative to chin, not translate as a board');
  assert.ok(dy(p,b,[298,25])<3,'crown should not look pushed down');
 }
 for(const [p]of samples.slice(1))assert.equal(p.headY,samples[0][0].headY,'stroke distance must not be interpreted as downward pressure');
});
test('accepted head stroke relaxes eyes while held and opens into a gentle recovery',()=>{
 const d=createDirector({idleAction:'qianhuili',idle:false});for(let i=0;i<240;i++)d.advance(1/120);
 d.send({type:'down',partId:'head',pointerId:1,x:.56,y:.12});d.send({type:'move',pointerId:1,x:.62,y:.16});
 for(let i=0;i<240;i++)d.advance(1/120);
 const s=d.snapshot();assert.equal(s.expression.semantic,'enjoy');assert.equal(s.expression.face,'9003');
 d.send({type:'up',pointerId:1});assert.deepEqual(d.snapshot().pose,s.pose);assert.equal(d.snapshot().expression.semantic,'gentle');
 for(let i=0;i<100;i++)d.advance(1/120);assert.equal(d.snapshot().expression,null);
});
