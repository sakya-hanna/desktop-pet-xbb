const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {create} = require('../puppet/settings-store');
function file(t) { const dir=fs.mkdtempSync(path.join(os.tmpdir(),'baijie-settings-')); t.after(()=>fs.rmSync(dir,{recursive:true,force:true})); return path.join(dir,'nested/settings.json'); }
// Deliberately non-plaintext fake encryption; Electron is injected only by main.
const safeStorage = {isEncryptionAvailable:()=>true, encryptString:s=>Buffer.from([...s].reverse().join('')), decryptString:b=>[...b.toString()].reverse().join('')};
test('encrypted settings round trip; public snapshot excludes key; omitted key preserves and empty clears',t=>{
 const f=file(t),s=create({file:f,safeStorage});
 assert.deepEqual(s.snapshot(),{baseUrl:'',model:'',keyConfigured:false});
 assert.deepEqual(s.save({baseUrl:'https://example.test/v1/',model:'my-model',apiKey:'private-token'}),{baseUrl:'https://example.test/v1',model:'my-model',keyConfigured:true});
 assert.ok(!fs.readFileSync(f,'utf8').includes('private-token'));
 const restored=create({file:f,safeStorage});
 assert.deepEqual(restored.getRequestConfig(),{baseUrl:'https://example.test/v1',model:'my-model',apiKey:'private-token'});
 restored.save({baseUrl:'https://other.test',model:'next'});
 assert.equal(restored.getRequestConfig().apiKey,'private-token');
 restored.save({baseUrl:'https://other.test',model:'next',apiKey:''});
 assert.equal(restored.snapshot().keyConfigured,false);
 assert.equal(create({file:f,safeStorage}).getRequestConfig().apiKey,'');
});

test('validates explicit endpoints and bounded model',t=>{
 const s=create({file:file(t),safeStorage});
 for(const baseUrl of ['', 'ftp://secret.test','http://example.test','https://user:secret@example.test','https://example.test?secret','https://example.test#secret','https://example.test/?','https://example.test/#',' https://example.test','http://127.0.0.1.evil.test','http://[::ffff:192.168.1.1]']) assert.throws(()=>s.save({baseUrl,model:'m'}),{message:'Invalid AI settings'});
 for(const model of ['',null,{},'x'.repeat(201),'bad'+String.fromCharCode(10)+'model']) assert.throws(()=>s.save({baseUrl:'https://example.test',model}),{message:'Invalid AI settings'});
 for(const baseUrl of ['http://127.0.0.1:123/v1','http://localhost:123','http://[::1]:123','https://custom.example/path']) assert.equal(s.save({baseUrl,model:'explicit'}).baseUrl,baseUrl);
});

test('unavailable encryption refuses new key persistence and key reads, without plaintext fallback',t=>{
 const f=file(t),unavailable={...safeStorage,isEncryptionAvailable:()=>false};
 const s=create({file:f,safeStorage:unavailable});
 assert.throws(()=>s.save({baseUrl:'https://example.test',model:'m',apiKey:'secret'}),{message:'Secure key storage unavailable'});
 assert.equal(fs.existsSync(f),false);
 s.save({baseUrl:'https://example.test',model:'m'});
 assert.equal(s.snapshot().keyConfigured,false);
 create({file:f,safeStorage}).save({baseUrl:'https://example.test',model:'m',apiKey:'secret'});
 const locked=create({file:f,safeStorage:unavailable});
 assert.throws(()=>locked.getRequestConfig(),{message:'Secure key storage unavailable'});
 locked.save({baseUrl:'https://example.test',model:'m',apiKey:''});
 assert.equal(locked.getRequestConfig().apiKey,'');
});
test('encryption/decryption failures and invalid API keys never expose input',t=>{
 const f=file(t),s=create({file:f,safeStorage:{...safeStorage,encryptString(){throw Error('private-token');}}});
 for(const apiKey of [null,{},'x'.repeat(4097),'bad\nkey']) assert.throws(()=>s.save({baseUrl:'https://example.test',model:'m',apiKey}),{message:'Invalid AI settings'});
 assert.throws(()=>s.save({baseUrl:'https://example.test',model:'m',apiKey:'private-token'}),{message:'Secure key storage unavailable'});
 create({file:f,safeStorage}).save({baseUrl:'https://example.test',model:'m',apiKey:'private-token'});
 const broken=create({file:f,safeStorage:{...safeStorage,decryptString(){throw Error('private-token');}}});
 assert.throws(()=>broken.getRequestConfig(),{message:'Secure key storage unavailable'});
});

test('atomic write failure preserves old disk and memory and sanitizes filesystem errors',t=>{
 const f=file(t),s=create({file:f,safeStorage});s.save({baseUrl:'https://example.test',model:'before',apiKey:'private-token'});
 const bytes=fs.readFileSync(f,'utf8'),before=s.snapshot();
 for(const method of ['writeFileSync','renameSync']) {
  const original=fs[method];try {
   fs[method]=()=>{throw Error('private-token');};
   assert.throws(()=>s.save({baseUrl:'https://other.test',model:'after',apiKey:'next-token'}),{message:'Could not save AI settings'});
  } finally {fs[method]=original;}
  assert.equal(fs.readFileSync(f,'utf8'),bytes);assert.deepEqual(s.snapshot(),before);
  assert.deepEqual(fs.readdirSync(path.dirname(f)),['settings.json']);
 }
});
test('loads only valid bounded versioned own-store content, never accepts plaintext API keys',t=>{
 const f=file(t);fs.mkdirSync(path.dirname(f),{recursive:true});
 const empty={baseUrl:'',model:'',keyConfigured:false};
 for(const raw of ['{','null',' '.repeat(65537),JSON.stringify({version:2,baseUrl:'https://example.test',model:'m',encryptedKey:''}),JSON.stringify({version:1,baseUrl:'http://evil.test',model:'m',encryptedKey:''}),JSON.stringify({version:1,baseUrl:'https://example.test',model:'m',apiKey:'private-token'}),JSON.stringify({version:1,baseUrl:'https://example.test',model:'m',encryptedKey:'%%%bad'})]) {
  fs.writeFileSync(f,raw);assert.deepEqual(create({file:f,safeStorage}).snapshot(),empty);
 }
});

test('requires explicit URL syntax and rejects even empty URL credentials',t=>{
 const s=create({file:file(t),safeStorage});
 for(const baseUrl of ['https:///example.test','https:example.test','https:/example.test','https://@example.test','http://@127.0.0.1','https://: @example.test']) assert.throws(()=>s.save({baseUrl,model:'m'}),{message:'Invalid AI settings'});
});
