'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..');
test('desktop entry loads one new motion runtime and one canvas, without legacy/preview/recording entrypoints',()=>{
  const html=fs.readFileSync(path.join(root,'desktop.html'),'utf8');
  assert.equal((html.match(/<canvas\b/g)||[]).length,1);
  for(const banned of ['rig/app.js','live-preview.js','preview-main','original','id="detail"','frame-recorder'])assert.equal(html.includes(banned),false,banned);
  assert.equal((html.match(/src\/director\.js/g)||[]).length,1);
  assert.equal((html.match(/src\/desktop-runtime\.js/g)||[]).length,1);
  assert.ok(html.indexOf('src/character-renderer.js')<html.indexOf('src/desktop-bootstrap.js'));
  assert.match(html,/connect-src 'self'/);assert.doesNotMatch(html,/unsafe-inline|https?:|file:/);
  for(const id of ['grip','smaller','larger','hop','menu','hide'])assert.match(html,new RegExp('<button[^>]*id="'+id+'"[^>]*aria-label='));
});
function setup({failed=false}={}){
  const nodes=new Map(),windowEvents={},calls=[];
  for(const id of ['notice','character','toolbar','menu','hide'])nodes.set(id,{id,textContent:'',listeners:{},addEventListener(n,f){this.listeners[n]=f;},getBoundingClientRect:()=>({x:0,y:0,width:240,height:348})});
  const renderer={status:()=>({webgl2:true}),headInputPoint:()=>({x:130,y:60}),hitOpaque:()=>true,hitTest:()=>[290,80]};
  const runtime={start:()=>calls.push('start'),destroy:()=>calls.push('destroy'),status:()=>({running:true})};
  const window={pet:{setInteractive:v=>calls.push(['interactive',v]),menu:p=>calls.push(['menu',p]),command:(...p)=>calls.push(['command',...p])},addEventListener(n,f){windowEvents[n]=f;}};
  const context=vm.createContext({window,document:{body:{dataset:{}},querySelector:s=>nodes.get(s.slice(1))},console:{error:v=>calls.push(['error',v])},CharacterRenderer:{create:async c=>{assert.equal(c,nodes.get('character'));if(failed)throw Error('fixture texture failure');return renderer;}},DesktopRuntime:{attach:opts=>{assert.equal(opts.renderer,renderer);assert.equal(opts.pet,window.pet);calls.push('attach');return runtime;}}});
  return {window,windowEvents,nodes,calls,run:()=>vm.runInContext(fs.readFileSync(path.join(root,'src/desktop-bootstrap.js'),'utf8'),context)};
}
test('real bootstrap constructs renderer before runtime, starts once and exposes readonly diagnostics',async()=>{
  const h=setup();await h.run();assert.deepEqual(h.calls,['attach','start']);assert.equal(h.window.__desktop.status().ready,true);
  assert.equal(h.window.__desktop.status().render.webgl2,true);assert.equal(Object.isFrozen(h.window.__desktop),true);
  h.windowEvents.pagehide();assert.equal(h.calls.at(-1),'destroy');
});
test('startup failure is explicit and native exit remains reachable without pretending renderer is ready',async()=>{
  const h=setup({failed:true});await h.run();assert.match(h.window.__desktopFailure,/fixture texture failure/);assert.equal(h.window.__desktop,undefined);
  assert.ok(h.calls.some(v=>Array.isArray(v)&&v[0]==='interactive'&&v[1]===true));
  h.nodes.get('hide').listeners.click();assert.deepEqual(h.calls.at(-1),['command','quit']);
});

// Real bootstrap + runtime + director + sandbox preload. Only DOM/RAF/GPU and
// Electron IPC are simulated; no native window, tray, shortcut or input is used.
function integrated({failRenderAt=0,failCreate=false,pauseOnReady=null,shellOptions}={}){
  function node(id){return {id,title:'',textContent:'',dataset:{},listeners:new Map(),
    addEventListener(type,fn){const list=this.listeners.get(type)||new Set();list.add(fn);this.listeners.set(type,list);},
    removeEventListener(type,fn){this.listeners.get(type)?.delete(fn);},
    contains(target){return target===this||target?.parent===this;},
    setPointerCapture(){},hasPointerCapture(){return false;},releasePointerCapture(){}};}
  const window=node('window'),document=node('document'),nodes=new Map();
  for(const id of ['body','notice','character','toolbar','grip','smaller','larger','menu','hop','hide'])nodes.set(id,node(id));
  document.body=nodes.get('body');document.hidden=false;
  document.querySelector=selector=>nodes.get(selector.slice(1));
  const canvas=nodes.get('character'),toolbar=nodes.get('toolbar');
  const rect={x:100,y:100,width:240,height:348},bar={x:110,y:104,width:220,height:28};
  canvas.getBoundingClientRect=()=>({...rect});toolbar.getBoundingClientRect=()=>({...bar});
  toolbar.querySelector=document.querySelector;document.elementFromPoint=()=>toolbar;
  for(const id of ['grip','smaller','larger','menu','hop','hide'])nodes.get(id).parent=toolbar;
  const calls=[],raf=new Map(),ipc=new (require('node:events').EventEmitter)();let rafId=0,renderCalls=0,runtime;
  const emit=(target,type,data={})=>{const event={target,clientX:225,clientY:116,screenX:725,screenY:416,
    button:0,buttons:0,isTrusted:false,preventDefault(){},...data};
    for(const fn of [...(target.listeners.get(type)||[])])fn(event);};
  const act=name=>ipc.emit('action',{},name);
  let shell,removePolicy,nativeWindow,nativeElectron,failSaves=shellOptions?.saveFails===true;
  const ipcMain=new (require('node:events').EventEmitter)(),handlers=new Map(),saveTimers=new Map();let timerId=0;
  const event=()=>({sender:nativeWindow.webContents,senderFrame:nativeWindow.webContents.mainFrame});
  const stateNotifications=[];let resolveGetState;
  ipc.send=(...args)=>{calls.push(args);if(shell)ipcMain.emit(args[0],event(),...args.slice(1));if(args[0]==='idle-ready'&&pauseOnReady){
    if(pauseOnReady==='visibility'){document.hidden=true;emit(document,'visibilitychange');}
    else act(pauseOnReady);
  }};
  ipc.invoke=(...args)=>{calls.push(args);const value=shell?handlers.get(args[0])(event(),...args.slice(1)):{mode:'visible',visible:pauseOnReady!=='shell:hide',idleEnabled:true};
    return shellOptions?.deferGetState?new Promise(resolve=>{resolveGetState=()=>resolve(value);}):Promise.resolve(value);};
  if(shellOptions){
    const {EventEmitter}=require('node:events');
    class Window extends EventEmitter{
      constructor(options){super();nativeWindow=this;this.bounds={x:options.x,y:options.y,width:options.width,height:options.height};this.visible=false;this.dead=false;
        this.webContents=Object.assign(new EventEmitter(),{mainFrame:{url:'baijie28://app/desktop.html'},
          send:(channel,...args)=>{if(channel==='desktop:state'&&shellOptions.deferStateNotifications)stateNotifications.push(args);else ipc.emit(channel,{},...args);},setWindowOpenHandler(){}});}
      getBounds(){return {...this.bounds};} setBounds(value){this.bounds={...value};}
      isDestroyed(){return this.dead;} isVisible(){return this.visible;}
      setAlwaysOnTop(){} setIgnoreMouseEvents(){} setMenu(){}
      show(){this.visible=true;} hide(){this.visible=false;this.emit('hide');}
      loadURL(){return Promise.resolve();} destroy(){this.dead=true;this.emit('closed');}
    }
    class Tray extends EventEmitter{
      constructor(){super();if(!shellOptions.rescue)throw Error('fixture unavailable tray');}
      isDestroyed(){return false;} setToolTip(){} setContextMenu(){} destroy(){}
    }
    const app=Object.assign(new EventEmitter(),{quit:()=>calls.push(['native-quit'])});
    const screen=new EventEmitter(),display={id:1,workArea:{x:0,y:0,width:1920,height:1080}};
    screen.getAllDisplays=()=>[display];screen.getPrimaryDisplay=screen.getDisplayMatching=()=>display;
    ipcMain.handle=(name,fn)=>handlers.set(name,fn);ipcMain.removeHandler=name=>handlers.delete(name);
    const session=new EventEmitter();session.webRequest={onBeforeRequest(){}};
    for(const method of ['setPermissionRequestHandler','setPermissionCheckHandler','setDevicePermissionHandler','setDisplayMediaRequestHandler'])session[method]=()=>{};
    const policy=require('../resource-policy.cjs');policy.createOwnedSession({defaultSession:{},fromPartition:()=>session});
    removePolicy=policy.installPolicy({session,root});
    shell=require('../shell.cjs').createShell({root,mode:'visible',session,electron:nativeElectron={BrowserWindow:Window,app,screen,ipcMain,Tray,
      Menu:{buildFromTemplate:()=>Object.assign(new EventEmitter(),{popup(){}})},
      globalShortcut:{register:()=>shellOptions.rescue===true&&shellOptions.shortcut!==false,unregister(){}}},
      stateIO:shellOptions.stateIO||{loadStateResult:()=>({status:'missing',value:null,reason:null}),saveState(){calls.push(['save-attempt']);if(failSaves)throw Error('SECRET local path');}},
      clock:{setTimeout(fn){const id=++timerId;saveTimers.set(id,fn);return id;},clearTimeout:id=>saveTimers.delete(id)}});
  }
  vm.runInNewContext(fs.readFileSync(path.join(root,'desktop-preload.cjs'),'utf8'),{
    process:{isMainFrame:true},require:name=>{assert.equal(name,'electron');return {ipcRenderer:ipc,
      contextBridge:{exposeInMainWorld(name,value){assert.equal(name,'pet');window.pet=value;}}};},
  },{filename:'desktop-preload.cjs'});
  const renderer={render(){renderCalls++;if(renderCalls===failRenderAt)throw Error('fixture render failure');},
    status:()=>({webgl2:true}),headInputPoint:()=>({x:225,y:116}),hitOpaque:()=>true,hitTest:()=>true};
  const context=vm.createContext({window,document,console:{error:value=>calls.push(['error',value])},
    MotionDirector:require('../src/director.js'),PreviewView:require('../src/view.js'),CharacterBinding:require('../src/character.js'),
    CharacterRenderer:{create:async()=>{if(failCreate)throw Error('fixture texture failure');return renderer;}},
    requestAnimationFrame(fn){const id=++rafId;raf.set(id,fn);return id;},cancelAnimationFrame(id){raf.delete(id);},
  });
  vm.runInContext(fs.readFileSync(path.join(root,'src/desktop-runtime.js'),'utf8'),context,{filename:'desktop-runtime.js'});
  const attach=context.DesktopRuntime.attach;
  context.DesktopRuntime.attach=options=>{runtime=attach(options);return runtime;};
  return {window,document,nodes,rect,bar,calls,raf,ipc,act,emit,shell,saveTimers,nativeElectron,
    failSaves:value=>{failSaves=value;},
    resolveGetState:()=>resolveGetState(),
    flushStateNotifications(){for(const args of stateNotifications.splice(0))ipc.emit('desktop:state',{},...args);},
    flushSaves(){const pending=[...saveTimers.values()];saveTimers.clear();for(const fn of pending)fn();},
    runtime:()=>runtime,renderCalls:()=>renderCalls,
    failNextFrame(){failRenderAt=renderCalls+1;},
    tick(){const pending=[...raf.values()];raf.clear();for(const fn of pending)fn(16);},
    run:()=>vm.runInContext(fs.readFileSync(path.join(root,'src/desktop-bootstrap.js'),'utf8'),context,{filename:'desktop-bootstrap.js'}),
    cleanup(){runtime?.destroy();shell?.destroy();removePolicy?.();},
  };
}
const plain=value=>JSON.parse(JSON.stringify(value));
const {storage,good,mutationNames}=require('./helpers/storage-harness.cjs');
const loadMessages={
  WINDOW_STATE_INVALID:'窗口设置损坏，已暂停保存；本次调整不会保留。请退出后处理原文件。',
  WINDOW_STATE_UNSUPPORTED:'窗口设置版本不支持，已暂停保存；请使用兼容版本处理原文件。',
  WINDOW_STATE_READ_ERROR:'窗口设置读取失败，已暂停保存；请排除读取问题后重启。',
};
for(const [status,raw,options,code] of [
  ['invalid','broken',{},'WINDOW_STATE_INVALID'],
  ['unsupported-version',JSON.stringify({...good,version:2}),{},'WINDOW_STATE_UNSUPPORTED'],
  ['read-error',JSON.stringify(good),{readError:Object.assign(Error('synthetic private path'),{code:'EACCES'})},'WINDOW_STATE_READ_ERROR'],
])test('T07-R-U01 tracer: real '+status+' load reaches bootstrap before any user operation',async()=>{
  const store=storage(raw,options),h=integrated({shellOptions:{rescue:true,stateIO:store.stateIO}});
  const notice=h.nodes.get('notice');Object.defineProperty(notice,'innerHTML',{set(){assert.fail('textContent only');}});
  try{
    await h.run();await h.shell.ready;await new Promise(resolve=>setImmediate(resolve));
    assert.equal(h.shell.snapshot().stateNoticeCode,code);
    assert.equal(notice.textContent,loadMessages[code]);
    assert.equal(h.document.body.dataset.warning,'true');assert.equal(h.document.body.dataset.failed,undefined);
    assert.equal(h.runtime().status().running,true);const frames=h.renderCalls();h.tick();assert.ok(h.renderCalls()>frames);
    assert.equal(h.saveTimers.size,0);assert.equal(h.calls.filter(c=>c[0]==='error').length,0);
    assert.equal(h.nodes.get('hide').listeners.get('click').size,1,'no fatal fallback');
    assert.equal(store.bytes(),raw);for(const key of mutationNames)assert.equal(store.counts[key],0,key);
  }finally{h.cleanup();}
  assert.equal(store.bytes(),raw);assert.equal(store.counts.save,0);
});

for(const [name,raw,options,code,message]of [
  ['menu','broken',{},'WINDOW_STATE_INVALID','菜单暂时不可用，请稍后重试。'],
  ['rescue',JSON.stringify(good),{readError:Error('synthetic I/O')},'WINDOW_STATE_READ_ERROR','无可用救援通道，暂不能隐藏或开启穿透。'],
  ['drag',JSON.stringify({...good,version:2}),{},'WINDOW_STATE_UNSUPPORTED','窗口移动未能稳定，请稍后重试。'],
])test('T07-R-U02 '+name+' recovery preserves load warning and fatal takes priority',async()=>{
  const store=storage(raw,options),h=integrated({shellOptions:{rescue:true,shortcut:false,stateIO:store.stateIO}});
  try{
    await h.run();await h.shell.ready;await new Promise(resolve=>setImmediate(resolve));
    const notice=h.nodes.get('notice');assert.equal(notice.textContent,loadMessages[code]);
    let recover;
    if(name==='menu'){
      const build=h.nativeElectron.Menu.buildFromTemplate;
      h.nativeElectron.Menu.buildFromTemplate=(...args)=>{const m=build(...args);m.popup=()=>{throw Error('synthetic menu canary');};return m;};
      h.shell.menu({x:10,y:10});recover=()=>{h.nativeElectron.Menu.buildFromTemplate=(...args)=>{const m=build(...args);m.popup=o=>o.callback();return m;};h.shell.menu({x:10,y:10});};
    }else if(name==='rescue'){
      h.nativeElectron.Tray.prototype.isDestroyed=()=>true;h.shell.hide();
      recover=()=>{h.nativeElectron.Tray.prototype.isDestroyed=()=>false;h.shell.show();};
    }else{
      const set=h.shell.window.setBounds.bind(h.shell.window);
      h.shell.window.setBounds=b=>set({...b,width:b.width+10});h.shell.drag({dx:1,dy:0});
      recover=()=>{h.shell.window.setBounds=set;h.shell.drag({dx:1,dy:0});};
    }
    assert.equal(notice.textContent,message+' '+loadMessages[code]);
    h.shell.show();assert.equal(notice.textContent,message+' '+loadMessages[code]);
    recover();assert.equal(h.shell.snapshot().lastError,null);assert.equal(notice.textContent,loadMessages[code]);
    h.failNextFrame();h.tick();assert.equal(notice.textContent,'候选未能运行，请用菜单退出。');
    h.ipc.emit('desktop:state',{},h.shell.snapshot());h.ipc.emit('desktop:state',{}, {lastError:null,stateNoticeCode:null});
    assert.equal(notice.textContent,'候选未能运行，请用菜单退出。');assert.equal(h.document.body.dataset.failed,'true');
    assert.equal(h.saveTimers.size,0);assert.equal(store.bytes(),raw);assert.equal(store.counts.save,0);
  }finally{h.cleanup();}
});

for(const [status,raw,options,code]of [
  ['valid',JSON.stringify(good),{},null],['missing',undefined,{missing:true},null],
  ['invalid','broken',{},'WINDOW_STATE_INVALID'],
  ['unsupported-version',JSON.stringify({...good,version:2}),{},'WINDOW_STATE_UNSUPPORTED'],
  ['read-error',JSON.stringify(good),{readError:Error('synthetic canary')},'WINDOW_STATE_READ_ERROR'],
])for(const order of ['get-first','event-first'])test('T07-R-U01 delivery order '+order+' / '+status,async()=>{
  const store=storage(raw,options),h=integrated({shellOptions:{rescue:true,stateIO:store.stateIO,deferGetState:order==='event-first',deferStateNotifications:order==='get-first'}});
  const notice=h.nodes.get('notice');Object.defineProperty(notice,'innerHTML',{set(){assert.fail('textContent only');}});
  try{
    await h.run();await h.shell.ready;await new Promise(resolve=>setImmediate(resolve));
    const expected=code?loadMessages[code]:'独立候选 · Ctrl+滚轮缩放';
    assert.equal(notice.textContent,expected,'first source without next user operation');
    if(order==='get-first')h.flushStateNotifications();else{h.shell.show();h.resolveGetState();}
    await new Promise(resolve=>setImmediate(resolve));assert.equal(notice.textContent,expected);
    assert.equal(h.document.body.dataset.warning,String(!!code));assert.equal(h.document.body.dataset.failed,undefined);
    assert.equal(h.runtime().status().shell.stateLoadStatus,status);assert.equal(h.runtime().status().running,true);
    const frames=h.renderCalls();h.tick();assert.ok(h.renderCalls()>frames);assert.equal(h.calls.filter(c=>c[0]==='error').length,0);
    if(code){assert.equal(h.saveTimers.size,0);assert.equal(store.bytes(),raw);assert.equal(store.counts.save,0);}
  }finally{h.cleanup();}
});
for(const [name,code]of [
  ['unknown','unknown-private-path-canary'],['prototype','constructor'],['markup','<img src=canary>'],
  ['object',{toString(){assert.fail('must not stringify object code');}}],
])test('T07-R-U03 untrusted '+name+' storage code stays fixed text without logging',async()=>{
  const h=integrated(),notice=h.nodes.get('notice');Object.defineProperty(notice,'innerHTML',{set(){assert.fail('textContent only');}});
  try{
    await h.run();await new Promise(resolve=>setImmediate(resolve));
    h.ipc.emit('desktop:state',{}, {stateNoticeCode:code,lastError:null});
    assert.equal(notice.textContent,'窗口设置状态异常，已暂停保存；请退出后检查。');assert.equal(h.document.body.dataset.warning,'true');
    for(const lastError of ['unknown-private-path-canary','constructor','<b>canary</b>',{toString(){assert.fail('must not stringify operation code');}}]){
      h.ipc.emit('desktop:state',{}, {stateNoticeCode:'WINDOW_STATE_INVALID',lastError});
      const expected='操作未能完成，请稍后重试。 '+loadMessages.WINDOW_STATE_INVALID;
      assert.equal(notice.textContent,expected);h.ipc.emit('desktop:state',{}, {stateNoticeCode:'WINDOW_STATE_INVALID',lastError});assert.equal(notice.textContent,expected,'no duplicate accumulation');
    }
    assert.equal(h.calls.filter(c=>c[0]==='error').length,0);assert.equal(h.window.__desktopFailure,undefined);assert.equal(h.document.body.dataset.failed,undefined);
    const frames=h.renderCalls();h.tick();assert.ok(h.renderCalls()>frames);
  }finally{h.cleanup();}
});
test('T07-R-B01 window preload stays narrow and offers no storage recovery authority',async()=>{
  const store=storage('broken'),h=integrated({shellOptions:{rescue:true,stateIO:store.stateIO}});
  try{
    await h.run();assert.deepEqual(Object.keys(h.window.pet).sort(),['drag','resizeBy','setInteractive','menu','ready','command','getState','onAction','onState'].sort());
    const before=h.calls.length;h.window.pet.command('forceSave');h.window.pet.command('reload');h.window.pet.command('reset-store');
    assert.equal(h.calls.length,before);assert.equal(h.shell.save(),false);assert.equal(store.counts.save,0);assert.equal(store.bytes(),'broken');
  }finally{h.cleanup();}
});

test('real shell no-rescue rejections reach bootstrap as a nonfatal fixed Chinese notice',async()=>{
  const h=integrated({shellOptions:{rescue:false}});
  try{
    await h.run();await h.shell.ready;
    const notice=h.nodes.get('notice');
    Object.defineProperty(notice,'innerHTML',{set(){assert.fail('Notice must use textContent, never HTML');}});
    for(const reject of [()=>h.emit(h.nodes.get('hide'),'click'),()=>h.window.pet.command('click-through',true)]){
      reject();
      assert.equal(h.shell.snapshot().lastError,'No rescue channel available');
      assert.equal(h.runtime().status().shell.lastError,'No rescue channel available');
      assert.equal(notice.textContent,'无可用救援通道，暂不能隐藏或开启穿透。');
      assert.equal(h.document.body.dataset.warning,'true');
      assert.equal(h.document.body.dataset.failed,undefined);
      assert.equal(h.window.__desktop.status().ready,true);
      assert.equal(h.runtime().status().running,true);assert.equal(h.raf.size,1);
      assert.equal(h.shell.snapshot().visible,true);assert.equal(h.shell.snapshot().clickThrough,false);
    }
    const frames=h.renderCalls();h.tick();assert.ok(h.renderCalls()>frames);
    assert.equal(h.calls.some(c=>c[0]==='error'||c[0]==='native-quit'),false);
    assert.equal(h.nodes.get('hide').listeners.get('click').size,1,'Nonfatal notice must not install quit fallback');
  }finally{h.cleanup();}
});

test('debounced real shell save failure reaches the notice without a notification retry loop',async()=>{
  const h=integrated({shellOptions:{rescue:true,saveFails:true}});
  try{
    await h.run();await new Promise(resolve=>setImmediate(resolve));
    assert.ok(h.saveTimers.size>0);
    h.flushSaves();
    assert.equal(h.shell.snapshot().lastError,'Window state save failed');
    assert.equal(h.runtime().status().shell.lastError,'Window state save failed','Timer failure must publish without another user action');
    assert.equal(h.nodes.get('notice').textContent,'窗口设置保存失败，本次操作仍然有效。');
    assert.equal(h.saveTimers.size,0,'Error notification must not schedule another save');
    const writes=h.calls.filter(c=>c[0]==='save-attempt').length;
    h.flushSaves();h.flushSaves();h.tick();
    assert.equal(h.calls.filter(c=>c[0]==='save-attempt').length,writes);
    assert.equal(h.runtime().status().running,true);assert.equal(h.raf.size,1);
    h.failSaves(false);h.window.pet.command('topmost',false);
    assert.equal(h.nodes.get('notice').textContent,'窗口设置保存失败，本次操作仍然有效。','Only successful persistence clears its failure');
    h.flushSaves();assert.equal(h.shell.snapshot().lastError,null);
    assert.match(h.nodes.get('notice').textContent,/Ctrl\+滚轮/);
    assert.equal(h.document.body.dataset.warning,'false');assert.equal(h.saveTimers.size,0);
    assert.equal(h.calls.some(c=>c[0]==='error'),false,'No raw persistence error enters new UI/logs');
  }finally{h.cleanup();}
});

test('bootstrap maps only fixed error codes with textContent and fatal fallback always wins',async()=>{
  const h=integrated({failRenderAt:2});
  try{
    h.ipc.invoke=()=>Promise.resolve({mode:'visible',visible:true,lastError:'Window state save failed'});
    const notice=h.nodes.get('notice');
    Object.defineProperty(notice,'innerHTML',{set(){assert.fail('No HTML sink for shell errors');}});
    await h.run();await new Promise(resolve=>setImmediate(resolve));
    assert.equal(h.runtime().status().shell.lastError,'Window state save failed','Wait for cross-realm getState promise delivery');
    assert.equal(notice.textContent,'窗口设置保存失败，本次操作仍然有效。','Initial getState error must not be overwritten by startup hint');
    const cases=[
      ['No rescue channel available','无可用救援通道，暂不能隐藏或开启穿透。'],
      ['Window state save failed','窗口设置保存失败，本次操作仍然有效。'],
      ['Native menu unavailable','菜单暂时不可用，请稍后重试。'],
      ['Native drag dimensions did not settle','窗口移动未能稳定，请稍后重试。'],
      ['<img src=x onerror=SECRET>','操作未能完成，请稍后重试。'],
      ['constructor','操作未能完成，请稍后重试。'],
      [{toString(){throw Error('Must not stringify unknown error');}},'操作未能完成，请稍后重试。'],
    ];
    for(const [lastError,message] of cases){
      h.ipc.emit('desktop:state',{}, {lastError});
      assert.equal(notice.textContent,message);assert.equal(h.document.body.dataset.warning,'true');
      assert.equal(h.raf.size,1);assert.equal(h.runtime().status().running,true);
    }
    h.ipc.emit('desktop:state',{}, {lastError:null});
    assert.match(notice.textContent,/Ctrl\+滚轮/);assert.equal(h.document.body.dataset.warning,'false');
    h.ipc.emit('desktop:state',{}, {lastError:'No rescue channel available'});
    h.tick();assert.match(notice.textContent,/未能运行/);assert.equal(h.document.body.dataset.failed,'true');
    assert.equal(h.raf.size,0);assert.equal(h.runtime().status().destroyed,true);
    h.ipc.emit('desktop:state',{}, {lastError:null});h.act('shell:show');
    assert.match(notice.textContent,/未能运行/);assert.equal(h.raf.size,0);
    h.emit(h.nodes.get('hide'),'click');assert.deepEqual(plain(h.calls.at(-1)),['desktop:command',{name:'quit'}]);
  }finally{h.cleanup();}
});

test('small-window CSS keeps active warnings and fatal notices visible',()=>{
  const css=fs.readFileSync(path.join(root,'desktop.css'),'utf8');
  assert.match(css,/body:not\(\[data-failed="true"\]\):not\(\[data-warning="true"\]\) #notice\{display:none\}/);
  assert.match(css,/body\[data-warning="true"\]:not\(\[data-failed="true"\]\) #notice/);
  assert.match(fs.readFileSync(path.join(root,'desktop.html'),'utf8'),/id="notice" role="status" aria-live="polite"/);
});

test('first-frame failure caught inside the real runtime leaves bootstrap failed and native exit reachable',async()=>{
  const h=integrated({failRenderAt:1});
  try{
    await assert.doesNotReject(h.run());
    const state=h.runtime().status();
    assert.equal(h.renderCalls(),1);assert.equal(state.running,false);assert.equal(state.renderedFrames,0);
    assert.ok(state.cancelReasons.includes('render-error'));assert.match(state.errors[0],/fixture render failure/);
    assert.equal(h.raf.size,0);
    assert.match(h.nodes.get('notice').textContent,/未能运行/,'Success notice must not overwrite the caught render failure');
    assert.match(h.window.__desktopFailure,/fixture render failure/);assert.equal(h.document.body.dataset.failed,'true');
    assert.equal(h.window.__desktop,undefined,'Failed first frame must not publish a ready diagnostic');
    assert.equal(state.destroyed,true);assert.equal(h.ipc.listenerCount('action'),0);assert.equal(h.ipc.listenerCount('desktop:state'),0);
    assert.equal(h.calls.filter(c=>c[0]==='error').length,1);
    assert.deepEqual(h.calls.filter(c=>c[0]==='interactive').at(-1),['interactive',true]);
    h.emit(h.nodes.get('menu'),'click');assert.equal(h.calls.filter(c=>c[0]==='menu').length,1);
    h.emit(h.nodes.get('hide'),'click');assert.deepEqual(plain(h.calls.at(-1)),['desktop:command',{name:'quit'}]);
    h.act('shell:show');h.tick();assert.equal(h.renderCalls(),1);assert.equal(h.raf.size,0);
  }finally{h.cleanup();}
});

test('real runtime startup pause is not a failure and retains normal resume/menu/hide behavior',async()=>{
  for(const pause of ['idle:hold','shell:hide','visibility']){
    const h=integrated({pauseOnReady:pause});
    try{
      await h.run();
      const state=h.runtime().status();
      assert.equal(state.running,false);assert.equal(state.wantedRunning,true);assert.equal(state.destroyed,false);
      assert.equal(h.raf.size,0);assert.equal(state.errors.length,0);assert.equal(h.window.__desktop.status().ready,true);
      assert.equal(h.window.__desktopFailure,undefined);assert.equal(h.document.body.dataset.failed,undefined);
      assert.match(h.nodes.get('notice').textContent,/Ctrl\+滚轮/);
      h.emit(h.nodes.get('hide'),'click');assert.equal(h.calls.filter(c=>c[0]==='desktop:command').length,0,'Pause must not install a quit fallback');
      if(pause==='idle:hold')h.act('idle:release');
      else if(pause==='shell:hide')h.act('shell:show');
      else{h.document.hidden=false;h.emit(h.document,'visibilitychange');}
      assert.equal(h.runtime().status().running,true);assert.equal(h.raf.size,1);
      h.emit(h.nodes.get('menu'),'click');assert.equal(h.calls.filter(c=>c[0]==='menu').length,1);
      h.emit(h.nodes.get('hide'),'click');assert.deepEqual(plain(h.calls.at(-1)),['desktop:command',{name:'hide'}]);
    }finally{h.cleanup();}
  }
});

test('fallback menu uses the normal local coordinates on a negative-coordinate screen through the real preload',async()=>{
  for(const options of [{},{failRenderAt:1},{failCreate:true}]){
    const h=integrated(options);
    try{
      await h.run();
      h.emit(h.nodes.get('menu'),'click',{clientX:225,clientY:116,screenX:-900,screenY:-300});
      assert.deepEqual(plain(h.calls.filter(c=>c[0]==='menu')),[['menu',{x:125,y:16}]],JSON.stringify(options));
    }finally{h.cleanup();}
  }
});

test('fallback menu shares the normal toolbar anchor for clicks without a usable canvas point',async()=>{
  for(const options of [{},{failRenderAt:1},{failCreate:true}]){
    const h=integrated(options);
    try{
      await h.run();
      const anchor={x:h.bar.x+h.bar.width/2-h.rect.x,y:h.bar.y+h.bar.height-h.rect.y};
      for(const point of [{clientX:0,clientY:0},{clientX:NaN,clientY:NaN},{clientX:undefined,clientY:undefined}]){
        h.emit(h.nodes.get('menu'),'click',{...point,screenX:0,screenY:0});
        assert.deepEqual(plain(h.calls.filter(c=>c[0]==='menu').at(-1)),['menu',anchor],JSON.stringify(options));
      }
      assert.equal(h.calls.filter(c=>c[0]==='menu').length,3);
    }finally{h.cleanup();}
  }
});

test('a later real render failure revokes ready and installs only one native exit fallback',async()=>{
  const h=integrated({failRenderAt:2});
  try{
    await h.run();assert.equal(h.window.__desktop.status().ready,true);h.tick();
    assert.equal(h.runtime().status().running,false);assert.equal(h.raf.size,0);
    assert.equal(h.window.__desktop.status().ready,false);
    assert.equal(h.runtime().status().destroyed,true);assert.match(h.nodes.get('notice').textContent,/未能运行/);
    h.emit(h.window,'error',{error:Error('second reported failure')});
    assert.equal(h.window.__desktop.status().ready,false);
    h.emit(h.nodes.get('menu'),'click');assert.equal(h.calls.filter(c=>c[0]==='menu').length,1);
    h.emit(h.nodes.get('hide'),'click');assert.deepEqual(plain(h.calls.filter(c=>c[0]==='desktop:command')),[['desktop:command',{name:'quit'}]]);
  }finally{h.cleanup();}
});
