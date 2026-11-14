'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createHarness}=require('./helpers/interaction-fixtures.cjs');
test('I20 production desktop consumes the new spatial channels and retains active-grab picking, expression and manual face priority',async t=>{
 const h=await createHarness();t.after(()=>h.runtime.destroy());h.runtime.start();h.tick(2);h.tick(50,100);
 let s=h.runtime.status();assert.equal(s.motion.idleAction?.name,'soft-look');assert.ok(s.motion.pose.lookX<-0.3);assert.ok(s.motion.pose.breath>0);
 assert.equal(h.renderer.status().pose.lookX,s.motion.pose.lookX,'new state reaches actual renderer');
 let p=null;for(let y=120;y<240&&!p;y+=2)for(let x=55;x<120;x+=2)if(h.renderer.hitPart(x,y)?.partId==='arm-screen-left'){p={clientX:x,clientY:y};break;}
 assert.ok(p,'real arm material is still hittable during new parent geometry');
 h.emit(h.canvas,'pointerdown',p);h.emit(h.win,'pointermove',{...p,clientX:p.clientX+10});h.tick(10,100);
 s=h.runtime.status();assert.equal(s.motion.grab.state,'active');assert.equal(s.motion.expression.kind,'hand');
 assert.equal(s.renderedFace,'3901');assert.equal(s.motion.idleAction.completed,0);
 const pointer=s.activePointer;h.emit(h.win,'pointerup',{...p,pointerId:pointer+1,buttons:0});assert.equal(h.runtime.status().activePointer,pointer);
 h.emit(h.win,'pointerup',{...p,pointerId:pointer,buttons:0});h.tick(10,100);assert.equal(h.runtime.status().activePointer,null);
 h.action('face:3831');h.tick(10,100);assert.equal(h.runtime.status().renderedFace,'3831');
 h.action('idle:off');h.tick(2,100);assert.equal(h.runtime.status().motion.pose.lookX,0);assert.equal(h.runtime.status().motion.pose.breath,0);
 assert.deepEqual(h.errors,[]);
});
