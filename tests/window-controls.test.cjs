'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createHarness}=require('./helpers/interaction-fixtures.cjs');
async function setup(){const h=await createHarness({idle:false});h.toolbar.hidden=true;h.runtime.start();h.tick(2);return h;}
test('Ctrl drag carries the window without touching the head; capture survives leaving',async()=>{
 const h=await setup();try{
  const p=h.renderer.headInputPoint();assert.ok(p);
  const point={clientX:p.x,clientY:p.y,ctrlKey:true,screenX:400,screenY:400};
  h.emit(h.canvas,'pointerdown',point);assert.equal(h.runtime.status().pointerKind,'drag');
  assert.equal(h.runtime.status().motion.pointerId,null);
  h.emit(h.canvas,'pointerleave',{...point,clientX:-10});assert.equal(h.runtime.status().dragging,true);
  h.tick(1,650);assert.equal(h.runtime.status().dragging,true,'native capture survives a delayed frame');
  h.emit(h.win,'pointermove',{...point,screenX:425,screenY:390});
  assert.deepEqual(h.calls.filter(c=>c[0]==='drag'),[['drag',25,-10]]);
  h.emit(h.win,'pointerup',{...point,buttons:0});assert.equal(h.runtime.status().activePointer,null);
  h.emit(h.canvas,'pointerdown',point);h.canvas.releasePointerCapture(7);
  assert.equal(h.runtime.status().activePointer,null,'lost native capture ends carrying');
 }finally{h.runtime.destroy();}
});
test('Ctrl Shift double click hides, single click does not touch; ordinary double click does not hide',async()=>{
 const h=await setup();try{
  const p=h.renderer.headInputPoint(),point={clientX:p.x,clientY:p.y,ctrlKey:true,shiftKey:true};
  h.emit(h.canvas,'pointerdown',point);assert.equal(h.runtime.status().pointerKind,'hide-shortcut');
  assert.equal(h.runtime.status().motion.pointerId,null);
  h.emit(h.win,'pointerup',{...point,buttons:0});
  assert.equal(h.calls.some(c=>c[0]==='command'&&c[1]==='hide'),false);
  h.emit(h.canvas,'dblclick',{...point,ctrlKey:false});
  assert.equal(h.calls.some(c=>c[0]==='command'&&c[1]==='hide'),false);
  h.emit(h.canvas,'dblclick',point);
  assert.equal(h.calls.filter(c=>c[0]==='command'&&c[1]==='hide').length,1);
 }finally{h.runtime.destroy();}
});
test('right click opens menu, toolbar toggles, Ctrl wheel remains available while toolbar hidden',async()=>{
 const h=await setup();try{
  const p=h.renderer.headInputPoint(),point={clientX:p.x,clientY:p.y,buttons:0};
  h.emit(h.canvas,'contextmenu',{...point,button:2});assert.equal(h.calls.filter(c=>c[0]==='menu').length,1);
  h.action('toolbar:toggle');assert.equal(h.toolbar.hidden,false);
  h.action('toolbar:toggle');assert.equal(h.toolbar.hidden,true);
  h.emit(h.win,'wheel',{...point,ctrlKey:true,deltaY:-100});assert.equal(h.calls.filter(c=>c[0]==='resizeBy').length,1);
  h.emit(h.win,'wheel',{...point,deltaY:100});assert.equal(h.calls.filter(c=>c[0]==='resizeBy').length,1);
  h.emit(h.canvas,'pointerdown',{clientX:-10,clientY:-10,ctrlKey:true});assert.equal(h.runtime.status().activePointer,null);
 }finally{h.runtime.destroy();}
});
