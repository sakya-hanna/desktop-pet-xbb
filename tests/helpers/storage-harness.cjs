'use strict';
// System boundaries only. The loader, writer, shell and boot are real source.
// This is an in-memory fault model, not evidence of OS permissions/disk failure.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const {createRequire}=require('node:module'),{EventEmitter}=require('node:events');
const root=path.resolve(__dirname,'../..');
const plain=value=>JSON.parse(JSON.stringify(value));
const good={version:1,bounds:{x:20,y:30,width:240,height:348},size:'medium',alwaysOnTop:true,idleEnabled:true};
const mutationNames=['mkdir','openWrite','write','close','rename','unlink'];
function storage(raw=JSON.stringify(good),options={}){
  const files=new Map(),fds=new Map(),directories=new Set(),calls=[],counts=Object.fromEntries(['read',...mutationNames,'commit','save'].map(n=>[n,0]));
  let target=null,fd=50,readError=options.readError,fault=null,cleanupFails=false,collision=null;
  const error=stage=>Object.assign(Error('synthetic storage '+stage),{code:stage==='openWrite'?'EACCES':'EIO'});
  function hit(stage,...args){counts[stage]++;calls.push([stage,...args]);if(fault===stage)throw error(stage);}
  function bind(file){if(target===null){target=file;if(!options.missing)files.set(file,Buffer.from(raw));if(options.parentExists!==false)directories.add(path.dirname(file));}assert.equal(file,target);}
  const api={
    readFileSync(file){bind(file);hit('read',file);if(readError)throw readError;if(!files.has(file))throw Object.assign(Error('absent fixture'),{code:'ENOENT'});return files.get(file).toString('utf8');},
    mkdirSync(file){hit('mkdir',file);directories.add(file);},
    openSync(file,flags,mode){
      hit('openWrite',file,flags,mode);assert.equal(flags,'wx');assert.equal(mode,0o600);
      if(options.collide){files.set(file,Buffer.from('other owner'));collision=file;}
      if(files.has(file))throw Object.assign(Error('collision'),{code:'EEXIST'});
      files.set(file,Buffer.alloc(0));fds.set(++fd,file);return fd;
    },
    writeFileSync(file,bytes,opts){
      // Legacy writer path remains executable for the pre-fix behavior RED.
      if(typeof file!=='number'){const handle=api.openSync(file,opts.flag,opts.mode);try{api.writeFileSync(handle,bytes);}finally{api.closeSync(handle);}return;}
      const name=fds.get(file);assert.ok(name,'fd must be owned');
      counts.write++;calls.push(['write',name]);files.set(name,Buffer.from(fault==='write'?bytes.slice(0,5):bytes));if(fault==='write')throw error('write');
    },
    closeSync(handle){hit('close',handle);assert.ok(fds.has(handle),'close only owned fd');fds.delete(handle);},
    renameSync(from,to){hit('rename',from,to);assert.equal(to,target);assert.equal(path.dirname(from),path.dirname(to));assert.ok(files.has(from));files.set(to,files.get(from));files.delete(from);counts.commit++;},
    unlinkSync(file){counts.unlink++;calls.push(['unlink',file]);assert.notEqual(file,target,'never unlink target');if(cleanupFails)throw Error('cleanup failure');files.delete(file);},
  };
  const file=path.join(root,'shared/window-state.js'),local=createRequire(file),module={exports:{}};
  vm.runInNewContext(fs.readFileSync(file,'utf8'),{module,exports:module.exports,process:{pid:731},require:n=>n==='node:fs'?api:local(n)},{filename:file});
  const implementation=module.exports;
  const stateIO={...implementation};
  for(const name of ['loadState','loadStateResult'])if(typeof implementation[name]==='function')stateIO[name]=file=>{bind(file);return implementation[name](file,{fsImpl:api});};
  stateIO.saveState=(file,value)=>{bind(file);counts.save++;return implementation.saveState(file,value,{fsImpl:api});};
  return {api,stateIO,implementation,counts,calls,files,fds,directories,bind,
    bytes:()=>files.get(target)?.toString('utf8'),target:()=>target,collision:()=>collision,
    fail:stage=>{fault=stage;},failCleanup:value=>{cleanupFails=value;},readFailure:value=>{readError=value;},
    external:bytes=>{if(bytes===undefined)files.delete(target);else files.set(target,Buffer.from(bytes));},
    resetCounts(){for(const n of Object.keys(counts))counts[n]=0;calls.length=0;},
  };
}
function harness({store=storage(),mode='visible',failure=null,policyFailure=null,stateIO=store.stateIO,displays,allClosedDelivery='sync',rescue=true}={}){
  const calls=[],windows=[],handles=new Map(),timers=new Map(),retired=[],lifecycle=[],pending=[];let now=0,id=0,quitting=false,shell;
  const app=new EventEmitter();
  app.isReady=()=>false;app.setPath=app.setAppLogsPath=()=>{};app.whenReady=()=>Promise.resolve();
  app.quit=()=>{calls.push(['quit']);if(quitting)return;quitting=true;lifecycle.push('before-quit');app.emit('before-quit');for(const w of windows)w.destroy();};
  const allClosed=()=>{const deliver=()=>{if(quitting)return;lifecycle.push('window-all-closed');if(!app.emit('window-all-closed')){lifecycle.push('default-quit');app.quit();}};if(allClosedDelivery==='queued')pending.push(deliver);else if(allClosedDelivery==='microtask')queueMicrotask(deliver);else deliver();};
  const failureError=Error('synthetic '+failure);
  class Window extends EventEmitter{
    constructor(o){super();this.bounds={x:o.x,y:o.y,width:o.width,height:o.height};this.dead=false;this.visible=false;windows.push(this);calls.push(['window',o]);
      this.webContents=Object.assign(new EventEmitter(),{mainFrame:{url:'baijie28://app/desktop.html'},isDestroyed:()=>this.dead,
        send:(...args)=>calls.push(['send',...args]),setFrameRate(){},setWindowOpenHandler(){}});}
    getBounds(){assert.equal(this.dead,false,'no dead bounds read');calls.push(['getBounds']);return {...this.bounds};}
    setBounds(b){this.bounds={...b};this.emit('move');this.emit('resize');}
    isDestroyed(){return this.dead;}isVisible(){assert.equal(this.dead,false);return this.visible;}
    setMenu(){if(failure==='sync-setup')throw failureError;}setAlwaysOnTop(){}setIgnoreMouseEvents(){}
    loadURL(){if(failure==='sync-load')throw failureError;return failure==='load-rejection'?Promise.reject(failureError):Promise.resolve();}
    show(){this.visible=true;}hide(){this.visible=false;this.emit('hide');}
    destroy(){if(this.dead)return;this.dead=true;this.visible=false;this.emit('closed');if(Window.getAllWindows().length===0)allClosed();}
    close(){this.emit('close');this.destroy();}
    static getAllWindows(){return windows.filter(w=>!w.dead);}
  }
  class Tray extends EventEmitter{constructor(){super();if(!rescue)throw Error('synthetic no tray');}isDestroyed(){return !!this.dead;}setToolTip(){}setContextMenu(m){this.menu=m;}destroy(){this.dead=true;calls.push(['tray-destroy']);}}
  const ipcMain=new EventEmitter();ipcMain.handle=(name,fn)=>handles.set(name,fn);ipcMain.removeHandler=name=>handles.delete(name);
  const screen=new EventEmitter();screen.displays=displays||[{id:1,workArea:{x:0,y:0,width:1920,height:1080}}];screen.getAllDisplays=()=>screen.displays;screen.getPrimaryDisplay=screen.getDisplayMatching=()=>screen.displays[0];
  const electron={app,screen,ipcMain,BrowserWindow:Window,Tray,protocol:{registerSchemesAsPrivileged(){}},
    Menu:{buildFromTemplate:()=>Object.assign(new EventEmitter(),{popup(o){calls.push(['popup',o]);}})},
    globalShortcut:{register:()=>rescue,unregister:k=>calls.push(['unregister',k])}};
  const session=new EventEmitter();session.webRequest={onBeforeRequest(){}};session.protocol={handle(){},unhandle(){}};
  for(const n of ['setPermissionRequestHandler','setPermissionCheckHandler','setDevicePermissionHandler','setDisplayMediaRequestHandler'])session[n]=()=>{};
  electron.session={defaultSession:{},fromPartition:()=>session};
  const clock={setTimeout(fn,ms){const key=++id;timers.set(key,{fn,at:now+ms});return key;},clearTimeout(key){if(timers.has(key))retired.push(timers.get(key).fn);timers.delete(key);}};
  const policy=require('../../resource-policy.cjs'),file=path.join(root,'shell.cjs'),local=createRequire(file),module={exports:{}};
  const wrapped={...policy};for(const n of ['validateProfile','assertNoSymlinks','assertSessionPolicy'])wrapped[n]=(...args)=>{calls.push(['preflight',n]);if(policyFailure===n)throw failureError;return policy[n](...args);};
  vm.runInNewContext(fs.readFileSync(file,'utf8'),{module,exports:module.exports,require:n=>n==='./shared/window-state.js'?store.implementation:n==='./resource-policy.cjs'?wrapped:local(n)},{filename:file});
  const createShell=module.exports.createShell;
  let removePolicy;
  const options={electron,session,root,mode,stateIO,clock,...(mode==='hidden'?{profileRoot:path.resolve(root,'../runtime/tests/storage-model')}: {})};
  const h={store,calls,windows,handles,timers,retired,lifecycle,pending,electron,session,clock,failureError,
    start(){policy.createOwnedSession(electron.session);removePolicy=policy.installPolicy({session,root});shell=createShell(options);return shell;},
    async boot(){const r=await require('../../desktop-main.cjs').boot({...options,env:{},fsImpl:{...fs,mkdirSync(){}},createShellImpl:createShell});shell=r.shell;return r;},
    shell:()=>shell,event:()=>({sender:windows.at(-1).webContents,senderFrame:windows.at(-1).webContents.mainFrame}),
    send(name,...args){ipcMain.emit(name,h.event(),...args);},
    advance(ms=201){now+=ms;for(const [key,row]of [...timers])if(row.at<=now){timers.delete(key);row.fn();}},
    async drain(){while(pending.length)pending.shift()();await new Promise(resolve=>setImmediate(resolve));},
    cleanup(){shell?.destroy();removePolicy?.();},
  };return h;
}
function untouched(h,expected,label){assert.equal(h.store.bytes(),expected,label+': original bytes');assert.deepEqual(Object.fromEntries([...mutationNames,'commit','save'].map(n=>[n,h.store.counts[n]])),Object.fromEntries([...mutationNames,'commit','save'].map(n=>[n,0])),label+': zero mutations');}
const loadCases=[
  ...[['truncated','{"version":1,'],['illegal','not-json'],['empty','']].map(([name,raw])=>({id:'W03',name,raw,status:'invalid',reason:'json',code:'WINDOW_STATE_INVALID'})),
  ...[2,0,-1].map(version=>({id:'W04',name:'version '+version,raw:JSON.stringify({...good,version}),status:'unsupported-version',reason:null,code:'WINDOW_STATE_UNSUPPORTED'})),
  ...[
    ['null',null],['array',[]],['empty object',{}],['string version',{...good,version:'1'}],
    ['fractional version',{...good,version:1.5}],['unsafe version',{...good,version:1e30}],
    ['missing bounds',{version:1,size:'medium',alwaysOnTop:true}],
    ['unsafe x',{...good,bounds:{...good.bounds,x:1e30}}],['fractional y',{...good,bounds:{...good.bounds,y:1.5}}],
    ['small width',{...good,bounds:{...good.bounds,width:63}}],['large height',{...good,bounds:{...good.bounds,height:4097}}],
    ['fractional height',{...good,bounds:{...good.bounds,height:100.5}}],['unknown size',{...good,size:'giant'}],
    ['array size',{...good,size:['medium']}],['nonboolean topmost',{...good,alwaysOnTop:1}],['nonboolean idle',{...good,idleEnabled:null}],
  ].map(([name,value])=>({id:'W05',name,raw:JSON.stringify(value),status:'invalid',reason:'schema',code:'WINDOW_STATE_INVALID'})),
  ...['EACCES','EPERM','EIO','ENOTDIR','EISDIR',null].map(code=>({id:'W06',name:code||'no code',raw:JSON.stringify(good),options:{readError:Object.assign(Error('synthetic private-path canary'),code?{code}:{})},status:'read-error',reason:null,code:'WINDOW_STATE_READ_ERROR'})),
];
module.exports={storage,harness,plain,good,mutationNames,untouched,root,loadCases};
