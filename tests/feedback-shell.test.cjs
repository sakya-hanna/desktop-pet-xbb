'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const ENTRY = 'baijie28://app/desktop.html';
const FEEDBACK = 'baijie28://app/feedback.html';

// Native surfaces only are faked; shell, resource ownership and feedback code are real.
function harness({ mode = 'hidden', deferred = false, failure = false, taskbarTopmost = true } = {}) {
  let time = 0, sequence = 0;
  const windows = [], timers = new Map(), history = [];
  const clock = { now: () => time,
    setTimeout(fn, delay) { const id = ++sequence; timers.set(id, { fn, due: time + delay }); history.push({ id, fn, delay }); return id; },
    clearTimeout(id) { timers.delete(id); } };
  class Window extends EventEmitter {
    constructor(options) {
      super(); this.options = options; this.dead = false; this.visible = false; this.top = options.alwaysOnTop;
      this.bounds = { x: options.x, y: options.y, width: options.width, height: options.height };
      this.calls = []; this.messages = []; this.webContents = new EventEmitter();
      Object.assign(this.webContents, { mainFrame: { url: ENTRY }, isDestroyed: () => this.dead,
        send: (...args) => this.messages.push(args), setFrameRate() {},
        setWindowOpenHandler: fn => { this.open = fn; } });
      windows.push(this);
    }
    isDestroyed() { return this.dead; }
    isVisible() { return this.visible; }
    isAlwaysOnTop() { return this.top; }
    getBounds() { return { ...this.bounds }; }
    setBounds(b) { this.bounds = { ...b }; this.calls.push(['bounds', b]); this.emit('move'); this.emit('resize'); }
    setAlwaysOnTop(v, level = 'floating') {
      this.top = v; this.calls.push(['top', v, level]);
      // Electron's default floating level inserts behind the taskbar. Win32
      // also demotes an owned window's owner when that anchor is non-topmost.
      if (v && level === 'floating' && !taskbarTopmost) {
        this.top = false;
        if (this.options.parent) this.options.parent.top = false;
      }
    }
    moveTop() { this.calls.push(['moveTop']); }
    setIgnoreMouseEvents(...v) { this.calls.push(['ignore', ...v]); }
    setMenu() {}
    show() { this.calls.push(['show']); this.visible = true; this.emit('show'); }
    showInactive() { this.calls.push(['showInactive']); this.visible = true; this.emit('show'); }
    focus() { this.calls.push(['focus']); }
    hide() { this.calls.push(['hide']); this.visible = false; this.emit('hide'); }
    loadURL(url) {
      this.url = url; this.webContents.mainFrame.url = url;
      if (url === ENTRY) return Promise.resolve();
      if (deferred) return new Promise((resolve, reject) => { this.finish = resolve; this.fail = reject; });
      if (failure) return Promise.reject(Error('fixture bubble load failure'));
      return Promise.resolve();
    }
    destroy() { if (this.dead) return; this.emit('close'); this.dead = true; this.emit('closed'); }
  }
  class Tray extends EventEmitter { setToolTip() {} setContextMenu(m) { this.menu = m; } isDestroyed() { return !!this.dead; } destroy() { this.dead = true; } }
  const ipcMain = new EventEmitter(), handles = new Map();
  ipcMain.handle = (name, fn) => handles.set(name, fn); ipcMain.removeHandler = name => handles.delete(name);
  const screen = new EventEmitter(); screen.area = { x: 0, y: 0, width: 1920, height: 1080 };
  screen.getPrimaryDisplay = () => ({ workArea: screen.area });
  screen.getAllDisplays = () => [screen.getPrimaryDisplay()]; screen.getDisplayMatching = screen.getPrimaryDisplay;
  screen.getCursorScreenPoint = () => ({ x: -100, y: -100 });
  const app = new EventEmitter(); app.quit = () => {};
  const electron = { BrowserWindow: Window, screen, app, ipcMain, Tray,
    Menu: { buildFromTemplate: template => Object.assign(new EventEmitter(), { template, popup() {} }) },
    globalShortcut: { register: () => true, unregister() {} } };
  const policy = require('../resource-policy.cjs'), privateSession = new EventEmitter();
  privateSession.webRequest = { onBeforeRequest() {} };
  for (const key of ['setPermissionRequestHandler', 'setPermissionCheckHandler', 'setDevicePermissionHandler', 'setDisplayMediaRequestHandler']) privateSession[key] = () => {};
  const session = policy.createOwnedSession({ defaultSession: {}, fromPartition: () => privateSession });
  const removePolicy = policy.installPolicy({ session, root });
  const shell = require('../shell.cjs').createShell({ electron, session, root, mode, clock,
    character: { faceOrder: [1], skip: [], labels: { 1: 'Test expression' } },
    profileRoot: path.resolve(root, mode === 'hidden' ? '../runtime/tests/feedback-mock' : '../runtime/interactive'),
    stateIO: { loadStateResult: () => ({ status: 'missing', value: null, reason: null }), saveState() {} } });
  const event = () => ({ sender: shell.window.webContents, senderFrame: shell.window.webContents.mainFrame });
  const send = (...args) => ipcMain.emit('desktop:feedback', event(), ...args);
  const advance = ms => { time += ms; for (const [id, task] of [...timers]) if (task.due <= time) { timers.delete(id); task.fn(); } };
  return { shell, electron, session, windows, timers, history, clock, event, send, advance, handles,
    bubble: () => windows.find(w => w.url === FEEDBACK),
    dispose() { shell.destroy(); removePolicy(); } };
}
const settle = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };
module.exports = { harness, settle, root, FEEDBACK };

if (require.main === module) {
  test('I9_feedback trusted main-frame IPC creates separate owned-session bubble and expires at first receipt', async () => {
    const h = harness();
    try {
      await h.shell.ready;
      const bounds = h.shell.window.getBounds();
      h.send({ id: 1, text: '姐姐在呢。' }); await settle();
      assert.equal(h.windows.length, 2, 'feedback must create a native bubble, not draw in parent');
      const bubble = h.bubble(); assert.ok(bubble);
      assert.deepEqual(bubble.messages.at(-1), ['feedback:state', { id: 1, text: '姐姐在呢。' }]);
      assert.equal(bubble.options.webPreferences.session, h.session);
      assert.deepEqual(h.shell.window.getBounds(), bounds);
      const deliveries = bubble.messages.length, timeout = h.history.find(t => t.delay === 3400);
      assert.ok(timeout, '3400ms begins at receipt');
      h.advance(3000); h.send({ id: 1, text: '不准重播' }); h.send({ id: 0, text: '旧条' });
      assert.equal(bubble.messages.length, deliveries);
      h.advance(400); assert.equal(bubble.messages.at(-1)[1], null);
      h.send({ id: 1, text: '过期不复活' }); assert.equal(bubble.messages.at(-1)[1], null);
    } finally { h.dispose(); }
    assert.equal(h.timers.size, 0);
  });

  test('I9_feedback rejects wrong sender/frame/URL, malformed payloads and extra IPC arguments', async () => {
    const h = harness();
    try {
      await h.shell.ready;
      for (const value of [undefined, [], {}, 'hello', { id: 0, text: 'x' }, { id: -1, text: 'x' },
        { id: 1.5, text: 'x' }, { id: Number.MAX_SAFE_INTEGER + 1, text: 'x' }, { id: 1, text: '' },
        { id: 1, text: '😀'.repeat(201) }, { id: 1, text: 3 }, { id: 1, text: 'x', extra: true }]) h.send(value);
      h.send({ id: 1, text: 'x' }, 'extra'); h.send();
      for (const event of [{}, { sender: {}, senderFrame: h.event().senderFrame },
        { sender: h.event().sender, senderFrame: { url: ENTRY } }]) h.electron.ipcMain.emit('desktop:feedback', event, { id: 1, text: 'x' });
      h.shell.window.webContents.mainFrame.url = ENTRY + '#wrong'; h.send({ id: 1, text: 'x' });
      h.shell.window.webContents.mainFrame.url = ENTRY;
      assert.equal(h.windows.length, 1);
      h.send({ id: 1, text: '😀'.repeat(200) }); await settle();
      assert.equal(h.windows.length, 2, 'valid 200 code points must be accepted');
      h.send(null); const count = h.bubble().messages.length;
      h.send({ id: 1, text: 'cleared id' }); assert.equal(h.bubble().messages.length, count);
    } finally { h.dispose(); }
  });

  test('I9_feedback replacement is protected from retired timers and cancellation preserves high-water mark', async () => {
    const h = harness();
    try {
      await h.shell.ready; h.send({ id: 1, text: 'one' }); await settle();
      assert.ok(h.bubble(), 'feedback behavior must be wired');
      const old = h.history.find(t => t.delay === 3400);
      h.advance(1000); h.send({ id: 2, text: 'two' }); old.fn();
      assert.equal(h.bubble().messages.at(-1)[1].id, 2);
      for (const cancel of [() => h.send(null), () => h.shell.window.emit('blur'),
        () => h.shell.setIdleEnabled(false), () => h.shell.hide()]) {
        cancel(); assert.equal(h.bubble().messages.at(-1)[1], null);
        const n = h.bubble().messages.length; h.send({ id: 2, text: 'stale' });
        assert.equal(h.bubble().messages.length, n);
      }
      h.send({ id: 3, text: 'while hidden' }); await settle();
      assert.equal(h.bubble().messages.at(-1)[1], null);
      h.shell.show(); h.send({ id: 3, text: 'late hidden message' });
      assert.equal(h.bubble().messages.at(-1)[1], null);
      h.send({ id: 4, text: 'new interaction' }); await settle();
      // Display IDs now belong to the main-process broker; hidden renderer IDs
      // are consumed for deduplication without allocating a visible message.
      assert.equal(h.bubble().messages.at(-1)[1].text, 'new interaction');
      assert.ok(h.bubble().messages.at(-1)[1].id > 2);
    } finally { h.dispose(); }
    assert.equal(h.windows.every(w => w.dead), true);
    assert.equal(h.electron.ipcMain.listenerCount('desktop:feedback'), 0);
  });
}
