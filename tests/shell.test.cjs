'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const root = path.resolve(__dirname, '..');
const profileRoot = path.resolve(root, '../runtime/tests/shell-mock');
function implementation() {
  assert.ok(fs.existsSync(path.join(root, 'shell.cjs')), 'shell implementation must exist');
  return require('../shell.cjs');
}
function harness({ mode = 'hidden', trayWorks = true, shortcutWorks = true, saved = null, testPolicy, loadFails = false } = {}) {
  const calls = [], handles = new Map(), timers = new Map();
  let nextTimer = 1;
  class Window extends EventEmitter {
    constructor(options) {
      super(); this.options = options; this.bounds = { x: options.x, y: options.y, width: options.width, height: options.height };
      this.visible = options.show; this.dead = false; this.top = options.alwaysOnTop;
      this.webContents = new EventEmitter();
      Object.assign(this.webContents, { mainFrame: { url: 'baijie28://app/desktop.html' },
        isDestroyed: () => this.dead, getURL: () => 'baijie28://app/desktop.html',
        setFrameRate: n => calls.push(['frame-rate', n]),
        send: (...args) => calls.push(['send', ...args]), setWindowOpenHandler: fn => { this.openHandler = fn; },
      });
      calls.push(['window', options]);
    }
    isDestroyed() { return this.dead; }
    isVisible() { if (this.dead) throw new Error('Object has been destroyed'); return this.visible; }
    isFocused() { return false; }
    getBounds() { return { ...this.bounds }; }
    setBounds(value) { this.bounds = { ...value }; calls.push(['bounds', value]); this.emit('move'); this.emit('resize'); }
    setPosition(x,y) { this.bounds = { ...this.bounds,x,y }; calls.push(['position',x,y]);this.emit('move'); }
    setAlwaysOnTop(value, level) { this.top = value; calls.push(['top', value, level]); }
    moveTop() { calls.push(['moveTop']); }
    isAlwaysOnTop() { return this.top; }
    setIgnoreMouseEvents(...args) { calls.push(['ignore', ...args]); }
    show() { calls.push(['show']); this.visible = true; this.emit('show'); }
    showInactive() { calls.push(['showInactive']); this.visible = true; this.emit('show'); }
    focus() { calls.push(['focus']); }
    hide() { calls.push(['hide']); this.visible = false; this.emit('hide'); }
    loadURL(url) { calls.push(['load', url]); return loadFails ? Promise.reject(new Error('load failed')) : Promise.resolve(); }
    setMenu(value) { calls.push(['setMenu', value]); }
    destroy() { if (!this.dead) { this.emit('close'); this.dead = true; this.emit('closed'); } }
  }
  class Tray extends EventEmitter {
    constructor(icon) { super(); calls.push(['tray', icon]); if (!trayWorks) throw new Error('no tray'); }
    setToolTip(value) { calls.push(['tooltip', value]); }
    setContextMenu(value) { this.menu = value; calls.push(['tray-menu', value]); }
    isDestroyed() { return !!this.dead; }
    destroy() { this.dead = true; calls.push(['tray-destroy']); }
  }
  const ipcMain = new EventEmitter();
  ipcMain.handle = (name, handler) => { assert.equal(handles.has(name), false); handles.set(name, handler); };
  ipcMain.removeHandler = name => handles.delete(name);
  const screen = new EventEmitter();
  screen.displays = [{ id: 1, workArea: { x: 0, y: 0, width: 1920, height: 1080 } }];
  screen.getAllDisplays = () => screen.displays;
  screen.getPrimaryDisplay = () => screen.displays[0];
  screen.getDisplayMatching = b => screen.displays.find(d => b.x >= d.workArea.x && b.x < d.workArea.x + d.workArea.width) || screen.displays[0];
  screen.getCursorScreenPoint = () => ({ x: -100, y: -100 });
  const app = new EventEmitter(); app.quit = () => calls.push(['quit']);
  const electron = { BrowserWindow: Window, Tray, screen, app, ipcMain,
    Menu: { buildFromTemplate: template => Object.assign(new EventEmitter(), { template, popup: options => calls.push(['popup', options]) }) },
    globalShortcut: {
      register(key, fn) { calls.push(['register', key]); this.callback = fn; return shortcutWorks; },
      unregister: key => calls.push(['unregister', key]),
      unregisterAll: () => { throw new Error('must never unregister other applications'); },
    },
  };
  const ioCalls = [];
  const stateIO = { loadStateResult(file) { ioCalls.push(['load', file]); return {status:saved === null ? 'missing' : 'valid',value:saved,reason:null}; },
    saveState(file, state) { ioCalls.push(['save', file, structuredClone(state)]); saved = structuredClone(state); } };
  const clock = { setTimeout(fn) { const id = nextTimer++; timers.set(id, fn); return id; }, clearTimeout(id) { timers.delete(id); },
    setInterval(fn) { const id = nextTimer++; timers.set(id, fn); return id; }, clearInterval(id) { timers.delete(id); } };
  const { createShell } = implementation();
  const policy = require('../resource-policy.cjs'), privateSession = new EventEmitter();
  privateSession.webRequest = { onBeforeRequest() {} };
  for (const method of ['setPermissionRequestHandler', 'setPermissionCheckHandler', 'setDevicePermissionHandler', 'setDisplayMediaRequestHandler'])
    privateSession[method] = () => {};
  const session = policy.createOwnedSession({ defaultSession: {}, fromPartition: () => privateSession });
  const removePolicy = policy.installPolicy({ session, root });
  const shell = createShell({ electron, session, root, profileRoot: mode === 'visible' ? path.resolve(root, '../runtime/interactive') : profileRoot,
    mode, stateIO, clock, ...(testPolicy ? { testPolicy } : {}) });
  const destroy = shell.destroy;
  shell.destroy = () => { try { return destroy(); } finally { removePolicy(); } };
  const event = () => ({ sender: shell.window.webContents, senderFrame: shell.window.webContents.mainFrame });
  return { shell, calls, electron, handles, ioCalls, timers, event, stateIO,
    send: (channel, ...args) => ipcMain.emit(channel, event(), ...args),
    flush: () => { const values = [...timers.values()]; timers.clear(); values.forEach(fn => fn()); } };
}

test('system idle samples continue during click-through and stop with the window lifecycle',async()=>{
  const h=harness({mode:'visible'});let seconds=0;
  h.electron.powerMonitor={getSystemIdleTime:()=>seconds};
  const samples=()=>h.calls.filter(c=>c[0]==='send'&&c[1]==='desktop:system-idle').map(c=>c[2]);
  try {
    await h.shell.ready;
    h.shell.setClickThrough(true); h.calls.length=0;
    for(let i=0;i<65;i++)h.flush();
    assert.ok(samples().length>=2,'unchanged zero must be sent again');
    assert.ok(samples().every(s=>s===0));
    assert.equal(h.calls.some(c=>c[1]==='desktop:cursor'),false);
    seconds=90;h.calls.length=0;
    for(let i=0;i<30;i++)h.flush();
    assert.ok(samples().includes(90));
    h.shell.hide();h.calls.length=0;
    for(let i=0;i<35;i++)h.flush();
    assert.equal(samples().length,0);
    h.shell.show();
    for(let i=0;i<30;i++)h.flush();
    assert.ok(samples().includes(90));
  }finally{h.shell.destroy();}
  assert.equal(h.timers.size,0);
});

test('IPC geometry accepts only the current main frame and strict payloads', () => {
  const h = harness();
  try {
    const before = h.shell.snapshot().bounds;
    h.send('drag', { dx: -12, dy: -9 });
    assert.deepEqual(h.shell.snapshot().bounds, { ...before, x: before.x - 12, y: before.y - 9 });
    const changed = h.shell.snapshot().bounds;
    for (const value of [null, [], { dx: NaN, dy: 1 }, { dx: 1, dy: Infinity }, { dx: '3', dy: 1 }, { dx: 1, dy: 2, url: 'x' }, { dx: 1e8, dy: 1 }]) h.send('drag', value);
    for (const event of [{ sender: h.shell.window.webContents, senderFrame: {} }, { sender: {}, senderFrame: h.shell.window.webContents.mainFrame }, {}]) {
      h.electron.ipcMain.emit('drag', event, { dx: 5, dy: 5 });
    }
    assert.deepEqual(h.shell.snapshot().bounds, changed);
    h.send('drag', { dx: -9999, dy: -9999 });
    assert.deepEqual(h.shell.snapshot().bounds, { ...changed, x: 0, y: 0 });
  } finally { h.shell.destroy(); }
});

test('resize IPC accumulates tiny steps and keeps an explicit anchor', () => {
  const h = harness();
  try {
    h.send('drag', { dx: -600, dy: -300 });
    const before = h.shell.snapshot().bounds;
    for (let i = 0; i < 80; i++) h.send('resize-by', { factor: 1.0005, anchor: { x: 0.5, y: 0.5 } });
    const b = h.shell.snapshot().bounds;
    assert.ok(b.width > before.width); assert.ok(b.height > before.height);
    assert.ok(Math.abs(b.x + b.width / 2 - before.x - before.width / 2) <= 0.5);
    assert.ok(Math.abs(b.y + b.height / 2 - before.y - before.height / 2) <= 0.5);
    assert.equal(h.shell.snapshot().size, 'custom');
    for (const value of [NaN, Infinity, 0, 0.49, 2.01, '1.1', null, {}, { factor: 1.1, anchor: { x: 2, y: 0 } }, { factor: 1.1, anchor: { x: 0, y: 0, z: 1 } }, { factor: 1.1, other: true }]) h.send('resize-by', value);
    assert.deepEqual(h.shell.snapshot().bounds, b);
    for (let i = 0; i < 20; i++) h.send('resize-by', 2);
    assert.equal(h.shell.snapshot().bounds.width, 600);
    h.send('resize-by', 0.9); assert.equal(h.shell.snapshot().bounds.width, 540);
    for (let i = 0; i < 20; i++) h.send('resize-by', 0.5);
    assert.equal(h.shell.snapshot().bounds.width, 96);
    h.send('resize-by', 1.1); assert.ok(h.shell.snapshot().bounds.width > 96);
  } finally { h.shell.destroy(); }
});

test('drag preserves exact dimensions when both native movement APIs round the readback outward',()=>{
  const h=harness();
  try{
    const b=h.shell.snapshot().bounds;
    const setBounds=h.shell.window.setBounds.bind(h.shell.window);
    h.shell.window.setBounds=v=>setBounds({...v,width:v.width+1,height:v.height+1});
    h.shell.window.setPosition=(x,y)=>h.shell.window.setBounds({...h.shell.window.getBounds(),x,y});
    for(let i=0;i<8;i++)h.send('drag',{dx:-8,dy:-4});
    const after=h.shell.snapshot().bounds;
    assert.equal(after.width,b.width);assert.equal(after.height,b.height);
    assert.equal(after.x,b.x-8*8);assert.equal(after.y,b.y-4*8);
  }finally{h.shell.destroy();}
});

test('queued drag and resize are rejected throughout explicit click-through until rescue',()=>{
  const h=harness({testPolicy:{rescueAvailable:true}});
  try{
    h.shell.setClickThrough(true);const before=h.shell.snapshot().bounds;
    h.send('drag',{dx:-40,dy:-20});h.send('resize-by',{factor:1.2,anchor:{x:0.5,y:0}});
    assert.deepEqual(h.shell.snapshot().bounds,before,'Queued geometry must not bypass full-through state');
    h.shell.setClickThrough(false);h.send('resize-by',1.1);
    assert.ok(h.shell.snapshot().bounds.width>before.width);
  }finally{h.shell.destroy();}
});

test('state invoke rejects subframes, old windows and unexpected arguments', () => {
  const h = harness();
  try {
    const get = h.handles.get('desktop:get-state');
    assert.equal(typeof get, 'function');
    assert.deepEqual(get(h.event()), h.shell.snapshot());
    assert.equal(get({ sender: {}, senderFrame: {} }), null);
    assert.equal(get(h.event(), 'extra'), null);
    h.shell.destroy();
    assert.equal(get(h.event()), null);
    assert.equal(h.handles.size, 0);
    assert.equal(h.electron.ipcMain.eventNames().length, 0);
  } finally { h.shell.destroy(); }
});



test('strict commands gate automatic/full click-through and hidden rescue stays invisible', () => {
  const h = harness({ testPolicy: { rescueAvailable: true } });
  try {
    h.send('interactive', false);
    assert.deepEqual(h.calls.filter(c => c[0] === 'ignore').at(-1), ['ignore', true, { forward: true }]);
    h.send('interactive', 'true');
    h.send('desktop:command', { name: 'click-through', value: true });
    assert.equal(h.shell.snapshot().clickThrough, true);
    h.send('interactive', true);
    assert.equal(h.calls.filter(c => c[0] === 'ignore').at(-1)[1], true);
    for (const v of [1, 'true', null, {}]) h.send('desktop:command', { name: 'topmost', value: v });
    h.send('desktop:command', { name: 'topmost', value: false, extra: 1 });
    assert.equal(h.shell.snapshot().alwaysOnTop, true);
    h.send('desktop:command', { name: 'topmost', value: false });
    assert.equal(h.shell.snapshot().alwaysOnTop, false);
    h.send('desktop:command', { name: 'hide' });
    h.shell.show();
    h.send('desktop:command', { name: 'reset' });
    h.send('menu', { x: 12, y: 12 });
    assert.equal(h.shell.snapshot().clickThrough, false);
    assert.equal(h.shell.snapshot().visible, false);
    assert.equal(h.shell.snapshot().testRescue, true);
    assert.ok(h.calls.some(c => c[0] === 'send' && c[2] === 'shell:cancel'));
    assert.equal(h.calls.some(c => ['tray', 'register', 'show', 'showInactive', 'focus', 'popup'].includes(c[0])), false);
  } finally { h.shell.destroy(); }
});

test('full click-through is denied when neither tray nor shortcut is available', async () => {
  for (const options of [{}, { mode: 'visible', trayWorks: false, shortcutWorks: false }]) {
    const h = harness(options);
    try {
      await h.shell.ready;
      h.send('desktop:command', { name: 'click-through', value: true });
      assert.equal(h.shell.snapshot().clickThrough, false);
      assert.equal(h.shell.snapshot().rescueAvailable, false);
      assert.equal(h.shell.snapshot().shortcutAvailable, false);
      assert.match(h.shell.snapshot().lastError, /rescue/i);
    } finally { h.shell.destroy(); }
    assert.equal(h.calls.some(c => c[0] === 'unregister'), false);
  }
});

test('visible mock without any rescue refuses every hide entry and broadcasts the error without pausing', async () => {
  const h = harness({ mode: 'visible', trayWorks: false, shortcutWorks: false });
  try {
    await h.shell.ready;
    assert.equal(h.shell.snapshot().visible, true);
    assert.equal(h.shell.snapshot().rescueAvailable, false);
    assert.equal(h.shell.window.options.skipTaskbar, true);
    const before = h.calls.length;
    assert.equal(h.shell.hide(), false);
    assert.equal(h.shell.command({ name: 'hide' }), false);
    h.send('desktop:command', { name: 'hide' });
    assert.equal(h.shell.menuTemplate().find(item => item.id === 'hide').click(), false);
    assert.equal(h.shell.snapshot().visible, true);
    assert.match(h.shell.snapshot().lastError, /rescue/i);
    const after = h.calls.slice(before);
    assert.equal(after.some(c => c[0] === 'hide' || (c[0] === 'send' && ['shell:cancel', 'shell:hide'].includes(c[2]))), false);
    const states = after.filter(c => c[0] === 'send' && c[1] === 'desktop:state').map(c => c[2]);
    assert.equal(states.length, 4);
    assert.ok(states.every(state => state.visible === true && /rescue/i.test(state.lastError)));
    h.flush();
    assert.match(h.shell.snapshot().lastError, /rescue/i, 'Saving must not erase the rejection feedback');
  } finally { h.shell.destroy(); }
});

test('hidden mock without rescue still accepts hide and sends cancellation/pause without native show', async () => {
  const h = harness();
  try {
    await h.shell.ready;
    assert.equal(h.shell.snapshot().rescueAvailable, false);
    const before = h.calls.length;
    assert.equal(h.shell.hide(), true);
    assert.equal(h.shell.snapshot().visible, false);
    assert.equal(h.shell.snapshot().lastError, null);
    const after = h.calls.slice(before);
    assert.ok(after.some(c => c[0] === 'hide'));
    assert.ok(after.some(c => c[0] === 'send' && c[2] === 'shell:cancel'));
    assert.ok(after.some(c => c[0] === 'send' && c[2] === 'shell:hide'));
    assert.equal(h.calls.some(c => ['tray', 'register', 'show', 'showInactive', 'focus', 'popup'].includes(c[0])), false);
  } finally { h.shell.destroy(); }
});

test('visible mock can hide with either tray-only or shortcut-only rescue', async () => {
  for (const options of [{ trayWorks: true, shortcutWorks: false }, { trayWorks: false, shortcutWorks: true }]) {
    const h = harness({ mode: 'visible', ...options });
    try {
      await h.shell.ready;
      assert.equal(h.shell.snapshot().rescueAvailable, true);
      assert.equal(h.shell.hide(), true);
      assert.equal(h.shell.snapshot().visible, false);
      assert.equal(h.shell.snapshot().lastError, null);
      assert.ok(h.calls.some(c => c[0] === 'send' && c[2] === 'shell:hide'));
    } finally { h.shell.destroy(); }
  }
});

test('visible mock tray and owned shortcut rescue, then clean up only owned registration', async () => {
  const h = harness({ mode: 'visible' });
  try {
    await h.shell.ready;
    assert.equal(h.shell.snapshot().visible, true);
    assert.equal(h.shell.snapshot().shortcutAvailable, true);
    assert.deepEqual(h.calls.filter(c => c[0] === 'register'), [['register', 'Control+Alt+Shift+B']]);
    h.send('desktop:command', { name: 'click-through', value: true });
    assert.equal(h.shell.snapshot().clickThrough, true);
    h.send('desktop:command', { name: 'hide' });
    assert.equal(h.shell.snapshot().visible, false);
    h.electron.globalShortcut.callback();
    assert.equal(h.shell.snapshot().visible, true);
    assert.equal(h.shell.snapshot().clickThrough, false);
    assert.ok(h.calls.some(c => c[0] === 'tray-menu'));
    h.shell.destroy(); h.shell.destroy();
    assert.deepEqual(h.calls.filter(c => c[0] === 'unregister'), [['unregister', 'Control+Alt+Shift+B']]);
    assert.equal(h.calls.filter(c => c[0] === 'tray-destroy').length, 1);
    assert.equal(h.timers.size, 0);
  } finally { h.shell.destroy(); }
  assert.throws(() => harness({ mode: 'visible', testPolicy: { rescueAvailable: true } }), /test.*hidden|hidden.*test/i);
});

test('menu action routing has exact face IDs, idle hold/release and no chat entry', async () => {
  const h = harness({ mode: 'visible', shortcutWorks: false });
  function flatten(items) { return items.flatMap(item => [item, ...flatten(item.submenu || [])]); }
  try {
    await h.shell.ready;
    assert.equal(h.shell.snapshot().rescueAvailable, true);
    assert.equal(h.shell.snapshot().shortcutAvailable, false);
    const items = flatten(h.shell.menuTemplate());
    for (const id of ['hop', 'face:3901', 'face:auto', 'idle', 'size:small', 'size:medium', 'size:large', 'click-through', 'topmost', 'hide', 'reset', 'quit']) assert.ok(items.find(item => item.id === id), id);
    assert.equal(items.some(item => /chat|聊天|设置模型/.test(item.id || item.label || '')), false);
    const meta=require('../assets/manifest.json').character;
    const offered=items.filter(item=>item.id?.startsWith('face:')&&item.id!=='face:auto').map(item=>Number(item.id.slice(5)));
    assert.deepEqual(offered,meta.faceOrder.filter(id=>!meta.skip.includes(id)),'Skipped faces must not appear as inert selectable menu items');
    items.find(item => item.id === 'face:3901').click();
    items.find(item => item.id === 'face:auto').click();
    items.find(item => item.id === 'idle').click({ checked: false });
    assert.equal(h.shell.snapshot().idleEnabled, false);
    assert.ok(h.calls.some(c => c[0] === 'send' && c[2] === 'idle:off'));
    items.find(item => item.id === 'size:large').click();
    assert.equal(h.shell.snapshot().size, 'large');
    assert.equal(h.shell.snapshot().bounds.width, 300);
    h.send('menu', { x: 10, y: 10 });
    const popup = h.calls.find(c => c[0] === 'popup'); assert.ok(popup);
    assert.ok(h.calls.some(c => c[0] === 'send' && c[2] === 'idle:hold'));
    popup[1].callback();
    assert.ok(h.calls.some(c => c[0] === 'send' && c[2] === 'idle:release'));
    h.send('idle-ready');
    assert.equal(h.calls.filter(c => c[0] === 'send' && c[1] === 'action').at(-1)[2], 'idle:off');
    h.shell.window.emit('blur');
    assert.equal(h.calls.filter(c => c[0] === 'send' && c[1] === 'action').at(-1)[2], 'shell:cancel');
    h.send('desktop:command', { name: 'quit' });
    assert.equal(h.calls.filter(c => c[0] === 'quit').length, 1);
  } finally { h.shell.destroy(); }
  assert.equal(h.calls.some(c => c[0] === 'unregister'), false);
});


test('window preferences restore and persist only the injected profile state', () => {
  const saved = { bounds: { x: 20, y: 30, width: 300, height: 435 }, size: 'large', alwaysOnTop: false, idleEnabled: false };
  const h = harness({ saved });
  try {
    assert.deepEqual(h.shell.snapshot().bounds, saved.bounds);
    assert.equal(h.shell.snapshot().size, 'large');
    assert.equal(h.shell.snapshot().alwaysOnTop, false);
    assert.equal(h.shell.snapshot().idleEnabled, false);
    assert.equal(h.shell.snapshot().followEnabled, true);
    assert.equal(h.shell.snapshot().fxEnabled, true);
    assert.deepEqual(h.ioCalls, [['load', path.join(profileRoot, 'window-state.json')]]);
    h.send('drag', { dx: 10, dy: 15 }); h.send('desktop:command', { name: 'topmost', value: true });
    for(const id of ['follow','effects'])h.shell.menuTemplate().find(item=>item.id===id).click({checked:false});
    h.flush();
    const write = h.ioCalls.filter(c => c[0] === 'save').at(-1); assert.ok(write);
    assert.equal(write[1], path.join(profileRoot, 'window-state.json'));
    assert.deepEqual(Object.keys(write[2]).sort(), ['alwaysOnTop', 'bounds', 'followEnabled', 'fxEnabled', 'idleEnabled', 'size', 'wanderEnabled']);
    assert.equal(write[2].followEnabled, false);
    assert.equal(write[2].fxEnabled, false);
    const restored=harness({saved:write[2]});
    try {
      assert.equal(restored.shell.snapshot().followEnabled, false);
      assert.equal(restored.shell.snapshot().fxEnabled, false);
    } finally {restored.shell.destroy();}
    assert.deepEqual(write[2].bounds, { x: 30, y: 45, width: 300, height: 435 });
    assert.equal(write[2].alwaysOnTop, true);
    h.send('resize-by', 1.1); h.shell.destroy();
    assert.equal(h.ioCalls.filter(c => c[0] === 'save').at(-1)[2].size, 'custom');
    assert.equal(h.timers.size, 0);
  } finally { h.shell.destroy(); }
});

test('display removal/metric changes refit bounds and cleanup event listeners', () => {
  const h = harness({ saved: { bounds: { x: 2400, y: 1200, width: 900, height: 1305 }, size: 'custom', alwaysOnTop: true, idleEnabled: true } });
  try {
    const b = h.shell.snapshot().bounds; assert.ok(b.x + b.width <= 1920 && b.y + b.height <= 1080);
    h.electron.screen.displays = [{ id: 2, workArea: { x: -800, y: 0, width: 800, height: 600 } }];
    h.electron.screen.emit('display-removed');
    let next = h.shell.snapshot().bounds;
    assert.ok(next.x >= -800 && next.x + next.width <= 0 && next.y + next.height <= 600);
    h.electron.screen.displays[0].workArea = { x: -400, y: -100, width: 400, height: 300 };
    h.electron.screen.emit('display-metrics-changed'); next = h.shell.snapshot().bounds;
    assert.ok(next.x >= -400 && next.x + next.width <= 0 && next.y >= -100 && next.y + next.height <= 200);
    h.shell.window.destroy();
    assert.equal(h.electron.screen.eventNames().length, 0);
    assert.equal(h.electron.app.eventNames().length, 0);
    assert.equal(h.electron.ipcMain.eventNames().length, 0);
    assert.equal(h.handles.size, 0); assert.equal(h.timers.size, 0);
  } finally { h.shell.destroy(); }
});

test('native navigation/webviews/windows are blocked and hidden frames run at 60fps', () => {
  const h = harness();
  try {
    for (const name of ['will-navigate', 'will-frame-navigate', 'will-redirect', 'will-attach-webview']) {
      let prevented = false;
      h.shell.window.webContents.emit(name, { preventDefault() { prevented = true; } }, 'https://example.invalid');
      assert.equal(prevented, true, name);
    }
    assert.deepEqual(h.shell.window.openHandler({ url: 'baijie28://app/desktop.html' }), { action: 'deny' });
    assert.deepEqual(h.calls.filter(c => c[0] === 'frame-rate'), [['frame-rate', 60]]);
    assert.equal(h.shell.window.options.webPreferences.backgroundThrottling, false);
    assert.notEqual(h.shell.window.options.paintWhenInitiallyHidden, false);
    for (const [channel, value] of [['interactive', false], ['desktop:command', { name: 'topmost', value: false }], ['menu', { x: 1, y: 1 }], ['idle-ready', undefined]]) {
      const count = h.calls.length;
      h.electron.ipcMain.emit(channel, { sender: h.shell.window.webContents, senderFrame: {} }, value);
      assert.equal(h.calls.length, count, channel);
    }
  } finally { h.shell.destroy(); }
});


test('direct shell refuses an arbitrary profile before creating any window', () => {
  const { createShell } = implementation();
  for (const options of [
    { root, profileRoot: path.resolve(root, '../../01-当前工程'), mode: 'hidden' },
    { root, mode: 'hidden' },
    { root, profileRoot, mode: 'visible' },
    { root: path.dirname(root), profileRoot, mode: 'hidden' },
  ]) assert.throws(() => createShell({ electron: {}, ...options }), /profile|root|path/i);
});

test('IPC is disabled after a frame URL changes and all send channels reject extras', () => {
  const h = harness();
  try {
    const count = h.calls.length;
    for (const [channel, values] of [['drag', [{ dx: 1, dy: 1 }]], ['resize-by', [1.1]], ['interactive', [false]],
      ['desktop:command', [{ name: 'hide' }]], ['menu', [{ x: 1, y: 1 }]], ['idle-ready', []]]) {
      h.send(channel, ...values, 'extra');
    }
    assert.equal(h.calls.length, count);
    h.shell.window.webContents.mainFrame.url = 'https://bad.invalid/';
    h.send('drag', { dx: 1, dy: 1 }); h.send('desktop:command', { name: 'quit' });
    assert.equal(h.calls.length, count);
    assert.equal(h.handles.get('desktop:get-state')(h.event()), null);
  } finally { h.shell.destroy(); }
});

test('menu holds keep input capture enabled and tray menus use the same cancellation boundary', async () => {
  const h = harness({ mode: 'visible' });
  try {
    await h.shell.ready;
    h.send('interactive', false);
    h.send('menu', { x: 4, y: 4 });
    assert.equal(h.calls.filter(c => c[0] === 'ignore').at(-1)[1], false);
    h.send('interactive', false);
    assert.equal(h.calls.filter(c => c[0] === 'ignore').at(-1)[1], false);
    h.calls.find(c => c[0] === 'popup')[1].callback();
    assert.equal(h.calls.filter(c => c[0] === 'ignore').at(-1)[1], true);
    const trayMenu = h.calls.filter(c => c[0] === 'tray-menu').at(-1)[1];
    trayMenu.emit('menu-will-show');
    assert.equal(h.calls.filter(c => c[0] === 'send' && c[1] === 'action').at(-1)[2], 'idle:hold');
    trayMenu.emit('menu-will-close');
    assert.equal(h.calls.filter(c => c[0] === 'send' && c[1] === 'action').at(-1)[2], 'idle:release');
  } finally { h.shell.destroy(); }
});


test('hidden logical show/reset resume actions without ever showing or focusing', () => {
  const h = harness();
  try {
    h.shell.hide(); h.shell.show(); h.shell.reset();
    assert.equal(h.calls.filter(c => c[0] === 'send' && c[2] === 'shell:show').length, 2);
    assert.equal(h.shell.snapshot().visible, false);
    assert.equal(h.calls.some(c => ['show', 'showInactive', 'focus', 'popup', 'tray', 'register'].includes(c[0])), false);
  } finally { h.shell.destroy(); }
});

test('failed native popup releases hold and rejected load cleans all registrations', async () => {
  const h = harness({ mode: 'visible' });
  try {
    await h.shell.ready;
    h.electron.Menu.buildFromTemplate = () => Object.assign(new EventEmitter(), { popup() { throw new Error('popup unavailable'); } });
    assert.equal(h.shell.menu({ x: 10, y: 10 }), false);
    assert.match(h.shell.snapshot().lastError, /menu/i);
    assert.ok(h.calls.some(c => c[0] === 'send' && c[2] === 'idle:release'));
  } finally { h.shell.destroy(); }
  const failed = harness({ mode: 'visible', loadFails: true });
  await assert.rejects(failed.shell.ready, /load failed/);
  assert.equal(failed.shell.window.isDestroyed(), true);
  assert.equal(failed.handles.size, 0); assert.equal(failed.electron.ipcMain.eventNames().length, 0);
  assert.equal(failed.timers.size, 0);
  assert.equal(failed.calls.filter(c => c[0] === 'unregister').length, 1);
  assert.equal(failed.calls.some(c => ['show', 'focus', 'showInactive'].includes(c[0])), false);
});


test('actual preload connects through mock IPC to shell drag/resize/state/action round trips', async () => {
  const h = harness({ testPolicy: { rescueAvailable: true } });
  const ipcRenderer = new EventEmitter(); let pet;
  ipcRenderer.send = (channel, ...args) => h.send(channel, ...args);
  ipcRenderer.invoke = (channel, ...args) => Promise.resolve(h.handles.get(channel)(h.event(), ...args));
  const originalSend = h.shell.window.webContents.send;
  h.shell.window.webContents.send = (channel, ...args) => { originalSend(channel, ...args); ipcRenderer.emit(channel, {}, ...args); };
  require('node:vm').runInNewContext(fs.readFileSync(path.join(root, 'desktop-preload.cjs'), 'utf8'), {
    process: { isMainFrame: true }, require: name => { assert.equal(name, 'electron'); return {
      ipcRenderer, contextBridge: { exposeInMainWorld(name, api) { assert.equal(name, 'pet'); pet = api; } },
    }; },
  });
  const actions = [], states = [], stopAction = pet.onAction(value => actions.push(value)), stopState = pet.onState(value => states.push(value));
  try {
    pet.ready(); pet.drag(-100, -100); pet.resizeBy(1.1, { x: 0.5, y: 0.5 });
    pet.command('click-through', true); pet.command('topmost', false);
    const state = await pet.getState();
    assert.equal(state.size, 'custom'); assert.equal(state.bounds.width, 264);
    assert.equal(state.clickThrough, true); assert.equal(state.alwaysOnTop, false);
    assert.equal(state.mode, 'hidden'); assert.equal(state.visible, false);
    assert.ok(actions.includes('idle:on') && actions.includes('shell:cancel'));
    assert.ok(states.some(state => state.clickThrough === true));
    pet.command('hide'); pet.command('reset');
    assert.ok(actions.includes('shell:hide') && actions.includes('shell:show'));
    assert.equal((await pet.getState()).visible, false);
  } finally { stopAction(); stopState(); h.shell.destroy(); }
  assert.equal(ipcRenderer.eventNames().length, 0);
});


test('destroyed native window snapshot remains safe and saves its last bounds', () => {
  const h = harness();
  h.send('drag', { dx: -40, dy: -30 });
  const bounds = h.shell.snapshot().bounds;
  h.shell.window.destroy();
  assert.equal(h.shell.snapshot().visible, false);
  assert.deepEqual(h.shell.snapshot().bounds, bounds);
  assert.equal(h.electron.ipcMain.eventNames().length, 0);
  assert.equal(h.electron.screen.eventNames().length, 0);
  assert.equal(h.ioCalls.filter(c => c[0] === 'save').at(-1)[2].bounds.x, bounds.x);
});

for (const failure of ['save', 'menu', 'drag']) test(`show and through recovery cannot clear unrelated ${failure} failure`, async () => {
  const h = harness({ mode: 'visible' });
  try {
    await h.shell.ready;
    if (failure === 'save') {
      h.stateIO.saveState = () => { throw Error('SECRET save path'); }; h.flush();
    } else if (failure === 'menu') {
      h.electron.Menu.buildFromTemplate = () => Object.assign(new EventEmitter(), { popup() { throw Error('SECRET menu error'); } });
      h.shell.menu({ x: 10, y: 10 });
    } else {
      const set = h.shell.window.setBounds.bind(h.shell.window);
      h.shell.window.setBounds = value => set({ ...value, width: value.width + 10 });
      assert.equal(h.shell.drag({ dx: -5, dy: 0 }), false);
    }
    const error = h.shell.snapshot().lastError; assert.ok(error);
    h.shell.show(); h.shell.setClickThrough(false);
    assert.equal(h.shell.snapshot().lastError, error);
    assert.equal(h.calls.filter(c => c[0] === 'send' && c[1] === 'desktop:state').at(-1)[2].lastError, error);
  } finally { h.shell.destroy(); }
});

test('recovery clears only its own error and reveals any still-unresolved save failure', async () => {
  const h = harness({ mode: 'visible', shortcutWorks: false });
  try {
    await h.shell.ready;
    const save = h.stateIO.saveState, build = h.electron.Menu.buildFromTemplate;
    h.stateIO.saveState = () => { throw Error('fixture save failure'); }; h.flush();
    h.electron.Menu.buildFromTemplate = () => Object.assign(new EventEmitter(), { popup() { throw Error('fixture popup failure'); } });
    assert.equal(h.shell.menu({ x: 10, y: 10 }), false);
    assert.equal(h.shell.snapshot().lastError, 'Native menu unavailable');
    h.electron.Menu.buildFromTemplate = build;
    assert.equal(h.shell.menu({ x: 10, y: 10 }), true);
    assert.equal(h.shell.snapshot().lastError, 'Window state save failed', 'Menu recovery must not erase an earlier save error');
    h.calls.filter(c => c[0] === 'popup').at(-1)[1].callback();
    h.electron.Tray.prototype.isDestroyed = () => true;
    assert.equal(h.shell.hide(), false);
    h.shell.show();
    assert.equal(h.shell.snapshot().lastError, 'No rescue channel available', 'No-rescue cause remains despite logical show');
    h.electron.Tray.prototype.isDestroyed = () => false;
    h.shell.show();
    assert.equal(h.shell.snapshot().lastError, 'Window state save failed');
    h.stateIO.saveState = save; h.flush();
    assert.equal(h.shell.snapshot().lastError, null);
    assert.equal(h.timers.size, 2, 'only visible topmost and cursor maintenance remain after saving');
  } finally { h.shell.destroy(); }
});

test('successful drag and persistence clear only matching errors, not a failed menu', async () => {
  const h = harness({ mode: 'visible' });
  try {
    await h.shell.ready;
    const set = h.shell.window.setBounds.bind(h.shell.window), build = h.electron.Menu.buildFromTemplate;
    h.electron.Menu.buildFromTemplate = () => Object.assign(new EventEmitter(), { popup() { throw Error('fixture popup failure'); } });
    h.shell.menu({ x: 10, y: 10 });
    h.shell.window.setBounds = value => set({ ...value, width: value.width + 10 });
    assert.equal(h.shell.drag({ dx: -5, dy: 0 }), false);
    assert.equal(h.shell.snapshot().lastError, 'Native drag dimensions did not settle');
    h.shell.window.setBounds = set;
    assert.equal(h.shell.drag({ dx: -5, dy: 0 }), true);
    assert.equal(h.shell.snapshot().lastError, 'Native menu unavailable');
    h.flush(); assert.equal(h.shell.snapshot().lastError, 'Native menu unavailable');
    h.electron.Menu.buildFromTemplate = build;
    h.shell.menu({ x: 10, y: 10 });
    assert.equal(h.shell.snapshot().lastError, null);
  } finally { h.shell.destroy(); }
});

test('hidden shell is transparent, sandboxed and ready without desktop side effects', async () => {
  const h = harness();
  try {
    await h.shell.ready;
    const o = h.shell.window.options;
    assert.equal(o.width, 240); assert.equal(o.height, 348);
    assert.equal(o.transparent, true); assert.equal(o.frame, false);
    assert.equal(o.show, false); assert.equal(o.focusable, false);
    assert.equal(o.webPreferences.offscreen, true);
    assert.equal(o.webPreferences.sandbox, true);
    assert.equal(o.webPreferences.contextIsolation, true);
    assert.equal(o.webPreferences.nodeIntegration, false);
    assert.equal(o.webPreferences.preload, path.join(root, 'desktop-preload.cjs'));
    assert.deepEqual(h.calls.filter(c => ['load'].includes(c[0])), [['load', 'baijie28://app/desktop.html']]);
    assert.equal(h.shell.snapshot().mode, 'hidden');
    assert.equal(h.shell.snapshot().visible, false);
    assert.equal(h.calls.some(c => ['tray', 'register', 'show', 'showInactive', 'focus', 'popup'].includes(c[0])), false);
  } finally { h.shell.destroy(); }
});

test('visible topmost recovers native demotion and z-order without focus; hide/off/own panel suspend it', async () => {
  const h=harness({mode:'visible'});
  try {
    await h.shell.ready;
    assert.ok(h.calls.some(c=>c[0]==='top'&&c[1]===true&&c[2]==='screen-saver'));
    h.calls.length=0;h.shell.window.top=false;h.flush();
    assert.equal(h.shell.window.top,true);assert.ok(h.calls.some(c=>c[0]==='moveTop'));
    assert.equal(h.calls.some(c=>['focus','show','showInactive'].includes(c[0])),false);
    h.calls.length=0;h.electron.BrowserWindow.getFocusedWindow=()=>({});h.flush();
    assert.equal(h.calls.some(c=>c[0]==='moveTop'),false);
    h.electron.BrowserWindow.getFocusedWindow=()=>null;h.flush();
    assert.ok(h.calls.some(c=>c[0]==='moveTop'));
    h.shell.menu({x:10,y:10});const popup=h.calls.filter(c=>c[0]==='popup').at(-1)[1];
    h.calls.length=0;h.flush();assert.equal(h.calls.some(c=>c[0]==='moveTop'),false);
    popup.callback();h.flush();assert.ok(h.calls.some(c=>c[0]==='moveTop'));
    h.shell.hide();h.calls.length=0;h.flush();assert.equal(h.calls.some(c=>c[0]==='moveTop'),false);
    h.shell.show();assert.ok(h.calls.some(c=>c[0]==='moveTop'));
    h.shell.setTopmost(false);h.calls.length=0;h.flush();
    assert.equal(h.shell.window.top,false);assert.equal(h.calls.some(c=>c[0]==='moveTop'),false);
    h.shell.setTopmost(true);assert.ok(h.calls.some(c=>c[0]==='moveTop'));
  } finally {h.shell.destroy();}
  assert.equal(h.timers.size,0);
});

test('native cursor heartbeat uses local DIP coordinates and stops for hide, pass-through and destruction', async()=>{
 const h=harness({mode:'visible'});try{
  await h.shell.ready;const b=h.shell.window.getBounds();h.electron.screen.getCursorScreenPoint=()=>({x:b.x+110,y:b.y+80});
  h.calls.length=0;h.flush();assert.deepEqual(h.calls.find(c=>c[0]==='send'&&c[1]==='desktop:cursor')?.[2],{x:110,y:80});
  h.calls.length=0;h.flush();assert.ok(h.calls.some(c=>c[1]==='desktop:cursor'),'stationary cursor still recovers after lost forwarding');
  h.shell.setTopmost(false);h.calls.length=0;h.flush();assert.ok(h.calls.some(c=>c[1]==='desktop:cursor'),'input does not depend on topmost preference');
  h.shell.setClickThrough(true);h.calls.length=0;h.flush();assert.equal(h.calls.some(c=>c[1]==='desktop:cursor'),false);
  h.shell.setClickThrough(false);assert.ok(h.calls.some(c=>c[1]==='desktop:cursor'));
  h.shell.hide();h.calls.length=0;h.flush();assert.equal(h.calls.some(c=>c[1]==='desktop:cursor'),false);
  h.shell.show();assert.ok(h.calls.some(c=>c[1]==='desktop:cursor'));
  h.shell.window.emit('minimize');h.calls.length=0;h.flush();assert.equal(h.calls.some(c=>c[1]==='desktop:cursor'),false);
  h.shell.window.emit('restore');assert.ok(h.calls.some(c=>c[1]==='desktop:cursor'));
 }finally{h.shell.destroy();}assert.equal(h.timers.size,0);
 const hidden=harness();try{await hidden.shell.ready;hidden.flush();assert.equal(hidden.calls.some(c=>c[1]==='desktop:cursor'),false);}finally{hidden.shell.destroy();}
});

test('pet startup, rescue, and reset reveal without activating over the foreground app',async()=>{
 const h=harness({mode:'visible'});try{
  await h.shell.ready;h.shell.hide();h.shell.show();h.shell.reset();
  assert.equal(h.calls.some(c=>c[0]==='show'||c[0]==='focus'),false,'revealing the overlay must not activate it over a fullscreen game');
  assert.equal(h.calls.filter(c=>c[0]==='showInactive').length,3);
  assert.equal(h.shell.window.isVisible(),true);assert.ok(h.calls.some(c=>c[0]==='moveTop'));assert.ok(h.calls.some(c=>c[1]==='desktop:cursor'));
 }finally{h.shell.destroy();}
});

test('walk displacement keeps size and focus, batches persistence, and yields to drag',async()=>{
 const h=harness({mode:'visible'});
 try{
  await h.shell.ready;
  const before=h.shell.window.getBounds();
  h.send('desktop:walk',{phase:'begin',id:1});h.calls.length=0;h.ioCalls.length=0;
  for(let i=1;i<=30;i++)h.send('desktop:walk',{phase:'step',id:1,offset:-i*.75});
  assert.deepEqual(h.shell.window.getBounds(),{...before,x:Math.round(before.x-22.5)});
  assert.equal(h.calls.filter(c=>c[0]==='tray-menu').length,0);
  assert.equal(h.calls.some(c=>c[0]==='show'||c[0]==='showInactive'||c[0]==='focus'||c[0]==='moveTop'),false);
  assert.equal(h.ioCalls.length,0);
  h.send('desktop:walk',{phase:'end',id:1});
  assert.ok(h.calls.some(c=>c[1]==='desktop:state'));
  const stopped=h.shell.window.getBounds();
  h.send('desktop:walk',{phase:'step',id:1,offset:-200});
  assert.deepEqual(h.shell.window.getBounds(),stopped);
  h.send('desktop:walk',{phase:'begin',id:2});
  h.send('drag',{dx:-10,dy:-10});const dragged=h.shell.window.getBounds();
  h.send('desktop:walk',{phase:'step',id:2,offset:-100});
  assert.deepEqual(h.shell.window.getBounds(),dragged);
  h.send('desktop:walk',{phase:'begin',id:3});
  h.send('desktop:walk',{phase:'step',id:3,offset:10000});
  assert.equal(h.shell.window.getBounds().x,1920-before.width);
  h.send('desktop:walk',{phase:'end',id:3});
 }finally{h.shell.destroy();}
});
