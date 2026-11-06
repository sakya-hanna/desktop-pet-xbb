const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');
const file=path.join(__dirname,'../puppet/rig/js/blink-clock.js');
function clock(){assert.ok(fs.existsSync(file),'missing single-clock blink scheduler');return require(file);}
function state(t=0){return {t,blinking:false,blinkUntil:0,nextBlink:2.5};}
test('manual blink lives for its full duration on the simulation clock',()=>{
 const b=clock(),s=state(900);b.trigger(s,false,()=>0);
 assert.equal(s.blinking,true);assert.equal(s.blinkUntil,900.13);
 s.t=900.05;b.tick(s,false,false);assert.equal(s.blinking,true);
 s.t=900.14;b.tick(s,false,false);assert.equal(s.blinking,false);
});
test('automatic blink is disabled in still mode and for already closed expressions',()=>{
 const b=clock(),s=state(20);b.tick(s,false,false);assert.equal(s.blinking,false);
 b.tick(s,true,true);assert.equal(s.blinking,false);
 b.trigger(s,true);assert.equal(s.blinking,false);
 b.tick(s,true,false,()=>0.5);assert.equal(s.blinking,true);
 assert.ok(s.nextBlink>s.t+2.6&&s.nextBlink<s.t+6.4);
});
test('switching expression clears the old blink and schedules relative to current time',()=>{
 const b=clock(),s=state(4);b.trigger(s);b.defer(s);
 assert.equal(s.blinking,false);assert.equal(s.nextBlink,5.2);
 s.t=5.1;b.tick(s,true,false);assert.equal(s.blinking,false);
});
