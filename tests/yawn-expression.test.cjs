'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {createMotion}=require('../src/reference-motion.js'),{binding}=require('../src/character.js');
const root=path.resolve(__dirname,'..');
const advance=(m,seconds)=>{for(let i=0;i<Math.round(seconds*120);i++)m.step(1/120);};
test('stretch and wake select the approved independent yawn then release it',()=>{
 for(const [action,at]of [['stretch',1],['wake',3.5]]){
  const m=createMotion({binding,idle:false});assert.equal(m.play(action),true);advance(m,at);
  assert.equal(m.snapshot().face,'9001',action+' must not reuse the closed face');
  advance(m,5);assert.notEqual(m.snapshot().face,'9001');
  m.play(action);advance(m,at);m.cancel();assert.notEqual(m.snapshot().face,'9001');
 }
});
test('yawn artwork is whitelisted and intentionally has no blink replacement',()=>{
 const meta=require('../assets/manifest.json');
 assert.ok(meta.character.faces['9001']);assert.equal(meta.character.labels['9001'],'哈欠');
 assert.ok(meta.character.faceOrder.includes(9001));assert.ok(!meta.character.skip.includes(9001));
 assert.ok(meta.blink.noBlink.includes(9001));assert.equal(meta.blink.textures['9001'],undefined);
 const texture='assets/baijie-face-9001.png';
 assert.equal(require('../resource-policy.cjs').resolveResource('baijie28://app/'+texture,root),path.join(root,texture));
 assert.ok(fs.statSync(path.join(root,texture)).size>0);
 const listeners=new Map();let pet;
 vm.runInNewContext(fs.readFileSync(path.join(root,'desktop-preload.cjs'),'utf8'),{process:{isMainFrame:true},require:name=>{assert.equal(name,'electron');return {contextBridge:{exposeInMainWorld:(_n,api)=>pet=api},ipcRenderer:{on:(n,f)=>listeners.set(n,f),removeListener(){}}};}});
 const received=[];pet.onAction(v=>received.push(v));listeners.get('action')({},'face:9001');assert.deepEqual(received,['face:9001']);
});
test('runtime menu action renders yawn, respects manual face, and clears on cancellation',async t=>{
 const {createHarness}=require('./helpers/interaction-fixtures.cjs');
 const h=await createHarness({idle:false});t.after(()=>h.runtime.destroy());h.runtime.start();h.tick(2);
 h.action('idle:hold');h.action('motion:stretch');h.action('idle:release');h.tick(60);
 assert.equal(h.runtime.status().renderedFace,'9001');assert.ok(h.draws.some(d=>d.texture==='baijie-face-9001.png'));
 const pose=h.runtime.status().motion.pose;
 for(const blink of [0,.5,1]){h.renderer.render(pose,'9001',false,blink,false,[{face:'9001',weight:1}]);assert.ok(h.draws.some(d=>d.texture==='baijie-face-9001.png'));}
 h.action('face:3901');h.tick(2);assert.equal(h.runtime.status().renderedFace,'3901');
 h.action('face:auto');h.tick(15);assert.equal(h.runtime.status().renderedFace,'9001');
 h.action('shell:cancel');assert.notEqual(h.runtime.status().renderedFace,'9001');
 h.action('face:9001');assert.equal(h.runtime.status().manualFace,'9001');assert.equal(h.runtime.status().renderedFace,'9001');
 assert.deepEqual(h.errors,[]);
});
