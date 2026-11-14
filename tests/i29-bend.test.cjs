'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const rig=require('../src/material-rig.js'),ch=require('../src/character.js'),{createDirector}=require('../src/director.js');
function fit(a,b){const center=x=>[0,1].map(k=>x.reduce((s,p)=>s+p[k],0)/x.length),ca=center(a),cb=center(b);let dot=0,cross=0;for(let i=0;i<a.length;i++){const x=a[i][0]-ca[0],y=a[i][1]-ca[1],u=b[i][0]-cb[0],v=b[i][1]-cb[1];dot+=x*u+y*v;cross+=x*v-y*u;}const angle=Math.atan2(cross,dot),c=Math.cos(angle),s=Math.sin(angle);return Math.sqrt(a.reduce((sum,p,i)=>sum+(cb[0]+(p[0]-ca[0])*c-(p[1]-ca[1])*s-b[i][0])**2+(cb[1]+(p[0]-ca[0])*s+(p[1]-ca[1])*c-b[i][1])**2,0)/a.length)*.351;}
const points=[];for(let y=260;y<=440;y+=10){const line=ch.parts['rear-left'].centerline;let i=0;while(i<line.length-2&&line[i+1][1]<y)i++;const a=line[i],b=line[i+1];points.push([a[0]+(b[0]-a[0])*(y-a[1])/(b[1]-a[1]),y]);}
test('I29 the wide left hair visibly bends inside its main length, rather than only travelling as one rigid piece',()=>{
 const d=createDirector({idleAction:'qianhuili',idle:false,seed:17});for(let i=0;i<360;i++)d.advance(1/120);d.playAction('hum');let maximum=0,visibleSamples=0;
 for(let i=0;i<720;i++){const p=d.advance(1/120).pose;if(i%6)continue;const local=points.map(r=>rig.unparentPoint(rig.deformPoint(r,p,ch.binding,ch.parts['rear-left']),ch.parts['rear-left'].root,p,ch.binding));const rms=fit(points,local);maximum=Math.max(maximum,rms);if(rms>1)visibleSamples++;}
 console.log('WIDE_HAIR_BEND '+JSON.stringify({maximumRmsCss:maximum,samplesOverOneCssPixel:visibleSamples}));
 assert.ok(maximum>1.5&&visibleSamples>=10,'body of the strand remains near-rigid; visible bend must persist, not be one spike');
});
test('I29 moving-root chain holds its segment lengths and continues bending after the head stops',()=>{
 for(const id of ['outer-left','rear-left']){
  const part=ch.parts[id],d=rig.createFlexibleHair(part,ch.binding);let atStop,afterStop;
  for(let i=0;i<1200;i++){
   const t=i/120,w=t<1?Math.sin(Math.PI*t):0,pose={referenceMotion:true,headRoll:.12*w,headX:.02*w};d.step(1/120,pose);const state=d.snapshot();
   for(let j=1;j<state.nodes.length;j++)assert.ok(Math.abs(Math.hypot(...state.nodes[j].map((v,k)=>v-state.nodes[j-1][k]))-Math.hypot(...part.centerline[j].map((v,k)=>v-part.centerline[j-1][k])))<1e-7,'segment stretches '+id);
   const moved=rig.deformPoint(part.root,{...pose,flexHair:{[id]:state}},ch.binding,part),parent=rig.deformPoint(part.root,pose,ch.binding);assert.ok(Math.hypot(...moved.map((v,k)=>v-parent[k]))<1e-7,'root detaches '+id);
   if(i===120)atStop=state.nodes;if(i===150)afterStop=state.nodes;
  }
  assert.ok(Math.hypot(...afterStop.at(-1).map((v,k)=>v-atStop.at(-1)[k]))>2,'tail stops rigidly with the head '+id);
  const final=d.snapshot();assert.ok(Math.hypot(...final.nodes.at(-1).map((v,k)=>v-part.centerline.at(-1)[k]))<1,'chain does not settle '+id);
 }
});
test('I30 untouched fringe and left front curl remain exactly on their existing paths',()=>{
 const d=createDirector({idleAction:'qianhuili',idle:false,seed:17});d.playAction('hum');
 for(let i=0;i<480;i++){const pose=d.advance(1/120).pose;if(i%8)continue;const plain={...pose};delete plain.flexHair;
  for(const id of ['fringe','front-left']){const part=ch.parts[id];for(const p of part.centerline)assert.deepEqual(rig.deformPoint(p,pose,ch.binding,part),rig.deformPoint(p,plain,ch.binding,part));}
 }
});
module.exports={fit};
