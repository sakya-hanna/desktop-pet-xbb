'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const ch=require('../src/character.js'),{createDirector}=require('../src/director.js'),rig=require('../src/material-rig.js');
const ids=['skirt-front','skirt-right'],dt=1/120,scale=348*0.8/800;
const send=(d,type,more={})=>assert.equal(d.send({type,pointerId:7,...more}),true);
const body=p=>['bodyRoll','bodyX','bodyY'].map(k=>p[k]);
const tick=(d,n)=>{for(let i=0;i<n;i++)d.advance(dt);return d.snapshot();};
test('I8 skirt: cloth keeps its full range while body response is small, quiet for small pulls, and low-pass during reversals',()=>{
 const stats=[];
 for(const id of ids)for(const mode of ['small','hold','wave']){
  const d=createDirector({idle:false});send(d,'grab-down',{partId:id});let maxRoll=0,maxHead=0,maxStep=0,previous=0,local=0,firstQuarter=0;
  for(let i=0;i<720;i++){
   const x=mode==='small'?3:mode==='hold'?18:18*Math.sin(2*Math.PI*i*dt);send(d,'grab-move',{x,y:0});const p=d.advance(dt).pose;
   maxStep=Math.max(maxStep,Math.abs(p.bodyRoll-previous));previous=p.bodyRoll;if(i===29)firstQuarter=Math.abs(p.bodyRoll);
   if(i>=360){maxRoll=Math.max(maxRoll,Math.abs(p.bodyRoll));maxHead=Math.max(maxHead,Math.abs(rig.deformPoint([298.2,95],p,ch.binding)[0]-298.2)*scale);local=Math.max(local,Math.abs(p.grab[id][0]));}
  }
  stats.push({id,mode,maxRoll,maxHeadCss:maxHead,maxStep,local,firstQuarter});
 }
 console.log('I8_SKIRT_RESPONSE '+JSON.stringify(stats));
 for(const s of stats){
  if(s.mode==='small'){assert.ok(s.local>2.9,'small cloth movement is not disabled');assert.ok(s.maxRoll<0.0001,'small skirt motion should not rock the torso');}
  if(s.mode==='hold'){assert.ok(s.local>17.99,'keep original 18 material-pixel envelope');assert.ok(s.maxRoll>0.004&&s.maxRoll<0.01,'gentle but nonzero whole-body response');assert.ok(s.maxHeadCss<1.3,'body must not dominate cloth');assert.ok(s.firstQuarter<s.maxRoll*0.5,'body must not immediately chase the local pull');}
  if(s.mode==='wave'){assert.ok(s.maxRoll<0.005,'filter repeated skirt reversals');assert.ok(s.maxStep<0.0003,'no abrupt torso direction flips');}
 }
});
test('I8 skirt: body follows held intent and independent recovery, not the cloth spring or its released recoil',()=>{
 const file=require.resolve('../src/director.js'),source=fs.readFileSync(file,'utf8'),anchor="id===grabId?grabTarget[i]:0,150,";assert.ok(source.includes(anchor),'fault-injection anchor must exist');
 const sandbox={module:{exports:{}},require:name=>{if(name==='./response-config.js')return require('../src/response-config.js');assert.equal(name,'./character.js');return ch;}};vm.runInNewContext(source.replace(anchor,"id===grabId?grabTarget[i]:0,300,"),sandbox,{filename:'cloth-spring-perturbation.cjs'});
 const a=createDirector({idle:false}),b=sandbox.module.exports.createDirector({idle:false});for(const d of [a,b]){send(d,'grab-down',{partId:ids[0]});send(d,'grab-move',{x:18,y:-5});}
 let bodyDifference=0,clothDifference=0;for(let i=0;i<600;i++){
  if(i===180)for(const d of [a,b]){const before=JSON.stringify(d.snapshot().pose);send(d,'grab-up');assert.equal(JSON.stringify(d.snapshot().pose),before,'release is continuous');}
  const pa=a.advance(dt).pose,pb=b.advance(dt).pose;body(pa).forEach((v,k)=>bodyDifference=Math.max(bodyDifference,Math.abs(v-body(pb)[k])));clothDifference=Math.max(clothDifference,Math.abs(pa.grab[ids[0]][0]-pb.grab[ids[0]][0]));
 }
 console.log('I8_RELEASE_INDEPENDENCE '+JSON.stringify({bodyDifference,clothDifference}));assert.ok(clothDifference>1,'injection must actually change cloth motion');assert.equal(bodyDifference,0,'cloth spring/recoil must not drive body');assert.ok(Math.abs(a.snapshot().pose.bodyRoll)<0.00001,'body settles after release');
});
