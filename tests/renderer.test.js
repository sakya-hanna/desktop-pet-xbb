const {test}=require('node:test');const assert=require('node:assert/strict');
const {boot}=require('./helpers/renderer-harness.cjs');
test('production renderer loads and animates two independent locks with finite vertices',async()=>{
 const {rig:r}=await boot();const d=r.diagnostics();
 assert.equal(d.hairLayers.length,2);
 assert.ok(d.hairLayers.every(x=>x.vertices>0&&x.finite));
 assert.ok(d.hairLayers.some(x=>Math.abs(x.angle)>0.001));
 assert.equal(d.bodyHairAmplitude,0);
});
test('still mode freezes head/body/hair; original mode retains the complete body',async()=>{
 const {rig:r}=await boot('?still=1');const d=r.diagnostics();
 assert.equal(d.hairLayers.length,2);assert.ok(d.hairLayers.every(x=>x.angle===0));
 assert.equal(r.S.angleX.x,0);assert.equal(r.S.roll.x,0);assert.equal(r.S.bodyX.x,0);
 const {rig:original}=await boot('?layers=0&still=1');assert.equal(original.diagnostics().hairLayers.length,0);
});
