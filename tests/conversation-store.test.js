const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {create}=require('../puppet/conversation-store');
test('validated explicit user, assistant and system append persist without fabricating a paired notice',t=>{const f=file(t),s=create({file:f});s.append('user','你好','chat-input');s.append('assistant','弟弟好','model');assert.equal(create({file:f}).snapshot().length,2);assert.equal(s.snapshot()[1].role,'assistant');for(const a of [['tool','x','model'],['assistant',' ','model'],['assistant','x'.repeat(4001),'model']])assert.throws(()=>s.append(...a));});
function file(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'baijie-chat-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return path.join(dir,'nested/conversation.json');}
test('user send atomically persists an ordered user + honest system status, restores and clears',t=>{
 const f=file(t),s=create({file:f}); assert.deepEqual(s.snapshot(),[]);
 const rows=s.send('  你好🌷  ');assert.equal(rows.length,2);assert.equal(rows[0].text,'你好🌷');assert.equal(rows[0].role,'user');assert.equal(rows[1].role,'system');assert.equal(rows[1].source,'model-unconfigured');assert.match(rows[1].text,/未配置/);assert.notEqual(rows[0].id,rows[1].id);
 assert.deepEqual(create({file:f}).snapshot(),rows);assert.equal(JSON.parse(fs.readFileSync(f)).version,1);
 rows[0].text='mutated';assert.equal(s.snapshot()[0].text,'你好🌷');s.clear();assert.deepEqual(create({file:f}).snapshot(),[]);assert.deepEqual(fs.readdirSync(path.dirname(f)),['conversation.json']);
});
test('rejects blank/non-string/over-limit input and bounds Unicode history to 200 rows',t=>{
 const s=create({file:file(t)});for(const text of ['', ' \n ', null, {}, '🌷'.repeat(4001)])assert.throws(()=>s.send(text));
 s.send('🌷'.repeat(4000));for(let i=0;i<101;i++)s.send('消息'+i);assert.equal(s.snapshot().length,200);assert.equal(s.snapshot().at(-2).text,'消息100');
});
test('corrupt, oversized, wrong-schema and duplicate-id histories fall back safely',t=>{
 const f=file(t);fs.mkdirSync(path.dirname(f),{recursive:true});
 const row={id:'same',role:'user',source:'chat-input',text:'hello',timestamp:1};
 for(const raw of [JSON.stringify({version:1,messages:[row,row]}),'{','null',JSON.stringify({version:99,messages:[]}),JSON.stringify({version:1,messages:[{role:'assistant',text:'fake'}]}),' '.repeat(4*1024*1024+1)]){
  fs.writeFileSync(f,raw);const s=create({file:f});assert.deepEqual(s.snapshot(),[]);s.send('重新开始');assert.equal(create({file:f}).snapshot().length,2);
 }
});
test('failed atomic replacement preserves memory and previous readable history',t=>{
 const f=file(t),s=create({file:f});s.send('before');const before=s.snapshot(),bytes=fs.readFileSync(f,'utf8'),rename=fs.renameSync;
 try{fs.renameSync=()=>{throw Error('injected rename failure');};assert.throws(()=>s.send('after'),/injected/);}finally{fs.renameSync=rename;}
 assert.equal(fs.readFileSync(f,'utf8'),bytes);assert.deepEqual(s.snapshot(),before);assert.deepEqual(fs.readdirSync(path.dirname(f)),['conversation.json']);
});
