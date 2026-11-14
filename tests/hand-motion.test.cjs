'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createDirector}=require('../src/director.js'),ch=require('../src/character.js'),rig=require('../src/material-rig.js');
const send=(d,type,more={})=>assert.equal(d.send({type,pointerId:7,...more}),true);
const tick=(d,n)=>{for(let i=0;i<n;i++)d.advance(1/120);return d.snapshot().pose;};

test('both hands lead the torso, stay quiet when held and recover before the body and long hair',()=>{
 const observations=[];
 for(const id of ['arm-screen-left','arm-screen-right'])for(const sign of [-1,1]){
  const d=createDirector({idle:false});send(d,'grab-down',{partId:id});send(d,'grab-move',{x:18*sign,y:0});
  const trace=[];for(let i=0;i<360;i++)trace.push(tick(d,1));
  const first=(xs,fn)=>xs.findIndex(fn)/120,body=ch.coupling.body.hand.bodyRoll*.75;
  const handRise=first(trace,p=>p.grab[id][0]*sign>=9),bodyRise=first(trace,p=>p.bodyRoll*sign>=body/2);
  assert.ok(handRise>=0&&handRise<.16,'local hand remains responsive');
  assert.ok(bodyRise-handRise>.22,'body needs a perceptible delayed response to the hand');
  assert.ok(Math.abs(trace.at(-1).bodyRoll-body*sign)<.00005,'held posture settles at its intended lean');
  assert.ok(Math.abs(trace.at(-1).bodyRoll-trace.at(-31).bodyRoll)<.00005,'holding does not introduce a new sway');
  const held=d.snapshot().pose;send(d,'grab-up');assert.deepEqual(d.snapshot().pose,held,'release preserves position and velocity history');
  const release=[];for(let i=0;i<720;i++)release.push(tick(d,1));
  const handReturn=first(release,p=>Math.abs(p.grab[id][0])<1.8),bodyReturn=first(release,p=>Math.abs(p.bodyRoll)<body*.1);
  assert.ok(bodyReturn-handReturn>.25,'body recovery follows the hand, not the hand spring recoil');
  const late=release[Math.ceil(bodyReturn*120)];assert.ok(Math.abs(late.hair['outer-left'][2])>.001,'long hair has a remaining follow-through');
  for(const p of trace.concat(release)){
   assert.ok(Math.hypot(...p.grab[id].map((v,k)=>v/ch.grabs[id].limit[k]))<=1.000001,'retain the original local art envelope');
   assert.equal(p.headRoll,0);assert.equal(p.headX,0);assert.equal(p.headY,0);
   assert.deepEqual(rig.deformPoint([265,798],p,ch.binding),[265,798],'feet do not slide');
  }
  const end=release.at(-1);assert.ok(Math.max(Math.abs(end.bodyRoll),...end.hair['outer-left'].map(Math.abs),...end.grab[id].map(Math.abs))<.00001);
  observations.push({id,sign,handRise,bodyRise,handReturn,bodyReturn});
 }
 console.log('HAND_PHASES '+JSON.stringify(observations));
});

test('hand reversals, releasing while moving and switching hands remain bounded; cancel clears only reaction',()=>{
 const d=createDirector({idleAction:'qianhuili',idle:false,seed:17}),base=createDirector({idleAction:'qianhuili',idle:false,seed:17});
 for(const id of ['arm-screen-left','arm-screen-right']){
  send(d,'grab-down',{partId:id});
  for(let i=0;i<240;i++){
   if(i%12===0)send(d,'grab-move',{x:24*Math.cos(i*.16),y:18*Math.sin(i*.16)});
   const p=tick(d,1);tick(base,1);
   for(const [part,delta]of Object.entries(p.grab))assert.ok(Math.hypot(...delta.map((v,k)=>v/ch.grabs[part].limit[k]))<=1.000001);
  }
  const p=d.snapshot().pose;send(d,'grab-up');assert.deepEqual(d.snapshot().pose,p);
  tick(d,12);tick(base,12);
 }
 d.cancelGrab();
 for(let i=0;i<120;i++){
  const p=tick(d,1),b=tick(base,1);delete p.grab;delete p.cloth;delete b.cloth;assert.deepEqual(p,b,'cancellation does not erase idle/hair history');
 }
});
