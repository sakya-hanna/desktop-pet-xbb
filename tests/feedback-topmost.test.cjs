'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {harness,settle}=require('./feedback-shell.test.cjs');

test('interaction feedback preserves pet topmost when the taskbar leaves the topmost band',async()=>{
 const h=harness({mode:'visible',taskbarTopmost:false});
 try {
  await h.shell.ready;const parent=h.shell.window,bounds=parent.getBounds();
  for(let id=1;id<=4;id++){
   assert.equal(parent.isAlwaysOnTop(),true);
   h.send({id,text:'互动反馈'});await settle();
   assert.equal(parent.isAlwaysOnTop(),true,'feedback must not demote its owner until the 4-second repair');
   assert.equal(h.bubble().isAlwaysOnTop(),true);assert.equal(h.bubble().isVisible(),true);
   h.shell.drag({dx:-8,dy:-5});h.shell.resizeBy(1.03);
   assert.equal(parent.isAlwaysOnTop(),true,'placement sync must keep the same topmost band');
   h.send(null);assert.equal(h.bubble().isVisible(),false);
   assert.equal(parent.isAlwaysOnTop(),true);
  }
  assert.notDeepEqual(parent.getBounds(),bounds,'moving/resizing remain enabled');
  h.shell.setTopmost(false);h.send({id:5,text:'普通层级'});await settle();
  assert.equal(parent.isAlwaysOnTop(),false);assert.equal(h.bubble().isAlwaysOnTop(),false);
  h.shell.setTopmost(true);
  assert.equal(parent.isAlwaysOnTop(),true);assert.equal(h.bubble().isAlwaysOnTop(),true);
  h.advance(3400);assert.equal(h.bubble().isVisible(),false);assert.equal(parent.isAlwaysOnTop(),true);
  assert.equal(h.windows.some(w=>w.calls.some(c=>c[0]==='show'||c[0]==='focus')),false);
 }finally{h.dispose();}
});
