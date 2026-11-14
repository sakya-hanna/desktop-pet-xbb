'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const rig=require('../src/material-rig.js'),character=require('../src/character.js');
const {createMotion}=require('../src/reference-motion.js');
const locks=Object.values(character.parts).filter(p=>p.flexible),dt=1/120;
// Isolate the real turn channel from breathing, roll, and ambient breeze.
// Keep the reference motion's gaze and hair outputs; exercise the same chain
// and drawing path as Director.step and CharacterRenderer.render.
function yawOnly(source){return {...source,lookY:0,headRoll:0,headX:0,headY:0,bodyRoll:0,bodyX:0,bodyY:0,breath:0,squash:0,hop:0,compression:0,hairWind:{}};}
function turnSamples(){
 const motion=createMotion({binding:character.binding,idle:false});
 const chains=Object.fromEntries(locks.map(p=>[p.name,rig.createFlexibleHair(p,character.binding)]));
 const samples=[];motion.play('lookAround');
 for(let i=0;i<840;i++){
  motion.step(dt);const pose=yawOnly(motion.snapshot().pose);
  for(const p of locks)chains[p.name].step(dt,pose);
  pose.flexHair=Object.fromEntries(locks.map(p=>[p.name,chains[p.name].snapshot()]));
  samples.push({time:(i+1)*dt,pose});
 }
 return samples;
}
test('left/right gaze bends every long lock beyond its parent translation and back parallax',()=>{
 const samples=turnSamples(),report={};
 for(const part of locks){
  const holds=[[1.25,1.7],[3.3,3.8]].map(([from,to])=>samples.filter(s=>s.time>=from&&s.time<=to).map(({pose})=>{
   const still={...pose,flexHair:{...pose.flexHair,[part.name]:{nodes:part.centerline}}};
   const tip=part.centerline.at(-1);
   return rig.deformPoint(tip,pose,character.binding,part)[0]-rig.deformPoint(tip,still,character.binding,part)[0];
  }));
  report[part.name]=holds.map(a=>a.reduce((n,v)=>n+v,0)/a.length);
 }
 console.log('TURN_ONLY_HAIR_BEND '+JSON.stringify(report));
 for(const part of locks){
  const [left,right]=report[part.name];
  assert.ok(Math.abs(left)>2&&Math.abs(right)>2,'turn does not reach '+part.name+': '+JSON.stringify(report[part.name]));
  assert.ok(left*right<0,'hair must respond to both gaze directions: '+part.name);
 }
});

test('a held turn bends progressively, keeps attachment and lengths, and releases continuously',()=>{
 const motion=createMotion({binding:character.binding,idle:false});motion.play('lookAround');
 for(let i=0;i<180;i++)motion.step(dt);
 const pose=yawOnly(motion.snapshot().pose),distance=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
 for(const part of locks){
  const chain=rig.createFlexibleHair(part,character.binding);
  for(let i=0;i<960;i++)chain.step(dt,pose);
  const loaded=chain.snapshot();
  assert.ok(Math.abs(loaded.angles.at(-1))>Math.abs(loaded.angles[0])*2,'turn must bend progressively '+part.name);
  assert.ok(distance(loaded.nodes[0],part.root)<1e-9);
  for(let i=1;i<loaded.nodes.length;i++)assert.ok(Math.abs(distance(loaded.nodes[i],loaded.nodes[i-1])-distance(part.centerline[i],part.centerline[i-1]))<1e-7);
  const unloaded={...pose,hairTurn:0};chain.step(dt,unloaded);
  assert.ok(distance(loaded.nodes.at(-1),chain.snapshot().nodes.at(-1))<.2,'load removal snaps the tip');
  assert.ok(distance(chain.snapshot().nodes.at(-1),part.centerline.at(-1))>2,'release discarded the bend');
  for(let i=0;i<1200;i++)chain.step(dt,unloaded);
  assert.ok(distance(chain.snapshot().nodes.at(-1),part.centerline.at(-1))<.01,'turn load does not settle');
 }
});

test('turn-driven bend reaches painted draw vertices and the full action keeps painted triangles oriented',async()=>{
 const {createHarness}=require('./helpers/interaction-fixtures.cjs'),{createDirector}=require('../src/director.js');
 const h=await createHarness({idle:false});
 const maxima=Object.fromEntries(locks.map(p=>[p.name,0]));
 const inspect=(pose,measure)=>{
  h.renderer.render(pose,'3942',false,0,true);
  for(const part of locks){
   const draw=h.draws.find(d=>d.texture==='baijie-'+part.name+'.png');assert.ok(draw);
   const im=h.load(draw.texture),alpha=(u,v)=>im.data[(Math.max(0,Math.min(im.height-1,Math.floor(v*im.height)))*im.width+Math.max(0,Math.min(im.width-1,Math.floor(u*im.width))))*4+3];
   const still={...pose,flexHair:{...pose.flexHair,[part.name]:{...pose.flexHair[part.name],nodes:part.centerline}}};
   for(let i=0;i<draw.rest.length;i+=2){
    const rest=[draw.rest[i],draw.rest[i+1]],expected=rig.deformPoint(rest,pose,character.binding,part);
    assert.ok(Math.hypot(draw.positions[i]-expected[0],draw.positions[i+1]-expected[1])<.001,'draw ignores chain '+part.name);
    if(measure&&rest[1]>part.rootBlendY+20&&alpha(draw.uv[i],draw.uv[i+1])>32){
     const base=rig.deformPoint(rest,still,character.binding,part);
     maxima[part.name]=Math.max(maxima[part.name],Math.hypot(draw.positions[i]-base[0],draw.positions[i+1]-base[1]));
    }
   }
   for(let i=0;i<draw.indices.length;i+=3){
    const ids=Array.from(draw.indices.subarray(i,i+3));
    const samples=[[1,0,0],[0,1,0],[0,0,1],[.5,.5,0],[.5,0,.5],[0,.5,.5],[1/3,1/3,1/3]];
    if(!samples.some(w=>alpha(...[0,1].map(axis=>w.reduce((s,v,j)=>s+v*draw.uv[ids[j]*2+axis],0)))>32))continue;
    const [a,b,c]=ids.map(n=>n*2),area=p=>(p[b]-p[a])*(p[c+1]-p[a+1])-(p[b+1]-p[a+1])*(p[c]-p[a]);
    assert.ok(area(draw.rest)*area(draw.positions)>0,'painted turn triangle folds '+JSON.stringify({part:part.name,ids,lookX:pose.lookX}));
   }
  }
 };
 try{
  for(const s of turnSamples().filter((_s,i)=>i%60===0))inspect(s.pose,true);
  const d=createDirector({idleAction:'qianhuili',idle:false});for(let i=0;i<360;i++)d.advance(dt);d.playAction('lookAround');
  for(let i=0;i<900;i++){const s=d.advance(dt);if(i%60===0)inspect(s.pose,false);}
  for(const seed of [9,17,20]){
   const idle=createDirector({idleAction:'qianhuili',seed});
   for(let i=0;i<1080;i++){const s=idle.advance(dt);if(i%60===0)inspect(s.pose,false);}
  }
  for(const part of locks)assert.ok(maxima[part.name]>3,'turn has no painted main-length bend '+part.name);
  console.log('TURN_DRAW_BEND '+JSON.stringify(maxima));
 }finally{h.runtime.destroy();}
});
