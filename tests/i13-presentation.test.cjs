'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createHarness}=require('./helpers/interaction-fixtures.cjs');
async function setup(){let receiver=null,removed=0;const h=await createHarness({idle:false,configurePet(pet){pet.onChatPresentation=f=>{receiver=f;return ()=>{receiver=null;removed++;};};}});h.runtime.start();h.tick();return Object.assign(h,{present(value){assert.equal(typeof receiver,'function','runtime subscribes to main-only chat presentation');receiver(value);},removed:()=>removed});}
const bubbles=h=>h.calls.filter(c=>c[0]==='feedback'&&c[1]!==null);
test('I13 reply reaches transient face and one bubble, manual face wins, expiry recovers',async()=>{
 const h=await setup();try{
 h.present({id:1,reply:'姐姐在这里。',face:3901,action:'none'});h.tick(4,60);
 assert.equal(h.runtime.status().renderedFace,'3901');assert.equal(bubbles(h).length,1);assert.equal(bubbles(h)[0][1].kind,'chat');assert.equal(bubbles(h)[0][1].text,'姐姐在这里。');
 h.action('face:3711');h.tick();assert.equal(h.runtime.status().renderedFace,'3711');
 h.action('face:auto');h.tick(4,60);assert.equal(h.runtime.status().renderedFace,'3901');
 h.present({id:1,reply:'重复不续期',face:3665,action:'hop'});assert.equal(bubbles(h).length,1);
 h.tick(45,80);assert.equal(h.runtime.status().renderedFace,'3942');assert.equal(h.runtime.status().chatPresentation,null);assert.equal(h.calls.filter(c=>c[0]==='feedback').at(-1)[1],null);assert.deepEqual(h.errors,[]);
 }finally{h.runtime.destroy();}assert.equal(h.removed(),1);
});
const plain=v=>JSON.parse(JSON.stringify(v));
function point(h,part){for(let y=58;y<340;y+=5)for(let x=30;x<230;x+=5){const hit=h.renderer.hitPart(x,y);if(hit&&(part===null?hit.partId===null:hit.partId===part))return {clientX:x,clientY:y};}throw Error('Real material not found '+part);}
test('I13 allowed model blink and hop reuse the one director clock; unsupported hints do not run',async()=>{
 const h=await setup();try{
 h.present({id:1,reply:'眨个眼。',face:3942,action:'blink'});h.tick(1,80);assert.ok(h.runtime.status().motion.blink>0.9);
 h.tick(4,80);assert.equal(h.runtime.status().motion.blink,0);
 h.present({id:2,reply:'跳一下。',face:null,action:'hop'});h.tick(5,80);assert.ok(h.runtime.status().motion.pose.hop>0);
 const before=bubbles(h).length;h.present({id:3,reply:'不执行未知动作',face:3942,action:'run-code'});assert.equal(bubbles(h).length,before);
 h.present({id:4,reply:'已有但不可选的贴片不强制加载',face:4006,action:'none'});assert.equal(h.runtime.status().chatPresentation.face,null);
 assert.deepEqual(h.errors,[]);
 }finally{h.runtime.destroy();}
});
test('I13 new physical grab interrupts reply without losing capture or expression; stale clear cannot clear touch',async()=>{
 const h=await setup();try{
 h.present({id:1,reply:'原聊天',face:3711,action:'none'});h.tick(4,60);
 const p=point(h,'skirt-front');h.emit(h.canvas,'pointerdown',p);h.emit(h.win,'pointermove',{...p,clientX:p.clientX+12});h.tick(4,60);
 assert.equal(h.runtime.status().chatPresentation,null);assert.ok(h.calls.some(c=>c[0]==='command'&&c[1]==='chat-cancel'));
 assert.equal(h.runtime.status().motion.grab.state,'active');assert.notEqual(h.runtime.status().renderedFace,'3711');
 const before=plain(h.runtime.status().motion);h.present({id:2,reply:'在途晚回被丢弃',face:3711,action:'hop'});h.present({id:3,clear:true});
 assert.deepEqual(plain(h.runtime.status().motion),before);assert.equal(h.runtime.status().activePointer,7);
 h.emit(h.win,'pointerup',{...p,buttons:0});h.present({id:2,reply:'旧ID不能复活',face:3711,action:'none'});assert.equal(h.runtime.status().chatPresentation,null);
 }finally{h.runtime.destroy();}
});
test('I13 cancellation, hidden, stopped and duplicate replies cannot revive presentation',async()=>{
 const h=await setup();try{
 h.present({id:1,reply:'当前',face:3711,action:'none'});h.tick(4,60);h.present({id:2,clear:true});assert.equal(h.runtime.status().chatPresentation,null);
 h.present({id:3,reply:'要隐藏',face:3711,action:'none'});h.action('shell:hide');h.present({id:4,reply:'隐藏中',face:3711,action:'none'});h.action('shell:show');
 assert.equal(h.runtime.status().chatPresentation,null);h.present({id:4,reply:'旧',face:3711,action:'none'});assert.equal(h.runtime.status().chatPresentation,null);
 h.present({id:5,reply:'停机',face:3711,action:'none'});h.runtime.stop();assert.equal(h.runtime.status().chatPresentation,null);assert.equal(h.runtime.status().renderedFace,'3942');
 h.present({id:6,reply:'停机中',face:3711,action:'none'});h.runtime.start();assert.equal(h.runtime.status().chatPresentation,null);
 assert.deepEqual(h.errors,[]);
 }finally{h.runtime.destroy();}
});
test('I13 normal short click and keyboard share face cycle, drag never cycles, manual blink while idle disabled',async()=>{
 const h=await setup();try{
 const p=point(h,null);h.action('face:3599');h.emit(h.canvas,'pointerdown',p);h.tick(1,80);h.emit(h.win,'pointerup',{...p,buttons:0});assert.equal(h.runtime.status().manualFace,'3831');
 h.emit(h.win,'keydown',{key:'1',buttons:0});assert.equal(h.runtime.status().manualFace,'3901');h.action('face-next');assert.equal(h.runtime.status().manualFace,'3942');
 h.emit(h.win,'keydown',{key:' ',buttons:0});h.tick(1,80);assert.ok(h.runtime.status().motion.blink>0.9);
 h.emit(h.win,'keydown',{key:'2',target:{tagName:'INPUT'},buttons:0});assert.equal(h.runtime.status().manualFace,'3942');
 const q=point(h,'skirt-front');h.emit(h.canvas,'pointerdown',q);h.emit(h.win,'pointermove',{...q,clientX:q.clientX+12});h.tick();h.emit(h.win,'pointerup',{...q,buttons:0});assert.equal(h.runtime.status().manualFace,'3942');
 }finally{h.runtime.destroy();}
});
