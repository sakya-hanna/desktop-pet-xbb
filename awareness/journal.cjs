'use strict';
const fs=require('node:fs'),path=require('node:path');
const {assertNoSymlinks}=require('../resource-policy.cjs');
function create({file,maxBytes=256*1024}){
 let failed=false;
 function write(value){
  try{
   if(!value||typeof value.phase!=='string'||! /^[a-z-]{1,40}$/.test(value.phase))return;
   const row={time:new Date().toISOString(),phase:value.phase};
   if(typeof value.manual==='boolean')row.manual=value.manual;
   if(typeof value.reason==='string'&&/^[a-z-]{1,40}$/.test(value.reason))row.reason=value.reason;
   for(const name of ['bytes','durationMs'])if(Number.isFinite(value[name])&&value[name]>=0)row[name]=Math.round(value[name]);
   for(const name of ['working','codex','accepted'])if(typeof value[name]==='boolean')row[name]=value[name];
   if(['developing','reading','waiting','gaming','watching','browsing','other','unknown'].includes(value.activity))row.activity=value.activity;
   assertNoSymlinks(file,{allowMissing:true});fs.mkdirSync(path.dirname(file),{recursive:true});
   if(fs.existsSync(file)&&fs.statSync(file).size>=maxBytes){
    assertNoSymlinks(file+'.previous',{allowMissing:true});fs.copyFileSync(file,file+'.previous');fs.writeFileSync(file,'');
   }
   fs.appendFileSync(file,JSON.stringify(row)+'\n',{encoding:'utf8',mode:0o600});failed=false;
  }catch{failed=true;}
 }
 return {write,failed:()=>failed};
}
module.exports={create};
