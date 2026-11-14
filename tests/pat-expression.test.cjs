'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {createHarness,load,root}=require('./helpers/interaction-fixtures.cjs');
test('new pat face is available through the menu and stays closed during blink and face transitions',async t=>{
 const h=await createHarness({idle:false});t.after(()=>h.runtime.destroy());h.runtime.start();h.tick(2);
 assert.ok(h.meta.blink.closedFaces.includes(9003));assert.ok(h.meta.blink.noBlink.includes(9003));
 assert.equal(h.meta.blink.textures['9003'],undefined,'never replace drawn closed eyes with old blink art');
 const asset='assets/baijie-face-9003.png';assert.equal(require('../resource-policy.cjs').resolveResource('baijie28://app/'+asset,root),path.join(root,asset));
 const texture=load('baijie-face-9003.png'),rect=h.meta.character.faces['9003'];assert.deepEqual([texture.width,texture.height],[rect.w,rect.h]);
 h.action('face:9003');assert.equal(h.runtime.status().renderedFace,'9003');
 const pose=h.runtime.status().motion.pose;
 for(const blink of [0,.4,.6,1]){
  h.renderer.render(pose,'9003',false,blink,false,[{face:'9003',weight:1}]);
  assert.ok(h.draws.some(d=>d.texture==='baijie-face-9003.png'));
 }
 for(const weight of [.1,.49,.51,.9])h.renderer.render(pose,'9003',false,0,false,[{face:'3901',weight:1-weight},{face:'9003',weight}]);
 h.action('face:3942');assert.equal(h.runtime.status().renderedFace,'3942');assert.deepEqual(h.errors,[]);
});
