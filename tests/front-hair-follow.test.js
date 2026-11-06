const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const F=require('../puppet/rig/js/front-hair.js');
function config(){const ctx={window:{}};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../puppet/rig/js/front-hair-assets.js'),'utf8'),ctx);const c=JSON.parse(JSON.stringify(ctx.window.FRONT_HAIR_ASSETS.baijie));c.version=3;c.motionModel='outer-follow-v1';c.parts.forEach((p,i)=>p.amplitude=[17,36,18][i]);return c;}
test('v3 actual outer carrier selects the matching side, reverses rotation sign and has no time-dependent phase',()=>{
 const outer={left:{x:.0275,amplitude:.055},right:{x:-.0325,amplitude:.065}};
 for(const p of config().parts){const want=p.motion.follow==='left'?-.5*p.amplitude:.5*p.amplitude;assert.equal(F.followTarget(p,outer,true),want);assert.equal(F.followTarget({...p,phase:999},outer,true),want);assert.equal(F.followTarget(p,outer,false),0);
  for(const bad of [undefined,{}, {[p.motion.follow]:{x:NaN,amplitude:.055}}, {[p.motion.follow]:{x:1,amplitude:0}}])assert.equal(F.followTarget(p,bad,true),0);
  for(const sign of [-1,1])assert.equal(F.followTarget(p,{[p.motion.follow]:{x:sign*1e308,amplitude:.055}},true),-sign*p.amplitude);
 }
});
test('v3 follower is substepped, velocity-limited, amplitude-bounded and settles exactly without inertia',()=>{
 for(const p of config().parts){const outer={[p.motion.follow]:{x:.02,amplitude:.055}},dt=1/120+5e-13,h=dt/2,expected={x:0,v:0},actual={x:0,v:0};
  for(let i=0;i<2;i++){expected.v+=(F.followTarget(p,outer,true)-expected.x)*p.motion.stiffness*h-expected.v*p.motion.damping*h;expected.x+=expected.v*h;}
  F.advanceFollow(p,actual,dt,true,outer);assert.ok(Math.abs(actual.x-expected.x)<1e-14);assert.ok(Math.abs(actual.v-expected.v)<1e-12);
  const tracks=[];for(const hz of [30,60,120]){const state={x:0,v:0},samples=[];for(let i=1;i<=4*hz;i++){F.advanceFollow(p,state,1/hz,true,outer);if(i%hz===0)samples.push(state.x);}tracks.push(samples);}for(let j=1;j<3;j++)tracks[0].forEach((x,i)=>assert.ok(Math.abs(x-tracks[j][i])<1e-12));
  for(const sign of [-1,1]){const s={x:sign*1e308,v:sign*1e308};F.advanceFollow(p,s,1/120,true,outer);assert.ok(Number.isFinite(s.x)&&Number.isFinite(s.v));assert.ok(Math.abs(s.x)<=p.amplitude);assert.ok(Math.abs(s.v)<=p.amplitude*4);if(Math.abs(s.x)===p.amplitude)assert.ok(s.x*s.v<=0);}
  const bad={x:NaN,v:Infinity};assert.equal(F.advanceFollow(p,bad,.05,true,outer),0);assert.deepEqual(bad,{x:0,v:0});
  for(const badDt of [NaN,Infinity,0,-1,.0501]){const s={x:1,v:2};F.advanceFollow(p,s,badDt,true,outer);assert.deepEqual(s,{x:1,v:2});}
  const s={x:p.amplitude,v:4*p.amplitude};for(let i=0;i<300;i++)F.advanceFollow(p,s,1/60,false,outer);assert.deepEqual(s,{x:0,v:0});
  for(let i=0;i<600;i++){const drive={[p.motion.follow]:{x:i%2?1e6:-1e6,amplitude:.055}};F.advanceFollow(p,s,.05,true,drive);assert.ok(Math.abs(s.x)<=p.amplitude);assert.ok(Math.abs(s.v)<=4*p.amplitude);}
 }
});
test('v3 guards reject model mismatch, invalid side, malformed dynamics and source-pixel envelopes',()=>{
 const cfg=config();assert.equal(F.validate(cfg,[530,800]),true);
 for(const model of [undefined,'reference-wind-v1','unknown'])assert.throws(()=>F.validate({...cfg,motionModel:model},[530,800]));
 for(const [key,values] of Object.entries({follow:['unknown','right',null],stiffness:[39,201,NaN],damping:[3.19,18.01,Infinity]}))for(const value of values){const c=config();c.parts[0].motion[key]=value;assert.throws(()=>F.validate(c,[530,800]));}
 for(const i of [0,1,2]){const c=config();c.parts[i].amplitude=.12*(c.parts[i].tip-c.parts[i].root)+.001;assert.throws(()=>F.validate(c,[530,800]));const s={x:1,v:2};assert.equal(F.advanceFollow(c.parts[i],s,1/60,true,{}),0);assert.deepEqual(s,{x:0,v:0});}
 const legacy=config();legacy.version=1;delete legacy.motionModel;legacy.parts.forEach(p=>{p.amplitude=3;delete p.motion;});assert.equal(F.validate(legacy,[530,800]),true);legacy.parts[0].amplitude=12.001;assert.throws(()=>F.validate(legacy,[530,800]));
});
test('v3 full source envelopes retain pinned roots and inverse-alpha hit coordinates with unchanged shader',()=>{
 for(const p of config().parts){const [bx,by,w,h]=p.sourceBox,a=new Uint8Array(w*h),x=bx+Math.floor(w/2)+.5,y=p.tip+.5;a[(p.tip-by)*w+Math.floor(w/2)]=255;
  for(const offset of [-p.amplitude,p.amplitude]){assert.ok(Math.abs(F.sampleAlpha(p,a,(x+offset)/2612,y/3941,[2612,3941],offset)-255)<1e-8);assert.equal(F.sampleAlpha(p,a,x/2612,y/3941,[2612,3941],offset),0);assert.equal(F.gain(p.root,p),0);}
  const mesh=F.mesh(p,[530,800],[2612,3941]);assert.ok(mesh.rest.every(Number.isFinite));assert.ok(mesh.idx.every(i=>i<mesh.rest.length/2));
 }
});
