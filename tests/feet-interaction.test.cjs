'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{createDirector}=require('../src/director.js'),rig=require('../src/material-rig.js'),ch=require('../src/character.js');
const step=(d,seconds)=>{for(let i=0;i<seconds*120;i++)d.advance(1/120);};
function tap(d,side='left',cancel=false){const pointerId=1;assert.ok(d.send({type:'down',partId:'feet',pointerId,x:0,y:.8,materialPoint:[side==='left'?215:335,760]}));step(d,.06);d.send({type:cancel?'cancel':'up',pointerId});step(d,.08);}
test('five same-foot taps remove shoes; further taps keep them off until sixty quiet seconds',()=>{
 const d=createDirector({idleAction:'qianhuili',idle:false});for(let i=0;i<4;i++)tap(d);assert.equal(d.snapshot().expression.kind,'feet');assert.equal(d.snapshot().pose.feet.active,false);
 tap(d);assert.equal(d.snapshot().expression.kind,'shoesOff');step(d,1.6);assert.deepEqual(d.snapshot().pose.feet.bare,{left:true,right:false});assert.ok(d.snapshot().pose.feet.legs.left.drop>0);
 step(d,3.5);assert.deepEqual(d.snapshot().pose.feet.bare,{left:true,right:true});assert.equal(d.snapshot().pose.feet.active,false);
 for(let i=0;i<5;i++)tap(d,'right');assert.equal(d.snapshot().expression.kind,'feet');assert.equal(d.snapshot().pose.feet.active,false);
 step(d,59);assert.deepEqual(d.snapshot().pose.feet.bare,{left:true,right:true});assert.equal(d.snapshot().pose.feet.active,false);
 step(d,1.1);assert.equal(d.snapshot().expression.kind,'shoesOn');
 assert.equal(d.snapshot().bubble,'不看姐姐的脚了？那姐姐就把鞋子穿上了');
 step(d,1.4);assert.deepEqual(d.snapshot().pose.feet.bare,{left:false,right:true});
 step(d,3.6);assert.deepEqual(d.snapshot().pose.feet.bare,{left:false,right:false});
 step(d,61);assert.equal(d.snapshot().pose.feet.active,false);assert.equal(d.snapshot().bubble,null);
});

test('other pet contacts restart the timer and a held hand postpones dressing until after release',()=>{
 const d=createDirector({idleAction:'qianhuili',idle:false});for(let i=0;i<5;i++)tap(d);step(d,5.1);step(d,55);
 d.send({type:'down',partId:'head',pointerId:1,x:0});d.send({type:'up',pointerId:1});
 step(d,10);assert.equal(d.snapshot().pose.feet.active,false);
 assert.equal(d.send({type:'grab-down',partId:'arm-screen-left',pointerId:2,x:0}),true);
 step(d,65);assert.equal(d.snapshot().pose.feet.active,false);
 d.send({type:'grab-up',pointerId:2});step(d,59);assert.equal(d.snapshot().pose.feet.active,false);
 step(d,1.1);assert.equal(d.snapshot().expression.kind,'shoesOn');
});

test('an interrupted single bare foot is restored automatically; menus defer the timeout',()=>{
 const d=createDirector({idleAction:'qianhuili',idle:false});for(let i=0;i<5;i++)tap(d);step(d,1.6);d.cancelFeet();
 assert.deepEqual(d.snapshot().pose.feet.bare,{left:true,right:false});
 d.setIdleBlocked(true);step(d,65);assert.equal(d.snapshot().pose.feet.active,false);
 d.setIdleBlocked(false);step(d,59);assert.equal(d.snapshot().pose.feet.active,false);
 step(d,1.1);assert.equal(d.snapshot().expression.kind,'shoesOn');step(d,2.5);
 assert.deepEqual(d.snapshot().pose.feet.bare,{left:false,right:false});assert.equal(d.snapshot().pose.feet.active,false);
});
test('expired, cancelled and opposite-foot contacts do not accumulate into an accidental removal',()=>{
 const d=createDirector({idleAction:'qianhuili',idle:false});for(let i=0;i<4;i++)tap(d);step(d,6.1);tap(d);tap(d,'left',true);for(let i=0;i<3;i++)tap(d,'right');assert.equal(d.snapshot().pose.feet.active,false);
});
test('cancelling midway retains completed wardrobe and restores a planted stance',()=>{
 const d=createDirector({idleAction:'qianhuili',idle:false});for(let i=0;i<5;i++)tap(d);step(d,1.6);d.cancelFeet();assert.deepEqual(d.snapshot().pose.feet,{bare:{left:true,right:false},legs:{},active:false});
});
test('wiggling leg keeps its root attached and the other foot planted',()=>{
 const p={feet:{legs:{left:{angle:.1,lift:8}}}},left=ch.parts['leg-left'],right=ch.parts['leg-right'];
 assert.deepEqual(rig.deformPoint([250,480],p,ch.binding,left),rig.deformPoint([250,480],{},ch.binding,left));
 assert.deepEqual(rig.deformPoint([335,790],p,ch.binding,right),rig.deformPoint([335,790],{},ch.binding,right));
 const at=[215,780],m=rig.deformPoint(at,p,ch.binding,left);assert.ok(Math.hypot(m[0]-at[0],m[1]-at[1])>15);
});
test('neutral separated textures reconstruct original pixels and preserve upper legs',()=>{
 const {load}=require('./helpers/interaction-fixtures.cjs'),src=load('baijie-head-torso.png'),torso=load('baijie-feet-torso.png');
 const left=load('baijie-leg-left-shod.png'),right=load('baijie-leg-right-shod.png');
 for(let y=0;y<800;y++)for(let x=0;x<530;x++){const i=(y*530+x)*4,im=y<480?torso:x<285?left:right;for(let c=0;c<4;c++)assert.equal(im.data[i+c],src.data[i+c]);}
 for(const side of ['left','right']){const a=load('baijie-leg-'+side+'-shod.png'),b=load('baijie-leg-'+side+'-bare.png');for(let i=0;i<680*530*4;i++)assert.equal(a.data[i],b.data[i]);}
});

test('native captured foot tap survives a slow frame; uncaptured contact is cancelled',()=>{
 for(const captured of [true,false]){
  const d=createDirector({idleAction:'qianhuili',idle:false});d.send({type:'down',partId:'feet',pointerId:1,x:0,materialPoint:[215,760]});d.advance(.4,{touchCaptured:captured});
  assert.equal(d.snapshot().pointerId,captured?1:null);d.send({type:'up',pointerId:1});assert.equal(d.snapshot().expression?.kind,captured?'feet':undefined);
 }
});
