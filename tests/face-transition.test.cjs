'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createHarness}=require('./helpers/interaction-fixtures.cjs');
const blend=h=>JSON.parse(JSON.stringify(h.renderer.status().faceBlend));
function tap(h,at){const p=h.css(at);h.emit(h.canvas,'pointerdown',p);h.emit(h.win,'pointerup',{...p,buttons:0});}
test('I10 rapid response replacement starts from all visible residual weights and normal release eases to gentle',async t=>{
 const h=await createHarness({idle:false});t.after(()=>h.runtime.destroy());h.runtime.start();h.tick(2);
 tap(h,[295,222]);h.tick(5);const before=blend(h);assert.equal(before.length,2);
 const p=h.css([784*530/2612,1814*800/3941]);assert.equal(h.renderer.hitPart(p.clientX,p.clientY)?.partId,'arm-screen-left');
 h.emit(h.canvas,'pointerdown',p);h.emit(h.win,'pointermove',{...p,clientX:p.clientX+12});
 assert.equal(h.runtime.status().motion.expression.face,'3901');h.tick();assert.deepEqual(blend(h),before,'retarget must not discard residual face');
 h.tick(3);const mixed=blend(h);assert.equal(mixed.length,3);assert.ok(mixed.every(p=>p.weight>0));
 assert.ok(Math.abs(mixed.reduce((s,p)=>s+p.weight,0)-1)<1e-12);assert.ok(h.draws.some(d=>d.texture==='expression-face'));
 const sent=h.calls.filter(c=>c[0]==='feedback'&&c[1]).length;
 h.emit(h.win,'pointerup',{...p,buttons:0});assert.equal(h.runtime.status().motion.expression.phase,'recover');h.tick();assert.deepEqual(blend(h),mixed);
 h.tick(14);assert.deepEqual(blend(h),[{face:'3942',weight:1}]);assert.equal(h.calls.filter(c=>c[0]==='feedback'&&c[1]).length,sent);
 h.tick(45);assert.equal(h.runtime.status().motion.expression,null);assert.deepEqual(blend(h),[{face:'3942',weight:1}]);
 assert.equal(h.raf.size,1);assert.deepEqual(h.errors,[]);
});
test('I10 manual selection during a mixture erases all temporary residuals even after auto resume',async t=>{
 const h=await createHarness({idle:false});t.after(()=>h.runtime.destroy());h.runtime.start();h.tick(2);tap(h,[295,222]);h.tick(5);
 assert.equal(blend(h).length,2);h.action('face:3496');assert.deepEqual(blend(h),[{face:'3496',weight:1}]);
 h.action('shell:cancel');h.action('face:auto');h.tick(15);
 assert.deepEqual(blend(h),[{face:'3942',weight:1}]);assert.equal(h.runtime.status().motion.expression,null);assert.deepEqual(h.errors,[]);
});
