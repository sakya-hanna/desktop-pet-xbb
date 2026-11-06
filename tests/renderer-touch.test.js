const test=require('node:test'),assert=require('node:assert/strict');
const {boot}=require('./helpers/renderer-harness.cjs');
function point(h,x,y,id=31){const v=h.rig.diagnostics().view;return {button:0,pointerId:id,clientX:x*v.s+v.ox,clientY:y*v.s+v.oy,screenX:x*v.s+v.ox+100,screenY:y*v.s+v.oy+100,target:{}};}
test('real renderer chest release shows exact local line without changing expression',async()=>{
 const h=await boot('?still=1&layers=0',{frames:1}),face=h.rig.S.faceId;
 assert.equal(typeof h.rig.pickTest,'function','rest-coordinate picker must be wired to renderer');
 const e=point(h,295,222);assert.equal(h.rig.touchRegion(e.clientX,e.clientY),'chest_touch');
 h.events.pointerdown(e);h.advance(6);h.events.pointerup(e);
 assert.equal(h.rig.dialogue.snapshot().text,'姆，弟弟你这个色鬼。');assert.equal(h.rig.dialogue.snapshot().source,'touch');
 assert.equal(h.rig.S.faceId,face);assert.ok(h.rig.idle.snapshot().held.includes('dialogue'));
});

test('head tap is not pat or face cycle; horizontal back-and-forth emits the exact head line',async()=>{
 const h=await boot('?still=1&layers=0',{frames:1}),face=h.rig.S.faceId;
 const a=point(h,274,70),b=point(h,314,70);
 assert.equal(h.rig.touchRegion(a.clientX,a.clientY),'head_pat');
 h.events.pointerdown(a);h.events.pointerup(a);assert.equal(h.rig.dialogue.snapshot().visible,false);assert.equal(h.rig.S.faceId,face);
 h.events.pointerdown(a);h.advance(8);h.events.pointermove(b);h.advance(8);h.events.pointermove(a);h.events.pointerup(a);
 assert.equal(h.rig.dialogue.snapshot().text,'怎么突然模姐姐的头，是希望姐姐做什么呢。');assert.equal(h.rig.S.faceId,face);
 assert.ok(!h.rig.idle.snapshot().held.includes('input'));
});
test('cancel, capture loss, focus loss and hide cannot turn chest down into a reply',async()=>{
 for(const finish of ['pointercancel','lostpointercapture','blur','hide']){
  const h=await boot('?still=1&layers=0',{frames:1}),e=point(h,295,222);
  h.events.pointerdown(e);
  if(finish==='hide')h.action('dialogue:clear');else h.events[finish](e);
  h.events.pointerup(e);assert.equal(h.rig.dialogue.snapshot().visible,false,finish);
  assert.equal(h.rig.touch.snapshot().active,false);assert.ok(!h.rig.idle.snapshot().held.includes('input'));
 }
});
test('leaving the original region is sticky even when returned before release',async()=>{
 const h=await boot('?still=1&layers=0',{frames:1}),a=point(h,295,222),outside=point(h,10,400);
 h.events.pointerdown(a);h.events.pointermove(outside);h.events.pointermove(a);h.events.pointerup(a);
 assert.equal(h.rig.dialogue.snapshot().visible,false);
});
test('repeated chest touches share cooldown and never duplicate reply or cycle face',async()=>{
 const h=await boot('?still=1&layers=0',{frames:1}),e=point(h,295,222),face=h.rig.S.faceId;
 const tap=()=>{h.events.pointerdown(e);h.events.pointerup(e);};tap();const id=h.rig.dialogue.snapshot().id;
 tap();assert.equal(h.rig.dialogue.snapshot().id,id);assert.equal(h.rig.S.faceId,face);
 h.advance(80);tap();assert.ok(h.rig.dialogue.snapshot().id>id);
});
