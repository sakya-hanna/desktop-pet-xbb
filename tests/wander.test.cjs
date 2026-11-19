'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {create}=require('../src/wander.js');
const bounds={x:1000,y:600,width:240,height:348},area={x:0,y:0,width:1920,height:1080};
test('autonomous walk is infrequent, turns before displacement and stops before returning',()=>{
 const events=[],w=create({random:()=>0,send:v=>events.push(v)});
 for(let i=0;i<899;i++)w.advance(.1,{bounds,area});
 assert.equal(w.snapshot(),null);
 w.advance(.1,{bounds,area});w.advance(.1,{bounds,area});
 assert.equal(w.snapshot().phase,'turn');assert.equal(events.filter(e=>e.phase==='step').length,0);
 for(let i=0;i<80;i++)w.advance(.1,{bounds,area});
 assert.equal(w.snapshot(),null);
 const steps=events.filter(e=>e.phase==='step');
 assert.ok(steps.length>8);assert.ok(steps.every((s,i)=>!i||s.offset<=steps[i-1].offset));
 assert.ok(Math.abs(steps.at(-1).offset+120*.348)<1e-8);
 assert.equal(events.at(-1).phase,'end');
 for(let i=0;i<1400;i++)w.advance(.1,{bounds,area});
 assert.equal(events.filter(e=>e.phase==='begin').length,1);
});
test('edge selects available direction, and insufficient space does not start',()=>{
 const w=create({random:()=>0});
 assert.equal(w.start({...bounds,x:0},area),true);assert.equal(w.snapshot().direction,'right');
 w.cancel();assert.equal(w.start({...bounds,x:0,width:1920},area),false);
});
test('interaction interrupts displacement, disabled auto still permits manual preview',()=>{
 const events=[],w=create({random:()=>0,send:v=>events.push(v)});
 w.start(bounds,area);for(let i=0;i<10;i++)w.advance(.1,{bounds,area});
 w.advance(.1,{blocked:true,bounds,area});const count=events.length;
 for(let i=0;i<20;i++)w.advance(.1,{blocked:true,bounds,area});
 assert.equal(w.snapshot(),null);assert.equal(events.length,count);
 w.setEnabled(false);for(let i=0;i<4000;i++)w.advance(.1,{bounds,area});
 assert.equal(events.length,count);assert.equal(w.start(bounds,area),true);
});
test('busy expression postpones scheduled walk without interrupting it',()=>{
 const w=create({random:()=>0});
 for(let i=0;i<1000;i++)w.advance(.1,{busy:true,bounds,area});
 assert.equal(w.snapshot(),null);w.advance(.1,{bounds,area});assert.ok(w.snapshot());
});
test('authored support-foot curves drive native displacement in both directions',()=>{
 const meta=require('../assets/manifest.json').walk;
 for(const direction of ['left','right']){
  const curve=meta[direction].rootMotion,events=[];
  assert.equal(curve.length,9);assert.equal(curve[0],0);
  assert.ok(curve.every((x,i)=>!i||x>=curve[i-1]));
  const w=create({random:()=>direction==='left'?0:.9,send:v=>events.push(v),
   cycleSeconds:meta.cycleSeconds,gaits:{left:meta.left.rootMotion,right:meta.right.rootMotion}});
  w.start(bounds,area);
  for(let i=0;i<400;i++)w.advance(1/120,{bounds,area});
  const sign=direction==='left'?-1:1,cycles=direction==='left'?1:2;
  assert.ok(Math.abs(events.filter(e=>e.phase==='step').at(-1).offset-sign*curve[8]*.348*cycles)<1e-7);
 }
});
