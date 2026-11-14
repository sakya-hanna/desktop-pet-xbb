'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createDirector}=require('../src/director.js'),rig=require('../src/material-rig.js'),ch=require('../src/character.js');
const make=()=>createDirector({idleAction:'qianhuili',idle:false,seed:17});
const tick=(d,n)=>{for(let i=0;i<n;i++)d.advance(1/120);return d.snapshot();};
test('head stroke drives both directions while held, keeps the feet and releases without resetting head or hair',()=>{
 for(const side of [-1,1]){
  const d=make(),base=make();tick(d,240);tick(base,240);
  for(const e of [d,base])e.send({type:'down',partId:'head',pointerId:1,x:.56,y:.12});
  tick(d,30);tick(base,30);
  assert.equal(d.snapshot().headStroke.active,false);assert.deepEqual(d.snapshot().pose,base.snapshot().pose,'stationary contact must not drag head');
  d.send({type:'move',pointerId:1,x:.56+side*.09,y:.15});
  const samples=[];
  for(let i=0;i<240;i++){
   const s=d.advance(1/120),b=base.advance(1/120);samples.push({s,b});
   assert.deepEqual(rig.deformPoint([265,798],s.pose,ch.binding,ch.materials.torso),rig.deformPoint([265,798],b.pose,ch.binding,ch.materials.torso));
  }
  const held=d.snapshot(),b=base.snapshot();assert.equal(held.headStroke.active,true);
  assert.equal(held.expression.kind,'head');assert.equal(held.expression.phase,'hold');
  assert.ok((held.pose.headRoll-b.pose.headRoll)*side>.02&&(held.pose.headRoll-b.pose.headRoll)*side<.04,'head follows softly without a wide neck tilt');
  assert.ok((held.pose.headX-b.pose.headX)*side>.001&&(held.pose.headX-b.pose.headX)*side<.003,'head follows with a small lateral shift');
  assert.ok(held.pose.lookY-b.pose.lookY>.15,'soft downward gaze');
  for(const part of Object.values(ch.parts).filter(p=>p.flexible)){
   const movement=samples.map(({s,b})=>Math.hypot(...rig.deformPoint(part.centerline.at(-1),s.pose,ch.binding,part).map((v,i)=>v-rig.deformPoint(part.centerline.at(-1),b.pose,ch.binding,part)[i])));
   assert.ok(Math.max(...movement)>3,'long hair never follows '+part.name);
   assert.ok(samples.some(({s,b})=>Math.abs(s.pose.flexHair[part.name].angles.at(-1)-b.pose.flexHair[part.name].angles.at(-1))>.015),'hair must bend, not merely translate '+part.name);
  }
  const feedback=held.feedback.id;d.send({type:'up',pointerId:1});base.send({type:'up',pointerId:1});
  assert.deepEqual(d.snapshot().pose,held.pose,'release must not reset head or hair');assert.equal(d.snapshot().feedback.id,feedback,'no duplicate line');
  assert.equal(d.snapshot().expression.phase,'recover');
  tick(d,120);tick(base,120);
  assert.ok(Math.abs(d.snapshot().pose.headRoll-base.snapshot().pose.headRoll)<.001);
  assert.ok(Object.keys(d.snapshot().pose.flexHair).some(id=>Math.abs(d.snapshot().pose.flexHair[id].angles.at(-1)-base.snapshot().pose.flexHair[id].angles.at(-1))>.002),'hair must continue after the head returns');
  tick(d,1080);tick(base,1080);
  assert.equal(d.snapshot().expression,null);assert.equal(d.snapshot().headStroke,undefined);
  for(const id of Object.keys(d.snapshot().pose.flexHair))assert.ok(Math.abs(d.snapshot().pose.flexHair[id].angles.at(-1)-base.snapshot().pose.flexHair[id].angles.at(-1))<.002,'hair did not settle '+id);
 }
});
test('vertical strokes count, foreign cancellation is ignored and cancelled strokes never revive',()=>{
 const d=make();tick(d,240);d.send({type:'down',partId:'head',pointerId:1,x:.56,y:.12});tick(d,30);
 d.send({type:'move',pointerId:1,x:.56,y:.16});tick(d,60);assert.equal(d.snapshot().headStroke.active,true);
 assert.equal(d.send({type:'cancel',pointerId:2}),false);assert.equal(d.snapshot().headStroke.active,true);
 const held=d.snapshot().pose;d.send({type:'cancel',pointerId:1});assert.deepEqual(d.snapshot().pose,held);
 assert.equal(d.snapshot().headStroke,undefined);assert.equal(d.snapshot().expression,null);
 tick(d,360);assert.equal(d.snapshot().headStroke,undefined);assert.equal(d.snapshot().expression,null);
});
test('actual picking, held face, both input axes and manual override reach the renderer',async t=>{
 const {createHarness}=require('./helpers/interaction-fixtures.cjs'),h=await createHarness({idle:false});t.after(()=>h.runtime.destroy());h.runtime.start();h.tick(2);
 const checkHair=()=>{
  const pose=h.runtime.status().motion.pose;
  for(const part of Object.values(ch.parts).filter(p=>p.flexible)){
   const draw=h.draws.find(d=>d.texture==='baijie-'+part.name+'.png'),im=h.load(draw.texture);
   assert.deepEqual(draw.positions,rig.deformMesh({rest:draw.rest,uv:draw.uv,indices:draw.indices},pose,ch.binding,part),'hair upload must consume the stroked pose');
   const alpha=(u,v)=>im.data[(Math.max(0,Math.min(im.height-1,Math.floor(v*im.height)))*im.width+Math.max(0,Math.min(im.width-1,Math.floor(u*im.width))))*4+3];
   for(let n=0;n<draw.indices.length;n+=3){
    const ids=Array.from(draw.indices.slice(n,n+3)),weights=[[1,0,0],[0,1,0],[0,0,1],[.5,.5,0],[.5,0,.5],[0,.5,.5],[1/3,1/3,1/3]];
    if(!weights.some(w=>alpha(...[0,1].map(axis=>w.reduce((s,v,j)=>s+v*draw.uv[ids[j]*2+axis],0)))>32))continue;
    const [a,b,c]=ids.map(v=>v*2),area=p=>(p[b]-p[a])*(p[c+1]-p[a+1])-(p[b+1]-p[a+1])*(p[c]-p[a]);
    assert.ok(area(draw.positions)*area(draw.rest)>0,'painted hair triangle folded '+part.name);
   }
  }
 };
 const p=h.css([298,105]);assert.equal(h.renderer.hitPart(p.clientX,p.clientY)?.partId,'head');
 h.action('face:3831');h.emit(h.canvas,'pointerdown',p);h.tick(16);
 h.emit(h.win,'pointermove',{...p,clientX:p.clientX+15,clientY:p.clientY+5});h.tick(20);
 let s=h.runtime.status();assert.equal(s.motion.headStroke.active,true);assert.ok(s.motion.headStroke.offset.every(v=>v>0));
 assert.equal(s.renderedFace,'3901');assert.equal(s.motion.expression.kind,'head');
 assert.ok(h.renderer.status().faceBlend.some(f=>f.face==='3901'&&f.weight>0));
 checkHair();
 h.emit(h.win,'pointermove',{...p,clientX:p.clientX-15,clientY:p.clientY-5});h.tick(30);checkHair();
 h.tick(130);s=h.runtime.status();assert.equal(s.motion.expression.phase,'hold');assert.equal(s.renderedFace,'9003');
 h.tick(1,650);assert.equal(h.runtime.status().motion.headStroke?.active,true,'a long frame is not release while the head pointer is still captured');
 h.action('face:9002');h.tick(2);assert.equal(h.runtime.status().renderedFace,'9002');
 const held=h.runtime.status().motion.pose;h.emit(h.win,'pointerup',{...p,clientX:p.clientX+15,clientY:p.clientY+5,buttons:0});
 assert.deepEqual(h.runtime.status().motion.pose,held);assert.equal(h.runtime.status().motion.headStroke,undefined);
 h.tick(60);assert.equal(h.runtime.status().motion.expression,null);assert.equal(h.runtime.status().renderedFace,'9002');
 checkHair();
 h.emit(h.canvas,'pointerdown',p);h.tick(16);h.emit(h.win,'pointermove',{...p,clientY:p.clientY+10});h.tick(10);assert.equal(h.runtime.status().motion.headStroke.active,true);
 h.emit(h.win,'blur');assert.equal(h.runtime.status().activePointer,null);assert.equal(h.runtime.status().motion.headStroke,undefined);h.tick(40);
 assert.equal(h.runtime.status().motion.expression,null);assert.deepEqual(h.errors,[]);assert.equal(h.raf.size,1);
});
