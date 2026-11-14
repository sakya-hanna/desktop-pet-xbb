'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createHarness}=require('./helpers/interaction-fixtures.cjs'),{catalog}=require('../src/reference-motion.js');
test('I22 actual desktop starts the reference set and plays every menu action including selection while a native menu holds runtime',async t=>{
 const h=await createHarness();t.after(()=>h.runtime.destroy());h.runtime.start();h.tick(2);
 assert.equal(h.runtime.status().motion.motionSet,'qianhuili');h.action('idle:off');
 for(const a of catalog){
  h.action('idle:hold');h.action('motion:'+a.id);h.action('idle:release');h.tick(2);
  assert.equal(h.runtime.status().motion.referenceMotion.active,a.id,a.id+' must survive menu release');
  h.tick(Math.ceil((a.duration+(a.prepareDuration||0)+0.2)/0.1),100);assert.equal(h.runtime.status().motion.referenceMotion.active,null,a.id+' completes');
 }
 assert.equal(h.runtime.status().motion.referenceMotion.completed,catalog.length);assert.equal(h.runtime.status().motion.referenceMotion.jumps,2);
 h.action('face:3831');h.action('motion:hum');h.tick(8,100);assert.equal(h.runtime.status().renderedFace,'3831');
 h.action('motion:stop');h.action('blink');h.tick(3,1000/60);assert.ok(h.runtime.status().motion.blink>0.5,'manual blink is not lost behind the new director');
 h.action('motion:all');h.tick(3);assert.equal(h.runtime.status().motion.referenceMotion.active,catalog[0].id);
 h.action('shell:hide');assert.equal(h.runtime.status().motion.referenceMotion.demoRemaining,0);h.action('shell:show');h.tick(5);assert.equal(h.runtime.status().motion.referenceMotion.active,null);
 assert.deepEqual(h.errors,[]);
});
