'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createDirector}=require('../src/director.js');
const character=require('../src/character.js');
const {deformPoint}=require('../src/material-rig.js');
const TARGETS=['arm-screen-left','arm-screen-right','skirt-front','skirt-right'];
const HAIR=['outer-left','outer-right','fringe','front-left','front-right'];
const CLOTH=['skirt-front','skirt-right'];
const tick=(d,n)=>{for(let i=0;i<n;i++)d.advance(1/120);return d.snapshot();};
const down=(d,partId,pointerId=7)=>assert.equal(d.send({type:'grab-down',partId,pointerId}),true);
const move=(d,x,y,pointerId=7)=>assert.equal(d.send({type:'grab-move',x,y,pointerId}),true);
const up=(d,pointerId=7)=>assert.equal(d.send({type:'grab-up',pointerId}),true);
const body=s=>['bodyRoll','bodyX','bodyY'].map(k=>s.pose[k]);
const hair=s=>HAIR.flatMap(k=>s.pose.hair[k]);
const maxDelta=(a,b)=>Math.max(...a.map((v,i)=>Math.abs(v-b[i])));
const cloth=s=>CLOTH.flatMap(k=>s.pose.cloth?.[k]||[0,0]);

test('I4 C1: each of four local grabs drives body, five hair chains and passive skirt offsets, including idle:false',t=>{
  const observations=[];
  for(const idle of [false,true])for(const partId of TARGETS){
    const d=createDirector({idle,seed:17}),control=createDirector({idle,seed:17});
    tick(d,456);tick(control,456);
    down(d,partId);const [lx,ly]=character.grabs[partId].limit;move(d,lx*0.75,ly*0.3);
    const s=tick(d,48),base=tick(control,48);
    observations.push({partId,idle,body:maxDelta(body(s),body(base)),hair:maxDelta(hair(s),hair(base)),cloth:Math.max(...cloth(s).map(Math.abs))});
    assert.deepEqual(Object.keys(s.pose.hair),HAIR);
    assert.ok(HAIR.every(k=>s.pose.hair[k].length===3));
    assert.equal(s.bubble,null,'grab must not add a bubble');
    assert.deepEqual([s.pose.headRoll,s.pose.headX,s.pose.headY],[base.pose.headRoll,base.pose.headX,base.pose.headY],'no independent drag-driven head bend');
  }
  t.diagnostic(JSON.stringify(observations));
  assert.ok(observations.every(o=>o.body>0.001),'all four targets must change parent body relative to same-seed/time control');
  assert.ok(observations.every(o=>o.hair>0.0001),'body must drive secondary hair with idle disabled too');
  assert.ok(observations.every(o=>o.cloth>0.005),'both skirts must receive passive material-pixel motion');
});

test('I4 C2: real hips transform pulls hands with the drag and resists skirt pulls; normalized vertical drags also respond',()=>{
  const rest=[character.binding.neck[0],200];
  for(const partId of TARGETS)for(const sign of [-1,1]){
    const hand=partId.startsWith('arm-'),d=createDirector({idle:false}),oversized=createDirector({idle:false});
    const [lx,ly]=character.grabs[partId].limit;
    down(d,partId);down(oversized,partId);move(d,lx*sign,0);move(oversized,lx*sign*100,0);
    const s=tick(d,180),large=tick(oversized,180);
    // No part/weights: exercise the existing hips parent, not new local cloth code.
    const p=deformPoint(rest,s.pose,character.binding);
    assert.ok((p[0]-rest[0])*sign*(hand?1:-1)>1,`${partId}: actual upper torso has wrong screen direction`);
    assert.ok(maxDelta(body(s),body(large))<1e-12,'coupling must normalize the already-limited displacement');
    const vertical=createDirector({idle:false});down(vertical,partId);move(vertical,0,ly*sign);
    // I8 skirt response is intentionally slower; keep the displacement/direction
    // requirement after its response has developed, not at the old fast deadline.
    const v=tick(vertical,hand?36:90),vp=deformPoint(rest,v.pose,character.binding);
    assert.equal(v.pose.bodyRoll,0);assert.equal(v.pose.bodyX,0);
    assert.ok((vp[1]-rest[1])*sign*(hand?1:-1)>0.1,'pure vertical force must not be discarded');
    assert.ok(Math.max(...hair(v).map(Math.abs))>1e-5,'vertical parent velocity must reach hair');
  }
});

test('I4 C3: parent-driven secondary motion has different lags, gravity correction and a continuous decaying release',()=>{
  const d=createDirector({idle:false});down(d,TARGETS[0]);move(d,24,0);
  const traces=[];for(let i=0;i<300;i++)traces.push(tick(d,1));
  const peak=values=>values.reduce((best,v,i)=>Math.abs(v)>Math.abs(values[best])?i:best,0);
  const root=traces.map(s=>s.pose.hair['outer-left'][0]),tip=traces.map(s=>s.pose.hair['outer-left'][2]);
  const fringe=traces.map(s=>s.pose.hair.fringe[0]),front=traces.map(s=>s.pose.hair['front-left'][2]);
  assert.ok(peak(tip)>peak(root)+3,'long hair must propagate root to tip rather than move in lockstep');
  assert.ok(peak(fringe)<peak(root),'fringe should react faster than long hair');
  assert.ok(peak(front)<peak(tip),'front curls should settle before the long outer tips');
  assert.ok(Math.max(...fringe.map(Math.abs))<Math.max(...root.map(Math.abs)),'fringe remains smaller');
  assert.deepEqual(Object.keys(traces[30].pose.cloth),CLOTH,'lining is not a cloth target');
  assert.notDeepEqual(traces[30].pose.cloth[CLOTH[0]],traces[30].pose.cloth[CLOTH[1]],'skirts have different gains/timing');
  for(const id of HAIR)assert.ok(Math.abs(traces.at(-1).pose.hair[id][0])>0.001,'held tilt retains gravity correction: '+id);
  const held=d.snapshot().pose;up(d);assert.deepEqual(d.snapshot().pose,held,'release cannot zero or teleport any pose channel');
  const first=tick(d,1);assert.ok(Math.abs(first.pose.bodyRoll)>0.01);
  assert.ok(Math.max(...hair(first).map(Math.abs))>0.001);
  const tail=tick(d,960);
  assert.ok(Math.max(...body(tail).map(Math.abs),...hair(tail).map(Math.abs),...cloth(tail).map(Math.abs))<1e-5,'all interaction-derived tails settle without extra wind/sine');
});

test('I4 C4: pending is inert; all four local springs, regrabs and foreign-pointer rejection stay independent and continuous',()=>{
  const d=createDirector({idle:false}),control=createDirector({idle:false});
  down(d,TARGETS[0]);tick(d,36);tick(control,36);
  assert.deepEqual(body(d.snapshot()),body(control.snapshot()));assert.deepEqual(hair(d.snapshot()),hair(control.snapshot()));
  assert.deepEqual(cloth(d.snapshot()),[0,0,0,0]);up(d);
  const refs=TARGETS.map(()=>createDirector({idle:false}));
  for(let i=0;i<TARGETS.length;i++){
    const before=d.snapshot(),id=TARGETS[i],pointerId=10+i;
    down(d,id,pointerId);down(refs[i],id,pointerId);
    assert.deepEqual(body(d.snapshot()),body(before));assert.deepEqual(hair(d.snapshot()),hair(before));assert.deepEqual(cloth(d.snapshot()),cloth(before));
    move(d,10-i*3,6,pointerId);move(refs[i],10-i*3,6,pointerId);
    const current=d.snapshot();
    for(const event of [{type:'grab-cancel',pointerId:99},{type:'cancel',pointerId},{type:'grab-up',pointerId:99},
      {type:'grab-move',pointerId,x:NaN,y:0},{type:'grab-move',pointerId,x:0,y:Infinity},
      {type:'grab-cancel',pointerId,partId:TARGETS[(i+1)%4]}]){
      assert.equal(d.send(event),false);assert.deepEqual(d.snapshot(),current);
    }
    for(let j=0;j<10;j++){
      tick(d,1);for(const ref of refs)tick(ref,1);
      for(let k=0;k<=i;k++)assert.deepEqual(d.snapshot().pose.grab[TARGETS[k]],refs[k].snapshot().pose.grab[TARGETS[k]]);
    }
    const held=d.snapshot().pose;up(d,pointerId);up(refs[i],pointerId);assert.deepEqual(d.snapshot().pose,held);
  }
  const before=d.snapshot().pose;down(d,TARGETS[3],25);assert.deepEqual(d.snapshot().pose,before,'same-part regrab keeps positions and secondary motion');
  move(d,-10,-6,25);assert.deepEqual(d.snapshot().pose,before,'new target is a spring goal, not an immediate pose write');
});

// Ownership/optional local fields are not base motion. Everything else, including
// base hair, feedback, phase, RNG-driven idle/blink and jump counters, is compared.
const baseState=d=>{const s=d.snapshot();delete s.grab;delete s.pose.grab;delete s.pose.cloth;return s;};
function cleanLocal(d){
  assert.ok(Object.values(d.snapshot().pose.grab).every(pair=>pair.every(v=>v===0)));
  assert.deepEqual(cloth(d.snapshot()),[0,0,0,0]);
}
test('I4 C5: active lifecycle or owned-pointer cancellation restores exact base now and on every future step',()=>{
  for(const partId of TARGETS)for(const kind of ['lifecycle','pointer']){
    const d=createDirector({seed:43}),control=createDirector({seed:43});
    tick(d,456);tick(control,456);down(d,partId);move(d,16,-8);tick(d,42);tick(control,42);
    assert.ok(maxDelta(body(d.snapshot()),body(control.snapshot()))>0.001);
    assert.equal(kind==='lifecycle'?d.cancelGrab():d.send({type:'grab-cancel',pointerId:7}),true);
    assert.equal(d.snapshot().pointerId,null);assert.equal(d.snapshot().grab,null);cleanLocal(d);
    assert.deepEqual(baseState(d),baseState(control),'cancel must reveal base rather than reset or damp it');
    assert.equal(d.cancelGrab(),false,'cleanup is idempotent');
    for(let i=0;i<480;i++){
      tick(d,1);tick(control,1);cleanLocal(d);
      assert.deepEqual(baseState(d),baseState(control),'no hidden interaction velocity or altered random schedule may revive');
    }
  }
});

test('I4 C6: cancelling released tails preserves a later unrelated head contact, head feedback or jump',()=>{
  for(const mode of ['head-held','head-released','jump']){
    const d=createDirector({seed:29}),control=createDirector({seed:29});
    tick(d,456);tick(control,456);
    for(const partId of [TARGETS[0],TARGETS[3]]){
      down(d,partId);move(d,16,7);tick(d,18);tick(control,18);up(d);
    }
    if(mode==='jump')for(const e of [d,control])assert.equal(e.send({type:'jump'}),true);
    else for(const e of [d,control]){
      assert.equal(e.send({type:'down',pointerId:8,x:0.5}),true);
      assert.equal(e.send({type:'move',pointerId:8,x:0.65}),true);
    }
    tick(d,36);tick(control,36);
    if(mode==='head-released')for(const e of [d,control])assert.equal(e.send({type:'up',pointerId:8}),true);
    const before=d.snapshot();
    assert.ok(maxDelta(hair(before),hair(control.snapshot()))>1e-4,'test must still be cancelling real secondary recoil');
    for(const pointerId of [7,8])assert.equal(d.send({type:'grab-cancel',pointerId}),false,'released pointer messages cannot own lifecycle cleanup');
    assert.deepEqual(d.snapshot(),before);
    assert.equal(d.cancelGrab(),true);cleanLocal(d);assert.equal(d.cancelGrab(),false);
    assert.deepEqual(baseState(d),baseState(control),'tail cleanup must not clear later ownership or base motion');
    for(let i=0;i<360;i++){
      if(mode==='head-held'&&i===60)for(const e of [d,control])assert.equal(e.send({type:'up',pointerId:8}),true);
      tick(d,1);tick(control,1);cleanLocal(d);assert.deepEqual(baseState(d),baseState(control));
    }
    if(mode==='jump')assert.equal(d.snapshot().completedJumps,1);else assert.equal(d.snapshot().completedGestures,1);
  }
});

test('I4 C7: normal frame rates share one deterministic step and all local/secondary outputs remain finite and bounded',()=>{
  const paths=[];
  for(const rate of [30,60,120,144]){
    const d=createDirector({seed:11}),control=createDirector({seed:11}),path=[];
    const run=()=>{
      for(let i=0;i<rate/2;i++){
        const s=d.advance(1/rate),base=control.advance(1/rate);
        const numbers=[...body(s),...hair(s),...cloth(s),...Object.values(s.pose.grab||{}).flat(),s.pose.headRoll,s.pose.headX,s.pose.headY,s.pose.hop,s.pose.compression];
        assert.ok(numbers.every(Number.isFinite));
        for(const [key,limit]of Object.entries(character.coupling.body.limit))assert.ok(Math.abs(s.pose[key]-base.pose[key])<=limit+1e-12);
        assert.ok(hair(s).every(v=>Math.abs(v)<=0.12));
        for(const pair of Object.values(s.pose.cloth||{}))pair.forEach((v,axis)=>assert.ok(Math.abs(v)<=character.coupling.clothLimit[axis]));
        for(const [id,pair]of Object.entries(s.pose.grab||{}))assert.ok(Math.hypot(...pair.map((v,axis)=>v/character.grabs[id].limit[axis]))<=1+1e-12);
      }
      path.push(d.snapshot());
    };
    run();
    for(let i=0;i<TARGETS.length;i++){
      down(d,TARGETS[i]);move(d,(i%2?1:-1)*1e6,(i<2?1:-1)*1e6);run();up(d);run();
    }
    paths.push(path);
  }
  for(const path of paths.slice(1))assert.deepEqual(path,paths[0],'30/60/120/144 Hz must agree at the same event/time boundaries');
});

test('I4 C8: snapshots own their arrays and long-frame cancellation clears reaction without resetting the base clock',()=>{
  const d=createDirector({seed:53}),control=createDirector({seed:53});
  assert.equal(d.cancelGrab(),false);tick(d,456);tick(control,456);
  down(d,TARGETS[2]);move(d,14,-6);tick(d,36);tick(control,36);
  const saved=d.snapshot(),escaped=d.snapshot();
  escaped.grab.target[0]=999;escaped.pose.grab[TARGETS[2]][0]=999;
  escaped.pose.hair.fringe[0]=999;escaped.pose.cloth[CLOTH[0]][0]=999;
  assert.deepEqual(d.snapshot(),saved,'callers must not mutate director-owned spring state through snapshots');
  for(const dt of [NaN,Infinity,-1])assert.throws(()=>d.advance(dt),RangeError);
  assert.deepEqual(d.snapshot(),saved);
  d.advance(1);control.advance(0.1);
  assert.equal(d.snapshot().pointerId,null);assert.equal(d.snapshot().grab,null);cleanLocal(d);
  assert.deepEqual(baseState(d),baseState(control));
  for(let i=0;i<120;i++){tick(d,1);tick(control,1);cleanLocal(d);assert.deepEqual(baseState(d),baseState(control));}
});
