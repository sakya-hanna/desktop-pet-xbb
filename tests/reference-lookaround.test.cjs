'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const rig=require('../src/material-rig.js'),{binding,parts}=require('../src/character.js');
// Execute the unmodified, read-only upstream Rig, not another implementation of
// the expected formula. Source: lizitc/chieri-live2d @ 1e7a0b1b1c2ed7f2365b557f2c83c89f5a55fc31.
const refDir=path.resolve(__dirname,'../verification/reference-lookaround-v1/reference');
const context=vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(refDir,'config.js'),'utf8')+'\n'+fs.readFileSync(path.join(refDir,'rig.js'),'utf8')+'\nglobalThis.original={Rig,POSES};',context);
const sx=binding.width/1024,sy=binding.height/1536;
const base={angleX:0,angleY:0,roll:0,headDX:0,headDY:0,bodyRoll:0,bodyX:0,breath:0,ear:[],earPull:[],hair:[],tailAngle:0,tailWave:0,t:0,skirt:0,pokes:[],squash:0,hop:0};
const near=(a,b,why)=>assert.ok(Math.hypot(a[0]-b[0],a[1]-b[1])<.0001,why+' actual='+a+' upstream='+b);

test('the four split back locks consume upstream opposite parallax without moving their fixed seams',()=>{
 const original=new context.original.Rig({...context.original.POSES.a,strands:[],ears:[]});
 const rest=Float32Array.from([0,800]),w=original.weights(rest);w.back[0]=1;
 for(const name of ['outer-left','outer-right','rear-left','rear-right']){
  const part=parts[name],without={...part,backParallax:false},point=part.centerline.at(-1);
  for(const lookX of [-1.2,1.2])for(const mode of ['plain','chain','flexible']){
   const pose={referenceMotion:true,lookX,hair:{[name]:[.01,.02,.03]},
    ...(mode==='chain'?{longHair:{[name]:part.centerline.slice(1).map(()=>.01)}}:{}),
    ...(mode==='flexible'?{flexHair:{[name]:{nodes:part.centerline.map(p=>p.slice()),angles:part.centerline.slice(1).map(()=>0)}}}:{})};
   const actual=rig.deformPoint(point,pose,binding,part),basePoint=rig.deformPoint(point,pose,binding,without);
   const expected=original.deform(rest,w,{...base,angleX:lookX},new Float32Array(2));
   near(actual.map((v,i)=>v-basePoint[i]),[(expected[0]-rest[0])*sx,(expected[1]-rest[1])*sy],name+' '+mode+' reverse parallax');
   near(rig.deformPoint(part.root,pose,binding,part),rig.deformPoint(part.root,pose,binding),name+' root seam');
  }
 }
});

test('the explicit raw reference fallback retains upstream dome displacement in material units',()=>{
 const raw={...binding,headTurn:{...binding.headTurn,center:[298.2,97],radius:[84,72],features:[],cage:null,model:null}};
 const cfg={...context.original.POSES.a,strands:[],ears:[],head:{c:[298.2/sx,95/sy],rx:120/sx,ry:120/sy,feather:10},neck:binding.neck.map((v,i)=>v/(i?sy:sx)),dome:{c:[298.2/sx,97/sy],rx:84/sx,ry:72/sy}};
 const original=new context.original.Rig(cfg);
 for(const point of [[220,60],[240,50],[298.2,20],[298.2,97],[355,60],[298,135],[265,220],[298,180]]){
  const rest=Float32Array.from([point[0]/sx,point[1]/sy]),w=original.weights(rest);
  const neutral=original.deform(rest,w,base,new Float32Array(2));
  for(const [lookX,lookY]of [[-1.2,0],[1.2,0],[0,-.9],[0,.9],[.8,-.5]]){
   const expected=original.deform(rest,w,{...base,angleX:lookX,angleY:lookY},new Float32Array(2));
   const actual=rig.deformPoint(point,{referenceMotion:true,lookX,lookY},raw);
   near(actual.map((v,k)=>v-point[k]),Array.from(expected,(v,k)=>(v-neutral[k])*(k?sy:sx)),'point '+point+' gaze '+[lookX,lookY]);
  }
 }
});
