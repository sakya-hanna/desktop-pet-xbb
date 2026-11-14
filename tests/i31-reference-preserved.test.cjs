'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {catalog,scores}=require('../src/reference-motion.js'),{createDirector}=require('../src/director.js');
const old=require('../../31-交付版集成-V1/revisions/i30-right-hair-bend/candidate/src/director.js');
test('I31 eight retained action targets match pinned upstream 1e7a0b1; the turn is separately authored',()=>{
 const text=fs.readFileSync(path.resolve(__dirname,'../../../references/chieri-live2d-source/js/app.js'),'utf8'),start=text.indexOf('const ANIMS = {'),end=text.indexOf('\n// hearts flying',start);assert.ok(start>0&&end>start);
 const c=vm.createContext({});vm.runInContext("const S={gaze:{active:false,x:0}};const notes=()=>{};const smoothstep=(a,b,x)=>{const t=Math.min(1,Math.max(0,(x-a)/(b-a)));return t*t*(3-2*t);};const env=(u,a,b,c,d)=>smoothstep(a,b,u)*(1-smoothstep(c,d,u));"+text.slice(start,end)+';this.reference=ANIMS;',c);
 assert.equal(catalog.length,9);
 for(const a of catalog.filter(a=>a.id!=='lookAround')){assert.equal(a.duration,c.reference[a.id].dur);for(let i=0;i<=120;i++){const t=a.duration*i/120;assert.deepEqual(JSON.parse(JSON.stringify(scores[a.id].f(t))),JSON.parse(JSON.stringify(c.reference[a.id].f(t))),a.id+' '+t);}}
});
test('I31 historical six-action comparison against I30 body hair face and recovery trajectories',()=>{
 for(const a of catalog.filter(a=>!['wake','rouse','lookAround'].includes(a.id))){const before=old.createDirector({idleAction:'qianhuili',idle:false,seed:17}),after=createDirector({idleAction:'qianhuili',idle:false,seed:17});
  for(let i=0;i<360;i++){before.advance(1/120);after.advance(1/120);}assert.equal(before.playAction(a.id),true);assert.equal(after.playAction(a.id),true);
  for(let i=0;i<Math.ceil((a.duration+3.5)*120);i++){before.advance(1/120);after.advance(1/120);if(i%10===0)assert.deepEqual(after.snapshot(),before.snapshot(),a.id+' sample '+i);}
 }
});
test('I31 every action cancels future cues and full showcase without discarding current hair pose',()=>{
 for(const a of catalog){const d=createDirector({idleAction:'qianhuili',idle:false});for(let i=0;i<360;i++)d.advance(1/120);d.playAction(a.id);for(let i=0;i<60;i++)d.advance(1/120);const before=d.snapshot();d.cancelIdleAction();const after=d.snapshot();assert.deepEqual(after.pose,before.pose);assert.equal(after.referenceMotion.active,null);assert.equal(after.feedback,undefined);
  for(let i=0;i<1000;i++)d.advance(1/120);assert.equal(d.snapshot().referenceMotion.completed,0);assert.equal(d.snapshot().feedback,undefined);
 }
 const d=createDirector({idleAction:'qianhuili',idle:false});d.playAll();d.cancelIdleAction();for(let i=0;i<2400;i++)d.advance(1/120);assert.equal(d.snapshot().referenceMotion.demoRemaining,0);assert.equal(d.snapshot().referenceMotion.completed,0);
});
