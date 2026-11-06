const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const F=require('../puppet/rig/js/front-hair.js');
function config(){const ctx={window:{}};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../puppet/rig/js/front-hair-assets.js'),'utf8'),ctx);const cfg=JSON.parse(JSON.stringify(ctx.window.FRONT_HAIR_ASSETS.baijie));cfg.version=2;cfg.motionModel='reference-wind-v1';cfg.parts.forEach((p,i)=>{p.amplitude=[12,28,14][i];p.motion={windGain:1,stiffness:[110,80,110][i],damping:4.8,phaseIndex:i};});return cfg;}
test('reference driver uses deterministic multifrequency source-length-scaled phases and gated counter-inertia',()=>{
 for(const p of config().parts)for(const t of [0,.013,1,4.8,39.25]){
  const k=p.motion.phaseIndex,angle=.035*Math.sin(1.3*t+1.7*k+p.phase)+.020*Math.sin(2.9*t+.6*k+p.phase)+.015*Math.sin(.47*t);
  const expected=Math.max(-p.amplitude,Math.min(p.amplitude,(p.tip-p.root)*angle));assert.equal(F.motionTarget(p,t,true),expected);assert.equal(F.motionTarget(p,t,true),F.motionTarget(p,t,true));
  const short={...p,tip:p.root+(p.tip-p.root)/2};assert.equal(F.motionTarget(short,t,true),expected/2);
  assert.equal(F.motionTarget(p,t,false,{roll:100,rollVelocity:100,bodyVelocity:100}),0);
  assert.equal(F.motionTarget(p,NaN,true),0);
 }
 const p=config().parts[1],t=2;assert.notEqual(F.motionTarget(p,t,true),F.motionTarget({...p,motion:{...p.motion,phaseIndex:2}},t,true));assert.notEqual(F.motionTarget(p,t,true),F.motionTarget(p,t+4.8,true));
 assert.equal(F.motionTarget(p,0,true,{roll:100}),Math.max(-p.amplitude,Math.min(p.amplitude,F.motionTarget(p,0,true)-.02*(p.tip-p.root))));
});
test('v2 advance follows deterministic substep spring dynamics with frame-rate invariant bounded trajectories',()=>{
 const parts=config().parts;
 for(const p of parts){
  const state={x:0,v:0},dt=1/120,t=.3,goal=F.motionTarget(p,t,true);assert.equal(F.advance(p,state,t,dt,true),p.motion.stiffness*goal*dt*dt);assert.equal(state.v,p.motion.stiffness*goal*dt);
  const tracks=[];for(const hz of [30,60,120]){const s={x:0,v:0},samples=[];for(let i=1;i<=120*hz;i++){F.advance(p,s,i/hz,1/hz,true);assert.ok(Number.isFinite(s.x)&&Number.isFinite(s.v));assert.ok(Math.abs(s.x)<=p.amplitude);if(i%hz===0)samples.push(s.x);}tracks.push(samples);}
  for(let j=1;j<3;j++)tracks[0].forEach((x,i)=>assert.ok(Math.abs(x-tracks[j][i])<1e-9,`${p.name} at ${i}: ${x} vs ${tracks[j][i]}`));
 }
});
test('advance neutralizes malformed input and removes outward velocity at the hard envelope',()=>{
 const p=config().parts[1];const bad={x:NaN,v:Infinity};assert.equal(F.advance(p,bad,1,1/60,true),0);assert.deepEqual(bad,{x:0,v:0});
 for(const dt of [NaN,Infinity,-1,0,.05001,1,Number.MAX_VALUE]){const s={x:2,v:3};assert.equal(F.advance(p,s,1,dt,true),2);assert.deepEqual(s,{x:2,v:3});}
 const noTime={x:2,v:3};assert.equal(F.advance(p,noTime,NaN,1/60,true),2);assert.deepEqual(noTime,{x:2,v:3});
 const legacy={...p};delete legacy.motion;const old={x:2,v:3};assert.equal(F.advance(legacy,old,1,1/60,true),0);assert.deepEqual(old,{x:0,v:0});
 for(const sign of [-1,1]){const s={x:sign*p.amplitude,v:sign*10000};F.advance(p,s,1,1/120,true);assert.ok(Math.abs(s.x)<=p.amplitude);assert.ok(s.v*sign<=0);}
 const extreme={x:1e308,v:1e308};F.advance(p,extreme,1,.05,true,{roll:NaN,rollVelocity:Infinity});assert.ok(Number.isFinite(extreme.x)&&Number.isFinite(extreme.v));assert.ok(Math.abs(extreme.x)<=p.amplitude);
});
test('disabled v2 motion settles to exact zero while ignoring every inertia input',()=>{
 for(const p of config().parts){const a={x:p.amplitude,v:90},b={...a};for(let i=1;i<=240;i++){
  F.advance(p,a,i/60,1/60,false,{roll:999,rollVelocity:-999,bodyVelocity:999});F.advance(p,b,i/60,1/60,false);assert.deepEqual(a,b);
 }assert.deepEqual(a,{x:0,v:0});F.advance(p,a,8,1/60,false,{roll:99});assert.deepEqual(a,{x:0,v:0});}
});
test('shipped front bundle selects v4 while explicit v2 fixture remains supported',()=>{
 const ctx={window:{}};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../puppet/rig/js/front-hair-assets.js'),'utf8'),ctx);const actual=JSON.parse(JSON.stringify(ctx.window.FRONT_HAIR_ASSETS.baijie));assert.equal(actual.version,4);assert.equal(actual.motionModel,'outer-follow-wide-v1');assert.deepEqual(actual.parts.map(p=>p.amplitude),[40,80,40]);assert.equal(F.validate(config(),[530,800]),true);
});
test('shifted source alpha stays pinned at roots and follows both complete candidate envelopes at tips',()=>{
 for(const p of config().parts){const [bx,by,w,h]=p.sourceBox,a=new Uint8Array(w*h),x=bx+Math.floor(w/2)+.5,y=p.tip+.5;a[(p.tip-by)*w+Math.floor(w/2)]=255;
  for(const offset of [-p.amplitude,p.amplitude]){assert.ok(Math.abs(F.sampleAlpha(p,a,(x+offset)/2612,y/3941,[2612,3941],offset)-255)<1e-8);assert.equal(F.sampleAlpha(p,a,x/2612,y/3941,[2612,3941],offset),0);assert.equal(F.gain(p.root,p),0);}
 }
});
test('substeps never exceed 1/120 second even just above a floating-point boundary',()=>{
 const p=config().parts[0],dt=1/120+5e-13,time=.7,h=dt/2,expected={x:0,v:0},actual={x:0,v:0};
 for(let i=1;i<=2;i++){const goal=F.motionTarget(p,time-dt+i*h,true);expected.v+=((goal-expected.x)*p.motion.stiffness-expected.v*p.motion.damping)*h;expected.x+=expected.v*h;}
 F.advance(p,actual,time,dt,true);assert.deepEqual(actual,expected);
});
test('v2 validates explicitly bounded reference motion without relaxing legacy v1 guards',()=>{
 const cfg=config();assert.equal(F.validate(cfg,[530,800]),true);
 for(const [field,value] of [['version',0],['version',3],['motionModel','unknown'],['motionModel',undefined]])assert.throws(()=>F.validate({...cfg,[field]:value},[530,800]));
 for(const [field,values] of Object.entries({windGain:[0,-1,1.5001,NaN,Infinity],stiffness:[39,201,NaN],damping:[3.19,18.1,Infinity],phaseIndex:[-1,8.1,NaN]}))for(const value of values){const c=config();c.parts[0].motion[field]=value;assert.throws(()=>F.validate(c,[530,800]),`${field}=${value}`);}
 for(const amplitude of [17.761,49,NaN]){const c=config();c.parts[0].amplitude=amplitude;assert.throws(()=>F.validate(c,[530,800]));}
 const legacy=config();legacy.version=1;delete legacy.motionModel;legacy.parts.forEach(p=>{p.amplitude=3;delete p.motion;});assert.equal(F.validate(legacy,[530,800]),true);legacy.parts[0].amplitude=12.01;assert.throws(()=>F.validate(legacy,[530,800]));
 const p={amplitude:3,phase:.12};assert.equal(F.target(p,1,4.8,true),3*Math.sin(2*Math.PI/4.8+.12));assert.equal(F.target(p,1,4.8,false),0);
});
