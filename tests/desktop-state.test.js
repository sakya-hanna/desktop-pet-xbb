const test = require('node:test');
const assert = require('node:assert/strict');
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
    setBounds(bounds) { this.bounds = bounds; this.emit('move'); }
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
    ...require('../puppet/window-state'),
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
    __dirname: path.resolve(__dirname, '../puppet'), console,
    process: { env, stdout: new EventEmitter(), stderr: new EventEmitter() }, URLSearchParams,
    setTimeout: fn => { const key = Symbol(); timers.set(key, fn); return key; },
    clearTimeout: key => timers.delete(key), setInterval, clearInterval,
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../puppet/main.js'), 'utf8'), context);
  await Promise.resolve(); await Promise.resolve();
  return { app, win: windows[0], speechCalls, writes, ipcMain, menus, popups, trays, screen, flush: () => { for (const fn of timers.values()) fn(); timers.clear(); } };
}

test('main renderer keeps security enabled and rejects foreign or subframe actions', async () => {
  const run=await boot(), before=run.win.getBounds();
  assert.equal(run.win.options.webPreferences.webSecurity,true);
  assert.equal(run.win.options.webPreferences.sandbox,true);
  let prevented=false;run.win.webContents.emit('will-navigate',{preventDefault(){prevented=true;}});assert.equal(prevented,true);
  for(const e of [{},{sender:{}},{sender:run.win.webContents,senderFrame:{}}]){run.ipcMain.emit('drag',e,{dx:99,dy:99});run.ipcMain.emit('menu',e,null);}
  assert.deepEqual(run.win.getBounds(),before);assert.equal(run.menus.length,0);
});

test('restores desktop position, preset and topmost from project-scoped settings', async () => {
  const saved = { bounds: { x: 500, y: 150, width: 300, height: 435 }, size: 'large', alwaysOnTop: false };
  const run = await boot(saved);
  assert.deepEqual(run.win.bounds, saved.bounds);
  assert.equal(run.win.top, false);
});

test('coalesces drag writes and flushes latest state on quit', async () => {
  const run = await boot();
  run.ipcMain.emit('drag', {sender:run.win.webContents,senderFrame:run.win.webContents.mainFrame}, { dx: 10, dy: 20 });
  run.ipcMain.emit('drag', {sender:run.win.webContents,senderFrame:run.win.webContents.mainFrame}, { dx: 15, dy: 5 });
  assert.equal(run.writes.length, 0);
  run.flush();
  assert.equal(run.writes.length, 1);
  assert.equal(run.writes[0].state.bounds.x, 845);
  assert.match(run.writes[0].file, /baijie-desktop/);
  assert.equal('clickThrough' in run.writes[0].state, false);
  run.ipcMain.emit('drag', {sender:run.win.webContents,senderFrame:run.win.webContents.mainFrame}, { dx: 2, dy: 0 });
  run.app.emit('before-quit');
  assert.equal(run.writes.at(-1).state.bounds.x, 847);
});


test('menu changes save topmost and recover lost desktop position', async () => {
  const run = await boot();
  run.ipcMain.emit('menu', {sender:run.win.webContents,senderFrame:run.win.webContents.mainFrame}, null);
  const menu = run.menus.at(-1);
  menu.find(item => item.label === '始终置顶').click({ checked: false });
  run.flush();
  assert.equal(run.writes.at(-1)?.state.alwaysOnTop, false);
  const reset = menu.find(item => item.label === '重置位置与大小');
  assert.ok(reset, 'recovery must be reachable through menu and tray');
  reset.click();
  assert.equal(run.win.bounds.x, 820);
  assert.equal(run.win.bounds.width, 240);
});

test('diagnostic launches never read or save desktop preferences', async () => {
  const run = await boot({ bounds: { x: 5, y: 5, width: 300, height: 435 }, size: 'large', alwaysOnTop: false }, { PUPPET_STATELESS: '1' });
  assert.equal(run.win.bounds.width, 240);
  run.ipcMain.emit('drag', {sender:run.win.webContents,senderFrame:run.win.webContents.mainFrame}, { dx: 1, dy: 1 });
  run.app.emit('before-quit'); run.flush();
  assert.equal(run.writes.length, 0);
});

test('invalid drag payload cannot corrupt bounds or crash main process', async () => {
  const run = await boot(); const before = run.win.getBounds();
  for (const value of [null, {}, { dx: NaN, dy: 0 }, { dx: Infinity, dy: 0 }, { dx: '12', dy: 0 }]) {
    run.ipcMain.emit('drag', {sender:run.win.webContents,senderFrame:run.win.webContents.mainFrame}, value);
    assert.deepEqual(run.win.getBounds(), before);
  }
});

test('display changes refit the window without changing fixed drag dimensions', async () => {
  const run = await boot();
  let calls = 0; const original = run.win.setBounds.bind(run.win);
  run.win.setBounds = b => { calls++; original(b); };
  run.win.bounds.x = -5000; run.win.bounds.y = -5000;
  run.screen.emit('display-removed', {}, {});
  assert.equal(calls, 1);
  assert.equal(run.win.bounds.x, 100);
  assert.equal(run.win.bounds.y, 40);
  run.screen.emit('display-metrics-changed', {}, {}, ['workArea']);
  assert.equal(calls, 2);
});

test('size menu updates the fixed drag dimensions before subsequent movement', async () => {
  const run = await boot();
  run.ipcMain.emit('menu', {sender:run.win.webContents,senderFrame:run.win.webContents.mainFrame}, null);
  run.menus.at(-1).find(item => item.label === '大小').submenu[2].click();
  run.ipcMain.emit('drag', {sender:run.win.webContents,senderFrame:run.win.webContents.mainFrame}, { dx: 1, dy: 1 });
  assert.equal(run.win.bounds.width, 300);
  assert.equal(run.win.bounds.height, 435);
  run.flush();
  assert.equal(run.writes.at(-1).state.size, 'large');
});

test('idle toggle is restored, sent after renderer readiness and persisted',async()=>{
 const run=await boot({bounds:{x:500,y:150,width:240,height:348},size:'medium',alwaysOnTop:true,idleEnabled:false});
 const messages=[];run.win.webContents.send=(...args)=>messages.push(args);
 run.ipcMain.emit('idle-ready',{sender:run.win.webContents,senderFrame:run.win.webContents.mainFrame});
 assert.ok(messages.some(m=>m[1]==='idle:off'));
 run.ipcMain.emit('menu',{sender:run.win.webContents,senderFrame:run.win.webContents.mainFrame},null);
 const toggle=run.menus.at(-1).find(i=>i.label==='自动待机动作');assert.equal(toggle.checked,false);
 toggle.click({checked:true});run.flush();assert.equal(run.writes.at(-1).state.idleEnabled,true);
 assert.ok(messages.some(m=>m[1]==='idle:on'));
});

test('native menu closure releases idle and tray rebuild reflects latest toggle',async()=>{
 const run=await boot(),messages=[];run.win.webContents.send=(...args)=>messages.push(args);
 run.ipcMain.emit('menu',{sender:run.win.webContents,senderFrame:run.win.webContents.mainFrame},null);assert.equal(messages.at(-1)[1],'idle:hold');
 run.popups.at(-1).callback();assert.equal(messages.at(-1)[1],'idle:release');
 run.menus.at(-1).find(i=>i.label==='自动待机动作').click({checked:false});
 run.trays[0].emit('right-click');assert.equal(run.menus.at(-1).find(i=>i.label==='自动待机动作').checked,false);
 run.popups.at(-1).callback();assert.equal(messages.at(-1)[1],'idle:release');
});

test('automatic blank-area pass-through cannot override explicit full pass-through or native menu safety',async()=>{
 const run=await boot();const sender=run.win.webContents;
 run.ipcMain.emit('interactive',{sender,senderFrame:sender.mainFrame},false);assert.equal(run.win.ignoring,true);assert.equal(run.win.forward,true);
 run.ipcMain.emit('interactive',{sender,senderFrame:sender.mainFrame},true);assert.equal(run.win.ignoring,false);
 run.ipcMain.emit('menu',{sender:run.win.webContents,senderFrame:run.win.webContents.mainFrame},null);
 run.menus.at(-1).find(i=>i.label?.startsWith('鼠标穿透')).click({checked:true});
 run.ipcMain.emit('interactive',{sender,senderFrame:sender.mainFrame},true);assert.equal(run.win.ignoring,true);
 run.menus.at(-1).find(i=>i.label?.startsWith('鼠标穿透')).click({checked:false});
 run.ipcMain.emit('interactive',{sender,senderFrame:sender.mainFrame},false);assert.equal(run.win.ignoring,false,'menu stays interactive');
 run.popups.at(-1).callback();assert.equal(run.win.ignoring,true);
 run.ipcMain.emit('interactive',{sender:{}},true);assert.equal(run.win.ignoring,true,'foreign sender ignored');
});

test('continuous resize is bounded, persists custom dimensions and keeps new drag dimensions',async()=>{
 const run=await boot();const sender=run.win.webContents,b=run.win.getBounds();
 run.ipcMain.emit('resize-by',{sender,senderFrame:sender.mainFrame},1.1);assert.ok(run.win.bounds.height>b.height);
 const next=run.win.getBounds();assert.equal(next.x+next.width,b.x+b.width);assert.equal(next.y+next.height,b.y+b.height);
 run.ipcMain.emit('drag',{sender:run.win.webContents,senderFrame:run.win.webContents.mainFrame}, {dx:2,dy:1});assert.equal(run.win.bounds.width,next.width);
 run.flush();assert.equal(run.writes.at(-1).state.size,'custom');
 const last=run.win.getBounds();for(const f of [NaN,Infinity,0,100,'1.1']){run.ipcMain.emit('resize-by',{sender,senderFrame:sender.mainFrame},f);assert.deepEqual(run.win.getBounds(),last);}
 run.ipcMain.emit('resize-by',{sender:{}},1.1);assert.deepEqual(run.win.getBounds(),last);
});

test('dialogue menu and sender-validated speech-state drive companion without resizing pet',async()=>{
 const r=await boot(),sender=r.win.webContents,b=r.win.getBounds();
 r.ipcMain.emit('menu',{sender,senderFrame:sender.mainFrame},null);
 const preview=r.menus.at(-1).find(i=>i.label==='气泡对白预览');assert.ok(preview,'preview must be reachable without touch implementation');
 const messages=[];r.win.webContents.send=(...args)=>messages.push(args);preview.submenu[0].click();
 assert.deepEqual(messages.at(-1),['action','dialogue:preview-head']);
 const s={id:1,text:'中文对白',source:'preview',visible:true,expiresAt:9999};
 r.ipcMain.emit('speech-state',{sender,senderFrame:sender.mainFrame},s);assert.deepEqual(r.speechCalls.at(-1),['show',s]);
 const count=r.speechCalls.length;
 for(const bad of [null,{}, {...s,text:123},{...s,id:-1},{...s,visible:'yes'}])r.ipcMain.emit('speech-state',{sender,senderFrame:sender.mainFrame},bad);
 r.ipcMain.emit('speech-state',{sender:{}},s);assert.equal(r.speechCalls.length,count);
 r.ipcMain.emit('speech-state',{sender,senderFrame:sender.mainFrame},{id:null,text:'',source:'',visible:false,expiresAt:null});
 assert.deepEqual(r.speechCalls.at(-1),['hide']);
 assert.deepEqual(r.win.getBounds(),b);
 r.win.emit('hide');assert.ok(r.speechCalls.some(c=>c[0]==='hide'));assert.deepEqual(messages.at(-1),['action','dialogue:clear']);
});
