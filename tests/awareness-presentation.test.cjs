'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createHarness}=require('./helpers/interaction-fixtures.cjs');
async function setup(idle=false){let observe,chat;const results=[],busy=[],events=[];
 const h=await createHarness({idle,configurePet(p){
  p.onAwareness=fn=>{observe=fn;return ()=>{observe=null;};};p.onChatPresentation=fn=>{chat=fn;return ()=>{};};
  p.awarenessResult=(...args)=>results.push(args);p.awarenessBusy=value=>busy.push(value);
  p.awarenessEvent=(phase,reason)=>events.push({phase,reason});
 }});h.runtime.start();h.tick();return {...h,observe:value=>observe(value),chat:value=>chat(value),results,busy,events};
}
test('encouragement displays existing smile and accepted small bubble for five seconds without self-cancellation',async()=>{
 const h=await setup();try{
 h.observe({id:1,text:'姐姐陪着你。'});h.tick(20,80);assert.deepEqual(h.results,[[1,true]]);
 assert.equal(h.runtime.status().renderedFace,'3901');assert.equal(h.busy.at(-1),false);
 const bubble=h.calls.filter(c=>c[0]==='feedback'&&c[1]).at(-1)[1];
 assert.equal(bubble.durationMs,5000);assert.equal(require('../feedback-window.cjs').validFeedback(bubble),true);
 h.observe({id:2,text:'重复不插队'});assert.deepEqual(h.results.at(-1),[2,false]);
 h.tick(50,80);assert.ok(h.runtime.status().chatPresentation);h.tick(12,80);assert.equal(h.runtime.status().chatPresentation,null);
 h.observe({id:1,text:'旧消息不复活'});assert.equal(h.runtime.status().chatPresentation,null);assert.deepEqual(h.errors,[]);
 }finally{h.runtime.destroy();}
});
test('companion starts a connected care gesture before speech and restores the chosen idle setting',async()=>{
 for(const idle of [false,true]){
  const h=await setup(idle);try{
   h.observe({id:1,text:'慢慢来，姐姐陪着你。'});
   assert.equal(h.runtime.status().motion.referenceMotion.micro?.id,'care');
   assert.equal(h.calls.filter(c=>c[0]==='feedback'&&c[1]).length,0,'attention leads the bubble');
   h.tick(12,80);const side=h.runtime.status().motion;
   assert.ok(Math.abs(side.pose.lookX)>.55);assert.ok(Math.abs(side.pose.bodyX)>.001);
   assert.equal(h.runtime.status().motion.referenceMotion.automatic,false);
   const hair=JSON.stringify(side.pose.longHair);
   h.tick(15,80);const nod=h.runtime.status().motion;
   assert.ok(nod.pose.lookY>.15);assert.ok(nod.blink>.15);
   assert.notEqual(JSON.stringify(nod.pose.longHair),hair);
   assert.equal(h.runtime.status().renderedFace,'3901');
   assert.equal(h.calls.filter(c=>c[0]==='feedback'&&c[1]).length,1);
   h.tick(58,80);assert.equal(h.runtime.status().chatPresentation,null);
   assert.equal(h.runtime.status().motion.referenceMotion.automatic,idle);
   assert.deepEqual(h.errors,[]);
  }finally{h.runtime.destroy();}
 }
});
test('moving the mouse away while working does not cancel autonomous encouragement',async()=>{
 const h=await setup();try{
  h.observe({id:1,text:'姐姐陪着你。'});
  assert.equal(h.events.at(-1).phase,'gesture-started');
  for(const type of ['mouseout','mouseleave','pointerleave'])h.emit(h.win,type,{buttons:0,relatedTarget:null});
  assert.equal(h.runtime.status().chatPresentation?.kind,'companion');
  h.tick(20,80);
  assert.equal(h.calls.filter(c=>c[0]==='feedback'&&c[1]).length,1);
  assert.equal(h.events.at(-1).phase,'bubble-sent');
  h.emit(h.win,'mouseout',{buttons:0,relatedTarget:null});
  assert.ok(h.runtime.status().chatPresentation);
  assert.notEqual(h.calls.filter(c=>c[0]==='feedback').at(-1)[1],null);
  h.action('shell:cancel');
  assert.deepEqual(h.events.at(-1),{phase:'response-ended',reason:'shell-cancel'});
 }finally{h.runtime.destroy();}
});
test('chat and game reminders take priority; hidden pet rejects encouragement',async()=>{
 const h=await setup();try{
 h.chat({id:1,reply:'已有聊天',face:3711,action:'none'});h.observe({id:1,text:'不抢聊天'});assert.deepEqual(h.results.at(-1),[1,false]);
 assert.equal(h.runtime.status().chatPresentation.kind,'chat');
 h.chat({id:2,clear:true});h.observe({id:2,text:'陪伴'});assert.deepEqual(h.results.at(-1),[2,true]);
 h.state({visible:true,idleEnabled:false,reminderActive:true});assert.equal(h.runtime.status().chatPresentation,null);
 h.observe({id:3,text:'不抢游戏'});assert.deepEqual(h.results.at(-1),[3,false]);
 h.state({visible:false,idleEnabled:false,reminderActive:false});h.observe({id:4,text:'隐藏时不说'});assert.deepEqual(h.results.at(-1),[4,false]);
 }finally{h.runtime.destroy();}
});
test('touch, chat, reminder and hide cancel the companion gesture and release its idle ownership',async()=>{
 const h=await setup(true);try{
  h.observe({id:1,text:'姐姐陪着你。'});h.tick(8,80);
  let point;
  for(let y=80;y<300&&!point;y+=8)for(let x=40;x<220&&!point;x+=8){if(h.renderer.hitPart(x,y)?.partId==='skirt-front')point={clientX:x,clientY:y};}
  assert.ok(point);h.emit(h.canvas,'pointerdown',point);
  assert.equal(h.runtime.status().chatPresentation,null);assert.equal(h.runtime.status().motion.referenceMotion.micro,null);
  assert.equal(h.runtime.status().motion.referenceMotion.automatic,true);
  h.emit(h.win,'pointerup',{...point,buttons:0});h.action('shell:cancel');h.tick(3,80);
  h.observe({id:2,text:'继续陪伴'});assert.deepEqual(h.results.at(-1),[2,true]);h.tick(5,80);
  h.chat({id:1,reply:'用户聊天优先',face:3711,action:'none'});
  assert.equal(h.runtime.status().chatPresentation.kind,'chat');assert.equal(h.runtime.status().motion.referenceMotion.micro,null);
  assert.equal(h.runtime.status().motion.referenceMotion.automatic,true);
  h.chat({id:2,clear:true});h.tick(2,80);
  h.observe({id:3,text:'再陪伴'});assert.deepEqual(h.results.at(-1),[3,true]);h.tick(5,80);
  h.state({visible:true,idleEnabled:true,reminderActive:true});
  assert.equal(h.runtime.status().chatPresentation,null);assert.equal(h.runtime.status().motion.referenceMotion.micro,null);
  assert.equal(h.runtime.status().motion.referenceMotion.automatic,true);
  h.state({visible:true,idleEnabled:true,reminderActive:false});h.tick(2,80);
  h.observe({id:4,text:'最后一次'});assert.deepEqual(h.results.at(-1),[4,true]);h.action('shell:hide');
  assert.equal(h.runtime.status().chatPresentation,null);assert.equal(h.runtime.status().motion.referenceMotion.micro,null);
  assert.equal(h.runtime.status().motion.referenceMotion.automatic,true);assert.deepEqual(h.errors,[]);
 }finally{h.runtime.destroy();}
});
