const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const file=path.join(__dirname,'../puppet/rig/js/idle-motion.js');
test('idle target is continuous at turn onset, direction change and completion',()=>{
 const c=require(file).create(()=>.5),due=c.snapshot().nextAt;c.update(due);const duration=c.snapshot().active.duration;
 for(const time of [due,due+duration*.32,due+duration*.70,due+duration]){
  const a=c.update(time-1e-5),b=c.update(time+1e-5);
  for(const key of Object.keys(a))assert.ok(Math.abs(a[key]-b[key])<.0001,key+' jumps at '+time);
 }
});
test('idle has a finite staged turn instead of an endless large oscillation',()=>{
 assert.ok(fs.existsSync(file),'missing interruptible idle controller');
 const c=require(file).create(()=>0.5);
 assert.equal(c.snapshot().active,null);
 const due=c.snapshot().nextAt;
 c.update(due);assert.ok(c.snapshot().active);
 c.update(due+10);assert.equal(c.snapshot().active,null);
 assert.ok(c.snapshot().nextAt>due+10);
});

test('input cancels action immediately, held input blocks it and release rearms quiet interval',()=>{
 const c=require(file).create(()=>0.5);c.update(21);assert.ok(c.snapshot().active);
 c.hold('input',true,22);assert.equal(c.snapshot().active,null);
 assert.deepEqual(c.update(100),{angleX:0,angleY:0,roll:0,bodyX:0});
 c.hold('menu',true,100);c.hold('input',false,101);c.update(200);assert.equal(c.snapshot().active,null);
 c.hold('menu',false,200);assert.ok(c.snapshot().nextAt>=214);
 c.update(207);assert.equal(c.snapshot().active,null);
});
test('disabled idle and busy actions suppress turns, not the externally owned breathing',()=>{
 const c=require(file).create(()=>0.5);c.update(21);
 c.setEnabled(false,22);assert.equal(c.snapshot().active,null);
 assert.deepEqual(c.update(200),{angleX:0,angleY:0,roll:0,bodyX:0});
 c.setEnabled(true,200);c.update(221,true);assert.equal(c.snapshot().active,null);
 c.update(250,false);assert.ok(c.snapshot().nextAt>=264);
 assert.deepEqual(c.update(251),{angleX:0,angleY:0,roll:0,bodyX:0});
});
