'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const {source}=require('./i13-frontend-harness.cjs');
for(const kind of ['chat','settings']) {
  function boot(isMainFrame) {
    const exposed=[],calls=[];
    vm.runInNewContext(source(kind+'-preload.js'),{process:{isMainFrame},require:name=>{
      assert.equal(name,'electron');return {contextBridge:{exposeInMainWorld:(name,api)=>exposed.push({name,api})},ipcRenderer:{invoke:(...args)=>{calls.push(args);return Promise.resolve();}}};
    }});
    return {exposed,calls};
  }
  test(`${kind} preload refuses subframes and missing main-frame identity`,()=>{
    assert.equal(boot(false).exposed.length,0);assert.equal(boot(undefined).exposed.length,0);
  });
  test(`${kind} preload exposes frozen named IPC only; no generic sender`,async()=>{
    const {exposed,calls}=boot(true);assert.equal(exposed.length,1);assert.equal(exposed[0].name,kind);
    const api=exposed[0].api,names=kind==='chat'?['read','send','cancel','clear']:['read','save','test'];
    assert.deepEqual(Object.keys(api),names);assert.equal(Object.isFrozen(api),true);
    await api.read('untrusted-channel');
    if(kind==='chat'){await api.send('hello');await api.cancel();await api.clear();assert.deepEqual(calls,[['chat:read'],['chat:send','hello'],['chat:cancel'],['chat:clear']]);}
    else {const preserve={baseUrl:'https://example.invalid',model:'fixture'};await api.save(preserve);await api.save({...preserve,apiKey:''});await api.test();assert.equal(Object.hasOwn(calls[1][1],'apiKey'),false);assert.equal(calls[2][1].apiKey,'');assert.deepEqual(calls.map(c=>c[0]),['settings:read','settings:save','settings:save','settings:test']);}
  });
}
test('local-only pages retain CSP and QQ avatar resources, no remote or direct network APIs',()=>{
  for(const kind of ['chat','settings']){
    assert.match(source(kind+'.html'),/connect-src 'none'/);
    assert.doesNotMatch(source(kind+'.html'),/(?:src|href)="https?:/);
    assert.doesNotMatch(source(kind+'.js'),/\b(?:fetch|XMLHttpRequest|WebSocket|innerHTML)\b/);
  }
  assert.match(source('chat.html'),/assets\/chat\/baijie-avatar\.png/);
  assert.match(source('chat.css'),/\.message\.user/);assert.match(source('chat.css'),/\.message\s*\{\s*display: grid; grid-template-columns: var\(--avatar\) minmax\(0, 1fr\)/);
});
