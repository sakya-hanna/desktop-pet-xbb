const test=require('node:test'),assert=require('node:assert/strict');
const {boot}=require('./helpers/renderer-harness.cjs');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const F=require('../puppet/rig/js/front-hair.js');
function config(){const ctx={window:{}};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../puppet/rig/js/front-hair-assets.js'),'utf8'),ctx);return JSON.parse(JSON.stringify(ctx.window.FRONT_HAIR_ASSETS.baijie));}
function correlation(a,b){const ma=a.reduce((s,x)=>s+x,0)/a.length,mb=b.reduce((s,x)=>s+x,0)/b.length;let xy=0,xx=0,yy=0;for(let i=0;i<a.length;i++){const x=a[i]-ma,y=b[i]-mb;xy+=x*y;xx+=x*x;yy+=y*y;}return xy/Math.sqrt(xx*yy);}
test('candidate front hair follows corresponding actual outer displacement without secular phase drift',async()=>{
 const h=await boot('?ax=0',{frames:0}),tracks=[[],[],[]],outer=[[],[]];
 // Fixed head/body isolates hair rhythm, but still runs the actual renderer springs.
 for(let i=0;i<3600;i++){h.advance();const d=h.rig.diagnostics();d.frontHair.forEach((f,j)=>tracks[j].push(f.actualSource));d.hairLayers.forEach((f,j)=>outer[j].push(-Math.sin(f.angle)));}
 for(const [j,side] of [[0,0],[1,0],[2,1]])for(const start of [120,1800,3000]){
  const r=correlation(tracks[j].slice(start,start+600),outer[side].slice(start,start+600));assert.ok(r>.96,`part ${j} window ${start}: correlation ${r}`);
 }
 const cfg=config();assert.equal(cfg.version,4);assert.equal(cfg.motionModel,'outer-follow-wide-v1');assert.deepEqual(cfg.parts.map(p=>p.amplitude),[40,80,40]);
 // CSS half swing at the real default viewport, not source pixels or enlarged previews.
 const scale=(530/2612)*h.rig.diagnostics().view.s;
 for(let j=0;j<3;j++){const a=tracks[j].slice(120),half=(Math.max(...a)-Math.min(...a))/2*scale;assert.ok(half>[.735,1.55,.782][j]*1.4,`part ${j}: ${half} CSS pixels`);}
});
function zeroHair(d){assert.ok(d.hairLayers.every(p=>p.angle===0),'old outer must also stop');assert.ok(d.frontHair.every(p=>p.targetSource===0&&p.actualSource===0),'front must stop');}
test('v4 hold, off, quietUntil and busy gate both wind and inertia with smooth exact-zero settling and resume',async()=>{
 const h=await boot('',{frames:180});const before=h.rig.diagnostics();h.action('idle:hold');h.advance();let d=h.rig.diagnostics();
 assert.ok(d.hairLayers.some(p=>p.angle!==0),'do not snap outer springs on hold');assert.ok(d.frontHair.some(p=>p.actualSource!==0),'do not snap front springs on hold');
 h.advance(299);zeroHair(h.rig.diagnostics());
 // Held motion must ignore even an explicitly forced nonzero head/body inertia.
 h.rig.S.roll.v=100;h.rig.S.bodyX.v=100;h.advance();zeroHair(h.rig.diagnostics());
 h.action('idle:release');h.advance(360);d=h.rig.diagnostics();assert.ok(h.rig.S.t<d.idle.quietUntil);zeroHair(d);h.advance(150);assert.ok(h.rig.diagnostics().frontHair.some(p=>p.actualSource!==0));
 h.action('idle:off');h.advance(300);zeroHair(h.rig.diagnostics());h.action('idle:on');h.advance(360);zeroHair(h.rig.diagnostics());h.advance(150);assert.ok(h.rig.diagnostics().hairLayers.some(p=>p.angle!==0));
 // Isolate busy from quietUntil and held flags via the renderer's own idle snapshot seam.
 const snapshot=h.rig.idle.snapshot;h.rig.idle.snapshot=()=>({...snapshot(),busy:true,quietUntil:0,held:[]});h.advance(300);zeroHair(h.rig.diagnostics());
 h.rig.idle.snapshot=snapshot;h.advance(120);assert.ok(h.rig.diagnostics().frontHair.some(p=>p.actualSource!==0));
 const still=await boot('?still=1&ax=.4&roll=.02',{frames:120});zeroHair(still.rig.diagnostics());
 const forced=await boot('?still=1&hair=.06',{frames:120});assert.ok(forced.rig.diagnostics().hairLayers.every(p=>p.angle===.06));assert.ok(forced.rig.diagnostics().frontHair.every(p=>p.actualSource===0));
 assert.ok(before.hairLayers.some(p=>p.angle!==0));
});
test('v4 targets use this frame outer spring and leave the established active outer waveform unchanged',async()=>{
 const cfg=config(),h=await boot('?ax=0',{frames:0}),outer=[{x:0,v:0},{x:0,v:0}],front=cfg.parts.map(()=>({x:0,v:0}));
 for(let i=0;i<600;i++){h.advance();const t=h.rig.S.t,dt=(((i+1)*1000/60)-(i*1000/60))/1000,d=h.rig.diagnostics();
  outer.forEach((s,j)=>{const goal=Math.sin(t*1.65+j*1.9)*[.055,.065][j];s.v+=((goal-s.x)*(19+j*4)-s.v*5.5)*dt;s.x+=s.v*dt;assert.ok(Math.abs(d.hairLayers[j].angle-s.x)<1e-14);});
  const carrier={left:{x:outer[0].x,amplitude:.055},right:{x:outer[1].x,amplitude:.065}};
  cfg.parts.forEach((p,j)=>{assert.ok(Math.abs(d.frontHair[j].targetSource-F.followTarget(p,carrier,true))<1e-12);F.advanceFollow(p,front[j],dt,true,carrier,cfg.motionModel);assert.ok(Math.abs(d.frontHair[j].actualSource-front[j].x)<1e-12);});
 }
});
test('v4 asset fallback and front-off retain legacy outer motion instead of enabling an orphaned shared gate',async()=>{
 for(const options of [{failFrontShader:true},{fail:src=>src.includes('front-right-receiver')},{frontConfig:{...config(),motionModel:'invalid'}}]){
  const h=await boot('?ax=0',{...options,frames:180});assert.ok(h.rig.diagnostics().frontFallback);h.action('idle:hold');h.advance(300);const d=h.rig.diagnostics();assert.equal(d.frontHair.length,0);assert.equal(d.bodySource,'baijie-layered-body.png');assert.ok(d.hairLayers.some(p=>p.angle!==0));
 }
 const h=await boot('?front=0&ax=0',{frames:180});h.action('idle:off');h.advance(300);assert.ok(h.rig.diagnostics().hairLayers.some(p=>p.angle!==0));
});

