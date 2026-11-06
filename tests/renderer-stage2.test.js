const {test}=require('node:test');const assert=require('node:assert/strict');const {boot}=require('./helpers/renderer-harness.cjs');
test('manual IPC blink uses local eye texture and keeps the selected expression',async()=>{
 const h=await boot('?still=1&face=3711',{epoch:900000,frames:1});
 h.action('blink');h.advance(3);
 const d=h.rig.diagnostics();assert.equal(d.blinkApplied,true);assert.equal(d.renderedFace,3711);
 assert.equal(h.rig.S.faceId,3711);h.advance(7);assert.equal(h.rig.diagnostics().blinkApplied,false);
});
test('still mode never auto-blinks; already closed/comic expressions stay unchanged',async()=>{
 const h=await boot('?still=1&face=3901',{frames:400});assert.equal(h.rig.diagnostics().blinkApplied,false);
 for(const face of [3496,3523,3625,3861,4006]){
  h.rig.setFace(face);h.action('blink');h.advance();assert.equal(h.rig.diagnostics().blinkApplied,false);assert.equal(h.rig.diagnostics().renderedFace,face);
 }
});
test('missing optional blink texture retains the current face without whole-face substitution',async()=>{
 const h=await boot('?still=1&face=3711',{frames:1,fail:src=>src.includes('baijie-blink-3711')});
 h.action('blink');h.advance();assert.equal(h.rig.diagnostics().blinkApplied,false);assert.equal(h.rig.diagnostics().renderedFace,3711);
 assert.ok(h.warnings.length);
});
test('IPC hop anticipates, rises and lands without a fixed-height hold or retrigger reset',async()=>{
 const h=await boot('?still=1',{frames:1});h.action('hop');h.advance(2);
 assert.equal(h.rig.S.hop,0);assert.ok(h.rig.S.squash<0);
 h.advance(13);assert.ok(h.rig.S.hop>20&&h.rig.S.hop<26);
 h.action('hop');h.advance(24);assert.equal(h.rig.S.hop,0);assert.equal(h.rig.S.squash,0);
});

test('a missing independent hair texture reverts the whole set to the intact original body',async()=>{
 const h=await boot('?still=1',{frames:1,fail:src=>src.includes('baijie-outer-right')});
 const d=h.rig.diagnostics();assert.equal(d.bodySource,'baijie-body.png');assert.equal(d.hairLayers.length,0);assert.ok(d.assetFallback);
});
