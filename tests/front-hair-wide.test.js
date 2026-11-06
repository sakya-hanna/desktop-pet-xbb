const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const F=require('../puppet/rig/js/front-hair.js'),{boot}=require('./helpers/renderer-harness.cjs');
function config(){const c={window:{}};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../puppet/rig/js/front-hair-assets.js'),'utf8'),c);return JSON.parse(JSON.stringify(c.window.FRONT_HAIR_ASSETS.baijie));}
function v3(){const c=config();c.version=3;c.motionModel='outer-follow-v1';c.parts.forEach((p,i)=>p.amplitude=[17,36,18][i]);return c;}
test('v4 visible motion exceeds twice candidate19 CSS swing with identical normalized rhythm and outer waveform',async()=>{
 const old=await boot('?ax=0',{frames:0,frontConfig:v3()}),next=await boot('?ax=0',{frames:0}),a=[[],[],[]],b=[[],[],[]];
 for(let i=0;i<1200;i++){old.advance();next.advance();const x=old.rig.diagnostics(),y=next.rig.diagnostics();assert.equal(y.frontFallback,null);assert.deepEqual(Array.from(y.hairLayers,p=>p.angle),Array.from(x.hairLayers,p=>p.angle));
  if(i>120)for(let j=0;j<3;j++){a[j].push(x.frontHair[j].actualSource);b[j].push(y.frontHair[j].actualSource);assert.ok(Math.abs(x.frontHair[j].actualSource/x.frontHair[j].amplitude-y.frontHair[j].actualSource/y.frontHair[j].amplitude)<1e-12);}
  old.glDraws.length=next.glDraws.length=0;
 }
 const scale=530/2612*next.rig.diagnostics().view.s;
 for(let j=0;j<3;j++){const half=v=>(Math.max(...v)-Math.min(...v))/2*scale;assert.ok(half(b[j])>=2*half(a[j]),`strand ${j}: old=${half(a[j])}, next=${half(b[j])}`);assert.ok(half(b[j])>[2.6,5.2,2.6][j]);}
 assert.equal(config().version,4);assert.equal(config().motionModel,'outer-follow-wide-v1');
});
test('v4 envelope is explicit and bounded while v3 cannot opt into a wider envelope accidentally',()=>{
 const c=config();c.version=4;c.motionModel='outer-follow-wide-v1';c.parts.forEach((p,i)=>p.amplitude=[40,80,40][i]);assert.equal(F.validate(c,[530,800]),true);
 for(const model of ['outer-follow-v1','reference-wind-v1',undefined])assert.throws(()=>F.validate({...c,motionModel:model},[530,800]));
 for(const p of c.parts){const s={x:1,v:2};F.advanceFollow(p,s,1/60,true,{left:{x:.03,amplitude:.055},right:{x:.03,amplitude:.065}},c.motionModel);assert.notEqual(s.x,0);const legacy={x:1,v:2};F.advanceFollow(p,legacy,1/60,true,{});assert.deepEqual(legacy,{x:0,v:0});}
 for(let i=0;i<3;i++){const bad=structuredClone(c);bad.parts[i].amplitude=Math.min(84,.28*(bad.parts[i].tip-bad.parts[i].root))+.001;assert.throws(()=>F.validate(bad,[530,800]));const s={x:1,v:2};F.advanceFollow(bad.parts[i],s,1/60,true,{},c.motionModel);assert.deepEqual(s,{x:0,v:0});}
 assert.equal(F.validate(v3(),[530,800]),true);const bad=v3();bad.parts[0].amplitude=18;assert.throws(()=>F.validate(bad,[530,800]));
});
test('wide moved-alpha points outside source crop are sampled by hit inverse and covered by mesh',()=>{
 for(const p of config().parts){const [bx,by,w,h]=p.sourceBox,a=new Uint8Array(w*h),mesh=F.mesh(p,[530,800],[2612,3941]);const xs=Array.from(mesh.rest).filter((_,i)=>i%2===0);const lo=Math.min(...xs)*2612/530,hi=Math.max(...xs)*2612/530;
  for(const sign of [-1,1]){const col=sign<0?1:w-2,y=p.tip+.5,x=bx+col+.5,out=x+sign*p.amplitude;a.fill(0);a[(p.tip-by)*w+col]=255;assert.ok(out<bx||out>=bx+w);assert.ok(Math.abs(F.sampleAlpha(p,a,out/2612,y/3941,[2612,3941],sign*p.amplitude)-255)<1e-8);assert.ok(out>lo&&out<hi);}
  assert.equal(F.gain(p.root,p),0);
 }
 assert.match(F.fragmentSource,/localSample\(u_tex,inverseHair\(p\)\)/);assert.match(F.fragmentSource,/localSample\(u_receiver,p\)/);
});
