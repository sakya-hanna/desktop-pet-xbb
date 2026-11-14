'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createHarness}=require('./helpers/interaction-fixtures.cjs');
const feedback=h=>h.calls.filter(c=>c[0]==='feedback'),shown=h=>feedback(h).filter(c=>c[1]);
const left=[784*530/2612,1814*800/3941];
function skirtPoint(h,entry){
 const image=h.load(entry.texture),[x0,y0,x1,y1]=h.meta.images[entry.texture].alpha_bbox,aim=[(x0+x1)/2,y1-80];let best=null,distance=Infinity;
 const alpha=(x,y)=>x<0||y<0||x>=image.width||y>=image.height?0:image.data[(y*image.width+x)*4+3];
 for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++){
  if(alpha(x,y)<245)continue;const d=(x-aim[0])**2+(y-aim[1])**2;
  if(d>=distance||![-4,0,4].every(dy=>[-4,0,4].every(dx=>alpha(x+dx,y+dy)>240)))continue;distance=d;best=[x+0.5,y+0.5];
 }
 assert.ok(best);return [best[0]*530/image.width,best[1]*800/image.height];
}
test('I9 four authored targets emit distinct actions once, pending clicks and foreign pointers do not',async t=>{
 const h=await createHarness({idle:false});t.after(()=>h.runtime.destroy());h.runtime.start();
 const targets=[{id:'arm-screen-left',at:left},{id:'arm-screen-right',at:[1828.5*530/2612,1579.5*800/3941]},...h.meta.interaction.skirts.parts.filter(e=>e.grab).map(e=>({id:e.id,at:skirtPoint(h,e)}))];
 let count=0,previous=0;
 for(const {id,at}of targets){
  const p=h.css(at);assert.equal(h.renderer.hitPart(p.clientX,p.clientY)?.partId,id);
  h.emit(h.canvas,'pointerdown',p);h.emit(h.win,'pointermove',{...p,clientX:p.clientX+3});h.emit(h.win,'pointerup',{...p,buttons:0});h.tick();assert.equal(shown(h).length,count);
  h.emit(h.canvas,'pointerdown',p);h.emit(h.win,'pointermove',{...p,clientX:p.clientX+12,pointerId:99});assert.equal(shown(h).length,count);
  h.emit(h.win,'pointermove',{...p,clientX:p.clientX+12});assert.equal(shown(h).length,++count,'start must publish before next RAF');
  const value=shown(h).at(-1)[1];assert.ok(value.id>previous);previous=value.id;assert.ok(value.text.includes(id.startsWith('arm-')?'手':'裙子'));
  h.emit(h.win,'pointercancel',{pointerId:99});assert.equal(feedback(h).at(-1)[1].id,value.id);
  h.tick(10);assert.equal(shown(h).length,count);h.emit(h.win,'pointercancel');assert.equal(feedback(h).at(-1)[1],null);h.tick();
 }
 assert.equal(h.runtime.status().motion.completedGestures,0);assert.deepEqual(h.errors,[]);
});
test('I9 chest uses visible material hit and click-only release; head feedback reaches the same transport',async t=>{
 const h=await createHarness({idle:false});t.after(()=>h.runtime.destroy());h.runtime.start();
 const p=h.css([295,222]);assert.equal(h.renderer.hitPart(p.clientX,p.clientY)?.partId,'chest');
 h.emit(h.canvas,'pointerdown',p);h.tick(6);h.emit(h.win,'pointerup',{...p,buttons:0});h.tick();
 assert.equal(shown(h).at(-1)?.[1].text,'姆，弟弟你这个色鬼。');const first=shown(h).at(-1)[1].id;
 h.emit(h.canvas,'pointerdown',p);h.emit(h.win,'pointermove',{...p,clientY:p.clientY+8});h.emit(h.win,'pointerup',{...p,buttons:0});h.tick();assert.equal(shown(h).length,1,'vertical drag must not become a chest click');
 const head=h.css([298.2,80]);assert.equal(h.renderer.hitPart(head.clientX,head.clientY)?.partId,'head');
 h.emit(h.canvas,'pointerdown',head);h.emit(h.win,'pointermove',{...head,clientX:head.clientX-12});h.tick(20);h.emit(h.win,'pointerup',{...head,buttons:0});h.tick();
 assert.equal(shown(h).at(-1)[1].text,'怎么突然模姐姐的头，是希望姐姐做什么呢。');assert.ok(shown(h).at(-1)[1].id>first);
 assert.equal(h.calls.some(c=>c[0]==='drag'),false);assert.deepEqual(h.errors,[]);
});
test('I9 lifecycle clears visible feedback immediately and never resurrects it on resume',async t=>{
 const h=await createHarness({idle:false});t.after(()=>h.runtime.destroy());h.runtime.start();h.action('face:3831');
 let previous=0;
 for(const kind of ['blur','cancel','hide','stop','menu','idle','destroy']){
  const p=pull(h);h.tick(2);const id=shown(h).at(-1)[1].id;assert.ok(id>previous);previous=id;
  h.emit(h.win,'pointerup',{...p,buttons:0});
  if(kind==='blur')h.emit(h.win,'blur');
  if(kind==='cancel')h.action('shell:cancel');
  if(kind==='hide')h.action('shell:hide');
  if(kind==='stop')h.runtime.stop();
  if(kind==='menu')h.action('idle:hold');
  if(kind==='idle')h.action('idle:on');
  if(kind==='destroy')h.runtime.destroy();
  assert.equal(feedback(h).at(-1)[1],null,kind+' requires immediate clear without next RAF');
  assert.equal(h.runtime.status().motion.bubble,null);
  const count=shown(h).length;
  if(kind==='hide')h.action('shell:show');if(kind==='stop')h.runtime.start();if(kind==='menu')h.action('idle:release');if(kind==='idle')h.action('idle:off');
  h.tick(3);assert.equal(shown(h).length,count,'old feedback must not revive');assert.equal(h.runtime.status().renderedFace,'3831');
 }
 assert.deepEqual(h.errors,[]);
});
function pull(h,point=left){const p=h.css(point);assert.equal(h.renderer.hitPart(p.clientX,p.clientY)?.partId,'arm-screen-left');h.emit(h.canvas,'pointerdown',p);h.emit(h.win,'pointermove',{...p,clientX:p.clientX+12});return p;}
test('I9 real hit/runtime sends feedback once, preserves manual face, clears after release and expiry',async t=>{
 const h=await createHarness({idle:false});t.after(()=>h.runtime.destroy());h.runtime.start();h.action('face:3831');
 const p=h.css(left);h.emit(h.canvas,'pointerdown',p);h.emit(h.win,'pointermove',{...p,clientX:p.clientX+3});h.tick();assert.equal(shown(h).length,0);
 h.emit(h.win,'pointermove',{...p,clientX:p.clientX+12});h.tick();assert.equal(shown(h).length,1);
 const first=shown(h)[0][1];assert.equal(first.text,'想牵姐姐的手吗？那就轻轻握住吧。');
 h.tick(30);assert.equal(shown(h).length,1);assert.equal(h.runtime.status().renderedFace,'3831');
 h.emit(h.win,'pointerup',{...p,buttons:0});h.tick(180);assert.equal(shown(h).length,1);assert.equal(feedback(h).at(-1)[1],null);
 assert.equal(h.runtime.status().motion.completedGestures,0);assert.equal(h.calls.some(c=>c[0]==='drag'),false);assert.deepEqual(h.errors,[]);
});
