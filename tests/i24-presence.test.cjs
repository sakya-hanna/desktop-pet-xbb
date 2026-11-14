'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createDirector}=require('../src/director.js'),ch=require('../src/character.js'),rig=require('../src/material-rig.js');
const css=351*.8/ch.binding.height;
function sample(action,seconds){const d=createDirector({idleAction:'qianhuili',idle:false,seed:17});for(let i=0;i<360;i++)d.advance(1/120);if(action)d.playAction(action);const data={};
 const record=(name,x)=>{const a=data[name]??=[x,x];a[0]=Math.min(a[0],x);a[1]=Math.max(a[1],x);};
 for(let i=0;i<seconds*120;i++){const p=d.advance(1/120).pose;
  record('face',rig.deformPoint([298.2,97],p,ch.binding)[0]*css);record('shoulder',rig.deformPoint([260,190],p,ch.binding)[0]*css);
  for(const n of ['front-left','front-right']){const a=ch.parts[n],pt=a.centerline.at(-1);record(n,(rig.localPoint(pt,p,a)[0]-pt[0])*css);}
  record('skirt',rig.grabOffset(p,ch.grabs['skirt-front'])[0]*css);
  const foot=rig.deformPoint([265,798],p,ch.binding);assert.ok(Math.abs(foot[0]-265)<1e-6&&Math.abs(foot[1]-798)<1e-6,'no new standing foot motion');
 }
 return Object.fromEntries(Object.entries(data).map(([n,a])=>[n,a[1]-a[0]]));}
test('I24 default-size head/body, short front hair and cloth have a readable movement envelope',()=>{
 const idle=sample(null,24),look=sample('lookAround',6.4);
 // Minimum presentation goals, not an assertion of aesthetic approval.
 assert.ok(idle.shoulder>=4.5,`shoulder ${idle.shoulder} CSS px`);
 assert.ok(look.face>=7,`look ${look.face} CSS px`);
 assert.ok(idle['front-left']>=3.8,`left front ${idle['front-left']}`);
 assert.ok(idle['front-right']>=3,`right front ${idle['front-right']}`);
 assert.ok(idle.skirt>=2.5,`cloth ${idle.skirt}`);
});
