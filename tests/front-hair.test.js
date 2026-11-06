const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
test('front hair alpha sampling follows the same pinned quintic displacement as visible hair',()=>{
 const file=path.join(__dirname,'../puppet/rig/js/front-hair.js');assert.ok(fs.existsSync(file),'The front-hair runtime sampler is not implemented');const F=require(file);
 const part={sourceBox:[0,0,4,4],textureSize:[4,4],root:1.5,tip:3.5,amplitude:1};const alpha=new Uint8Array(16);alpha[2*4+1]=255;
 assert.equal(F.gain(1.5,part),0);assert.equal(F.gain(2.5,part),0.5);assert.equal(F.gain(3.5,part),1);
 assert.equal(F.sampleAlpha(part,alpha,2/4,2.5/4,[4,4],1),255);assert.equal(F.sampleAlpha(part,alpha,0.5/4,2.5/4,[4,4],1),0);assert.equal(F.sampleAlpha(part,alpha,-1,0,[4,4],1),0);
});
test('front bundle validates source units and produces bounded mesh and interruptible targets',()=>{
 const F=require('../puppet/rig/js/front-hair.js'),vm=require('node:vm'),ctx={window:{}};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../puppet/rig/js/front-hair-assets.js'),'utf8'),ctx);const cfg=ctx.window.FRONT_HAIR_ASSETS.baijie;
 F.validate(cfg,[530,800]);for(const p of cfg.parts){const m=F.mesh(p,cfg.canvas,cfg.sourceCanvas,8);assert.ok(m.rest.length&&m.idx.length);assert.ok(m.rest.every(Number.isFinite));assert.ok(Math.abs(F.target(p,1,cfg.periodSeconds,true))<=p.amplitude);assert.equal(F.target(p,1,cfg.periodSeconds,false),0);assert.equal(F.target(p,NaN,cfg.periodSeconds,true),0);assert.ok(Math.abs(F.target(p,1,cfg.periodSeconds,true)-F.target(p,1+cfg.periodSeconds,cfg.periodSeconds,true))<1e-12);}
 assert.throws(()=>F.validate({...cfg,body:'../model-settings.json'},[530,800]));assert.throws(()=>F.validate(cfg,[1,1]));assert.throws(()=>F.validate({...cfg,parts:[...cfg.parts.slice(0,2)]},[530,800]));
 assert.match(F.fragmentSource,/u_caster/);assert.match(F.fragmentSource,/u_receiver/);assert.match(F.fragmentSource,/u_face/);
});
test('character picking uses moved front alpha and does not turn transparent shadow space into a hit',()=>{
 const F=require('../puppet/rig/js/front-hair.js'),Hit=require('../puppet/rig/js/character-hit.js');const mesh={rest:new Float32Array([0,0,4,0,4,4,0,4]),out:new Float32Array([0,0,4,0,4,4,0,4]),uvs:new Float32Array([0,0,1,0,1,1,0,1]),idx:new Uint16Array([0,1,2,0,2,3])};
 const a=new Uint8Array(16);a[9]=255;const p={sourceBox:[0,0,4,4],textureSize:[4,4],root:1.5,tip:3.5,amplitude:1};const layer=Hit.makeLayer(mesh,new Uint8Array(64),4,4);layer.part='hair';layer.sampleAlpha=(u,v)=>F.sampleAlpha(p,a,u,v,[4,4],1);const view={s:1,ox:0,oy:0};
 assert.equal(Hit.pick([layer],2,2.5,view)?.part,'hair');assert.equal(Hit.hit([layer],0.5,2.5,view),false);
});
