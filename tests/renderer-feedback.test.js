const test=require('node:test'),assert=require('node:assert/strict');
const {boot}=require('./helpers/renderer-harness.cjs');
function point(h,x,y,id=41){const v=h.rig.diagnostics().view;return {button:0,pointerId:id,clientX:x*v.s+v.ox,clientY:y*v.s+v.oy,screenX:x*v.s+v.ox+100,screenY:y*v.s+v.oy+100,target:{}};}
test('head contact gently previews expression without mutating manual face; cancel restores',async()=>{
 const h=await boot('?still=1&layers=0',{frames:1}),base=h.rig.S.faceId,e=point(h,294,50);
 h.events.pointerdown(e);h.advance(10);
 const d=h.rig.diagnostics();assert.ok(d.feedback,'feedback must be integrated');
 assert.equal(d.feedback.face,3942);assert.equal(d.faceBlend.target,3942);assert.ok(d.faceBlend.layers.length>1);
 assert.equal(h.rig.S.faceId,base);assert.equal(h.rig.dialogue.snapshot().visible,false);
 h.events.pointercancel(e);h.advance(30);assert.equal(h.rig.diagnostics().faceBlend.target,base);assert.equal(h.rig.diagnostics().feedback.face,null);
});

test('accepted chest reply goes surprise to pout then restores latest base, not a face cycle',async()=>{
 const h=await boot('?still=1&layers=0',{frames:1}),base=h.rig.S.faceId,e=point(h,295,222);
 h.events.pointerdown(e);h.advance(3);assert.equal(h.rig.diagnostics().feedback.face,null);
 h.events.pointerup(e);h.advance(1);assert.equal(h.rig.diagnostics().feedback.face,3563);
 assert.equal(h.rig.dialogue.snapshot().text,'姆，弟弟你这个色鬼。');
 h.advance(22);assert.equal(h.rig.diagnostics().feedback.face,3665);
 h.advance(100);const d=h.rig.diagnostics();assert.equal(d.feedback.face,null);assert.equal(d.faceBlend.target,base);assert.equal(d.faceBlend.active,false);assert.equal(d.feedback.pose.angleY,0);
});
test('manual face overrides a held or released interaction permanently and ignores stale release',async()=>{
 for(const released of [false,true]){
  const h=await boot('?still=1&layers=0',{frames:1}),e=point(h,295,222);
  h.events.pointerdown(e);if(released)h.events.pointerup(e);h.advance(5);
  h.action('face:3901');h.events.pointerup(e);h.advance(140);
  assert.equal(h.rig.S.faceId,3901);assert.equal(h.rig.diagnostics().faceBlend.target,3901);assert.equal(h.rig.diagnostics().feedback.face,null);
  if(!released)assert.equal(h.rig.dialogue.snapshot().visible,false);
 }
});
test('new pointer, invalid drag and menu cancel feedback without permanently holding idle',async()=>{
 const h=await boot('?still=1&layers=0',{frames:1}),e=point(h,294,50);
 h.events.pointerdown(e);h.advance(10);assert.ok(h.rig.diagnostics().feedback.pose.angleY>0);
 h.events.pointermove(point(h,10,400));h.events.pointerup(e);h.advance(30);
 assert.equal(h.rig.diagnostics().feedback.active,false);assert.ok(!h.rig.idle.snapshot().held.includes('feedback'));
 h.events.pointerdown(e);h.advance(10);h.action('idle:hold');h.advance(30);
 assert.equal(h.rig.diagnostics().feedback.face,null);assert.ok(h.rig.idle.snapshot().held.includes('menu'));
});
test('keyboard blink is a manual interruption just like menu blink',async()=>{
 const h=await boot('?still=1&layers=0',{frames:1}),e=point(h,294,50);
 h.events.pointerdown(e);h.advance(10);h.events.keydown({key:' '});h.advance(20);
 assert.equal(h.rig.diagnostics().feedback.face,null);assert.equal(h.rig.touch.snapshot().active,false);
});
