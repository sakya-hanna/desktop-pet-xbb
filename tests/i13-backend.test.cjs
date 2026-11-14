'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events'),path=require('node:path'),fs=require('node:fs');
const root=path.resolve(__dirname,'..'),ENTRY='baijie28://app/desktop.html';
const {safe}=require('./i13-settings-store.test.cjs');
let serial=0;
function harness({request,mode='hidden',deferred=false}={}){
 const windows=[],handles=new Map();
 class Window extends EventEmitter{
  constructor(options){super();this.options=options;this.dead=false;this.visible=false;this.bounds={x:0,y:0,width:240,height:348,...options};this.messages=[];this.calls=[];this.webContents=new EventEmitter();Object.assign(this.webContents,{mainFrame:{url:ENTRY},isDestroyed:()=>this.dead,send:(...args)=>this.messages.push(args),setFrameRate(){},setWindowOpenHandler:fn=>this.openHandler=fn});windows.push(this);}
  isDestroyed(){return this.dead;}isVisible(){return this.visible;}getBounds(){return {...this.bounds};}setBounds(v){Object.assign(this.bounds,v);}setIgnoreMouseEvents(){}setAlwaysOnTop(){}isAlwaysOnTop(){return true;}setMenu(){}
  show(){this.calls.push('show');this.visible=true;}focus(){this.calls.push('focus');}showInactive(){this.calls.push('showInactive');this.visible=true;}hide(){this.visible=false;this.emit('hide');}
  loadURL(url){this.url=url;this.webContents.mainFrame.url=url;if(deferred&&url!==ENTRY)return new Promise((ok,no)=>{this.finish=()=>{this.webContents.emit('did-finish-load');ok();};this.fail=no;});this.webContents.emit('did-finish-load');return Promise.resolve();}
  destroy(){if(this.dead)return;this.emit('close');this.dead=true;this.emit('closed');}
 }
 const ipcMain=new EventEmitter();ipcMain.handle=(n,fn)=>{assert.ok(!handles.has(n));handles.set(n,fn);};ipcMain.removeHandler=n=>handles.delete(n);
 const screen=new EventEmitter();screen.getPrimaryDisplay=()=>({workArea:{x:0,y:0,width:1920,height:1080}});screen.getAllDisplays=()=>[screen.getPrimaryDisplay()];screen.getDisplayMatching=screen.getPrimaryDisplay;
 class Tray extends EventEmitter{setToolTip(){}setContextMenu(m){this.menu=m;}isDestroyed(){return !!this.dead;}destroy(){this.dead=true;}}
 const app=new EventEmitter();app.quit=()=>{};
 const electron={BrowserWindow:Window,ipcMain,screen,app,Tray,safeStorage:safe,Menu:{buildFromTemplate:t=>Object.assign(new EventEmitter(),{template:t,popup(){}})},globalShortcut:{register:()=>true,unregister(){}}};
 const privateSession=new EventEmitter();privateSession.webRequest={onBeforeRequest(){}};for(const k of ['setPermissionRequestHandler','setPermissionCheckHandler','setDevicePermissionHandler','setDisplayMediaRequestHandler'])privateSession[k]=()=>{};
 const policy=require('../resource-policy.cjs'),session=policy.createOwnedSession({defaultSession:{},fromPartition:()=>privateSession}),remove=policy.installPolicy({session,root});
 const appDataRoot=path.join(process.env.TMPDIR,'app-'+(++serial)),profileRoot=path.join(appDataRoot,mode==='hidden'?'BaijieDesktopV1-Tests/test':'BaijieDesktopV1');
 const shell=require('../shell.cjs').createShell({electron,session,root,mode,storageLayout:'product',appDataRoot,profileRoot,chatOptions:request?{request}:undefined,stateIO:{loadStateResult:()=>({status:'missing',value:null,reason:null}),saveState(){}}});
 function get(page){return windows.find(w=>w.url==='baijie28://app/'+page+'.html'&&!w.dead);}
 function event(w){return {sender:w.webContents,senderFrame:w.webContents.mainFrame};}
 const invoke=(page,action,...args)=>handles.get(page+':'+action)(event(get(page)),...args);
 return {shell,electron,session,windows,handles,profileRoot,get,event,invoke,dispose(){shell.destroy();remove();}};
}
const settle=async()=>{for(let i=0;i<5;i++)await Promise.resolve();};
module.exports={harness,settle};
if(require.main===module){
 test('I13 shell lazy menus + owned protocol hidden windows strict IPC and teardown',async()=>{
  const h=harness({deferred:true});try{await h.shell.ready;assert.equal(h.windows.length,1);assert.equal(h.shell.command({name:'chat-cancel'}),true);assert.equal(h.windows.length,1);
   for(const name of ['chat','settings','blink','face-next'])assert.ok(h.shell.menuTemplate().some(x=>x.id===name));
   for(const page of ['chat','settings']){assert.equal(h.shell.command({name:page}),true);const w=h.get(page);assert.ok(w);assert.equal(w.options.webPreferences.session,h.session);assert.equal(w.options.show,false);w.finish();await settle();h.shell.command({name:page});assert.deepEqual(w.calls,[]);assert.equal(w.openHandler().action,'deny');let prevented=0;for(const n of ['will-navigate','will-frame-navigate','will-redirect','will-attach-webview'])w.webContents.emit(n,{preventDefault(){prevented++;}});assert.equal(prevented,4);
    const fn=h.handles.get(page+':read');assert.throws(()=>fn(h.event(w),'extra'));assert.throws(()=>fn({sender:w.webContents,senderFrame:{url:w.url}}));w.webContents.mainFrame.url+='?bad';assert.throws(()=>fn(h.event(w)));w.webContents.mainFrame.url=w.url;assert.ok(fn(h.event(w)));
   }
   const p=require('../resource-policy.cjs');for(const f of ['chat.html','chat.js','chat.css','settings.html','settings.js','settings.css','assets/chat/baijie-avatar.png'])assert.ok(p.resolveResource('baijie28://app/'+f,path.resolve(__dirname,'..')),f);
   for(const f of ['settings-store.js','persona.md','chat-preload.js','model-settings.json'])assert.equal(p.resolveResource('baijie28://app/'+f,root),null);
   assert.equal((await h.invoke('chat','send','本地')).outcome,'saved');const stored=JSON.parse(fs.readFileSync(path.join(h.profileRoot,'conversation.json'),'utf8'));assert.equal(stored.messages[0].text,'本地');
  }finally{h.dispose();}assert.equal(h.handles.size,0);assert.ok(h.windows.every(w=>w.dead));
 });
 test('I13 successful replies publish only on visible character; cancellation settings and close retire requests',async()=>{
  let resolve,signal,calls=0;const h=harness({mode:'visible',request:r=>{calls++;signal=r.signal;return new Promise(ok=>resolve=ok);}});
  try{await h.shell.ready;h.shell.command({name:'chat'});h.shell.command({name:'settings'});await settle();assert.equal(calls,0);
   const config={baseUrl:'https://local-test.invalid/v1',model:'LOCAL',apiKey:'fixture-only'};assert.equal((await h.invoke('settings','save',config)).ok,true);assert.ok(!JSON.stringify(h.invoke('settings','read')).includes('fixture-only'));
   let pending=h.invoke('chat','send','回复');resolve({reply:'姐姐在呢',face:3901,action:'blink'});assert.equal((await pending).outcome,'success');let frames=h.shell.window.messages.filter(x=>x[0]==='chat:presentation').map(x=>x[1]);assert.deepEqual(frames.at(-1),{id:frames.at(-1).id,reply:'姐姐在呢',face:3901,action:'blink'});assert.ok(!h.shell.window.messages.some(x=>x[0]==='action'&&x[1]==='face:3901'));
   for(const stop of [()=>h.shell.command({name:'chat-cancel'}),()=>h.shell.command({name:'blink'}),()=>h.shell.command({name:'face-next'}),()=>h.invoke('settings','save',config),()=>h.get('chat').destroy()]){if(!h.get('chat')){h.shell.command({name:'chat'});await settle();}pending=h.invoke('chat','send','取消');await stop();assert.equal(signal.aborted,true);resolve({reply:'不得出现',face:3901,action:'hop'});assert.equal((await pending).outcome,'cancelled');frames=h.shell.window.messages.filter(x=>x[0]==='chat:presentation').map(x=>x[1]);assert.equal(frames.at(-1).clear,true);}
   assert.ok(frames.every((x,i)=>Number.isSafeInteger(x.id)&&x.id>0&&(!i||x.id>frames[i-1].id)));
   h.shell.command({name:'chat'});await settle();pending=h.invoke('chat','send','隐藏');h.shell.hide();resolve({reply:'隐藏期间不得展示',face:null,action:'none'});assert.equal((await pending).outcome,'cancelled');
   h.shell.show();pending=h.invoke('chat','send','销毁');h.dispose();assert.equal(signal.aborted,true);resolve({reply:'退出后不得展示',face:null,action:'none'});assert.equal((await pending).outcome,'cancelled');assert.equal(h.handles.size,0);
  }finally{h.dispose();}
 });
}
