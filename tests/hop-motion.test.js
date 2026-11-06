const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');
const p=path.join(__dirname,'../puppet/rig/js/hop-motion.js');
test('hop has a continuous anticipation, airborne arc and landing with exact neutral termination',()=>{
 assert.ok(fs.existsSync(p),'missing continuous hop motion');const {sampleHop}=require(p);
 assert.deepEqual(sampleHop(-1),{hop:0,squash:0,done:true});
 let prev=sampleHop(0),max=0,crouch=false;
 for(let t=0.001;t<=0.7001;t+=0.001){
  const r=sampleHop(t);assert.ok(Number.isFinite(r.hop)&&Number.isFinite(r.squash));
  assert.ok(Math.abs(r.hop-prev.hop)<0.5,'no vertical teleport');assert.ok(Math.abs(r.squash-prev.squash)<0.001,'no abrupt scaling reset');
  assert.ok(r.hop>=0&&r.hop<=26.01);max=Math.max(max,r.hop);if(t<0.1&&r.squash<0)crouch=true;prev=r;
 }
 assert.ok(crouch);assert.ok(max>25.9);assert.deepEqual(sampleHop(1),{hop:0,squash:0,done:true});
});
