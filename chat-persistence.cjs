'use strict';
// Main-only own-file persistence. Never import or discover a legacy profile.
const fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto');
const {assertNoSymlinks}=require('./resource-policy.cjs');
function read(file,limit,validate,fsImpl=fs){
 let raw,inspected=false;
 try {assertNoSymlinks(file,{allowMissing:true,fsImpl});if(fsImpl.statSync(file).size>limit)return {status:'invalid',value:null};inspected=true;raw=fsImpl.readFileSync(file,'utf8');}
 catch(e){return {status:e.code==='ENOENT'&&!inspected?'missing':'read-error',value:null};}
 try {const value=JSON.parse(raw);if(!value||typeof value!=='object'||Array.isArray(value))throw Error();if(value.version!==1)return {status:Object.hasOwn(value,'version')?'unknown':'invalid',value:null};return {status:'valid',value:validate(value)};}
 catch{return {status:'invalid',value:null};}
}
function commit(file,value,fsImpl=fs){
 assertNoSymlinks(file,{allowMissing:true,fsImpl});fsImpl.mkdirSync(path.dirname(file),{recursive:true});
 const temp=file+'.'+randomUUID()+'.tmp';let owned=false,fd;
 try {fd=fsImpl.openSync(temp,'wx',0o600);owned=true;fsImpl.writeFileSync(fd,JSON.stringify(value));fsImpl.fsyncSync(fd);fsImpl.closeSync(fd);fd=undefined;assertNoSymlinks(file,{allowMissing:true,fsImpl});fsImpl.renameSync(temp,file);owned=false;}
 finally {if(fd!==undefined){try{fsImpl.closeSync(fd);}catch{}}if(owned){try{fsImpl.unlinkSync(temp);}catch{}}}
}
module.exports={read,commit};
