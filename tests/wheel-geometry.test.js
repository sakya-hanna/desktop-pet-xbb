const test=require('node:test'),assert=require('node:assert/strict');
const {createResizeSession}=require('../puppet/resize-geometry');
const b={x:400,y:250,width:240,height:348},area={x:0,y:0,width:1920,height:1080};

test('session rounds symmetrically and stays bounded during many reversible fractional steps',()=>{
 const s=createResizeSession();let current={...b};
 for(let cycle=0;cycle<10;cycle++){
   for(let i=0;i<200;i++)current=s.resize(current,Math.exp(.00012),area);
   assert.equal(current.height,Math.round(348*Math.exp(.024)));
   for(let i=0;i<200;i++)current=s.resize(current,Math.exp(-.00012),area);
   assert.deepEqual(current,b);
 }
});

test('session canonical maximum reverses immediately and independent sessions do not share residue',()=>{
 const s=createResizeSession();let current={...b};
 for(let i=0;i<100;i++)current=s.resize(current,2,area);
 assert.equal(current.width,600);assert.equal(current.height,870);
 current=s.resize(current,.99,area);assert.equal(current.height,861);
 const other=createResizeSession();assert.deepEqual(other.resize(b,1,area),b);
});

test('session fits anchored resize to negative and tiny work areas without mutating inputs',()=>{
 for(const workArea of [{x:-1000,y:-800,width:800,height:700},{x:-8,y:-9,width:11,height:15},{x:-2,y:-3,width:.25,height:.5}]){
   const s=createResizeSession(),bounds=Object.freeze({...b}),a=Object.freeze({...workArea}),anchor=Object.freeze({x:0,y:1});
   const next=s.resize(bounds,2,a,anchor);
   assert.ok(Object.values(next).every(Number.isInteger));
   assert.ok(next.width<=Math.max(1,Math.floor(a.width))&&next.height<=Math.max(1,Math.floor(a.height)));
   assert.ok(next.x>=Math.ceil(a.x)&&next.y>=Math.ceil(a.y));
   assert.ok(next.x+next.width<=a.x+Math.max(1,a.width));
   assert.ok(next.y+next.height<=a.y+Math.max(1,a.height));
   assert.deepEqual(bounds,b);assert.deepEqual(a,workArea);assert.deepEqual(anchor,{x:0,y:1});
 }
});

test('invalid input leaves fractional state intact and changed workArea retargets it',()=>{
 const s=createResizeSession();let current={...b};
 for(let i=0;i<10;i++)current=s.resize(current,Math.exp(.00012),area);
 for(const factor of [NaN,Infinity,'1',0,.4999,2.0001])assert.equal(s.resize(current,factor,area),null);
 assert.equal(s.resize(current,1,null),null);assert.equal(s.resize(null,1,area),null);
 for(let i=0;i<3;i++)current=s.resize(current,Math.exp(.00012),area);
 assert.equal(current.height,349,'invalid requests must not erase valid residue');
 s.reset();current={...b};
 for(let i=0;i<10;i++)current=s.resize(current,Math.exp(.00012),area);
 const changed={...area,x:-1};
 for(let i=0;i<3;i++)current=s.resize(current,Math.exp(.00012),changed);
 assert.equal(current.height,348);
});
