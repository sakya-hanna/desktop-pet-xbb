'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createDirector}=require('../src/director.js'),ch=require('../src/character.js'),rig=require('../src/material-rig.js'),view=require('../src/view.js');
const dt=1/120,scale=348/view.cameraFor(240,348,false,ch.binding).h;
function begin(side){
 const d=createDirector({idleAction:'qianhuili',idle:false});
 for(let i=0;i<5;i++){d.send({type:'down',partId:'feet',pointerId:1,x:0,materialPoint:[side==='left'?215:335,760]});d.send({type:'up',pointerId:1});}
 return d;
}
function delta(point,p,q,owner=ch.materials.torso){
 const a=rig.deformPoint(point,p,ch.binding,owner),b=rig.deformPoint(point,q,ch.binding,owner);
 return [(a[0]-b[0])*scale,(a[1]-b[1])*scale];
}
function sample(side){
 const d=begin(side),base=begin(side);base.cancelFeet();
 const peaks={shoulder:0,waist:0,head:0,bodyRoll:0,maxFrame:0};let previous=null,held=null,settled=null;
 for(let i=0;i<120*9;i++){
  const p=d.advance(dt).pose,q=base.advance(dt).pose;
  const shoulder=delta([240,185],p,q),waist=delta([295,330],p,q),head=delta([298,95],p,q,ch.materials.head);
  peaks.shoulder=Math.max(peaks.shoulder,Math.abs(shoulder[0]));peaks.waist=Math.max(peaks.waist,Math.abs(waist[0]));
  peaks.head=Math.max(peaks.head,Math.abs(head[0]));peaks.bodyRoll=Math.max(peaks.bodyRoll,Math.abs(p.bodyRoll-q.bodyRoll));
  if(previous)peaks.maxFrame=Math.max(peaks.maxFrame,Math.hypot(shoulder[0]-previous[0],shoulder[1]-previous[1]));previous=shoulder;
  if(i===167)held={p,q,shoulder,waist};
  if(i<280){
   const stance=side==='left'?'right':'left',point=stance==='right'?[335,790]:[215,790];
   assert.deepEqual(rig.deformPoint(point,p,ch.binding,ch.parts['leg-'+stance]),rig.deformPoint(point,q,ch.binding,ch.parts['leg-'+stance]));
  }
  if(i===1079)settled=shoulder;
 }
 return {peaks,held,settled};
}
for(const side of ['left','right'])test('shoe motion has visible torso weight transfer at 240x348: '+side,()=>{
 const {peaks,held,settled}=sample(side);console.log('SHOE_SCREEN '+JSON.stringify({side,...peaks,holdX:held.shoulder[0],settled}));
 assert.ok(peaks.shoulder>=8&&peaks.shoulder<19,'shoulder movement must read at desktop size: '+peaks.shoulder);
 assert.ok(peaks.waist>=4&&peaks.waist<12,'waist must join the shift: '+peaks.waist);
 assert.ok(peaks.bodyRoll>.04&&peaks.bodyRoll<.11,'body must lean rather than only translate');
 assert.ok(held.shoulder[0]*(side==='left'?1:-1)>6,'weight must stay over the planted leg during release');
 assert.ok(peaks.maxFrame<.5,'shoulder movement must remain continuous');
 assert.ok(Math.hypot(...settled)<.2,'body must return after the shoe sequence');
});

test('shoe weight transfer reaches the uploaded torso mesh and keeps layer attachments continuous',async t=>{
 const {createHarness}=require('./helpers/interaction-fixtures.cjs'),h=await createHarness({idle:false});
 t.after(()=>h.runtime.destroy());
 for(const side of ['left','right']){
  const {held:{p,q}}=sample(side);
  h.renderer.render(q,'3942',false,0,false);
  const before=h.draws.find(d=>d.texture===h.meta.feet.torso);assert.ok(before);
  const positions=before.positions.slice();
  h.renderer.render(p,'3942',false,0,false);
  const after=h.draws.find(d=>d.texture===h.meta.feet.torso);assert.ok(after);
  let distance=Infinity,nearest=0;
  for(let i=0;i<after.rest.length;i+=2){
   const d=Math.hypot(after.rest[i]-240,after.rest[i+1]-185);
   if(d<distance){distance=d;nearest=i;}
  }
  assert.ok(Math.abs(after.positions[nearest]-positions[nearest])*scale>8,'actual torso upload must show the lean');
  const expected=rig.deformPoint([after.rest[nearest],after.rest[nearest+1]],p,ch.binding,ch.materials.torso);
  assert.ok(Math.hypot(expected[0]-after.positions[nearest],expected[1]-after.positions[nearest+1])<.001);
  for(const part of Object.values(ch.parts).filter(part=>part.root)){
   const own=rig.deformPoint(part.root,p,ch.binding,part),parent=rig.deformPoint(part.root,p,ch.binding,part.followPart||ch.materials.head);
   assert.ok(Math.hypot(own[0]-parent[0],own[1]-parent[1])<1e-7,'hair root separated: '+part.name);
  }
  for(const side of ['left','right']){
   const leg=ch.parts['leg-'+side];
   assert.deepEqual(rig.deformPoint(leg.hip,p,ch.binding,leg),rig.deformPoint(leg.hip,p,ch.binding,ch.materials.torso));
  }
 }
});
