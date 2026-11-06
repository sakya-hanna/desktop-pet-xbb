'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = name => fs.readFileSync(path.join(__dirname, '../puppet', name), 'utf8');
function fixture(t, overrides = {}) {
  const handlers = new Map(), windows = [], saves = [], connections = [];
  const store = { snapshot: () => ({baseUrl:'https://example.test/v1', model:'model', keyConfigured:true, apiKey:'NEVER'}),
    save: value => { saves.push(value); return store.snapshot(); } };
  class Window extends EventEmitter {
    constructor(options) { super(); this.options=options; this.webContents=new EventEmitter(); this.webContents.mainFrame={}; this.webContents.setWindowOpenHandler=f=>{this.openHandler=f;}; windows.push(this); }
    isDestroyed(){return !!this.dead;} loadFile(file){this.file=file;return Promise.resolve();}
    show(){this.shown=true;} focus(){this.focused=true;} destroy(){this.dead=true;this.emit('closed');}
  }
  const api = require('../puppet/settings-window').create({BrowserWindow:Window, ipcMain:{handle:(k,f)=>handlers.set(k,f),removeHandler:k=>handlers.delete(k)},store,
    testConnection:async(...args)=>{connections.push(args);return {ok:true,apiKey:'NEVER'};},...overrides});
  t.after(()=>api.destroy());
  const call=(action,payload,event)=>handlers.get('settings:'+action)(event || {sender:windows.at(-1).webContents,senderFrame:windows.at(-1).webContents.mainFrame},payload);
  return {api,handlers,windows,store,saves,connections,call};
}
function renderer(api) {
  const nodes={};
  for(const id of ['settings-form','base-url','model','api-key','remove-key','key-status','save','test','status']) nodes[id]={value:'',checked:false,disabled:false,textContent:'',listeners:{},addEventListener(name,handler){this.listeners[name]=handler;}};
  vm.runInNewContext(source('settings.js'),{document:{getElementById:id=>nodes[id]},window:{settings:api}});
  return nodes;
}
const tick=()=>new Promise(setImmediate);
test('light local form preserves blank password, clears only explicitly and only tests through its separate button',async()=>{
  const saves=[];let tests=0;
  const nodes=renderer({async read(){return {baseUrl:'https://saved.test',model:'<model>',keyConfigured:true};},async save(value){saves.push(JSON.parse(JSON.stringify(value)));return {ok:true,settings:{baseUrl:value.baseUrl,model:value.model,keyConfigured:value.apiKey!==''}};},async test(){tests++;return {ok:true,message:'DO NOT ECHO'};}});
  await tick();assert.equal(nodes['base-url'].value,'https://saved.test');assert.equal(nodes.model.value,'<model>');assert.equal(nodes['api-key'].value,'');assert.match(nodes['key-status'].textContent,/已配置/);assert.equal(tests,0);
  const event={preventDefault(){}};
  await nodes['settings-form'].listeners.submit(event);assert.deepEqual(saves[0],{baseUrl:'https://saved.test',model:'<model>'});assert.equal(tests,0);
  nodes['api-key'].value='NEW';await nodes['settings-form'].listeners.submit(event);assert.equal(saves[1].apiKey,'NEW');assert.equal(nodes['api-key'].value,'');
  nodes['remove-key'].checked=true;nodes['remove-key'].listeners.change();assert.equal(nodes['api-key'].disabled,true);
  await nodes['settings-form'].listeners.submit(event);assert.equal(saves[2].apiKey,'');assert.equal(nodes['remove-key'].checked,false);assert.match(nodes['key-status'].textContent,/未配置/);
  await nodes.test.listeners.click();assert.equal(tests,1);assert.equal(nodes.status.textContent,'连接成功。');
  const html=source('settings.html');assert.match(html,/default-src 'none'/);assert.match(html,/script-src 'self'/);assert.match(html,/style-src 'self'/);assert.match(html,/connect-src 'none'/);assert.match(html,/id="test" type="button"/);assert.match(html,/id="api-key" type="password"/);
  assert.match(source('settings.css'),/color-scheme:\s*light/);assert.doesNotMatch(source('settings.js'),/innerHTML|console\.|fetch\(/);
});
test('busy controls block duplicate or cross actions during read/save/test, with safe errors and password disposal',async()=>{
  let resolveRead,resolveSave,resolveTest,saves=0,tests=0;
  const nodes=renderer({read:()=>new Promise(r=>{resolveRead=r;}),save:()=>{saves++;return new Promise(r=>{resolveSave=r;});},test:()=>{tests++;return new Promise(r=>{resolveTest=r;});}});
  const submit=()=>nodes['settings-form'].listeners.submit({preventDefault(){}});
  const initial=submit();assert.equal(saves,0);await initial;await nodes.test.listeners.click();assert.equal(tests,0);assert.ok(nodes.save.disabled && nodes.test.disabled);
  resolveRead({baseUrl:'https://saved.test',model:'m',keyConfigured:true});await tick();
  nodes['api-key'].value='DISPOSE';const saving=submit();await submit();await nodes.test.listeners.click();assert.equal(saves,1);assert.equal(tests,0);assert.ok(nodes.save.disabled && nodes.test.disabled && nodes['api-key'].disabled);
  resolveSave({ok:false,message:'SECRET'});await saving;assert.doesNotMatch(nodes.status.textContent,/SECRET/);assert.equal(nodes['api-key'].value,'');assert.equal(nodes.save.disabled,false);
  const testing=nodes.test.listeners.click();await nodes.test.listeners.click();await submit();assert.equal(tests,1);assert.equal(saves,1);assert.ok(nodes.save.disabled && nodes.test.disabled);
  resolveTest({ok:false,message:'SECRET'});await testing;assert.doesNotMatch(nodes.status.textContent,/SECRET/);assert.equal(nodes.test.disabled,false);
  const failed=renderer({read:async()=>{throw Error('SECRET');}});await tick();assert.doesNotMatch(failed.status.textContent,/SECRET/);assert.ok(failed.save.disabled && failed.test.disabled);
});
test('narrow bridge exposes only read/save/test and test never forwards arguments',()=>{
  let api;const calls=[];
  vm.runInNewContext(source('settings-preload.js'),{require(name){assert.equal(name,'electron');return {contextBridge:{exposeInMainWorld(name,value){assert.equal(name,'settings');api=value;}},ipcRenderer:{invoke:(...args)=>{calls.push(args);}}};}});
  assert.deepEqual(Object.keys(api).sort(),['read','save','test']);api.read('bad');api.save({model:'m'});api.test({baseUrl:'bad'});
  assert.deepEqual(calls,[['settings:read'],['settings:save',{model:'m'}],['settings:test']]);
});
test('save preserves omitted keys, explicitly clears and strips unknown properties; all failures are fixed safe messages', async t=>{
  const f=fixture(t);f.api.open();
  assert.equal((await f.call('save',{baseUrl:'https://saved.test',model:'m',extra:'no'})).ok,true);
  assert.deepEqual(f.saves[0],{baseUrl:'https://saved.test',model:'m'});
  await f.call('save',{baseUrl:'https://saved.test',model:'m',apiKey:''});assert.equal(f.saves[1].apiKey,'');
  await f.call('save',{baseUrl:'https://saved.test',model:'m',apiKey:'NEW'});assert.equal(f.saves[2].apiKey,'NEW');
  f.store.save=()=>{throw Error('SECRET https://user:password@host');};
  const result=await f.call('save',{baseUrl:'x',model:'y',apiKey:'NEW'});assert.equal(result.ok,false);assert.doesNotMatch(JSON.stringify(result),/SECRET|password|NEW/);
  assert.equal((await f.call('save',null)).ok,false);
});
test('connection is explicit, payload never reaches callback and arbitrary result/errors are not echoed',async t=>{
  const f=fixture(t);f.api.open();assert.equal(f.connections.length,0);
  const result=await f.call('test',{baseUrl:'https://attacker.test',apiKey:'BAD'});assert.deepEqual(f.connections,[[]]);assert.deepEqual(result,{ok:true,message:'连接成功。'});
  const g=fixture(t,{testConnection:async()=>{throw Error('SECRET network URL');}});g.api.open();
  assert.deepEqual(await g.call('test'),{ok:false,message:'连接失败，请检查已保存的配置。'});
  const h=fixture(t,{testConnection:async()=>({ok:false,message:'SECRET'})});h.api.open();assert.doesNotMatch(JSON.stringify(await h.call('test')),/SECRET/);
});
test('independent secure singleton window rejects foreign/subframe/stale senders and cleans up', t=>{
  const f=fixture(t); assert.equal(f.windows.length,0); f.api.open(); f.api.open(); assert.equal(f.windows.length,1);
  const w=f.windows[0]; assert.deepEqual(w.options.webPreferences,{preload:path.resolve(__dirname,'../puppet/settings-preload.js'),sandbox:true,contextIsolation:true,nodeIntegration:false,webSecurity:true});
  assert.equal(w.options.show,false); w.webContents.emit('did-finish-load'); assert.ok(w.shown && w.focused);
  assert.deepEqual(f.call('read'),{baseUrl:'https://example.test/v1',model:'model',keyConfigured:true});
  for(const action of ['read','save','test']) {
    assert.throws(()=>f.call(action,{}, {sender:{},senderFrame:w.webContents.mainFrame}),/sender/);
    assert.throws(()=>f.call(action,{}, {sender:w.webContents,senderFrame:{}}),/sender/);
  }
  assert.deepEqual(w.openHandler(),{action:'deny'});
  for(const name of ['will-navigate','will-frame-navigate','will-redirect','will-attach-webview']) {let prevented=false;w.webContents.emit(name,{preventDefault(){prevented=true;}});assert.ok(prevented);}
  w.destroy();f.api.open();assert.equal(f.windows.length,2);
  assert.throws(()=>f.call('read',null,{sender:w.webContents,senderFrame:w.webContents.mainFrame}),/sender/);
  f.api.destroy();assert.equal(f.handlers.size,0);assert.ok(f.windows[1].dead);f.api.open();assert.equal(f.windows.length,2);
});
