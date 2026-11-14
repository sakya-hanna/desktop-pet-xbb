'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createHarness}=require('./helpers/interaction-fixtures.cjs');
const {createDirector}=require('../src/director.js');
const rig=require('../src/material-rig.js'),ch=require('../src/character.js');
test('I30 keeps accepted left chain bindings while the head attachment is allowed to change',()=>{
 const before=require('../verification/final-head-rebuild/before-source/src/character.js');
 for(const id of ['outer-left','rear-left'])assert.deepEqual(ch.parts[id],before.parts[id]);
 // Full solver same-input comparison is retained in head-projection.test.cjs.
 // Old I29 world trajectories used a different moving head and are not a
 // legitimate golden image for the newly authorized complete head rebuild.
});
test('I30 right main hair has sustained internal bending, not only rigid travel',()=>{
 const d=createDirector({idleAction:'qianhuili',idle:false,seed:17}),part=ch.parts['rear-right'],line=part.centerline,points=[];
 for(let y=220;y<=430;y+=10){let i=0;while(i<line.length-2&&line[i+1][1]<y)i++;const a=line[i],b=line[i+1];points.push([a[0]+(b[0]-a[0])*(y-a[1])/(b[1]-a[1]),y]);}
 function rms(a,b){const center=x=>[0,1].map(k=>x.reduce((s,p)=>s+p[k],0)/x.length),ca=center(a),cb=center(b);let dot=0,cross=0;for(let i=0;i<a.length;i++){const x=a[i][0]-ca[0],y=a[i][1]-ca[1],u=b[i][0]-cb[0],v=b[i][1]-cb[1];dot+=x*u+y*v;cross+=x*v-y*u;}const angle=Math.atan2(cross,dot),c=Math.cos(angle),s=Math.sin(angle);return Math.sqrt(a.reduce((sum,p,i)=>sum+(cb[0]+(p[0]-ca[0])*c-(p[1]-ca[1])*s-b[i][0])**2+(cb[1]+(p[0]-ca[0])*s+(p[1]-ca[1])*c-b[i][1])**2,0)/a.length)*.351;}
 for(let i=0;i<360;i++)d.advance(1/120);d.playAction('hum');let peak=0,visible=0;
 for(let i=0;i<720;i++){const p=d.advance(1/120).pose;if(i%6)continue;const local=points.map(r=>rig.unparentPoint(rig.deformPoint(r,p,ch.binding,part),part.root,p,ch.binding)),amount=rms(points,local);peak=Math.max(peak,amount);if(amount>1)visible++;}
 console.log('RIGHT_MAIN_BEND '+JSON.stringify({peakRmsCss:peak,visibleSamples:visible}));assert.ok(peak>1.5&&visible>=10);
});
test('I30 the right front curl root follows its newly moving parent hair instead of staying on the torso',()=>{
 const d=createDirector({idleAction:'qianhuili',idle:false,seed:17});for(let i=0;i<360;i++)d.advance(1/120);d.playAction('hum');let maxGap=0;
 for(let i=0;i<600;i++){const pose=d.advance(1/120).pose;if(i%8)continue;const p=ch.parts['front-right'].root,a=rig.deformPoint(p,pose,ch.binding,ch.parts['front-right']),b=rig.deformPoint(p,pose,ch.binding,ch.parts['rear-right']);maxGap=Math.max(maxGap,Math.hypot(a[0]-b[0],a[1]-b[1]));}
 assert.ok(maxGap<1e-7,'front curl detaches from the parent lock: '+maxGap);
});
test('I30 the moving right curl samples its shadow receiver in fixed body material coordinates',async()=>{
 const h=await createHarness(),d=createDirector({idleAction:'qianhuili',idle:false,seed:17});for(let i=0;i<360;i++)d.advance(1/120);d.playAction('hum');for(let i=0;i<180;i++)d.advance(1/120);const pose=d.snapshot().pose;
 h.renderer.render(pose,'3942',false,0,true,[{face:'3942',weight:1}]);const draw=h.draws.find(p=>p.texture==='baijie-front-right-caster.png'),part=h.meta.front.parts.find(p=>p.name==='front-right'),s=h.meta.character.scale,[x,y,w,height]=part.sourceBox.map(v=>v*s),offset=part.shadowOffset.map(v=>v*s);let maxGap=0;
 for(let i=0;i<draw.positions.length;i+=2){const rest=[x+draw.uv[i]*w,y+draw.uv[i+1]*height],world=[draw.positions[i],draw.positions[i+1]],local=rig.unparentPoint(world,rest,pose,ch.binding,ch.materials.torso);maxGap=Math.max(maxGap,Math.hypot(draw.rest[i]-local[0],draw.rest[i+1]-local[1]));}
 h.runtime.destroy();assert.ok(maxGap<.001,'receiver mask dragged with the parent curl: '+maxGap);
});
test('I30 right main hair is an independent rear layer driven by the full flexible centreline',async()=>{
 const h=await createHarness(),d=createDirector({idleAction:'qianhuili',idle:false,seed:17});for(let i=0;i<360;i++)d.advance(1/120);d.playAction('hum');for(let i=0;i<180;i++)d.advance(1/120);const pose=d.snapshot().pose;
 h.renderer.render(pose,'3942',false,0,true,[{face:'3942',weight:1}]);
 const rear=h.draws.find(p=>p.texture==='baijie-rear-right.png'),body=h.draws.find(p=>p.texture===h.meta.head.torso);assert.ok(rear,'right main hair is still baked into the body');
 assert.ok(pose.flexHair?.['rear-right']&&pose.flexHair?.['outer-right'],'right-side curves not supplied by production director');
 assert.ok(h.draws.indexOf(rear)<h.draws.indexOf(body),'rear hair must not cover torso/arms/skirt');
 h.runtime.destroy();
});
