'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path').join(__dirname, '../puppet/rig/js/touch-interaction.js');
const Touch = fs.existsSync(path) ? require(path) : null;
const event = (x=100, y=100, pointerId=1, button=0) => ({clientX:x,clientY:y,pointerId,button});
const head = (x=294,y=50) => ({x,y,part:'hair'});
const chest = (x=295,y=222) => ({x,y,part:'body'});
function harness() {
  let time = 0;
  const events = [];
  const api = Touch.create({now:()=>time,onTrigger:e=>events.push(e)});
  return {api,events,at:t=>{time=t;}};
}

test('chest tap emits exact local text once on release, never on begin', () => {
  assert.equal(typeof Touch.create, 'function');
  const {api,events,at} = harness();
  assert.equal(api.begin(event(),chest()),true);
  assert.equal(events.length,0);
  at(100);
  assert.equal(api.end(event(),chest()),true);
  assert.deepEqual(events,[{type:'chest_touch',text:'姆，弟弟你这个色鬼。',interactionId:'touch-1'}]);
  assert.equal(api.end(event(),chest()),false);
});


test('one pointer lifecycle ignores foreign input and supports cancel and detached snapshots', () => {
  const {api,events} = harness();
  assert.equal(typeof api.cancel,'function');
  assert.equal(typeof api.move,'function');
  assert.equal(api.cancel(),false);
  assert.equal(api.snapshot().active,false);
  assert.equal(api.begin(event(),chest()),true);
  const before = api.snapshot();
  assert.equal(before.active,true);
  before.active = false;
  assert.equal(api.snapshot().active,true);
  assert.equal(api.move(event(100,100,2),null),false);
  assert.equal(api.end(event(100,100,2),null),false);
  assert.equal(api.snapshot().active,true);
  assert.equal(api.cancel(),true);
  assert.equal(api.end(event(),chest()),false);
  assert.equal(events.length,0);
  api.begin(event(),chest());
  assert.equal(api.begin(event(),null),false);
  assert.equal(api.end(event(),chest()),false);
  api.begin(event(),chest());
  api.begin(event(100,100,2),head());
  assert.equal(api.end(event(),chest()),false);
  assert.equal(api.cancel(),true);
});

test('begin requires primary finite pointer input and a recognized original point', () => {
  const {api} = harness();
  for (const bad of [null,{},event(0,0,1,2),event(NaN),event(0,Infinity),event(0,0,NaN),
    event(0,0,Infinity),event(0,0,1,NaN),event('100')]) {
    assert.equal(api.begin(bad,chest()),false);
    assert.equal(api.snapshot().active,false);
  }
  for (const point of [null,{},head(200),chest(295,222.0+30),{x:295,y:222,part:'hair'}])
    assert.equal(api.begin(event(),point),false);
  assert.equal(api.move(event(),chest()),false);
  assert.equal(api.end(event(),chest()),false);
});

test('invalid samples cancel stickily but recognized release is consumed', () => {
  const badSamples = [[event(),null], [event(),head()], [event(),chest(400)],
    [event(),{x:NaN,y:222}], [event(NaN),chest()], [event(0,Infinity),chest()],
    [event(0,0,1,NaN),chest()], [null,chest()], [event(0,0,NaN),chest()],
    [event(),{x:295,y:222,part:'hair'}]];
  for (const [e,p] of badSamples) {
    for (const releaseOnly of [false,true]) {
      const {api,events,at} = harness();
      api.begin(event(),chest());
      at(100);
      if (releaseOnly) assert.equal(api.end(e,p),true);
      else {
        api.move(e,p);
        api.move(event(),chest());
        assert.equal(api.end(event(),chest()),true);
      }
      assert.equal(events.length,0);
      assert.equal(api.snapshot().active,false);
    }
  }
});

test('chest tap enforces inclusive elapsed and radial peak displacement limits', () => {
  for (const [duration,cssX,cssY,worldX,worldY,valid] of [
    [650,4,0,12,0,true], [0,0,0,0,0,true], [651,0,0,0,0,false],
    [100,4.01,0,0,0,false], [100,3,3,0,0,false],
    [100,0,0,12.01,0,false], [100,0,0,9,9,false]
  ]) {
    for (const releaseOnly of [false,true]) {
      const {api,events,at} = harness();
      api.begin(event(),chest());
      at(duration);
      const e = event(100+cssX,100+cssY), p = chest(295+worldX,222+worldY);
      if (!releaseOnly) api.move(e,p);
      api.end(releaseOnly?e:event(),releaseOnly?p:chest());
      assert.equal(events.length,valid?1:0,JSON.stringify({duration,cssX,cssY,worldX,worldY,releaseOnly}));
    }
  }
});

test('head pat recognizes deliberate reversal only on valid release with exact typo preserved', () => {
  for (const sign of [-1,1]) {
    const {api,events,at} = harness();
    api.begin(event(),head());
    at(100);
    api.move(event(100+20*sign),head(294+20*sign));
    assert.equal(events.length,0);
    at(180);
    assert.equal(api.end(event(),head()),true);
    assert.deepEqual(events,[{type:'head_pat',text:'怎么突然模姐姐的头，是希望姐姐做什么呢。',interactionId:'touch-1'}]);
  }
});

test('head pat requires inclusive time, total horizontal travel, two substantial legs and real CSS travel', () => {
  const cases = [
    {xs:[0,20,0],duration:179,css:[0,8,0],valid:false},
    {xs:[0,20,0],duration:2501,css:[0,8,0],valid:false},
    {xs:[0,20,0],duration:180,css:[0,4,0],valid:true},
    {xs:[0,20,0],duration:2500,css:[0,4,0],valid:true},
    {xs:[0,20,0],duration:200,css:[0,0,0],valid:false},
    {xs:[0,20,0],duration:200,css:[0,3.99,0],valid:false},
    {xs:[0,14,0],duration:200,css:[0,8,0],valid:false},
    {xs:[0,26,12],duration:200,css:[0,8,0],valid:true},
    {xs:[0,30,16.01],duration:200,css:[0,8,0],valid:false},
    {xs:[0,10,0,10,0,10,0],duration:200,css:[0,8,0,8,0,8,0],valid:false},
    {xs:[0,20,40],duration:200,css:[0,8,16],valid:false},
    {xs:[0,0],duration:200,css:[0,8],valid:false},
    {xs:[0,0],duration:2000,css:[0,0],valid:false}
  ];
  for (const c of cases) {
    const {api,events,at} = harness();
    api.begin(event(100+c.css[0]),head(294+c.xs[0]));
    for (let i=1;i<c.xs.length;i++) {
      at(c.duration*i/(c.xs.length-1));
      const e = event(100+c.css[i]), p = head(294+c.xs[i]);
      if (i===c.xs.length-1) api.end(e,p);
      else api.move(e,p);
    }
    assert.equal(events.length,c.valid?1:0,JSON.stringify(c));
  }
});

test('1200ms release cooldown is shared across regions and failed or canceled gestures do not extend it', () => {
  const {api,events,at} = harness();
  const tap = (time) => {at(time);api.begin(event(),chest());api.end(event(),chest());};
  tap(0);
  at(100);
  api.begin(event(),head());
  api.move(event(120),head(314));
  at(300);
  assert.equal(api.end(event(),head()),true);
  assert.equal(events.length,1);
  tap(1199);
  assert.equal(events.length,1);
  at(1200);
  api.begin(event(),chest());
  api.cancel();
  api.begin(event(),chest());
  api.move(event(),null);
  api.end(event(),chest());
  tap(1200);
  assert.equal(events.length,2);
  at(2200);
  api.begin(event(),head());
  api.move(event(120),head(314));
  at(2400);
  api.end(event(),head());
  assert.deepEqual(events.map(e=>[e.type,e.interactionId]),[
    ['chest_touch','touch-1'],['chest_touch','touch-2'],['head_pat','touch-3']
  ]);
});

test('invalid or backwards clock samples fail closed and never consume cooldown', () => {
  const {api,events,at} = harness();
  for (const time of [NaN,Infinity,-Infinity]) {
    at(time);
    assert.equal(api.begin(event(),chest()),false);
  }
  at(100);
  api.begin(event(),chest());
  at(99);
  assert.equal(api.end(event(),chest()),true);
  assert.equal(events.length,0);
  at(200);
  api.begin(event(),chest());
  at(NaN);
  api.move(event(),chest());
  at(250);
  api.end(event(),chest());
  assert.equal(events.length,0);
  api.begin(event(),chest());
  api.end(event(),chest());
  assert.equal(events.length,1);
});

test('browser global runs without DOM, timers or CommonJS and exports exact lines', () => {
  for (const context of [{}, {window:{}}]) {
    vm.runInNewContext(fs.readFileSync(path,'utf8'),context);
    const browser = context.window ? context.window.TouchInteraction : context.TouchInteraction;
    assert.equal(typeof browser.create,'function');
    assert.equal(browser.LINES.head_pat,'怎么突然模姐姐的头，是希望姐姐做什么呢。');
    assert.equal(browser.LINES.chest_touch,'姆，弟弟你这个色鬼。');
    let count = 0;
    const api = browser.create({now:()=>100,onTrigger:()=>count++});
    api.begin(event(),chest());
    api.end(event(),chest());
    assert.equal(count,1);
    const defaults = browser.create();
    assert.equal(defaults.begin(event(),chest()),true);
    assert.equal(defaults.end(event(),chest()),true);
  }
});

test('head interruption and leaving its original region never reply even after a valid reversal', () => {
  for (const interruption of ['cancel','blank','chest','nonfinite','releaseBlank']) {
    const {api,events,at} = harness();
    api.begin(event(),head());
    api.move(event(120),head(314));
    at(200);
    api.move(event(),head());
    assert.equal(events.length,0);
    if (interruption==='cancel') api.cancel();
    if (interruption==='blank') api.move(event(),null);
    if (interruption==='chest') api.move(event(),chest());
    if (interruption==='nonfinite') api.move(event(Infinity),head());
    api.end(event(),interruption==='releaseBlank'?null:head());
    assert.equal(events.length,0,interruption);
  }
});

test('rest-world regions use bounded ellipses and exclude hair over chest', () => {
  assert.ok(Touch, 'TouchInteraction module exists');
  for (const p of [{x:294,y:50}, {x:232,y:50}, {x:294,y:6}, {x:294,y:94}])
    assert.equal(Touch.regionAt(p), 'head_pat');
  for (const p of [{x:295,y:222}, {x:340,y:222}, {x:295,y:197}])
    assert.equal(Touch.regionAt(p), 'chest_touch');
  for (const p of [null, {}, {x:NaN,y:50}, {x:294,y:Infinity}, {x:'294',y:50},
    {x:294,y:5}, {x:294,y:95}, {x:232,y:6}, {x:341,y:222}, {x:340,y:197},
    {x:295,y:222,part:'hair'}]) assert.equal(Touch.regionAt(p), null);
});

test('non-primary release consumes but never triggers a claimed gesture',()=>{
 const events=[];const t=require('../puppet/rig/js/touch-interaction').create({now:()=>100,onTrigger:e=>events.push(e)});
 const e={pointerId:9,button:0,clientX:100,clientY:100},p={x:295,y:222,part:'body'};
 t.begin(e,p);assert.equal(t.end({...e,button:2},p),true);assert.deepEqual(events,[]);
});
