'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const reference=require('../src/reference-motion.js'),{binding}=require('../src/character.js');
const remaining=['hum','stretch','sneeze','peek','doze','bounce','wake','rouse','lookAround'];
test('reauthorized turn has its new score and completes after retained actions in the showcase',()=>{
 assert.equal(reference.scores.lookAround.dur,5.6);
 assert.deepEqual(reference.catalog.map(a=>a.id),remaining);
 const m=reference.createMotion({binding,idle:false});assert.equal(m.play('lookAround'),true);
 assert.equal(m.playAll(),true);const seen=[];
 for(let i=0;i<7200;i++){m.step(1/120);const s=m.snapshot().referenceMotion;if(s.active&&seen.at(-1)!==s.active)seen.push(s.active);if(s.completed===remaining.length)break;}
 assert.deepEqual(seen,remaining);assert.equal(m.snapshot().referenceMotion.completed,remaining.length);
});
test('the accepted turn can occur automatically among the other idle actions',()=>{
 assert.equal(reference.catalog.find(a=>a.id==='lookAround').automatic,true);
 const m=reference.createMotion({binding,idle:true,seed:17}),seen=new Set();let previous=null,turns=0,total=0;
 for(let i=0;i<72000;i++){m.step(1/120);const a=m.snapshot().referenceMotion.active;if(a){assert.ok(remaining.includes(a));seen.add(a);if(!previous){total++;if(a==='lookAround')turns++;}}previous=a;}
 assert.ok(seen.has('lookAround')&&seen.size>2);
 assert.ok(turns>0&&turns<total/2,'full turns must remain occasional');
 m.setAuto(false);for(let i=0;i<3600;i++){m.step(1/120);assert.equal(m.snapshot().referenceMotion.active,null);}
});
test('sandboxed preload accepts the redesigned turn and rejects unknown motions',()=>{
 let pet;const listeners=new Map(),received=[];
 const electron={contextBridge:{exposeInMainWorld(_n,v){pet=v;}},ipcRenderer:{on(n,f){listeners.set(n,f);},removeListener(){}}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../desktop-preload.cjs'),'utf8'),{require:n=>{assert.equal(n,'electron');return electron;},process:{isMainFrame:true}});
 pet.onAction(v=>received.push(v));listeners.get('action')({},'motion:lookAround');listeners.get('action')({},'motion:unknown');listeners.get('action')({},'motion:hum');assert.deepEqual(received,['motion:lookAround','motion:hum']);
});
test('runtime starts the turn directly and after menu release, and preserves manual expressions',async()=>{
 const h=await require('./helpers/interaction-fixtures.cjs').createHarness({idle:false});
 try{h.runtime.start();h.tick(2);h.action('motion:lookAround');assert.equal(h.runtime.status().motion.referenceMotion.active,'lookAround');
  h.action('idle:hold');h.action('motion:lookAround');h.action('idle:release');assert.equal(h.runtime.status().motion.referenceMotion.active,'lookAround');
  h.action('face:3942');h.tick(12,100);assert.equal(h.runtime.status().renderedFace,'3942');
  h.tick(1,600);assert.equal(h.runtime.status().motion.referenceMotion.active,'lookAround','a long frame must preserve the turn');
  h.action('shell:hide');assert.equal(h.runtime.status().motion.referenceMotion.active,null);h.action('shell:show');h.tick(2);
  h.action('motion:hum');assert.equal(h.runtime.status().motion.referenceMotion.active,'hum');assert.deepEqual(h.errors,[]);
 }finally{h.runtime.destroy();}
});
