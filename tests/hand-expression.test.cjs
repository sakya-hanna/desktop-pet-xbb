'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createHarness}=require('./helpers/interaction-fixtures.cjs');

test('hand contact goes shy, smiles while held, recovers gently and restores the chosen face',async t=>{
 const h=await createHarness({idle:false});t.after(()=>h.runtime.destroy());h.runtime.start();h.tick(2);
 const status=()=>h.runtime.status(),face=()=>status().renderedFace;
 const p=h.css([784*530/2612,1814*800/3941]);
 assert.equal(h.renderer.hitPart(p.clientX,p.clientY)?.partId,'arm-screen-left');
 h.action('face:3831');h.emit(h.canvas,'pointerdown',p);h.tick(3);assert.equal(face(),'3831');
 h.emit(h.win,'pointermove',{...p,clientX:p.clientX+12});h.tick(12);
 assert.equal(face(),'9002');const id=status().motion.expression.id;
 h.tick(36);assert.equal(face(),'3901');h.tick(120);assert.equal(status().motion.expression.phase,'hold');
 assert.equal(status().motion.expression.id,id);assert.equal(h.calls.filter(c=>c[0]==='feedback'&&c[1]).length,1);
 h.emit(h.win,'pointerup',{...p,buttons:0});h.tick(12);assert.equal(face(),'3942');
 assert.equal(status().motion.expression.phase,'recover');h.tick(60);assert.equal(face(),'3831');
 // A new manual choice still wins during the current reaction. Cancellation
 // clears the reaction, and a late pointer-up cannot revive it.
 h.emit(h.canvas,'pointerdown',p);h.emit(h.win,'pointermove',{...p,clientX:p.clientX+12});h.tick(12);assert.equal(face(),'9002');
 h.action('face:3599');h.tick(48);assert.equal(face(),'3599');h.emit(h.win,'blur');
 h.emit(h.win,'pointerup',{...p,buttons:0});h.tick(60);assert.equal(status().motion.expression,null);assert.equal(face(),'3599');
 assert.deepEqual(h.errors,[]);
});
