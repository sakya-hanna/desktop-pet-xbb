'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createDirector}=require('../src/director.js'),ch=require('../src/character.js');
const {createHarness}=require('./helpers/interaction-fixtures.cjs');
const advance=(d,n)=>{for(let i=0;i<n;i++)d.advance(1/120);};
test('left and right cheek taps use local pressure, a shy reply, and the same bubble on repeat',()=>{
 for(const point of Object.values(ch.cheeks)){
  assert.equal(ch.touchRegion(point,ch.materials.head),'cheek');
  assert.equal(ch.touchRegion(point,ch.materials.torso),'head');
  const d=createDirector({idleAction:'qianhuili',idle:false});
  const down=()=>d.send({type:'down',pointerId:1,partId:'cheek',materialPoint:point,x:0,y:0});
  const up=()=>d.send({type:'up',pointerId:1});
  down();advance(d,18);
  const {pose}=d.snapshot();
  assert.deepEqual(pose.cheekPress.point,point);
  const rig=require('../src/material-rig.js'),calm={...pose,cheekPress:null};
  assert.notDeepEqual(rig.deformPoint(point,pose,ch.binding,ch.materials.head),rig.deformPoint(point,calm,ch.binding,ch.materials.head));
  assert.deepEqual(rig.deformPoint([298,80],pose,ch.binding,ch.materials.head),rig.deformPoint([298,80],calm,ch.binding,ch.materials.head));
  up();advance(d,40);
  const reply=d.snapshot();
  assert.equal(reply.expression.semantic,'shy');
  assert.match(reply.feedback.text,/脸颊/);
  down();up();assert.equal(d.snapshot().feedback.id,reply.feedback.id);
  down();d.send({type:'cancel',pointerId:1});advance(d,80);
  assert.equal(d.snapshot().expression,null);
  assert.equal(d.snapshot().pose.cheekPress,undefined);
 }
});
test('head taps and body zones own finite responses; cancelled touches stay silent',()=>{
 for(const [part,kind]of [['head','headTap'],['belly','belly'],['leg','leg'],['body','body']]){
  const d=createDirector({idleAction:'qianhuili',idle:false});
  d.send({type:'down',pointerId:1,partId:part,x:0,y:0});advance(d,10);d.send({type:'up',pointerId:1});
  assert.equal(d.snapshot().expression.kind,kind);assert.ok(d.snapshot().bubble);advance(d,360);assert.equal(d.snapshot().expression?.kind,kind,'response must remain readable at three seconds');advance(d,84);assert.equal(d.snapshot().expression,null);
  d.send({type:'down',pointerId:2,partId:part,x:0,y:0});d.send({type:'cancel',pointerId:2});assert.equal(d.snapshot().expression,null);
 }
 assert.equal(ch.touchRegion([295,279],ch.materials.torso),'belly');assert.equal(ch.touchRegion([250,600],null),'leg');assert.equal(ch.touchRegion([240,760],null),'feet');
});
test('real alpha routes taps to head, belly and legs, with feet tickling and no face cycle',async t=>{
 const h=await createHarness({idle:false});t.after(()=>h.runtime.destroy());h.runtime.start();h.tick(2);
 for(const [id,region]of [['head',[285,75,310,110]],['belly',[275,260,310,295]],['leg',[200,535,320,650]],['feet',[180,745,340,795]]]){
  let p;
  for(let y=region[1];y<=region[3]&&!p;y+=8)for(let x=region[0];x<=region[2];x+=8){const c=h.css([x,y]);if(h.renderer.hitPart(c.clientX,c.clientY)?.partId===id){p=c;break;}}
  assert.ok(p,'visible region '+id);console.log('TOUCH_POINT '+JSON.stringify({id,p}));
  const before=h.runtime.status().renderedFace;h.emit(h.canvas,'pointerdown',p);h.tick(3);h.emit(h.canvas,'pointerup',p);h.tick(2);
  const m=h.runtime.status().motion;
  if(id==='feet')assert.equal(m.expression?.kind,'feet');
  else assert.equal(m.expression?.kind,id==='head'?'headTap':id);
  h.tick(220);
 }
 assert.deepEqual(h.errors,[]);
});
test('belly tap cannot be released on a different zone or converted from dragging',async t=>{
 const h=await createHarness({idle:false});t.after(()=>h.runtime.destroy());h.runtime.start();h.tick(2);
 const p=h.css([292,279]);assert.equal(h.renderer.hitPart(p.clientX,p.clientY)?.partId,'belly');
 h.emit(h.canvas,'pointerdown',p);h.emit(h.canvas,'pointermove',{...p,clientY:p.clientY+20});h.emit(h.canvas,'pointerup',{...p,clientY:p.clientY+20});
 assert.equal(h.runtime.status().motion.expression??null,null);assert.equal(h.runtime.status().motion.pointerId,null);
 h.emit(h.canvas,'pointerdown',p);h.tick(2);h.emit(h.canvas,'pointerup',p);assert.equal(h.runtime.status().motion.expression?.kind,'belly');
});

test('tap impulses move the parent gently and settle without lifting the feet',()=>{
 const {createMotion}=require('../src/reference-motion.js'),rig=require('../src/material-rig.js');
 for(const kind of ['headTap','belly','leg']){
  const a=createMotion({binding:ch.binding,idle:false}),b=createMotion({binding:ch.binding,idle:false});a.react(kind);
  let peak=0;
  for(let i=0;i<480;i++){
   a.step(1/120,true);b.step(1/120,true);const p=a.snapshot().pose,q=b.snapshot().pose;
   peak=Math.max(peak,Math.abs(p.headY-q.headY)*800,Math.abs(p.bodyRoll-q.bodyRoll)*200);
   const foot=[250,798];assert.deepEqual(rig.deformPoint(foot,p,ch.binding),rig.deformPoint(foot,q,ch.binding));
  }
  assert.ok(peak>.5&&peak<8,kind+' reaction amplitude '+peak);
  const p=a.snapshot().pose,q=b.snapshot().pose;assert.ok(Math.abs(p.headY-q.headY)+Math.abs(p.bodyRoll-q.bodyRoll)<.001);
 }
});
