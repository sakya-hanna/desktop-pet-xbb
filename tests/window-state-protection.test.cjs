'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {storage,plain,good,mutationNames,loadCases}=require('./helpers/storage-harness.cjs');
const noMutation=s=>{for(const key of mutationNames)assert.equal(s.counts[key],0,key);};
for(const c of loadCases)test('T07-R-'+c.id+' loader classification: '+c.name,()=>{
  const s=storage(c.raw,c.options);s.bind(file);
  assert.deepEqual(plain(s.stateIO.loadStateResult(file)),{status:c.status,value:null,reason:c.reason});
  assert.equal(s.stateIO.loadState(file),null);assert.equal(s.bytes(),c.raw);noMutation(s);
});
for(const missing of [false,true])test('T07-R-W16 compatibility '+(missing?'missing':'valid')+' is read only',()=>{
  const s=storage(JSON.stringify({...good,ignored:'not persisted'}),{missing});s.bind(file);
  const result=plain(s.stateIO.loadStateResult(file));
  assert.equal(result.status,missing?'missing':'valid');assert.equal(result.reason,null);
  const {version,...expected}=good;assert.deepEqual(result.value,missing?null:expected);
  assert.deepEqual(plain(s.stateIO.loadState(file)),missing?null:expected);noMutation(s);
});
for(const fault of ['mkdir','openWrite','write','close','rename'])test('T07-R-W10 writer fault preserves target: '+fault,()=>{
  const raw=JSON.stringify(good),s=storage(raw);s.bind(file);s.fail(fault);
  assert.throws(()=>s.stateIO.saveState(file,{...good,alwaysOnTop:false}),e=>e.message==='synthetic storage '+fault);
  assert.equal(s.bytes(),raw);assert.equal(s.counts.commit,0);
  if(fault==='mkdir'){assert.equal(s.counts.openWrite,0);assert.equal(s.counts.unlink,0);}
  if(['mkdir','openWrite'].includes(fault)){assert.equal(s.counts.write,0);assert.equal(s.counts.unlink,0);}
  if(fault!=='rename')assert.equal(s.counts.rename,0);
  if(['write','close','rename'].includes(fault)){
    assert.equal(s.counts.unlink,1);const unlinked=s.calls.find(c=>c[0]==='unlink')[1];
    assert.equal(path.dirname(unlinked),path.dirname(file));assert.ok(unlinked.endsWith('.tmp'));assert.notEqual(unlinked,file);
  }
});
test('T07-R-W11 cleanup failure never masks primary partial-write error or deletes neighbors',()=>{
  const raw=JSON.stringify(good),s=storage(raw);s.bind(file);const neighbor=file+'.unrelated.tmp';s.files.set(neighbor,Buffer.from('neighbor'));
  s.fail('write');s.failCleanup(true);
  assert.throws(()=>s.stateIO.saveState(file,good),e=>e.message==='synthetic storage write');
  assert.equal(s.bytes(),raw);assert.equal(s.counts.unlink,1);assert.equal(s.counts.rename,0);
  assert.equal(s.files.get(neighbor).toString(),'neighbor');const unlinked=s.calls.find(c=>c[0]==='unlink')[1];
  assert.notEqual(unlinked,file);assert.notEqual(unlinked,neighbor);assert.equal(s.files.get(unlinked).length,5);
});
for(const [name,value]of [
  ['bounds',{...good,bounds:{...good.bounds,width:1}}],['topmost',{...good,alwaysOnTop:'true'}],['idle',{...good,idleEnabled:0}],
])test('T07-R-W12 invalid '+name+' rejected before any mutation',()=>{
  const raw=JSON.stringify(good),s=storage(raw);s.bind(file);
  assert.throws(()=>s.stateIO.saveState(file,value),e=>e.message==='Invalid window state');assert.equal(s.bytes(),raw);noMutation(s);
});
test('T07-R-W12 writer commits only disk whitelist through owned fd then rename',()=>{
  const s=storage();s.bind(file);s.stateIO.saveState(file,{...good,raw:'canary',stateWriteBlocked:false,stateNoticeCode:'canary'});
  assert.deepEqual(JSON.parse(s.bytes()),good);assert.equal(s.counts.commit,1);assert.equal(s.counts.unlink,0);assert.equal(s.fds.size,0);
  assert.deepEqual(s.calls.filter(c=>mutationNames.includes(c[0])).map(c=>c[0]),['mkdir','openWrite','write','close','rename']);
  const open=s.calls.find(c=>c[0]==='openWrite');assert.equal(path.dirname(open[1]),path.dirname(file));assert.equal(open[2],'wx');assert.equal(open[3],0o600);
});
for(const parentExists of [false,true])test('T07-R-W01 actual scratch filesystem missing target, parent exists '+parentExists,()=>{
  const fs=require('node:fs'),io=require('../shared/window-state.js');
  const base=fs.mkdtempSync(path.join(process.env.TMPDIR,'t07-w01-')),target=path.join(base,'nested','window-state.json');
  try{
    if(parentExists)fs.mkdirSync(path.dirname(target));
    assert.deepEqual(io.loadStateResult(target),{status:'missing',value:null,reason:null});assert.equal(fs.existsSync(target),false);
    io.saveState(target,good);assert.deepEqual(JSON.parse(fs.readFileSync(target,'utf8')),good);
    assert.equal(io.loadStateResult(target).status,'valid');assert.deepEqual(fs.readdirSync(path.dirname(target)),['window-state.json']);
  }finally{fs.rmSync(base,{recursive:true,force:true});}
});
const file=path.join(process.env.TMPDIR,'storage-model','window-state.json');
test('T07-R-W11 collision: real writer must not unlink an unowned exclusive temp',()=>{
  const raw=JSON.stringify(good),s=storage(raw,{collide:true});s.bind(file);
  assert.throws(()=>s.stateIO.saveState(file,good),e=>e.code==='EEXIST');
  assert.equal(s.bytes(),raw);
  assert.equal(s.counts.unlink,0,'failed exclusive open has no temp ownership');
  assert.equal(s.files.get(s.collision()).toString(),'other owner');
  assert.equal(s.counts.write,0);assert.equal(s.counts.rename,0);
});
