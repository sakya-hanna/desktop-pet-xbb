'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createHarness}=require('./helpers/interaction-fixtures.cjs');
test('runtime arbitrates reminders, chat and walking without queued idle playback',async()=>{
 let present;const walks=[],h=await createHarness({configurePet:pet=>{pet.walk=v=>walks.push(v);pet.onChatPresentation=f=>{present=f;return()=>{};};}});
 // This test targets RAF/IPC arbitration. Native verification covers drawing;
 // avoid rasterizing hundreds of identical blocked frames in this unit test.
 h.renderer.render=()=>{};
 try{
  await h.runtime.start();h.state({bounds:{x:700,y:300,width:240,height:348},workArea:{x:0,y:0,width:1920,height:1080},wanderEnabled:true});
  const motion=()=>h.runtime.status().motion.referenceMotion;
  for(let i=0;i<150&&!motion().micro;i++)h.tick(1,100);assert.ok(motion().micro);
  h.state({reminderActive:true});h.tick(2,100);assert.equal(motion().micro,null);assert.equal(motion().active,null);h.tick(1,350);assert.equal(motion().micro,null);
  h.state({reminderActive:false});for(let i=0;i<39;i++){h.tick(1,100);assert.equal(motion().micro,null);assert.equal(motion().active,null);}
  h.action('motion:hum');h.tick(2,100);assert.equal(motion().active,'hum');
  present({id:1,reply:'测试陪伴回应',face:3901,action:'none'});h.tick(2,100);assert.equal(motion().active,null);assert.equal(h.runtime.status().renderedFace,'3901');
  present({id:2,clear:true});for(let i=0;i<39;i++){h.tick(1,100);assert.equal(motion().micro,null);assert.equal(motion().active,null);}
  h.action('walk:now');h.tick(2,100);assert.ok(h.runtime.status().walk);assert.equal(motion().micro,null);
  for(let i=0;i<60&&h.runtime.status().walk;i++){h.tick(1,100);assert.equal(motion().micro,null);assert.equal(motion().active,null);}assert.equal(h.runtime.status().walk,null);assert.ok(walks.some(v=>v.phase==='step'));
  h.action('idle:off');h.action('idle:on');h.action('shell:hide');const t=h.runtime.status().motion.time;h.tick(5,1000);assert.equal(h.runtime.status().motion.time,t);h.action('shell:show');h.tick(1,60000);assert.equal(h.runtime.status().motion.time,t);assert.equal(motion().care,null);assert.deepEqual(h.errors,[]);
 }finally{h.runtime.destroy();}
});
