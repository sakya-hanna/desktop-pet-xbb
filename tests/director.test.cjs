'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const file=path.join(__dirname,'../src/director.js');
const tick=(engine,seconds,rate=60)=>{for(let i=0;i<Math.round(seconds*rate);i++)engine.advance(1/rate);return engine.snapshot();};
test('continuous stroking is recognized without adding head, torso or hair motion',()=>{
  assert.ok(fs.existsSync(file),'The character-connected director has not been implemented');
  const {createDirector}=require(file),e=createDirector({idle:false}),rest=e.snapshot().pose;
  e.send({type:'down',pointerId:1,x:0.55});e.send({type:'move',pointerId:1,x:0.40});
  const left=tick(e,0.6);assert.equal(left.phase,'contact');assert.deepEqual(left.pose,rest);
  const before=e.snapshot().pose.headRoll;e.send({type:'move',pointerId:1,x:0.70});
  assert.equal(e.snapshot().pose.headRoll,before,'Changing direction cannot teleport the pose');
  const right=tick(e,0.6);assert.equal(right.phase,'contact');assert.deepEqual(right.pose,rest);
  const held=tick(e,3);assert.deepEqual(held.pose,rest,'Holding must not add deformation');
});

test('release and cancellation preserve pose continuity and cannot complete a different pointer',()=>{
  const {createDirector}=require(file),e=createDirector({idle:false});
  e.send({type:'down',pointerId:7,x:0.55});e.send({type:'move',pointerId:7,x:0.4});tick(e,0.4);
  const before=e.snapshot().pose;assert.equal(e.send({type:'up',pointerId:7}),true,'Release is not implemented');
  assert.deepEqual(e.snapshot().pose,before,'Release must not zero the pose or hair');
  assert.equal(e.snapshot().bubble,'怎么突然模姐姐的头，是希望姐姐做什么呢。');
  assert.equal(e.snapshot().completedGestures,1);
  tick(e,0.1);e.send({type:'down',pointerId:8,x:0.45});e.send({type:'move',pointerId:8,x:0.65});
  assert.equal(e.send({type:'up',pointerId:7}),false);assert.equal(e.snapshot().pointerId,8);
  const entering=e.snapshot().pose;e.send({type:'cancel',pointerId:8,reason:'lostcapture'});
  assert.deepEqual(e.snapshot().pose,entering);assert.equal(e.snapshot().bubble,null);assert.equal(e.snapshot().completedGestures,1);
  const settled=tick(e,4);assert.equal(settled.pointerId,null);assert.ok(Math.abs(settled.pose.headRoll)<0.001);
  assert.ok(Math.max(...settled.pose.hair['outer-left'].map(Math.abs))<0.003);
});

test('one jump contains preparation, flight, landing and a secondary-motion tail without impulse stacking',()=>{
  const {createDirector}=require(file),e=createDirector({idle:false});
  assert.equal(e.send({type:'jump'}),true,'Jump timeline is missing');
  assert.equal(e.send({type:'jump'}),false);
  const prep=tick(e,0.18);assert.equal(prep.phase,'prepare');assert.ok(prep.pose.compression>0.01);assert.equal(prep.pose.hop,0);
  const air=tick(e,0.30);assert.equal(air.phase,'air');assert.ok(air.pose.hop>0.065);
  const landing=tick(e,0.30);assert.equal(landing.phase,'land');assert.ok(landing.pose.compression>0.005);
  assert.ok(Math.max(...landing.pose.hair['outer-left'].map(Math.abs))>0.002,'Landing must not erase secondary motion');
  const done=tick(e,2);assert.equal(done.pose.hop,0);assert.equal(done.pose.compression,0);assert.equal(done.completedJumps,1);
  assert.equal(e.send({type:'jump'}),true);
});

test('the actual head mesh has no positional snap at the preparation-to-flight boundary',()=>{
  const e=require(file).createDirector({idle:false}),{binding}=require('../src/character.js'),{deformPoint}=require('../src/material-rig.js');
  e.send({type:'jump'});let previous=deformPoint([298.2,100],e.snapshot().pose,binding),largest=0;
  for(let i=0;i<180;i++){
    const next=deformPoint([298.2,100],e.advance(1/120).pose,binding);
    largest=Math.max(largest,Math.hypot(next[0]-previous[0],next[1]-previous[1]));previous=next;
  }
  assert.ok(largest<6,'Real head vertex jumped '+largest+' material pixels in one fixed step');
});

test('idle has bounded attention beats separated by quiet breathing and independent blink timing',()=>{
  const e=require(file).createDirector({idle:true,seed:17}),phases=new Set(),heads=[],breaths=[],blinks=[],hair=[];
  for(let i=0;i<1200;i++){const s=e.advance(1/60);phases.add(s.phase);heads.push(s.pose.headRoll);breaths.push(s.pose.bodyY);blinks.push(s.blink);hair.push(s.pose.hair['outer-left'][2]);}
  assert.ok(phases.has('attend'),'Finite idle attention program is missing');assert.ok(phases.has('quiet'));
  const range=Math.max(...heads)-Math.min(...heads);
  assert.ok(range>0.04&&range<0.07,'I7: smaller attention beats still move both ways');
  assert.ok(Math.max(...breaths)-Math.min(...breaths)>0.001);
  assert.ok(Math.max(...blinks)>0.9);assert.ok(Math.max(...hair)-Math.min(...hair)>0.005);
  const before=e.snapshot().pose;e.send({type:'down',pointerId:1,x:0.55});assert.deepEqual(e.snapshot().pose,before);
  const held=tick(e,5),control=require(file).createDirector({idle:true,seed:17}),untouched=tick(control,25);
  assert.equal(held.phase,'contact');assert.deepEqual(held.pose,untouched.pose,'Touch must not pause or reset normal idle motion');
});

test('I1-L1 local control preserves independent head ownership and exact future idle, hair and jump timelines',()=>{
 const {createDirector}=require(file),partId='arm-screen-left';
 const parent=e=>{const s=e.snapshot();delete s.grab;delete s.pose.grab;delete s.pose.cloth;s.expression??=null;return s;};
 for(const mode of ['head','jump']){
  const e=createDirector({idle:true,seed:17}),control=createDirector({idle:true,seed:17});
  tick(e,4);tick(control,4);
  assert.equal(e.send({type:'grab-down',pointerId:7,partId}),true);
  e.send({type:'grab-move',pointerId:7,x:-20,y:5});tick(e,0.1);tick(control,0.1);
  const held=e.snapshot().pose.grab[partId];e.send({type:'grab-up',pointerId:7});
  assert.deepEqual(e.snapshot().pose.grab[partId],held);assert.ok(Math.hypot(...held)>1);
  const event=mode==='head'?{type:'down',pointerId:8,x:0.55}:{type:'jump'};
  assert.equal(e.send(event),true);assert.equal(control.send(event),true);
  const before=e.snapshot();
  for(const message of [{type:'grab-cancel',pointerId:7},{type:'grab-cancel',pointerId:8},{type:'cancelGrab',pointerId:8},{type:'grab-cancel'}])assert.equal(e.send(message),false);
  assert.deepEqual(e.snapshot(),before,'pointer protocol cannot impersonate local lifecycle control');
  assert.equal(e.cancelGrab(),true);assert.equal(e.cancelGrab(),false,'repeat local cleanup is idempotent');
  assert.deepEqual(parent(e),parent(control));
  for(let i=0;i<240;i++){
   e.advance(1/120);control.advance(1/120);
   assert.deepEqual(e.snapshot().pose.grab[partId],[0,0],'neither local velocity nor target may revive');
   assert.deepEqual(parent(e),parent(control),'future parent trajectory stays bit-for-bit unchanged');
  }
  if(mode==='head')assert.equal(e.snapshot().pointerId,8);else assert.equal(e.snapshot().completedJumps,1);
 }
});
test('invalid input and long-frame recovery cannot poison or retain a stale contact',()=>{
  const e=require(file).createDirector({idle:false});
  assert.equal(e.send({type:'down',pointerId:1,x:NaN}),false,'Non-finite input must be rejected');
  assert.equal(e.send({type:'down',pointerId:-1,x:0.5}),false);assert.equal(e.send(null),false);
  assert.throws(()=>e.advance(Infinity),RangeError);assert.throws(()=>e.advance(-1),RangeError);
  e.send({type:'down',pointerId:2,x:0.5});e.send({type:'move',pointerId:2,x:0.65});tick(e,0.3);
  const before=e.snapshot();const resumed=e.advance(5);
  assert.equal(resumed.pointerId,null);assert.equal(resumed.bubble,null);assert.equal(resumed.completedGestures,0);
  assert.ok(resumed.time-before.time<=0.100001,'Long pauses must not replay several seconds at once');
  const numbers=Object.values(resumed.pose).filter(v=>typeof v==='number');assert.ok(numbers.every(Number.isFinite));
});
