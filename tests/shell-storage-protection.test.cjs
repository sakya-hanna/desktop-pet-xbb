'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {storage,harness,plain,good,untouched,loadCases,mutationNames}=require('./helpers/storage-harness.cjs');
// Additional matrix checks exercise already-green behavior; no new product code is inferred from them.
function checkBlocked(h,s,raw,label){
  untouched(h,raw,label);assert.equal(h.timers.size,0,label+': no pending saves');
  assert.equal(s.snapshot().stateWriteBlocked,true);assert.equal(h.store.counts.read,1,'one initial load only');
}
function exerciseBlocked(h,s,raw){
  const steps=[
    ['idle-ready',()=>h.send('idle-ready')],['repeat show',()=>s.show()],['drag',()=>s.drag({dx:-10,dy:-10})],
    ['resizeBy',()=>s.resizeBy(1.1)],['setSize',()=>s.setSize('small')],['topmost',()=>s.setTopmost(false)],
    ['idle',()=>s.setIdleEnabled(false)],['move',()=>h.windows[0].emit('move')],['resize',()=>h.windows[0].emit('resize')],
    ['display',()=>h.electron.screen.emit('display-metrics-changed')],['hide',()=>s.hide()],['show',()=>s.show()],
    ['menu hold',()=>s.menu({x:10,y:10})],['menu release',()=>h.calls.filter(c=>c[0]==='popup').at(-1)[1].callback()],
    ['reset',()=>s.reset()],['debounce',()=>h.advance()],['empty debounce',()=>h.advance(1000)],
  ];
  for(const [name,fn]of steps){fn();checkBlocked(h,s,raw,name);}
  const before=h.calls.length;assert.equal(s.save(),false);assert.equal(h.calls.length,before,'blocked save does not snapshot or preflight');checkBlocked(h,s,raw,'direct save');
}
const terminals={close:h=>h.windows[0].close(),closed:h=>h.windows[0].destroy(),'before-quit':h=>h.electron.app.emit('before-quit'),destroy:h=>{h.shell().destroy();h.shell().destroy();},quit:h=>h.shell().quit()};
for(const c of loadCases)for(const terminal of c.id==='W03'?Object.keys(terminals):['close'])test('T07-R-'+c.id+' protected lifecycle: '+c.name+' / '+terminal,async()=>{
  const store=storage(c.raw,c.options),h=harness({store}),s=h.start();
  try{
    checkBlocked(h,s,c.raw,'startup');assert.equal(s.snapshot().stateLoadStatus,c.status);assert.equal(s.snapshot().stateNoticeCode,c.code);
    assert.equal(s.snapshot().size,'medium');assert.equal(s.snapshot().alwaysOnTop,true);assert.equal(s.snapshot().idleEnabled,true);
    if(c.id==='W06')store.readFailure(null);
    await s.ready;checkBlocked(h,s,c.raw,'ready show');exerciseBlocked(h,s,c.raw);terminals[terminal](h);checkBlocked(h,s,c.raw,'terminal');
    assert.equal(h.handles.size,0);assert.equal(h.electron.ipcMain.eventNames().length,0);
  }finally{h.cleanup();}
  untouched(h,c.raw,'final cleanup');
});
for(const c of loadCases.filter(c=>c.id==='W03'))for(const failure of ['load-rejection','sync-setup','sync-load'])for(const delivery of ['sync','queued','microtask'])test('T07-R-W03 startup failure preserves bytes: '+c.name+' / '+failure+' / '+delivery,async()=>{
  const h=harness({store:storage(c.raw),failure,allClosedDelivery:delivery});
  try{
    if(failure==='load-rejection'){const boot=await h.boot();await assert.rejects(boot.ready,e=>e===h.failureError);}
    else await assert.rejects(h.boot(),e=>e===h.failureError);
    await h.drain();untouched(h,c.raw,'startup failure cleanup');
    assert.equal(h.timers.size,0);assert.equal(h.windows.length,1);assert.equal(h.windows[0].dead,true);
    assert.equal(h.calls.some(c=>c[0]==='quit'),false,'failure cleanup must not become user quit');
    assert.ok(h.lifecycle.includes('window-all-closed'));assert.equal(h.lifecycle.includes('default-quit'),false);
    assert.equal(h.handles.size,0);assert.equal(h.electron.ipcMain.eventNames().length,0);
    assert.equal(h.electron.app.listenerCount('window-all-closed'),0);assert.equal(h.electron.app.listenerCount('before-quit'),0);
  }finally{h.cleanup();}
});
for(const parentExists of [true,false])test('T07-R-W01 missing shell coalesces show and close, parent exists '+parentExists,async()=>{
  const h=harness({store:storage(undefined,{missing:true,parentExists})}),s=h.start();
  try{
    untouched(h,undefined,'initial missing');assert.equal(s.snapshot().stateLoadStatus,'missing');assert.equal(s.snapshot().stateWriteBlocked,false);assert.equal(s.snapshot().stateNoticeCode,null);
    assert.equal(s.snapshot().size,'medium');assert.equal(s.snapshot().alwaysOnTop,true);assert.equal(s.snapshot().idleEnabled,true);
    await s.ready;h.send('idle-ready');s.show();assert.equal(h.timers.size,1);h.advance();assert.equal(h.store.counts.commit,1);
    assert.equal(s.save(),true);h.windows[0].close();assert.equal(h.store.counts.commit,1);assert.equal(h.timers.size,0);
    const value=JSON.parse(h.store.bytes());assert.deepEqual(Object.keys(value).sort(),['alwaysOnTop','bounds','idleEnabled','size','version']);
    assert.equal(h.store.directories.has(require('node:path').dirname(h.store.target())),true);
    assert.equal(h.store.stateIO.loadStateResult(h.store.target()).status,'valid');
  }finally{h.cleanup();}
});
const savedVariants=[
  ['custom false',{...good,size:'custom',alwaysOnTop:false,idleEnabled:false}],
  ['legacy omitted idle',(({idleEnabled,...rest})=>rest)(good)],
  ['negative coordinates min width max height',{...good,size:'custom',bounds:{x:-500,y:-600,width:64,height:4096}}],
  ['max width min height',{...good,size:'custom',bounds:{x:-3000,y:-200,width:4096,height:64}}],
];
for(const [name,value]of savedVariants)test('T07-R-W02 valid roundtrip: '+name,async()=>{
  const raw=JSON.stringify({...value,ignored:'canary'}),h=harness({store:storage(raw),displays:[{id:1,workArea:{x:-10000,y:-10000,width:20000,height:20000}}]}),s=h.start();
  try{
    untouched(h,raw,'read only');assert.equal(s.snapshot().stateLoadStatus,'valid');assert.deepEqual(plain(s.snapshot().bounds),value.bounds);
    assert.equal(s.snapshot().size,value.size);assert.equal(s.snapshot().alwaysOnTop,value.alwaysOnTop);assert.equal(s.snapshot().idleEnabled,value.idleEnabled??true);
    await s.ready;s.setTopmost(!value.alwaysOnTop);h.advance();assert.equal(h.store.counts.commit,1);
    assert.deepEqual(JSON.parse(h.store.bytes()),{version:1,bounds:value.bounds,size:value.size,alwaysOnTop:!value.alwaysOnTop,idleEnabled:value.idleEnabled??true});
  }finally{h.cleanup();}
});
test('T07-R-W02 valid custom geometry fits actual display area before roundtrip',async()=>{
  const h=harness({store:storage(JSON.stringify({...good,size:'custom',bounds:{x:2400,y:1200,width:900,height:1305}})),displays:[{id:2,workArea:{x:-800,y:-600,width:800,height:600}}]}),s=h.start();
  try{assert.deepEqual(plain(s.snapshot().bounds),{x:-800,y:-600,width:800,height:600});await s.ready;h.advance();assert.deepEqual(JSON.parse(h.store.bytes()).bounds,plain(s.snapshot().bounds));}finally{h.cleanup();}
});
for(const fault of ['mkdir','openWrite','write','close','rename'])test('T07-R-W10 shell retries changed B after '+fault+' fault without notification loop',async()=>{
  const h=harness(),s=h.start();
  try{
    await s.ready;h.advance();const raw=h.store.bytes();h.store.resetCounts();h.store.fail(fault);s.setTopmost(false);h.advance();
    assert.equal(h.store.bytes(),raw);assert.equal(s.snapshot().lastError,'Window state save failed');assert.equal(h.timers.size,0);assert.equal(h.store.counts.commit,0);
    const attempts=h.store.counts.save;h.advance();h.advance();assert.equal(h.store.counts.save,attempts);
    h.store.fail(null);s.show();assert.equal(s.snapshot().lastError,'Window state save failed');h.advance();
    assert.equal(h.store.counts.commit,1);assert.equal(JSON.parse(h.store.bytes()).alwaysOnTop,false);assert.equal(s.snapshot().lastError,null);
    assert.equal(s.save(),true);assert.equal(h.store.counts.commit,1);assert.equal(h.timers.size,0);
  }finally{h.cleanup();}
});
for(const terminal of Object.keys(terminals))test('T07-R-W13 latest trusted position survives '+terminal+' without dead native reads',async()=>{
  const h=harness(),s=h.start();let external=0;const listener=()=>external++;
  h.electron.app.on('external',listener);h.electron.ipcMain.on('external',listener);h.electron.screen.on('external',listener);
  try{
    await s.ready;s.drag({dx:25,dy:35});const bounds=plain(s.snapshot().bounds);assert.equal(h.store.counts.commit,0);
    terminals[terminal](h);assert.equal(h.store.counts.commit,1);assert.deepEqual(JSON.parse(h.store.bytes()).bounds,bounds);
    s.destroy();for(const fn of h.retired)fn();assert.equal(h.store.counts.commit,1);assert.equal(h.timers.size,0);assert.equal(h.handles.size,0);
    assert.equal(h.calls.filter(c=>c[0]==='unregister').length,1);assert.equal(h.calls.filter(c=>c[0]==='tray-destroy').length,1);
    for(const emitter of [h.electron.app,h.electron.ipcMain,h.electron.screen]){assert.deepEqual(emitter.eventNames(),['external']);emitter.emit('external');}
    assert.equal(external,3);assert.deepEqual(plain(s.snapshot().bounds),bounds);
  }finally{h.cleanup();}
});
for(const [name,raw,options,externalBytes,status]of [
  ['repair','broken',{},JSON.stringify({...good,alwaysOnTop:false}),'valid'],['delete','broken',{},undefined,'missing'],
  ['permission restored',JSON.stringify(good),{readError:Object.assign(Error('fixture'),{code:'EACCES'})},JSON.stringify(good),'valid'],
  ['still broken','broken',{},'broken','invalid'],
])test('T07-R-W09 sticky instance then independent restart: '+name,async()=>{
  const store=storage(raw,options),h=harness({store}),s=h.start();await s.ready;store.external(externalBytes);store.readFailure(null);
  try{s.reset();s.show();h.advance();assert.equal(s.save(),false);s.destroy();untouched(h,externalBytes,'A after fixture-only external operation');assert.equal(store.counts.read,1);}
  finally{h.cleanup();}
  store.resetCounts();const next=harness({store}),b=next.start();
  try{
    assert.equal(b.snapshot().stateLoadStatus,status);assert.equal(b.snapshot().stateWriteBlocked,status==='invalid');
    if(status==='valid')assert.equal(b.snapshot().alwaysOnTop,JSON.parse(externalBytes).alwaysOnTop);
    await b.ready;next.advance();assert.equal(store.counts.commit,status==='invalid'?0:1);
    if(status==='invalid')untouched(next,externalBytes,'B still blocked');
  }finally{next.cleanup();}
});
for(const method of ['validateProfile','assertNoSymlinks','assertSessionPolicy'])test('T07-R-W15 preflight refusal is not missing: '+method,()=>{
  const h=harness({policyFailure:method});
  try{assert.throws(()=>h.start(),e=>e===h.failureError);assert.equal(h.store.counts.read,0);assert.equal(h.store.counts.save,0);assert.equal(h.windows.length,0);assert.equal(h.timers.size,0);}finally{h.cleanup();}
});
for(const [status,raw,options]of [
  ['valid',JSON.stringify(good),{}],['missing',undefined,{missing:true}],['invalid','broken',{}],
  ['unsupported-version',JSON.stringify({...good,version:2}),{}],['read-error',JSON.stringify(good),{readError:Error('private canary')}],
])test('T07-R-W08 T07-R-W16 T07-R-B01 public diagnostics cannot authorize writes: '+status,async()=>{
  const store=storage(raw,options);let oldCalls=0;store.stateIO.loadState=()=>{oldCalls++;assert.fail('legacy adapter called');};
  const h=harness({store}),s=h.start();
  try{
    await s.ready;const get=h.handles.get('desktop:get-state'),state=get(h.event()),blocked=!['valid','missing'].includes(status);
    assert.equal(state.stateLoadStatus,status);assert.equal(state.stateWriteBlocked,blocked);assert.ok(state.stateNoticeCode===null||typeof state.stateNoticeCode==='string');
    assert.deepEqual(Object.keys(state).sort(),['bounds','size','alwaysOnTop','clickThrough','visible','idleEnabled','shortcut','shortcutAvailable','shortcutStatus','rescueAvailable','testRescue','lastError','mode','stateLoadStatus','stateWriteBlocked','stateNoticeCode'].sort());
    state.stateWriteBlocked=false;state.stateNoticeCode=null;state.stateLoadStatus='missing';
    for(const payload of [{name:'forceSave'},{name:'reset',forceSave:true},{name:'topmost',value:false,stateWriteBlocked:false},null,[]])h.send('desktop:command',payload);
    assert.equal(s.snapshot().stateWriteBlocked,blocked);assert.equal(s.snapshot().stateLoadStatus,status);assert.equal(s.snapshot().alwaysOnTop,true);
    const reads=store.counts.read,writes=store.counts.save,before=plain(s.snapshot());
    for(const event of [{sender:{},senderFrame:h.event().senderFrame},{sender:h.event().sender,senderFrame:{}},{}]){
      assert.equal(get(event),null);h.electron.ipcMain.emit('desktop:command',event,{name:'topmost',value:false});h.electron.ipcMain.emit('drag',event,{dx:10,dy:10});
    }
    assert.equal(get(h.event(),'extra'),null);assert.deepEqual(plain(s.snapshot()),before);assert.equal(store.counts.read,reads);assert.equal(store.counts.save,writes);
    assert.equal(s.save(),!blocked);assert.equal(oldCalls,0);
    if(blocked)untouched(h,raw,'forged snapshot cannot unlock');else assert.deepEqual(Object.keys(JSON.parse(store.bytes())).sort(),['alwaysOnTop','bounds','idleEnabled','size','version']);
    s.destroy();assert.equal(get(h.event()),null);assert.equal(h.handles.size,0);
  }finally{h.cleanup();}
});
const validValue=()=>{const {version,...value}=good;return structuredClone(value);};
test('T07-R-W14 retry cached A after failed B requires a real successful commit',async()=>{
  const h=harness(),s=h.start();
  try{
    await s.ready;h.advance();const original=h.store.bytes();assert.equal(h.store.counts.commit,1);
    h.store.fail('rename');s.setTopmost(false);h.advance();
    assert.equal(s.snapshot().lastError,'Window state save failed');assert.equal(h.store.bytes(),original);
    const attempts=h.store.counts.save;h.advance();h.advance();assert.equal(h.store.counts.save,attempts);
    s.setTopmost(true);
    assert.equal(s.save(),false,'matching cached A cannot clear an unresolved failed commit');
    assert.equal(h.store.counts.save,attempts+1);assert.equal(s.snapshot().lastError,'Window state save failed');
    assert.equal(h.timers.size,0);assert.equal(h.store.bytes(),original);
    const build=h.electron.Menu.buildFromTemplate;
    h.electron.Menu.buildFromTemplate=(...args)=>{const m=build(...args);m.popup=()=>{throw Error('synthetic menu fault');};return m;};
    s.menu({x:10,y:10});assert.equal(s.snapshot().lastError,'Native menu unavailable');
    h.store.fail(null);assert.equal(s.save(),true);assert.equal(h.store.counts.commit,2);
    assert.equal(s.snapshot().lastError,'Native menu unavailable','save recovery only clears its own source');
    h.electron.Menu.buildFromTemplate=build;s.menu({x:10,y:10});
    assert.equal(s.snapshot().lastError,null);h.calls.filter(c=>c[0]==='popup').at(-1)[1].callback();
    h.advance();assert.equal(h.store.counts.commit,2);
  }finally{h.cleanup();}
});
test('T07-R-W07 incomplete adapter without writer fails before any window',()=>{
  for(const result of [{status:'missing',value:null,reason:null},{status:'valid',value:validValue(),reason:null}]){
    const h=harness({stateIO:{loadStateResult:()=>result}});
    try{assert.throws(()=>h.start(),e=>e.message==='Invalid window state loader contract');assert.equal(h.windows.length,0);assert.equal(h.timers.size,0);}
    finally{h.cleanup();}
  }
});
test('T07-R-W03 tracer: bad JSON survives real load/show/200ms/close with zero mutations',async()=>{
  const raw='{"version":1,',h=harness({store:storage(raw)}),s=h.start();
  try{
    untouched(h,raw,'load');await s.ready;untouched(h,raw,'show');
    h.advance(201);untouched(h,raw,'200ms');
    h.windows[0].close();untouched(h,raw,'close then closed');
    assert.equal(h.timers.size,0);
  }finally{h.cleanup();}
});

for(const [name,result] of [
  ['unknown status',{status:'untrusted-canary',value:null,reason:null}],
  ['null',null],['missing value',{status:'valid',value:null,reason:null}],
  ['missing with value',{status:'missing',value:validValue(),reason:null}],
  ['invalid reason',{status:'invalid',value:null,reason:{toString(){throw Error('do not stringify');}}}],
  ['valid reason',{status:'valid',value:validValue(),reason:'json'}],
  ['invalid with value',{status:'invalid',value:validValue(),reason:'json'}],
  ['unsupported with reason',{status:'unsupported-version',value:null,reason:'schema'}],
  ['read-error with value',{status:'read-error',value:validValue(),reason:null}],
  ['bad geometry',{status:'valid',value:{...validValue(),bounds:{x:0,y:0,width:1,height:348}},reason:null}],
  ['extra value field',{status:'valid',value:{...validValue(),raw:'canary'},reason:null}],
  ['missing reason',{status:'missing',value:null}],
])test('T07-R-W07 contract rejected before window: '+name,()=>{
  let oldCalls=0;const store=storage('broken'),h=harness({store,stateIO:{loadState(){oldCalls++;return null;},loadStateResult:()=>result,saveState(){assert.fail('no save');}}});
  try{assert.throws(()=>h.start(),e=>e.message==='Invalid window state loader contract');
    assert.equal(h.windows.length,0);assert.equal(oldCalls,0);assert.equal(h.timers.size,0);assert.equal(store.counts.save,0);
  }finally{h.cleanup();}
});
test('T07-R-W07 old nullable adapter is not a missing-state adapter',()=>{
  let called=0;const h=harness({stateIO:{loadState(){called++;return null;},saveState(){assert.fail('no save');}}});
  try{assert.throws(()=>h.start(),e=>e.message==='Invalid window state loader contract');assert.equal(h.windows.length,0);assert.equal(called,0);}finally{h.cleanup();}
});
