'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createMotion}=require('../src/reference-motion.js'),{binding}=require('../src/character.js');
function run(m,seconds,idleSample){
 const starts=[];let previous=null;
 for(let i=0;i<60*seconds;i++){
  if(idleSample&&i%60===0)m.setSystemIdle?.(idleSample(i/60));
  m.step(1/60);const active=m.snapshot().referenceMotion.active;
  if(active&&active!==previous)starts.push({name:active,time:i/60});
  previous=active;
 }
 return starts;
}
test('keyboard/mouse use in another application keeps automatic doze out, without stopping other idle actions',()=>{
 const m=createMotion({binding,seed:17});
 const starts=run(m,600,()=>0);
 assert.equal(starts.filter(a=>a.name==='doze').length,0);
 assert.ok(starts.some(a=>a.name==='hum'));
 assert.ok(starts.some(a=>a.name==='lookAround'));
});
test('genuinely idle computer still dozes, but automatic dozes are at least three minutes apart',()=>{
 const m=createMotion({binding,seed:17});
 const times=run(m,900,t=>t).filter(a=>a.name==='doze').map(a=>a.time);
 assert.ok(times.length>=2);
 for(let i=1;i<times.length;i++)assert.ok(times[i]-times[i-1]>=180,JSON.stringify(times));
});
test('resuming computer activity releases automatic doze smoothly and preserves manual previews',()=>{
 const m=createMotion({binding,seed:17});
 for(let i=0;i<60*600;i++){
  if(i%60===0)m.setSystemIdle?.(i/60);
  m.step(1/60);
  if(m.snapshot().referenceMotion.active==='doze')break;
 }
 assert.equal(m.snapshot().referenceMotion.active,'doze');
 const before=m.snapshot().pose;
 m.setSystemIdle(0);
 assert.equal(m.snapshot().referenceMotion.active,null);
 assert.deepEqual(m.snapshot().pose,before,'release uses existing springs, never snaps pose');
 assert.equal(m.play('doze'),true);
 m.setSystemIdle(0);
 assert.equal(m.snapshot().referenceMotion.active,'doze');
});
