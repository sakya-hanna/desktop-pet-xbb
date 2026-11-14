'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {framebufferPoint}=require('../src/desktop-view.js');
test('CSS client coordinates map to the same framebuffer at fractional DPR',()=>{
  const r={x:12,y:15,width:240,height:348},w=Math.round(r.width*1.25),h=Math.round(r.height*1.25);
  assert.deepEqual(framebufferPoint(r,w,h,12,15),{x:0,y:h-1});
  assert.deepEqual(framebufferPoint(r,w,h,132,189),{x:Math.floor(w/2),y:h-1-Math.floor(h/2)});
  assert.deepEqual(framebufferPoint(r,w,h,251.9,362.9),{x:w-1,y:0});
});
test('outside, zero-sized and non-finite points never hit a clamped border pixel',()=>{
  const r={x:0,y:0,width:240,height:348};
  for(const [x,y] of [[-1,80],[240,80],[10,348],[Infinity,2],[2,NaN]])assert.equal(framebufferPoint(r,300,435,x,y),null);
  for(const bad of [{...r,width:0},{...r,height:NaN},{...r,x:Infinity}])assert.equal(framebufferPoint(bad,300,435,10,10),null);
  assert.equal(framebufferPoint(r,0,435,10,10),null);
  assert.equal(framebufferPoint(r,300.2,435,10,10),null);
});
