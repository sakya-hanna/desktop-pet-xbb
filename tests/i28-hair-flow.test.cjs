'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const rig=require('../src/material-rig.js'),ch=require('../src/character.js');
const {createDirector}=require('../src/director.js');
const {createHarness}=require('./helpers/interaction-fixtures.cjs');
const distance=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
test('I28 refuses a cleaned body without its required rear-hair layer',async()=>{
 await assert.rejects(createHarness({mutateManifest(meta){meta.rearHair=[];}}),/rear hair/i);
});
test('I28 wide left rear hair has local movement in the actual body draw, while face and clothes keep their parent',async()=>{
 const h=await createHarness(),d=createDirector({idleAction:'qianhuili',idle:false,seed:17});
 for(let i=0;i<360;i++)d.advance(1/120);d.playAction('lookAround');
 for(let i=0;i<105;i++)d.advance(1/120);const pose=d.snapshot().pose;
 h.renderer.render(pose,'3942',false,0,true,[{face:'3942',weight:1}]);
 const body=h.draws.find(x=>x.texture==='baijie-arms-skirts-body.png'),rear=h.draws.find(x=>x.texture==='baijie-rear-left.png');assert.ok(body);assert.ok(rear,'rear hair needs an independent layer, not stretched body vertices');
 assert.ok(h.draws.indexOf(rear)<h.draws.indexOf(body),'rear hair must stay behind body and arms');
 function vertex(p,draw=body){let index=0,min=Infinity;for(let k=0;k<draw.rest.length;k+=2){const e=distance(p,[draw.rest[k],draw.rest[k+1]]);if(e<min){min=e;index=k;}}return index;}
 const k=vertex([187,270],rear),rest=[rear.rest[k],rear.rest[k+1]],parent=rig.deformPoint(rest,pose,ch.binding);
 assert.ok(distance([rear.positions[k],rear.positions[k+1]],parent)>2,'wide painted rear hair still has only body movement');
 for(const p of [[298,97],[298,143],[244,179],[267,222],[237,287],[285,530],[210,198]]){
  const i=vertex(p),r=[body.rest[i],body.rest[i+1]],expected=rig.deformPoint(r,pose,ch.binding);
  assert.ok(distance([body.positions[i],body.positions[i+1]],expected)<.001,'protected body vertex moved: '+p);
 }
 h.runtime.destroy();
});
test('I28 fork tips bend independently along painted paths without changing their common upper attachment',()=>{
 const d=createDirector({idleAction:'qianhuili',idle:false,seed:17}),part=ch.parts['outer-left'];
 for(let i=0;i<360;i++)d.advance(1/120);d.playAction('hum');
 let sweep=0,tip=0,differential=0;
 for(let i=0;i<720;i++){
  const pose=d.advance(1/120).pose,base={...pose};delete base.hairBranches;
  const points=[[36,389],[89,480]],delta=points.map(p=>{const a=rig.deformPoint(p,pose,ch.binding,part),b=rig.deformPoint(p,base,ch.binding,part);return a.map((v,k)=>v-b[k]);});
  sweep=Math.max(sweep,Math.hypot(...delta[0]));tip=Math.max(tip,Math.hypot(...delta[1]));differential=Math.max(differential,distance(...delta));
  assert.ok(distance(rig.deformPoint([220,128],pose,ch.binding,part),rig.deformPoint([220,128],base,ch.binding,part))<1e-8,'upper attachment altered');
 }
 assert.ok(sweep>2&&tip>2&&differential>2,`fork tips still one shared field: ${JSON.stringify({sweep,tip,differential})}`);
});
test('I28 hand and skirt release/cancel keep continuous base hair and remove only grab recoil',()=>{
 for(const partId of Object.keys(ch.grabs)){
  const a=createDirector({idleAction:'qianhuili',idle:false,seed:17}),b=createDirector({idleAction:'qianhuili',idle:false,seed:17});
  for(let i=0;i<360;i++){a.advance(1/120);b.advance(1/120);}
  for(const d of [a,b])assert.equal(d.send({type:'grab-down',partId,pointerId:7}),true);
  a.send({type:'grab-move',partId,pointerId:7,x:18,y:-10});
  for(let i=0;i<120;i++){a.advance(1/120);b.advance(1/120);}
  a.send({type:'grab-up',partId,pointerId:7});b.send({type:'grab-up',partId,pointerId:7});
  for(let i=0;i<12;i++){a.advance(1/120);b.advance(1/120);}
  // Both directors see the same blocking timeline before comparing geometry.
  a.cancelGrab();b.cancelGrab();
  assert.equal(a.snapshot().pointerId,null);assert.equal(a.snapshot().expression,null);
  assert.deepEqual(a.snapshot().pose.longHair,b.snapshot().pose.longHair,'cancel reset/retained interaction hair '+partId);
  assert.deepEqual(a.snapshot().pose.hairBranches,b.snapshot().pose.hairBranches,'fork timeline changed '+partId);
  assert.deepEqual(a.snapshot().pose.flexHair,b.snapshot().pose.flexHair,'complete flexible centreline or reaction differs after cancel '+partId);
  for(let i=0;i<30;i++){a.advance(1/120);b.advance(1/120);}
  assert.deepEqual(a.snapshot().pose.longHair,b.snapshot().pose.longHair,'cancelled recoil revived '+partId);
  assert.deepEqual(a.snapshot().pose.flexHair,b.snapshot().pose.flexHair,'flexible reaction revived '+partId);
 }
});
