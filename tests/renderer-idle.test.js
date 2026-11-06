const test=require('node:test'),assert=require('node:assert/strict');
const {boot}=require('./helpers/renderer-harness.cjs');
function due(h){h.rig.S.t=h.rig.idle.snapshot().nextAt;h.advance(1);assert.ok(h.rig.idle.snapshot().active);}
test('real renderer idle turn cancels on manual face action without pose teleport',async()=>{
 const h=await boot('',{frames:0});assert.ok(h.rig.idle,'renderer must wire interruptible idle');
 due(h);h.advance(12);const x=h.rig.S.angleX.x;
 h.action('face:3711');assert.equal(h.rig.idle.snapshot().active,null);
 assert.equal(h.rig.S.angleX.x,x);h.advance(300);assert.equal(h.rig.idle.snapshot().active,null);
});
test('idle off settles pose but retains breathing, blink and manually triggered jump',async()=>{
 const h=await boot('',{frames:0});assert.ok(h.rig.idle);
 due(h);h.advance(30);h.action('idle:off');h.advance(300);
 assert.ok(Math.abs(h.rig.S.angleX.x)<1e-7);
 const b=h.rig.S.breath.x;h.advance(30);assert.notEqual(h.rig.S.breath.x,b);
 h.action('blink');h.advance(1);assert.equal(h.rig.diagnostics().blinkApplied,true);
 h.action('hop');h.advance(12);assert.ok(h.rig.S.hop>0);h.advance(40);assert.equal(h.rig.S.hop,0);
 assert.equal(h.rig.idle.snapshot().enabled,false);
});
test('native menu hold survives input release; closing it rearms rather than resumes old turn',async()=>{
 const h=await boot('',{frames:0});assert.ok(h.rig.idle);due(h);
 h.action('idle:hold');h.rig.S.t+=40;h.advance();assert.equal(h.rig.idle.snapshot().active,null);
 h.action('idle:release');assert.ok(h.rig.idle.snapshot().nextAt>=h.rig.S.t+14);
});

test('pointer lifecycle owns idle until release, including focus/capture loss',async()=>{
 const h=await boot('',{frames:0});due(h);
 const v=h.rig.diagnostics().view;
 h.events.pointerdown({button:0,pointerId:2,clientX:295*v.s+v.ox,clientY:222*v.s+v.oy,screenX:100,screenY:100,target:{}});
 assert.equal(h.rig.idle.snapshot().active,null);
 h.rig.S.t+=60;h.advance();assert.ok(h.rig.idle.snapshot().held.includes('input'));
 h.events.blur({});assert.equal(h.rig.idle.snapshot().held.length,0);
 assert.ok(h.rig.idle.snapshot().nextAt>h.rig.S.t+13);
});
