'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createMotion,catalog,scores}=require('../src/reference-motion.js');
const before=require('../verification/stretch-proportions/before-reference-motion.js');
const {binding}=require('../src/character.js'),{deformPoint}=require('../src/material-rig.js');
for(const name of ['stretch','wake'])test(name+' stretching phase keeps the same character envelope and planted foot anchor',()=>{
 const m=createMotion({binding,idle:false});m.play(name);let peak=0,min=0,sawYawn=false;
 for(let i=0;i<1080;i++){
  m.step(1/120);const s=m.snapshot();
  // Waking has a separate startle impulse before its sustained stretch. Do not
  // mistake that impulse for the authored stretch target under comparison.
  if(name==='stretch'||(s.referenceMotion.phase==='playing'&&s.idleAction.elapsed>=1.4)){
   peak=Math.max(peak,s.pose.squash);min=Math.min(min,s.pose.squash);
  }
  sawYawn||=s.face==='9001';
  const foot=deformPoint([265,binding.feetY],s.pose,binding);assert.ok(Math.abs(foot[1]-binding.feetY)<1e-8);
 }
 assert.ok(peak>0.005,'retain a visible extension, do not disable the action');
 assert.ok(peak<=0.0125,'stretch extension must remain within the new 1.25% character envelope; got '+peak);
 assert.ok(min>=-0.008,'preparation must not turn into a larger squash');assert.ok(sawYawn);assert.equal(m.snapshot().referenceMotion.active,null);
});
test('reference scores and active non-stretch springs remain unchanged apart from the standing breath channel',()=>{
 for(const a of catalog){
  if(a.id==='lookAround')continue; // New authored turn, covered by head-turn tests.
  for(let i=0;i<=60;i++)assert.deepEqual(scores[a.id].f(a.duration*i/60),before.scores[a.id].f(a.duration*i/60));
  if(['stretch','wake'].includes(a.id))continue;
  const old=before.createMotion({binding,idle:false}),current=createMotion({binding,idle:false});old.play(a.id);current.play(a.id);
  for(let i=0;i<1080;i++){
   old.step(1/120);current.step(1/120);
   if(i%20===0&&current.snapshot().referenceMotion.active){
    const next=current.snapshot(),previous=old.snapshot();
    delete next.pose.hairWind;delete next.pose.hairTurn;
    // Breathing and the return to quiet standing are intentionally redesigned.
    // Keep comparing all authored-action springs, faces, cues and clocks.
    delete next.pose.breath;delete previous.pose.breath;
    assert.deepEqual(next,previous,a.id+' '+i);
   }
  }
  assert.equal(current.snapshot().referenceMotion.completed,old.snapshot().referenceMotion.completed);
 }
});
