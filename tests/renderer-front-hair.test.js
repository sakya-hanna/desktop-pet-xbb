const test=require('node:test'),assert=require('node:assert/strict');const {boot}=require('./helpers/renderer-harness.cjs');
function v2Config(){const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),ctx={window:{}};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../puppet/rig/js/front-hair-assets.js'),'utf8'),ctx);const c=JSON.parse(JSON.stringify(ctx.window.FRONT_HAIR_ASSETS.baijie));c.version=2;c.motionModel='reference-wind-v1';c.parts.forEach((p,i)=>{p.amplitude=[12,28,14][i];p.motion={windGain:1,stiffness:[110,80,110][i],damping:4.8,phaseIndex:i};});return c;}
test('live renderer harness advances the v2 spring with existing body/head inertia and reports source targets',async()=>{
 const F=require('../puppet/rig/js/front-hair.js'),cfg=v2Config();
 const h=await boot('',{frames:0,frontConfig:cfg}),states=cfg.parts.map(()=>({x:0,v:0}));
 // Match the harness RAF clock directly, not differences of accumulated S.t.
 for(let i=0;i<180;i++){h.advance(1);const S=h.rig.S,dt=(((i+1)*1000/60)-(i*1000/60))/1000;const d=h.rig.diagnostics(),motion={roll:S.roll.x,rollVelocity:S.roll.v,bodyVelocity:S.bodyX.v};
  assert.equal(d.frontMotionModel,'reference-wind-v1');cfg.parts.forEach((p,j)=>{const expected=F.advance(p,states[j],S.t,dt,true,motion),actual=d.frontHair[j];assert.equal(actual.model,'reference-wind-v1');assert.ok(Math.abs(actual.offsetSource-expected)<1e-10);assert.equal(actual.actualSource,actual.offsetSource);assert.equal(actual.targetSource,F.motionTarget(p,S.t,true,motion));});
 }
});
test('front motion gates hold, release quietUntil, idle-off and still without disabling old outer locks',async()=>{
 const h=await boot('',{frames:180,frontConfig:v2Config()});assert.ok(h.rig.diagnostics().frontHair.some(p=>p.actualSource!==0));
 h.action('idle:hold');h.advance(240);let d=h.rig.diagnostics();assert.ok(d.idle.held.includes('menu'));assert.ok(d.frontHair.every(p=>p.targetSource===0&&p.actualSource===0));assert.equal(d.hairLayers.length,2);assert.ok(d.hairLayers.some(p=>p.angle!==0),'v2 must preserve old outer gate');
 h.action('idle:release');h.advance(360);d=h.rig.diagnostics();assert.ok(h.rig.S.t<d.idle.quietUntil);assert.ok(d.frontHair.every(p=>p.targetSource===0&&p.actualSource===0));h.advance(150);assert.ok(h.rig.diagnostics().frontHair.some(p=>p.actualSource!==0));
 h.action('idle:off');h.advance(240);assert.ok(h.rig.diagnostics().frontHair.every(p=>p.targetSource===0&&p.actualSource===0));
 const still=await boot('?still=1&ax=.4&roll=.02',{frames:120,frontConfig:v2Config()});assert.ok(still.rig.diagnostics().frontHair.every(p=>p.targetSource===0&&p.actualSource===0));
});
test('legacy v1 renderer retains the original spring and never invokes v2 advance',async()=>{
 const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),{createRequire}=require('node:module'),helper=path.join(__dirname,'helpers/renderer-harness.cjs'),local=createRequire(helper),module={exports:{}};
 const adaptedFS={...fs,readFileSync(file,...args){const text=fs.readFileSync(file,...args);if(String(file).endsWith('front-hair-assets.js')){const ctx={window:{}};vm.runInNewContext(text,ctx);const c=JSON.parse(JSON.stringify(ctx.window.FRONT_HAIR_ASSETS));c.baijie.version=1;delete c.baijie.motionModel;c.baijie.parts.forEach((p,i)=>{p.amplitude=[3,3,2.5][i];delete p.motion;});return 'window.FRONT_HAIR_ASSETS='+JSON.stringify(c)+';';}if(String(file).endsWith('front-hair.js'))return text+'\nwindow.FrontHair.advance=()=>{throw Error("v1 must not call v2");};';return text;}};
 vm.runInNewContext(fs.readFileSync(helper,'utf8'),{module,exports:module.exports,__dirname:path.dirname(helper),require:name=>name==='fs'?adaptedFS:local(name),setImmediate,queueMicrotask,Uint8ClampedArray,URLSearchParams});
 const h=await module.exports.boot('',{frames:0}),states=[0,1,2].map(()=>({x:0,v:0}));let prior=0;for(let i=0;i<90;i++){h.advance();const t=h.rig.S.t,dt=t-prior;prior=t;const d=h.rig.diagnostics();assert.equal(d.frontMotionModel,'legacy-sine-v1');d.frontHair.forEach((p,j)=>{const s=states[j],target=[3,3,2.5][j]*Math.sin(t*2*Math.PI/4.8+[.12,0,-.1][j]);s.v+=((target-s.x)*70-s.v*18)*dt;s.x+=s.v*dt;assert.ok(Math.abs(p.actualSource-s.x)<1e-12);});}
});
test('renderer draws three new front strands in candidate order without replacing the two old outer locks',async()=>{
 const h=await boot('',{frames:300});const d=h.rig.diagnostics();assert.ok(Array.isArray(d.frontHair),'Front-hair runtime is not wired');assert.equal(d.hairLayers.length,2);assert.deepEqual(Array.from(d.frontHair,x=>x.name),['fringe','front-left','front-right']);assert.equal(d.bodySource,'baijie-front-body.png');assert.ok(d.frontHair.every(p=>p.finite&&Math.abs(p.offsetSource)<=p.amplitude+1e-6));assert.ok(d.frontHair.some(p=>Math.abs(p.offsetSource)>0.0001));
 assert.deepEqual(Array.from(d.drawOrder),['body','outer:left','outer:right','fringe:hair','faces','fringe:shadow','front-left:shadow','front-left:hair','front-right:shadow','front-right:hair']);assert.equal(d.frontFallback,null);
});
test('front shader initialization failure keeps the old complete outer-hair set',async()=>{
 const h=await boot('?still=1',{frames:1,failFrontShader:true}),d=h.rig.diagnostics();assert.equal(d.frontHair.length,0);assert.equal(d.hairLayers.length,2);assert.equal(d.bodySource,'baijie-layered-body.png');assert.ok(d.frontFallback);
});
test('each missing front asset falls back as one bundle, never exposing the repaired body',async()=>{
 const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ctx={window:{}};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../puppet/rig/js/front-hair-assets.js'),'utf8'),ctx);const cfg=ctx.window.FRONT_HAIR_ASSETS.baijie;
 for(const file of [cfg.body,...cfg.parts.flatMap(p=>[p.texture,p.caster,p.receiver])]){const h=await boot('?still=1',{frames:1,fail:src=>src==='assets/'+file}),d=h.rig.diagnostics();assert.equal(d.frontHair.length,0,file);assert.equal(d.bodySource,'baijie-layered-body.png',file);assert.equal(d.hairLayers.length,2,file);assert.ok(d.frontFallback,file);}
});
test('wrong-size front texture and old outer failure retain their own complete fallback',async()=>{
 const h=await boot('?still=1',{frames:1,dimensions:src=>src.includes('front-right-receiver')?[1,1]:null}),d=h.rig.diagnostics();assert.equal(d.frontHair.length,0);assert.equal(d.bodySource,'baijie-layered-body.png');
 const old=await boot('?still=1',{frames:1,fail:src=>src.includes('baijie-outer-right')});assert.equal(old.rig.diagnostics().bodySource,'baijie-body.png');assert.equal(old.rig.diagnostics().hairLayers.length,0);assert.equal(old.rig.diagnostics().frontHair.length,0);
});
test('still/original/front-off controls remain independent and idle-off settles front motion',async()=>{
 const still=await boot('?still=1',{frames:2});assert.ok(still.rig.diagnostics().frontHair.every(p=>p.offsetSource===0));
 const original=await boot('?still=1&layers=0',{frames:1});assert.equal(original.rig.diagnostics().frontHair.length,0);assert.equal(original.rig.diagnostics().bodySource,'baijie-body.png');
 const old=await boot('?still=1&front=0',{frames:1});assert.equal(old.rig.diagnostics().frontHair.length,0);assert.equal(old.rig.diagnostics().hairLayers.length,2);
 const moving=await boot('',{frames:120});moving.action('idle:off');moving.advance(240);assert.ok(moving.rig.diagnostics().frontHair.every(p=>Math.abs(p.offsetSource)<1e-10));
});
test('all expressions and supported blinks keep front shadows outside the face accumulation framebuffer',async()=>{
 const h=await boot('?still=1',{frames:1});for(const id of h.rig.CFG.faceOrder){h.rig.setFace(id);h.action('blink');h.advance(20);const d=h.rig.diagnostics();assert.equal(d.renderedFace,id);assert.ok(d.frontHair.every(p=>p.finite));assert.equal(d.drawOrder.filter(x=>x==='fringe:shadow').length,1);}
 assert.ok(h.glDraws.some(x=>x.front));assert.ok(h.glDraws.filter(x=>x.front).every(x=>x.framebuffer===null));
});
