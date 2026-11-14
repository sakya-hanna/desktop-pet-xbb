'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createDirector}=require('../src/director.js'),rig=require('../src/material-rig.js'),{binding}=require('../src/character.js');
const advance=(d,seconds)=>{let s;for(let i=0;i<Math.round(seconds*120);i++)s=d.advance(1/120);return s;};
test('I22 reference actions drive production director, including two bounces, global stretch and one-shot sneeze impulses',()=>{
 const d=createDirector({idleAction:'qianhuili',idle:false});assert.equal(typeof d.playAction,'function');
 assert.equal(d.playAction('tailPlay'),false);assert.equal(d.playAction('lookAround'),true);d.cancelIdleAction();
 assert.equal(d.playAction('hum'),true);assert.equal(advance(d,1.3).referenceMotion.active,'hum');
 advance(d,4);assert.equal(d.playAction('stretch'),true);
 const stretched=advance(d,1.8);assert.ok(stretched.pose.squash>0.005&&stretched.pose.squash<=0.0125);
 const foot=rig.deformPoint([binding.hips[0],798],stretched.pose,binding);assert.ok(Math.abs(foot[1]-798)<1e-6,'feet anchor survives stretch');
 assert.ok(rig.deformPoint([binding.hips[0],650],{squash:0.035},binding)[1]<650,'global stretch reaches legs, not just shoulders');
 advance(d,5);d.playAction('bounce');let airborne=0,was=false;for(let i=0;i<240;i++){const s=d.advance(1/120),now=s.pose.hop>0.0001;if(now&&!was)airborne++;was=now;}assert.equal(airborne,2);
 advance(d,3);d.playAction('sneeze');advance(d,1.3);assert.equal(d.snapshot().referenceMotion.impulses.sneeze,1);advance(d,4);assert.equal(d.snapshot().referenceMotion.impulses.sneeze,1);
});
test('I22 interruption retires action cues/feedback but preserves base physics and manual interaction ownership',()=>{
 const d=createDirector({idleAction:'qianhuili'});assert.equal(typeof d.playAction,'function');d.playAction('sneeze');advance(d,0.6);
 const before=d.snapshot().pose;d.send({type:'grab-down',pointerId:7,partId:'skirt-front'});assert.deepEqual(d.snapshot().pose,{...before,grab:{'skirt-front':[0,0]}});
 d.send({type:'grab-move',pointerId:7,x:10,y:2});advance(d,3);assert.equal(d.snapshot().referenceMotion.impulses.sneeze||0,0);assert.equal(d.snapshot().expression.kind,'skirt');
 assert.equal(d.playAction('bounce'),false);d.send({type:'grab-up',pointerId:7});advance(d,2);assert.equal(d.playAction('wake'),true);
});
