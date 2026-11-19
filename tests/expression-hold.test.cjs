'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createDirector}=require('../src/director.js');
const {createHarness}=require('./helpers/interaction-fixtures.cjs');
const tick=(e,n)=>{for(let i=0;i<n;i++)e.advance(1/120);};
const start=(e,partId,pointerId=1)=>{e.send({type:'grab-down',partId,pointerId});e.send({type:'grab-move',pointerId,x:8,y:0});};
for(const partId of ['arm-screen-left','arm-screen-right','skirt-front','skirt-right'])test('I11 '+partId+' holds through drag and briefly after release without renewing speech',()=>{
 const e=createDirector({idle:false});start(e,partId);const first=e.snapshot(),semantic=partId.startsWith('arm-')?'smile':'hairPout';
 for(let i=0;i<720;i++){if(i%20===0)e.send({type:'grab-move',pointerId:1,x:i%40?8:-8,y:0});e.advance(1/120);}
 assert.equal(e.snapshot().expression?.semantic,semantic,'held expression must survive original fixed timeout');
 assert.equal(e.snapshot().expression.id,first.expression.id);assert.equal(e.snapshot().bubble,null,'speech must still expire');
 e.send({type:'grab-up',pointerId:99});assert.equal(e.snapshot().expression.phase,'hold','foreign release must not end hold');
 const recovery=partId.startsWith('arm-')?'gentle':semantic;
 e.send({type:'grab-up',pointerId:1});assert.equal(e.snapshot().expression.phase,'recover');assert.equal(e.snapshot().expression.semantic,recovery);
 tick(e,60);assert.equal(e.snapshot().expression.semantic,recovery,'keep reaction for 500ms after release');assert.equal(e.snapshot().bubble,null);
 tick(e,36);assert.equal(e.snapshot().expression,null);
 e.send({type:'grab-down',partId,pointerId:2});assert.equal(e.snapshot().expression,null,'pending alone never revives response');
 e.send({type:'grab-move',pointerId:2,x:8,y:0});assert.equal(e.snapshot().expression.id,first.expression.id+1);
});
test('I11 real runtime keeps the rendered face during long hold, manual override and post-release recovery',async t=>{
 const h=await createHarness({idle:false});t.after(()=>h.runtime.destroy());h.runtime.start();h.tick(2);
 const p=h.css([784*530/2612,1814*800/3941]);assert.equal(h.renderer.hitPart(p.clientX,p.clientY)?.partId,'arm-screen-left');
 h.emit(h.canvas,'pointerdown',p);h.emit(h.win,'pointermove',{...p,clientX:p.clientX+12});h.tick(60,100);
 assert.equal(h.runtime.status().motion.expression?.semantic,'smile');assert.equal(h.runtime.status().renderedFace,'3901');
 assert.deepEqual(JSON.parse(JSON.stringify(h.renderer.status().faceBlend)),[{face:'3901',weight:1}]);
 assert.equal(h.calls.filter(c=>c[0]==='feedback'&&c[1]).length,1);assert.equal(h.runtime.status().motion.bubble,null);
 h.action('face:3831');h.tick(5,100);assert.equal(h.runtime.status().renderedFace,'3831');
 h.action('face:auto');h.tick(5,100);assert.equal(h.runtime.status().renderedFace,'3901');
 h.emit(h.win,'pointerup',{...p,buttons:0});h.tick(5,100);assert.equal(h.runtime.status().renderedFace,'3942');
 h.tick(6,100);assert.equal(h.runtime.status().motion.expression,null);assert.deepEqual(JSON.parse(JSON.stringify(h.renderer.status().faceBlend)),[{face:'3942',weight:1}]);
 assert.equal(h.calls.filter(c=>c[0]==='feedback'&&c[1]).length,1);assert.deepEqual(h.errors,[]);
});
test('I11 cancellation after long hold cannot be revived by release; underlying idle and blink remain unchanged',()=>{
 const e=createDirector({idle:true,seed:17}),base=createDirector({idle:true,seed:17});start(e,'skirt-front');
 for(let i=0;i<600;i++){e.advance(1/120);base.advance(1/120);}
 assert.ok(e.snapshot().expression);e.cancelGrab();assert.equal(e.snapshot().expression,null);
 assert.deepEqual(e.snapshot().pose.hair,base.snapshot().pose.hair);assert.equal(e.snapshot().blink,base.snapshot().blink);
 e.send({type:'grab-up',pointerId:1});tick(e,120);assert.equal(e.snapshot().expression,null);
 start(e,'arm-screen-left',2);tick(e,600);e.clearFeedback();e.send({type:'grab-up',pointerId:2});assert.equal(e.snapshot().expression,null);
});
