const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const path = require('node:path');
const { create } = require('../puppet/speech-window');
const fs = require('node:fs');
const vm = require('node:vm');
const source = name => fs.readFileSync(path.join(__dirname, '../puppet/', name), 'utf8');

test('sandbox preload exposes a narrow bridge without leaking Electron event', () => {
  const ipc = new EventEmitter(), sent = []; let bridge;
  ipc.send = (...args) => sent.push(args);
  vm.runInNewContext(source('speech-preload.js'), { require(name) {
    assert.equal(name, 'electron');
    return { ipcRenderer: ipc, contextBridge: { exposeInMainWorld(name, api) {
      assert.equal(name, 'speech'); bridge = api;
    } } };
  } });
  let received;
  const off = bridge.onState(state => { received = state; });
  const state = { id: 9, text: '<img src=x onerror=alert(1)>' };
  ipc.emit('speech:state', { secret: true }, state);
  assert.equal(received, state);
  bridge.dismiss(9); assert.deepEqual(sent, [['speech:dismiss', 9]]);
  off(); assert.equal(ipc.listenerCount('speech:state'), 0);
});

test('renderer renders literal text, replaces content, resets scroll and dismisses current id', () => {
  let receive, click; const dismissed = [];
  const text = { textContent: '', scrollTop: 55 };
  const close = { addEventListener(type, callback) { assert.equal(type, 'click'); click = callback; } };
  Object.defineProperty(text, 'innerHTML', { set() { throw Error('HTML injection'); } });
  vm.runInNewContext(source('speech.js'), {
    document: { getElementById(id) { return id === 'speech-text' ? text : close; } },
    window: { speech: { onState(fn) { receive = fn; }, dismiss(id) { dismissed.push(id); } } },
  });
  receive({ id: 1, text: '<script>evil()</script> long' });
  assert.equal(text.textContent, '<script>evil()</script> long');
  assert.equal(text.scrollTop, 0);
  receive({ id: 2, text: 'replacement' }); click();
  assert.equal(text.textContent, 'replacement'); assert.deepEqual(dismissed, [2]);
});

test('local UI has restrictive CSP, scrollable body and always separate close control', () => {
  const html = source('speech.html'), css = source('speech.css');
  assert.match(html, /Content-Security-Policy/);
  assert.match(html, /default-src 'none'/);
  assert.match(html, /script-src 'self'/);
  assert.match(html, /id="speech-text"/);
  assert.match(html, /<button[^>]+id="speech-close"[^>]+aria-label=/);
  assert.match(css, /overflow-y:\s*auto/);
  assert.match(css, /min-height:\s*0/);
  assert.match(css, /grid-template-rows:\s*auto minmax\(0, 1fr\)/);
  assert.match(css, /overflow-wrap:\s*anywhere/);
});


test('dismiss requires exact bubble sender and currently rendered id', () => {
  const f = fixture(); f.api.show({ id: 1, text: 'old' });
  const w = f.windows[0]; w.webContents.emit('did-finish-load');
  f.api.show({ id: 2, text: 'new' });
  f.ipcMain.emit('speech:dismiss', { sender: {} }, 2);
  f.ipcMain.emit('speech:dismiss', { sender: w.webContents }, 1);
  assert.deepEqual(f.dismissed, []);
  f.ipcMain.emit('speech:dismiss', { sender: w.webContents }, 2);
  assert.deepEqual(f.dismissed, [2]); assert.equal(w.visible, false);
  f.ipcMain.emit('speech:dismiss', { sender: w.webContents }, 2);
  assert.deepEqual(f.dismissed, [2]);
});

test('click-through applies before lazy creation; destroy removes IPC and blocks late load', () => {
  const f = fixture(); f.api.setClickThrough(true);
  f.api.show({ id: 1, text: 'hi' }); const w = f.windows[0];
  assert.deepEqual(w.ignored, [true, { forward: true }]);
  f.api.setClickThrough(false); assert.deepEqual(w.ignored, [false]);
  f.api.destroy(); f.api.destroy();
  assert.equal(w.dead, true);
  assert.equal(f.ipcMain.listenerCount('speech:dismiss'), 0);
  w.webContents.emit('did-finish-load');
  f.api.show({ id: 2, text: 'late' }); f.api.sync();
  assert.equal(f.windows.length, 1); assert.equal(w.shows, 0);
});

test('failed load dismisses once rather than holding idle with an invisible message', () => {
  const f = fixture(); f.api.show({ id: 1, text: 'hi' });
  const w = f.windows[0];
  w.webContents.emit('did-fail-load', {}, -6, 'missing file');
  w.webContents.emit('did-finish-load');
  assert.deepEqual(f.dismissed, [1]);
  assert.equal(w.visible, false);
});

test('refuses navigation and new windows', () => {
  const f = fixture(); f.api.show({ id: 1, text: 'hi' });
  const w = f.windows[0]; let prevented = false;
  w.webContents.emit('will-navigate', { preventDefault() { prevented = true; } }, 'https://evil.invalid');
  assert.equal(prevented, true);
  assert.deepEqual(w.openHandler({ url: 'https://evil.invalid' }), { action: 'deny' });
});


function fixture() {
  const windows = [], ipcMain = new EventEmitter(), dismissed = [];
  const parent = { bounds: { x: 400, y: 400, width: 200, height: 300 }, top: true,
    visible: true, dead: false, getBounds() { return { ...this.bounds }; },
    isAlwaysOnTop() { return this.top; }, isVisible() { return this.visible; },
    isDestroyed() { return this.dead; } };
  const screen = { area: { x: 0, y: 0, width: 1000, height: 800 },
    getDisplayMatching(bounds) { this.matched = bounds; return { workArea: this.area }; } };
  class Window extends EventEmitter {
    constructor(options) { super(); this.options = options; this.shows = 0; this.visible = false;
      this.dead = false; this.webContents = new EventEmitter(); this.sent = [];
      this.webContents.send = (...args) => this.sent.push(args);
      this.webContents.setWindowOpenHandler = fn => { this.openHandler = fn; };
      windows.push(this); }
    loadFile(file) { this.file = file; return Promise.resolve(); }
    isDestroyed() { return this.dead; }
    setBounds(b) { this.bounds = b; }
    setAlwaysOnTop(on, level) { this.top = on; this.level = level; }
    setIgnoreMouseEvents(...args) { this.ignored = args; }
    showInactive() { this.shows++; this.visible = true; }
    hide() { this.visible = false; }
    destroy() { this.dead = true; this.emit('closed'); }
  }
  const api = create({ BrowserWindow: Window, screen, ipcMain, parent,
    onDismiss: id => dismissed.push(id) });
  return { api, windows, ipcMain, parent, screen, dismissed };
}

test('lazily creates a secure owned local window and delivers only latest state on load', () => {
  const f = fixture();
  assert.equal(f.windows.length, 0);
  f.api.show({ id: 1, text: 'old' });
  f.api.show({ id: 2, text: 'new' });
  const w = f.windows[0];
  assert.equal(f.windows.length, 1);
  assert.equal(w.shows, 0);
  assert.equal(w.options.parent, f.parent);
  for (const key of ['frame', 'resizable', 'show']) assert.equal(w.options[key], false);
  assert.equal(w.options.transparent, true);
  assert.equal(w.options.skipTaskbar, true);
  assert.equal(w.options.webPreferences.nodeIntegration, false);
  assert.equal(w.options.webPreferences.contextIsolation, true);
  assert.equal(w.options.webPreferences.webSecurity, true);
  assert.equal(w.file, path.join(__dirname, '../puppet/speech.html'));
  assert.equal(w.options.webPreferences.preload, path.join(__dirname, '../puppet/speech-preload.js'));
  w.webContents.emit('did-finish-load');
  assert.deepEqual(w.sent, [['speech:state', { id: 2, text: 'new' }]]);
  assert.equal(w.shows, 1);
  assert.deepEqual(f.parent.bounds, { x: 400, y: 400, width: 200, height: 300 });
});

test('hide before load cannot resurrect; later show wins without a stale hide', () => {
  const f = fixture();
  f.api.hide(); f.api.sync();
  f.api.show({ id: 1, text: 'first' });
  const w = f.windows[0];
  f.api.hide();
  w.webContents.emit('did-finish-load');
  assert.equal(w.shows, 0);
  assert.equal(w.sent.length, 0);
  f.api.show({ id: 2, text: 'second' });
  assert.equal(w.visible, true);
  assert.deepEqual(w.sent.at(-1), ['speech:state', { id: 2, text: 'second' }]);
  f.api.hide(); f.api.sync();
  assert.equal(w.visible, false);
});

test('sync tracks current display and topmost, hides with no room or hidden parent', () => {
  const f = fixture();
  f.api.show({ id: 1, text: 'hi' });
  const w = f.windows[0]; w.webContents.emit('did-finish-load');
  f.parent.bounds = { x: -500, y: -500, width: 200, height: 300 };
  f.screen.area = { x: -1000, y: -800, width: 1000, height: 800 };
  f.parent.top = false; f.api.sync();
  assert.equal(w.top, false);
  assert.equal(w.bounds.x, -550);
  assert.deepEqual(f.screen.matched, f.parent.bounds);
  f.screen.area = { ...f.parent.bounds }; f.api.sync();
  assert.equal(w.visible, false);
  assert.deepEqual(f.dismissed, [1]);
  f.api.sync(); assert.deepEqual(f.dismissed, [1]);
  f.screen.area = { x: -1000, y: -800, width: 1000, height: 800 };
  f.api.show({ id: 2, text: 'next' }); assert.equal(w.visible, true);
  f.parent.visible = false; f.api.sync(); assert.equal(w.visible, false);
  f.parent.visible = true; f.api.sync(); assert.equal(w.visible, true);
});
