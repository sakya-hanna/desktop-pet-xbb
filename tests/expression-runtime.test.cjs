'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createHarness}=require('./helpers/interaction-fixtures.cjs');
test('I10 response config survives idle director reconstruction',async t=>{
 const text='弟弟，姐姐在这里。',h=await createHarness({idle:false,responseConfig:{lines:{chest:text}}});t.after(()=>h.runtime.destroy());h.runtime.start();h.tick(2);
 for(const mode of [null,'idle:on','idle:off']){
  if(mode)h.action(mode);chest(h);h.tick();
  assert.equal(h.runtime.status().motion.feedback.text,text);
  assert.equal(h.runtime.status().motion.expression.face,'3563');
  assert.equal(h.calls.filter(c=>c[0]==='feedback'&&c[1]).at(-1)[1].text,text);
  h.action('shell:cancel');
 }assert.deepEqual(h.errors,[]);
});
test('I10 runtime forwards director feedback duration without per-frame duplicate sends',async t=>{
 const h=await createHarness({idle:false});t.after(()=>h.runtime.destroy());h.runtime.start();h.tick(2);chest(h);
 const sent=h.calls.filter(c=>c[0]==='feedback'&&c[1]);assert.equal(sent.length,1);
 assert.equal(sent[0][1].durationMs,h.runtime.status().motion.feedback.durationMs);
 h.tick(20);assert.equal(h.calls.filter(c=>c[0]==='feedback'&&c[1]).length,1);
});
const blend=h=>JSON.parse(JSON.stringify(h.renderer.status().faceBlend));
function chest(h){const p=h.css([295,222]);assert.equal(h.renderer.hitPart(p.clientX,p.clientY)?.partId,'chest');h.emit(h.canvas,'pointerdown',p);h.emit(h.win,'pointerup',{...p,buttons:0});return p;}
test('I10 real runtime to renderer: automatic response, immediate manual override, auto return and expiry',async t=>{
 const h=await createHarness({idle:false});t.after(()=>h.runtime.destroy());h.runtime.start();h.tick(2);chest(h);h.tick();
 assert.equal(h.runtime.status().renderedFace,'3563');h.tick(6);
 assert.ok(blend(h).some(p=>p.face==='3563'&&p.weight>0&&p.weight<1));assert.ok(h.draws.some(d=>d.texture==='expression-face'));
 h.action('face:3831');assert.deepEqual(blend(h),[{face:'3831',weight:1}]);
 h.tick(8);assert.deepEqual(blend(h),[{face:'3831',weight:1}]);
 h.action('face:auto');assert.equal(h.runtime.status().renderedFace,h.runtime.status().motion.expression.face);h.tick(15);
 assert.ok(blend(h).some(p=>p.face===h.runtime.status().motion.expression.face&&p.weight>0));
 h.tick(150);assert.equal(h.runtime.status().motion.expression,null);assert.deepEqual(blend(h),[{face:h.runtime.status().motion.face,weight:1}]);
 assert.equal(h.raf.size,1);assert.deepEqual(h.errors,[]);
});
test('I10 released chest response cancels synchronously on stop/hide/hold/blur/destroy without residual revival',async t=>{
 const h=await createHarness({idle:false});t.after(()=>h.runtime.destroy());h.runtime.start();h.tick(2);
 for(const reason of ['cancel','stop','hide','hold','blur','destroy']){
  chest(h);h.tick(6);assert.ok(h.runtime.status().motion.expression);assert.ok(blend(h).length>1);
  if(reason==='cancel')h.action('shell:cancel');if(reason==='stop')h.runtime.stop();if(reason==='hide')h.action('shell:hide');if(reason==='hold')h.action('idle:hold');if(reason==='blur')h.emit(h.win,'blur');if(reason==='destroy')h.runtime.destroy();
  assert.equal(h.runtime.status().motion.expression,null,reason);assert.deepEqual(blend(h),[{face:h.runtime.status().motion.face,weight:1}],reason+' must draw restoration before any RAF');
  if(reason==='stop')h.runtime.start();if(reason==='hide')h.action('shell:show');if(reason==='hold')h.action('idle:release');h.tick(3);
  assert.equal(h.runtime.status().motion.expression,null);assert.deepEqual(blend(h),[{face:h.runtime.status().motion.face,weight:1}]);
 }assert.deepEqual(h.errors,[]);
});
