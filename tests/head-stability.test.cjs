'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const rig=require('../src/material-rig.js'),ch=require('../src/character.js'),{createDirector}=require('../src/director.js');
const oldBinding={...ch.binding};delete oldBinding.headStability;
const eye=[298.2,95],left=[275,95],right=[320,95];
function measure(pose,binding){const p=rig.deformPoint(eye,pose,binding),a=rig.deformPoint(left,pose,binding),b=rig.deformPoint(right,pose,binding);return {sway:Math.hypot(p[0]-eye[0],p[1]-eye[1]),tilt:Math.abs(Math.atan2(b[1]-a[1],b[0]-a[0]))};}
function samples(){const out=ch.keyframes.map(k=>({name:k.id,pose:k.pose}));
 const idle=createDirector({idle:true,seed:17});for(let i=0;i<840;i++){idle.advance(1/120);if(i%24===0)out.push({name:'idle',pose:idle.snapshot().pose});}
 for(const id of Object.keys(ch.grabs))for(const direction of [-1,1]){const d=createDirector({idle:false,seed:17});d.send({type:'grab-down',partId:id,pointerId:7});d.send({type:'grab-move',partId:id,pointerId:7,x:direction*ch.grabs[id].limit[0],y:ch.grabs[id].limit[1]*0.4});for(let i=0;i<144;i++){if(i===80)d.send({type:'grab-up',partId:id,pointerId:7});d.advance(1/120);if(i%8===0)out.push({name:id+(i>=80?'-release':'-held'),pose:d.snapshot().pose});}}
 const jump=createDirector({idle:true,seed:17});jump.send({type:'jump'});for(let i=0;i<160;i++){jump.advance(1/120);if(i%8===0)out.push({name:'jump-'+jump.snapshot().phase,pose:jump.snapshot().pose});}return out;
}
// User rejected I6's independent head stabilization. Keep the inverse/root/hit
// guards below, but replace the now-invalid "12% parent following" contract.
const distance=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
function rigidBody(p,pose){const a=pose.bodyRoll||0,dx=p[0]-ch.binding.hips[0],dy=p[1]-ch.binding.hips[1];return [ch.binding.hips[0]+dx*Math.cos(a)-dy*Math.sin(a)+(pose.bodyX||0)*800,ch.binding.hips[1]+dx*Math.sin(a)+dy*Math.cos(a)+((pose.bodyY||0)+(pose.compression||0)-(pose.hop||0))*800];}
function dragSamples(){const out=[];for(const id of ['skirt-front','skirt-right'])for(const direction of [-1,1]){const d=createDirector({idle:false});d.send({type:'grab-down',partId:id,pointerId:7});d.send({type:'grab-move',partId:id,pointerId:7,x:18*direction,y:-5});for(let i=0;i<168;i++){if(i===96)d.send({type:'grab-up',pointerId:7});d.advance(1/120);if(i%12===0)out.push({name:id+':'+direction+':'+i,pose:d.snapshot().pose});}}return out;}
test('I7 upper body: head, shoulders and chest follow one rigid parent while pulling and releasing skirt',()=>{
 const points=[[298.2,95],[250,150],[225,180],[300,205],[340,245],[265,280],[290,330]];let maxResidual=0,maxStretch=0,maxHeadMovement=0;
 for(const {pose}of dragSamples()){
  const mapped=points.map(p=>rig.deformPoint(p,pose,ch.binding));
  for(let i=0;i<points.length;i++)maxResidual=Math.max(maxResidual,distance(mapped[i],rigidBody(points[i],pose)));
  for(let i=0;i<points.length-1;i++)maxStretch=Math.max(maxStretch,Math.abs(distance(mapped[i],mapped[i+1])/distance(points[i],points[i+1])-1));
  maxHeadMovement=Math.max(maxHeadMovement,distance(mapped[0],points[0]));
 }
 console.log('I7_UPPER_BODY '+JSON.stringify({maxResidual,maxStretch,maxHeadMovement}));
 assert.ok(maxResidual<1e-8,'head/shoulders/chest must follow the same body transform; residual='+maxResidual);
 assert.ok(maxStretch<1e-8,'skin is not the spring joining two differently-following sections');assert.ok(maxHeadMovement>1,'head must still inherit the now-smaller whole-body response');
});
test('I7 upper body: real visible shoulder/chest mesh edges do not shear during skirt response',async t=>{
 const {createHarness}=require('./helpers/interaction-fixtures.cjs'),h=await createHarness({idle:false});t.after(()=>h.runtime.destroy());h.renderer.render({},'3942');
 const name=h.meta.interaction.skirts.body,base=h.draws.find(d=>d.texture===name),image=h.load(name);let checked=0,maxStretch=0;
 const edges=[];for(let k=0;k<base.indices.length;k+=3){const ids=Array.from(base.indices.subarray(k,k+3));if(ids.some(i=>base.rest[i*2+1]<150||base.rest[i*2+1]>350))continue;const uv=[0,1].map(a=>ids.reduce((s,i)=>s+base.uv[i*2+a]/3,0)),x=Math.floor(uv[0]*image.width),y=Math.floor(uv[1]*image.height);if(image.data[(y*image.width+x)*4+3]<128)continue;for(let j=0;j<3;j++)edges.push([ids[j],ids[(j+1)%3]]);}
 for(const {pose}of dragSamples().filter((_,i)=>i%7===0)){h.renderer.render(pose,'3942');const now=h.draws.find(d=>d.texture===name);for(const [a,b]of edges){const old=Math.hypot(base.positions[a*2]-base.positions[b*2],base.positions[a*2+1]-base.positions[b*2+1]),next=Math.hypot(now.positions[a*2]-now.positions[b*2],now.positions[a*2+1]-now.positions[b*2+1]);maxStretch=Math.max(maxStretch,Math.abs(next/old-1));checked++;}}
 console.log('I7_VISIBLE_CHEST '+JSON.stringify({checked,maxStretch,method:'real PNG/renderer mesh, fake GL'}));assert.ok(checked>100);assert.ok(maxStretch<0.0001,'visible shoulder/chest edges must stay rigid: '+maxStretch);assert.deepEqual(h.errors,[]);
});
test('I7 head: smaller slower idle turn is driven at source, without suppressing the body parent',()=>{
 const d=createDirector({idle:true,seed:17});let maxRoll=0,maxShift=0,maxStep=0,previous=0,returnValue=0;
 for(let i=0;i<1440;i++){const s=d.advance(1/120),p=s.pose;maxRoll=Math.max(maxRoll,Math.abs(p.headRoll));maxShift=Math.max(maxShift,Math.abs(p.headX));maxStep=Math.max(maxStep,Math.abs(p.headRoll-previous));previous=p.headRoll;if(s.time>7.4&&s.time<7.6)returnValue=Math.max(returnValue,Math.abs(p.headRoll));}
 console.log('I7_HEAD_ACTION '+JSON.stringify({maxRoll,maxShift,maxStep,returnValue}));
 assert.ok(maxRoll>0.015&&maxRoll<0.035,'small but real head turn, not a locked head');assert.ok(maxShift<0.002,'reduce independent lateral neck sliding');assert.ok(maxStep<0.0005,'slow down turn and return');assert.ok(returnValue<0.001,'settle instead of sustained oscillation');
 assert.ok(ch.keyframes.every(k=>Math.abs(k.pose.headRoll||0)<=0.05&&Math.abs(k.pose.headX||0)<=0.003),'authored preview poses use the same head envelope');
});
test('I7 retained: whole-character hop, facial rigidity, lower-body motion and locked-point inverse are preserved',()=>{
 const pose={headRoll:0.1,headX:0.01,headY:0.003,bodyRoll:-0.045,bodyX:0.003,bodyY:-0.002,compression:0.018,hop:0.075};
 for(const p of [eye,[250,160],[200,225],[330,300],[350,425],[205,798]]){
  const base=rig.deformPoint(p,{...pose,hop:0},ch.binding),air=rig.deformPoint(p,pose,ch.binding);assert.ok(Math.abs(air[0]-base[0])<1e-10);assert.ok(Math.abs(air[1]-base[1]+60)<1e-10,'hop is shared, not a screen-fixed head');
  if(p[1]>=300){const old=rig.deformPoint(p,pose,oldBinding);air.forEach((v,i)=>assert.ok(Math.abs(v-old[i])<1e-10,'lower torso and skirt response unchanged'));}
  const weights=[0.2,0.3,0.5],part=ch.grabs['arm-screen-left'],pull={...pose,grab:{'arm-screen-left':[12,-5]}},drawn=rig.deformPoint(p,pull,ch.binding,part,weights),restored=rig.unparentPoint(drawn,p,pull,ch.binding),expected=rig.localPoint(p,pull,part,weights);
  restored.forEach((v,i)=>assert.ok(Math.abs(v-expected[i])<1e-9,'inverse must use actual stabilized parent'));
 }
 const a=rig.deformPoint(left,pose,ch.binding),b=rig.deformPoint(right,pose,ch.binding);assert.ok(Math.abs(Math.hypot(a[0]-b[0],a[1]-b[1])-45)<1e-10,'face stays rigid');
 for(const part of Object.values(ch.parts))assert.deepEqual(rig.deformPoint(part.root,{...pose,hair:{[part.name]:[0.04,0.07,0.09]}},ch.binding,part),rig.deformPoint(part.root,pose,ch.binding),'all roots share the same stabilized parent');
});
test('I6 head: actual visible neck, shoulder and adjacent hair triangles remain oriented; moving head hits follow rendering',async t=>{
 const {createHarness}=require('./helpers/interaction-fixtures.cjs'),h=await createHarness({idle:false});t.after(()=>h.runtime.destroy());h.renderer.render({},'3942');
 const baseline=h.draws.map(d=>({...d,positions:new Float32Array(d.positions)}));let checked=0,minAreaRatio=Infinity;
 const leftPose=ch.keyframes.find(k=>k.id==='left').pose,rightPose=ch.keyframes.find(k=>k.id==='right').pose;
 const poses=[leftPose,rightPose,{...leftPose,bodyRoll:0.045,bodyX:0.004},{...rightPose,bodyRoll:-0.045,bodyY:0.0035,compression:0.018,headY:0.003},...samples().filter(s=>s.name.startsWith('idle')||s.name.includes('release')).map(s=>s.pose)];
 const area=(p,a,b,c)=>(p[b*2]-p[a*2])*(p[c*2+1]-p[a*2+1])-(p[b*2+1]-p[a*2+1])*(p[c*2]-p[a*2]);
 for(const pose of poses){h.renderer.render(pose,'3942');
  for(let layer=0;layer<h.draws.length;layer++){const old=baseline[layer],now=h.draws[layer],image=h.load(now.texture);assert.equal(now.texture,old.texture);
   for(let n=0;n<now.indices.length;n+=3){const tri=Array.from(now.indices.subarray(n,n+3)),cy=tri.reduce((sum,v)=>sum+old.positions[v*2+1]/3,0);if(cy<130||cy>310)continue;
    const uv=[0,1].map(k=>tri.reduce((sum,v)=>sum+now.uv[v*2+k]/3,0)),x=Math.max(0,Math.min(image.width-1,Math.floor(uv[0]*image.width))),y=Math.max(0,Math.min(image.height-1,Math.floor(uv[1]*image.height)));if(image.data[(y*image.width+x)*4+3]<128)continue;
    const original=area(old.positions,...tri);if(original<=1e-8)continue;const ratio=area(now.positions,...tri)/original;minAreaRatio=Math.min(minAreaRatio,ratio);assert.ok(ratio>0.45,JSON.stringify({layer:now.texture,triangle:n/3,ratio}));checked++;
   }
  }
  const point=h.renderer.headInputPoint();assert.equal(h.renderer.hitPart(point.x,point.y)?.partId,'head');
 }
 assert.ok(checked>100);assert.deepEqual(h.errors,[]);console.log('I6_VISIBLE_TRANSITION '+JSON.stringify({checked,minAreaRatio,method:'real PNG alpha and renderer triangles; fake GL, no visual acceptance'}));
});
