const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {boot}=require('./helpers/renderer-harness.cjs');
test('text chat uses the original expression without loading or starting text-paced mouth animation',async()=>{
 const html=fs.readFileSync(path.join(__dirname,'../puppet/rig/index.html'),'utf8');
 assert.doesNotMatch(html,/speech-assets\.js|speech-motion\.js/);
 const h=await boot('?still=1&layers=0',{frames:1}),base=h.rig.S.faceId;
 h.chatReply({reply:'姐姐在这里，弟弟慢慢说。',face:3942,action:'none'});h.advance(20);
 assert.equal(h.rig.dialogue.snapshot().text,'姐姐在这里，弟弟慢慢说。');
 assert.equal(h.rig.faceBlend.snapshot(350).target,3942);assert.equal(h.rig.S.faceId,base);
 assert.equal(h.rig.speechMotion,undefined);assert.equal(h.rig.diagnostics().speech,undefined);
 const face=h.rig.diagnostics().renderedFace;h.advance(100);assert.equal(h.rig.diagnostics().renderedFace,face);
 h.rig.dismissDialogue();h.advance(20);assert.equal(h.rig.diagnostics().faceBlend.target,base);
});
test('fixed touch dialogue stays literal and manual face selection retains precedence',async()=>{
 const h=await boot('?still=1',{frames:1});h.action('dialogue:preview-head');h.advance(20);
 assert.equal(h.rig.dialogue.snapshot().text,'怎么突然模姐姐的头，是希望姐姐做什么呢。');assert.equal(h.rig.speechMotion,undefined);
 h.action('dialogue:preview-chest');h.advance(20);assert.equal(h.rig.dialogue.snapshot().text,'姆，弟弟你这个色鬼。');
 h.chatReply({reply:'新的回复。',face:3942,action:'none'});h.advance(20);h.action('face:3711');h.advance(30);
 assert.equal(h.rig.S.faceId,3711);assert.equal(h.rig.diagnostics().faceBlend.target,3711);
});
