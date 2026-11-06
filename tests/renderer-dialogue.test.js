const test=require('node:test'),assert=require('node:assert/strict');
const {boot}=require('./helpers/renderer-harness.cjs');
test('preview action reaches dialogue channel and interrupts idle without changing face',async()=>{
 const h=await boot('',{frames:0}),face=h.rig.S.faceId;
 h.action('dialogue:preview-head');
 assert.ok(h.rig.dialogue,'renderer must expose the unified dialogue channel');
 const s=h.rig.dialogue.snapshot();assert.equal(s.text,'怎么突然模姐姐的头，是希望姐姐做什么呢。');
 assert.equal(s.visible,true);assert.equal(h.rig.S.faceId,face);
 assert.ok(h.rig.idle.snapshot().held.includes('dialogue'));
});
test('new reply replaces old; stale dismiss cannot close it; current close releases only dialogue hold',async()=>{
 const h=await boot('',{frames:0});h.action('idle:hold');h.action('dialogue:preview-head');
 const id=h.rig.dialogue.snapshot().id;h.action('dialogue:preview-chest');
 assert.equal(h.rig.dialogue.snapshot().text,'姆，弟弟你这个色鬼。');
 h.action('dialogue:dismiss:'+id);assert.equal(h.rig.dialogue.snapshot().visible,true);
 h.action('dialogue:dismiss:'+h.rig.dialogue.snapshot().id);assert.equal(h.rig.dialogue.snapshot().visible,false);
 assert.ok(h.rig.idle.snapshot().held.includes('menu'));assert.ok(!h.rig.idle.snapshot().held.includes('dialogue'));
 h.action('idle:release');assert.ok(h.rig.idle.snapshot().nextAt>h.rig.S.t);
});
test('pagehide clears the transient dialogue and releases its hold',async()=>{
 const h=await boot('',{frames:0});h.action('dialogue:preview-head');h.events.pagehide({});
 assert.equal(h.rig.dialogue.snapshot().visible,false);assert.ok(!h.rig.idle.snapshot().held.includes('dialogue'));
});
test('real frame clock expires dialogue automatically',async()=>{
 const h=await boot('',{frames:0});h.action('dialogue:preview-chest');h.advance(400);
 assert.equal(h.rig.dialogue.snapshot().visible,false);assert.ok(!h.rig.idle.snapshot().held.includes('dialogue'));
});
