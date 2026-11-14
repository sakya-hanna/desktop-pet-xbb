'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {create}=require('../settings-store');
const file=require('node:path').join(process.env.TMPDIR,'settings-fixture','model-settings.json');
function memory(initial){
 const files=new Map(initial===undefined?[]:[[file,initial]]),fds=new Map();let n=0;
 const io={files,fail:null,unlinks:[],
 lstatSync(p){if(!files.has(p)){const e=Error();e.code='ENOENT';throw e;}return {isSymbolicLink:()=>false,isFile:()=>true};},
 statSync(p){if(io.fail==='read')throw Error('read denied');if(!files.has(p)){const e=Error();e.code='ENOENT';throw e;}return {size:Buffer.byteLength(files.get(p))};},
 readFileSync:p=>files.get(p),mkdirSync(){},
 openSync(p){if(io.fail==='collision'){files.set(p,'OTHER WRITER');const e=Error();e.code='EEXIST';throw e;}fds.set(++n,p);files.set(p,'');return n;},
 writeFileSync(fd,b){if(io.fail==='write')throw Error('write denied');files.set(fds.get(fd),b);},fsyncSync(){},closeSync(fd){fds.delete(fd);},
 renameSync(a,b){if(io.fail==='rename')throw Error('rename denied');files.set(b,files.get(a));files.delete(a);},
 unlinkSync(p){io.unlinks.push(p);files.delete(p);},existsSync:p=>files.has(p)};return io;
}
const safe={isEncryptionAvailable:()=>true,encryptString:s=>Buffer.from('LOCAL:'+s),decryptString:b=>{const s=b.toString();if(!s.startsWith('LOCAL:'))throw Error('bad');return s.slice(6);}};
const valid=JSON.stringify({version:1,baseUrl:'https://local-test.invalid/v1',model:'LOCAL',encryptedKey:Buffer.from('LOCAL:fixture-key').toString('base64')});
module.exports={memory,file,safe,valid};
if(require.main===module){
 test('I13 settings load classification is latched and bad bytes never overwritten',()=>{
  for(const [raw,status,storage,fail] of [[undefined,'missing',safe],['{','invalid',safe],[JSON.stringify({version:9}),'unknown',safe],[valid,'valid',safe],[valid,'read-error',safe,'read'],[valid,'decrypt-failure',{...safe,isEncryptionAvailable:()=>false}],[valid,'decrypt-failure',{...safe,decryptString(){throw Error('context');}}]]){
   const io=memory(raw);io.fail=fail;const s=create({file,safeStorage:storage,fsImpl:io});assert.equal(s.snapshot().loadStatus,status);assert.equal(s.snapshot().writeBlocked,!['valid','missing'].includes(status));
   if(s.snapshot().writeBlocked){io.fail=null;assert.throws(()=>s.save({baseUrl:'https://local-test.invalid',model:'LOCAL',apiKey:''}));assert.throws(()=>s.getRequestConfig());assert.equal(io.files.get(file),raw);s.snapshot().writeBlocked=false;assert.throws(()=>s.save({baseUrl:'https://local-test.invalid',model:'LOCAL'}));}
   else {s.save({baseUrl:'https://local-test.invalid',model:'LOCAL',apiKey:'new-fixture'});assert.equal(s.getRequestConfig().apiKey,'new-fixture');assert.ok(!JSON.stringify(s.snapshot()).includes('new-fixture'));assert.ok(!io.files.get(file).includes('new-fixture'));}
  }
 });
 test('I13 settings failed commit retains bytes and never unlinks another writer temp',()=>{
  for(const failure of ['collision','write','rename']){const io=memory(valid),s=create({file,safeStorage:safe,fsImpl:io});io.fail=failure;assert.throws(()=>s.save({baseUrl:'https://local-test.invalid',model:'changed'}));assert.equal(io.files.get(file),valid);assert.equal(s.snapshot().model,'LOCAL');if(failure==='collision'){assert.equal(io.unlinks.length,0);assert.ok([...io.files.values()].includes('OTHER WRITER'));}io.fail=null;s.save({baseUrl:'https://local-test.invalid/v1',model:'LOCAL'});assert.equal(s.snapshot().saveError,null);}
 });
}
