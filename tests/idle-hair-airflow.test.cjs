'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const rig=require('../src/material-rig.js'),character=require('../src/character.js');
const {createMotion}=require('../src/reference-motion.js');
const {cameraFor}=require('../src/view.js');
const locks=Object.values(character.parts).filter(part=>part.flexible);
const distance=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
function stationary(pose){
 return {...pose,lookX:0,lookY:0,headRoll:0,headX:0,headY:0,bodyRoll:0,bodyX:0,bodyY:0,breath:0,squash:0,hop:0,compression:0,hairTurn:0};
}
test('reference idle airflow reaches every main lock even while the head and body are stationary',()=>{
 const motion=createMotion({binding:character.binding,idle:false});
 const chains=Object.fromEntries(locks.map(part=>[part.name,rig.createFlexibleHair(part,character.binding)]));
 const spans=Object.fromEntries(locks.map(part=>[part.name,[Infinity,-Infinity]]));
 const middle=Object.fromEntries(locks.map(part=>[part.name,[Infinity,-Infinity]]));
 let frontSpan=[Infinity,-Infinity];
 for(let i=0;i<2400;i++){
  motion.step(1/120);const pose=stationary(motion.snapshot().pose);
  for(const part of locks)chains[part.name].step(1/120,pose);
  pose.flexHair=Object.fromEntries(locks.map(part=>[part.name,chains[part.name].snapshot()]));
  if(i<240)continue;
  for(const part of locks){
   const state=pose.flexHair[part.name];
   assert.ok(distance(state.nodes[0],part.root)<1e-9,'wind must not detach '+part.name);
   for(let j=1;j<state.nodes.length;j++)assert.ok(Math.abs(distance(state.nodes[j],state.nodes[j-1])-distance(part.centerline[j],part.centerline[j-1]))<1e-7,'wind must not stretch '+part.name);
   const tip=rig.deformPoint(part.centerline.at(-1),pose,character.binding,part);
   const span=spans[part.name];span[0]=Math.min(span[0],tip[0]);span[1]=Math.max(span[1],tip[0]);
   const mid=rig.deformPoint(part.centerline[3],pose,character.binding,part),range=middle[part.name];
   range[0]=Math.min(range[0],mid[0]);range[1]=Math.max(range[1],mid[0]);
  }
  const part=character.parts['front-left'],tip=rig.deformPoint(part.centerline.at(-1),pose,character.binding,part);
  frontSpan=[Math.min(frontSpan[0],tip[0]),Math.max(frontSpan[1],tip[0])];
 }
 const ranges=Object.fromEntries(Object.entries(spans).map(([id,[min,max]])=>[id,max-min]));
 const scale=240/cameraFor(240,351,false,character.binding).w;
 const css=Object.fromEntries(locks.map(p=>[p.name,{middle:(middle[p.name][1]-middle[p.name][0])*scale,tip:ranges[p.name]*scale}]));
 console.log('STATIONARY_IDLE_HAIR '+JSON.stringify({materialPixelRanges:ranges,css,frontRange:frontSpan[1]-frontSpan[0]}));
 assert.ok(frontSpan[1]-frontSpan[0]>1,'the real idle source is active');
 // A nonzero tip is not enough for a long lock. These are desktop-size motion
 // floors for its middle and tip, not a claim that numeric size proves beauty.
 for(const part of locks){
  const outer=part.name.startsWith('outer-'),range=css[part.name];
  assert.ok(range.middle>(outer?6:3),'long-hair middle remains too still at desktop scale: '+part.name+' '+JSON.stringify(range));
  assert.ok(range.tip>(outer?14:9),'long-hair tip has no distinct sway at desktop scale: '+part.name+' '+JSON.stringify(range));
 }
});

test('a breeze bends progressively and decays after the load stops without resetting the chain',()=>{
 for(const part of locks){
  const chain=rig.createFlexibleHair(part,character.binding);
  const pose={referenceMotion:true,hairWind:{[part.flexible.windSource]:.05}};
  for(let i=0;i<960;i++)chain.step(1/120,pose);
  const loaded=chain.snapshot();
  assert.ok(Math.abs(loaded.angles.at(-1))>Math.abs(loaded.angles[0])*2,'the whole lock must not rotate as one piece');
  chain.step(1/120,{referenceMotion:true});
  assert.ok(distance(chain.snapshot().nodes.at(-1),loaded.nodes.at(-1))<.1,'stopping wind must not snap the tip');
  assert.ok(distance(chain.snapshot().nodes.at(-1),part.centerline.at(-1))>1,'do not reset the chain');
  for(let i=0;i<1200;i++)chain.step(1/120,{referenceMotion:true});
  assert.ok(distance(chain.snapshot().nodes.at(-1),part.centerline.at(-1))<.01,'wind-driven chain must settle');
 }
});

test('standing idle reaches the actual main-hair draw buffers',async()=>{
 const {createHarness}=require('./helpers/interaction-fixtures.cjs');
 const {createDirector}=require('../src/director.js');
 const h=await createHarness({idle:false});
 try{
  const director=createDirector({idleAction:'qianhuili',idle:false});
  const maxima=Object.fromEntries(locks.map(part=>[part.name,0]));
  for(let frame=0;frame<1200;frame++){
   const state=director.advance(1/120);assert.equal(state.referenceMotion.active,null);
   if(frame%120)continue;
   const pose=state.pose;
   h.renderer.render(pose,'3942',false,0,true);
   for(const part of locks){
    const draw=h.draws.find(d=>d.texture==='baijie-'+part.name+'.png');assert.ok(draw,'missing main layer '+part.name);
    const pixels=h.load(draw.texture);
    const alphaAt=(u,v)=>{
     const x=Math.max(0,Math.min(pixels.width-1,Math.floor(u*pixels.width)));
     const y=Math.max(0,Math.min(pixels.height-1,Math.floor(v*pixels.height)));
     return pixels.data[(y*pixels.width+x)*4+3];
    };
    const still={...pose,flexHair:{...pose.flexHair,[part.name]:{...pose.flexHair[part.name],nodes:part.centerline}}};
    // Read actual uploaded vertices, not just the diagnostic angles. Keep the
    // same moving head/body and branch state when removing the main bend.
    for(let i=0;i<draw.rest.length;i+=2){
     const rest=[draw.rest[i],draw.rest[i+1]];
     if(rest[1]<part.rootBlendY+20)continue;
     const expected=rig.deformPoint(rest,pose,character.binding,part);
     const uploaded=[draw.positions[i],draw.positions[i+1]];
     assert.ok(distance(uploaded,expected)<.001,'renderer must consume the moving centreline');
     if(alphaAt(draw.uv[i],draw.uv[i+1])>32)maxima[part.name]=Math.max(maxima[part.name],distance(uploaded,rig.deformPoint(rest,still,character.binding,part)));
    }
    for(let i=0;i<draw.indices.length;i+=3){
     const [a,b,c]=draw.indices.subarray(i,i+3);
     // A rectangular hair mesh includes transparent padding beyond the strand.
     // Check triangles sampled on paint, not extrapolated invisible fork space.
     const samples=[[1,0,0],[0,1,0],[0,0,1],[.5,.5,0],[.5,0,.5],[0,.5,.5],[1/3,1/3,1/3]];
     if(!samples.some(w=>alphaAt(...[0,1].map(axis=>w.reduce((sum,v,j)=>sum+v*draw.uv[[a,b,c][j]*2+axis],0)))>32))continue;
     const area=p=>(p[b*2]-p[a*2])*(p[c*2+1]-p[a*2+1])-(p[b*2+1]-p[a*2+1])*(p[c*2]-p[a*2]);
     assert.ok(area(draw.rest)*area(draw.positions)>0,'painted idle hair triangle folds '+JSON.stringify({part:part.name,frame,indices:[a,b,c]}));
    }
   }
  }
  for(const part of locks)assert.ok(maxima[part.name]>3,'no main-length bending reaches the rendered idle '+part.name);
  console.log('IDLE_DRAW_MAIN_BEND '+JSON.stringify(maxima));
 }finally{h.runtime.destroy();}
});
