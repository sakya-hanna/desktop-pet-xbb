'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createHarness}=require('./helpers/interaction-fixtures.cjs');
test('walk renders authored sequence, interrupts on touch, resize and reminders, then restores the live rig',async()=>{
 const messages=[],h=await createHarness({idle:false,configurePet:pet=>{pet.walk=value=>messages.push(value);}});
 try{
  h.toolbar.hidden=true;h.runtime.start();
  h.state({bounds:{x:700,y:400,width:240,height:348},workArea:{x:0,y:0,width:1920,height:1080},wanderEnabled:true});
  const start=()=>{h.action('walk:now');h.tick(2);assert.ok(h.runtime.status().walk);};
  start();assert.ok(h.draws.some(d=>d.texture?.includes('-walk-')));
  h.tick(30);assert.equal(h.runtime.status().walk.phase,'walk');
  assert.ok(messages.some(v=>v.phase==='step'));
  const head=h.css([298,100]);h.emit(h.canvas,'pointerdown',head);
  assert.equal(h.runtime.status().walk,null);
  assert.ok(h.draws.some(d=>d.texture==='baijie-head-skin.png'));
  h.emit(h.win,'pointerup',{...head,buttons:0});h.tick(450);
  start();h.emit(h.canvas,'wheel',{...head,buttons:0,ctrlKey:true,deltaY:-80,deltaMode:0});
  assert.equal(h.runtime.status().walk,null);
  assert.ok(h.calls.some(c=>c[0]==='resizeBy'));
  start();h.state({reminderActive:true});assert.equal(h.runtime.status().walk,null);
  h.tick(20);assert.equal(h.runtime.status().walk,null);
  h.state({reminderActive:false});start();h.action('shell:hide');
  assert.equal(h.runtime.status().walk,null);assert.equal(h.raf.size,0);
  assert.deepEqual(h.errors,[]);
 }finally{h.runtime.destroy();}
});
