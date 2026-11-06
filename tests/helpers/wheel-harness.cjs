const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { EventEmitter } = require('node:events');

async function boot(saved = null, env = {}) {
  const writes = [], windows = [], menus = [], popups = [], trays = [], timers = new Map();
  const app = new EventEmitter();
  app.whenReady = () => Promise.resolve();
  app.getPath = () => '/isolated-user-data';
  app.quit = () => app.emit('before-quit');
  const primary = { id: 1, workArea: { x: 100, y: 40, width: 1000, height: 800 }, workAreaSize: { width: 1000, height: 800 } };
  const screen = Object.assign(new EventEmitter(), {
    getPrimaryDisplay: () => primary, getAllDisplays: () => [primary],
  });
  class Window extends EventEmitter {
    constructor(options) {
      super(); this.options = options; this.bounds = { x: options.x, y: options.y, width: options.width, height: options.height };
      this.top = options.alwaysOnTop; this.webContents = new EventEmitter(); this.webContents.mainFrame = {};
      this.webContents.send = () => {}; windows.push(this);
    }
    getBounds() { return { ...this.bounds }; }
    setBounds(bounds) { this.bounds = { ...bounds }; this.emit('move'); this.emit('resize'); }
    setAlwaysOnTop(top) { this.top = top; }
    isAlwaysOnTop() { return this.top; }
    setIgnoreMouseEvents(on,options) { this.ignoring=on; this.forward=options?.forward; }
    loadFile() {}
    loadURL() {}
    show() {}
    isDestroyed() { return false; }
  }
  class Tray extends EventEmitter { constructor(){ super(); trays.push(this); } setToolTip() {} setContextMenu(menu) { this.menu = menu; } }
  const ipcMain = new EventEmitter();
  const helper = {
    ...require('../../puppet/window-state'),
    loadState: () => saved,
    saveState: (file, state) => writes.push({ file, state: structuredClone(state) }),
  };
  const electron = { app, BrowserWindow: Window, ipcMain, screen, Tray,
    Menu: { buildFromTemplate: template => { menus.push(template); return { popup(options) { popups.push(options); } }; } },
    dialog: { showMessageBox() {} }, nativeImage: { createFromPath: () => ({ isEmpty: () => false }) },
    globalShortcut: { register() {}, unregisterAll() {} },
  };
  const speechCalls=[];
  const speech={show:s=>speechCalls.push(['show',structuredClone(s)]),hide:()=>speechCalls.push(['hide']),sync:()=>speechCalls.push(['sync']),destroy:()=>speechCalls.push(['destroy']),setClickThrough:b=>speechCalls.push(['through',b])};
  const context = {
    require: name => name === 'electron' ? electron : name === './window-state' ? helper : name.endsWith('speech-window.js') ? {create:()=>speech} : name === 'fs' ? { appendFileSync() {} } : require(name),
    __dirname: path.resolve(__dirname, '../../puppet'), console,
    process: { env, stdout: new EventEmitter(), stderr: new EventEmitter() }, URLSearchParams,
    setTimeout: fn => { const key = Symbol(); timers.set(key, fn); return key; },
    clearTimeout: key => timers.delete(key), setInterval, clearInterval,
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../puppet/main.js'), 'utf8'), context);
  await Promise.resolve(); await Promise.resolve();
  return { app, win: windows[0], speechCalls, writes, ipcMain, menus, popups, trays, screen, flush: () => { for (const fn of timers.values()) fn(); timers.clear(); } };
}


async function bootWheel() {
  const run = await boot({bounds:{x:400,y:250,width:240,height:348},size:'medium',alwaysOnTop:true});
  const sender = run.win.webContents;
  const event = {sender,senderFrame:sender.mainFrame};
  const messages = [], events = {}, options = {}, nodes = {};
  let pet, activity = 0;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../../puppet/preload.js'),'utf8'), {
    require(name) {
      if(name!=='electron') throw new Error('Unexpected preload require: '+name);
      return {contextBridge:{exposeInMainWorld(name,api){pet=api;}},ipcRenderer:{
        send(channel,...args){messages.push([channel,...args]);run.ipcMain.emit(channel,event,...args);},on(){},
      }};
    },
  });
  function element(){return {children:[],dataset:{},setAttribute(){},appendChild(n){this.children.push(n);if(n.id)nodes[n.id]=n;},contains(n){return n===this||this.children.includes(n);}};}
  let under = null;
  const document={createElement:element,body:element(),elementFromPoint:()=>under};
  const host={get innerWidth(){return run.win.bounds.width;},get innerHeight(){return run.win.bounds.height;},
    addEventListener(k,fn,opt){events[k]=fn;options[k]=opt;}};
  const ui=require('../../puppet/rig/js/desktop-ui').create(host,document,pet,
    (x,y)=>x>=host.innerWidth*.2&&x<=host.innerWidth*.8&&y>=host.innerHeight*.1&&y<=host.innerHeight*.9,()=>activity++);
  function wheel(overrides={}){
    const e={ctrlKey:true,deltaY:-100,deltaMode:0,buttons:0,clientX:host.innerWidth/2,clientY:host.innerHeight/2,
      preventDefault(){this.prevented=true;},...overrides};
    events.wheel(e);return e;
  }
  return {...run,pet,event,ui,wheel,events,options,nodes,messages,host,activity:()=>activity,under:v=>under=v};
}
module.exports={boot,bootWheel};
