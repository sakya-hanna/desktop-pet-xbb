const test=require('node:test'),assert=require('node:assert/strict');
const {boot}=require('./helpers/renderer-harness.cjs');
test('renderer hit-test uses current projected alpha layers and rejects blank canvas',async()=>{
 const h=await boot('?still=1');assert.equal(typeof h.rig.hitTest,'function');
 assert.equal(h.rig.hitTest(0,0),false);
 const d=h.rig.diagnostics(),v=d.view;
 assert.equal(h.rig.hitTest(v.ox+300*v.s,v.oy+90*v.s),true);
 assert.equal(h.rig.hitTest(Infinity,0),false);
});
