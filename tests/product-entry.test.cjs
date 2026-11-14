'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { EventEmitter } = require('node:events');
const root = path.resolve(__dirname, '..');
const entryFile = path.join(root, 'product-main.cjs');

function evaluateEntry({ main = false, electron, argv = ['product.exe'], defaultApp = false, dependencyFailure } = {}) {
  const entry = { exports: {} }, localRequire = createRequire(entryFile), messages = [];
  const load = name => {
    if (name === 'electron') {
      assert.equal(main, true, 'Import must not require Electron');
      return electron;
    }
    if (name === './desktop-main.cjs' && dependencyFailure) throw dependencyFailure;
    return localRequire(name);
  };
  load.main = main ? entry : {};
  vm.runInNewContext(fs.readFileSync(entryFile, 'utf8'), {
    module: entry, exports: entry.exports, require: load, __dirname: root,
    process: { argv, defaultApp, env: {} }, console: { error: message => messages.push(message) },
  }, { filename: entryFile });
  return { exports: entry.exports, messages };
}

test('product entry can be imported without Electron or startup side effects', () => {
  assert.ok(fs.existsSync(entryFile), 'Product entry must exist');
  const oldEnv = { ...process.env };
  const mkdir = fs.mkdirSync, write = fs.writeFileSync;
  try {
    fs.mkdirSync = fs.writeFileSync = () => assert.fail('Import must not write files');
    assert.equal(typeof evaluateEntry().exports, 'object');
  } finally { fs.mkdirSync = mkdir; fs.writeFileSync = write; }
  assert.ok(Object.keys(process.env).length === Object.keys(oldEnv).length
    && Object.keys(oldEnv).every(name => process.env[name] === oldEnv[name]), 'Import must not change environment');
});

// Only native Electron boundaries and clock are simulated. Filesystem, entry,
// boot, policy, shell and window-state persistence are the actual implementation.
function harness(t, { loadFailure, syncLoadFailure, loadGate, appReady = false, allClosedDelivery = 'sync' } = {}) {
  const scratch = process.env.TMPDIR;
  assert.match(scratch.replaceAll('\\', '/'), /hermes\/cache\/scratch\/baijie28-shell-tests$/);
  const dir = fs.mkdtempSync(path.join(scratch, 'product-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const appDataRoot = path.join(dir, 'app data'), calls = [], handles = new Map(), timers = new Map(), windows = [];
  let ready = appReady, timer = 0, quitting = false;
  const lifecycle = [], pendingAllClosed = [];
  assert.ok(['sync', 'microtask', 'queued'].includes(allClosedDelivery));
  // Contract models, not native observations: last-window closure is delivered
  // inline, in a microtask, or after the caller has observed startup rejection.
  // No subscriber means default quit. Quit emits before-quit before closing
  // windows, and quit-driven closure does not emit window-all-closed.
  const app = new class extends EventEmitter {
    emit(name, ...args) {
      if (name === 'before-quit') { quitting = true; lifecycle.push(['before-quit']); }
      return super.emit(name, ...args);
    }
  }();
  function allClosed() {
    const deliver = () => {
      if (quitting) return;
      lifecycle.push(['window-all-closed', app.listenerCount('window-all-closed')]);
      if (!app.emit('window-all-closed')) { lifecycle.push(['default-quit']); app.quit(); }
    };
    if (allClosedDelivery === 'sync') deliver();
    else if (allClosedDelivery === 'microtask') queueMicrotask(deliver);
    else pendingAllClosed.push(deliver);
  }
  const flushAllClosed = () => { while (pendingAllClosed.length) pendingAllClosed.shift()(); };
  app.isReady = () => ready;
  app.getPath = name => { assert.equal(name, 'appData'); calls.push(['getPath', name]); return appDataRoot; };
  app.setName = name => { assert.equal(ready, false); calls.push(['name', name]); };
  app.setPath = (name, value) => { assert.equal(ready, false); calls.push(['path', name, value]); };
  app.setAppLogsPath = value => { assert.equal(ready, false); calls.push(['logs', value]); };
  app.whenReady = () => { calls.push(['ready']); ready = true; return Promise.resolve(); };
  app.enableSandbox = () => calls.push(['sandbox']);
  app.commandLine = { appendSwitch: name => calls.push(['switch', name]) };
  app.quit = () => {
    calls.push(['quit']); lifecycle.push(['quit']);
    if (quitting) return;
    const event = { defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
    app.emit('before-quit', event);
    if (event.defaultPrevented) { quitting = false; return; }
    for (const window of windows) window.destroy();
  };
  let lockHeld = false;
  app.hasSingleInstanceLock = () => lockHeld;
  app.requestSingleInstanceLock = data => { calls.push(['request-lock', data]); lockHeld = true; return true; };
  app.releaseSingleInstanceLock = () => { calls.push(['release-lock']); lockHeld = false; };
  const protocol = { registerSchemesAsPrivileged(value) { assert.equal(ready, false); calls.push(['schemes', value]); } };
  const session = new EventEmitter();
  session.protocol = { handle(scheme, fn) { calls.push(['handle', scheme]); this.handler = fn; },
    unhandle(scheme) { calls.push(['unhandle', scheme]); this.handler = null; } };
  session.webRequest = { onBeforeRequest(filter, fn) { calls.push(['policy', !!fn]); this.check = fn; } };
  for (const name of ['setPermissionRequestHandler', 'setPermissionCheckHandler', 'setDevicePermissionHandler', 'setDisplayMediaRequestHandler'])
    session[name] = fn => { session[name + 'Value'] = fn; };
  const ipcMain = new EventEmitter();
  ipcMain.handle = (name, fn) => { assert.equal(handles.has(name), false); handles.set(name, fn); };
  ipcMain.removeHandler = name => handles.delete(name);
  const screen = new EventEmitter(), displays = [{ id: 1, workArea: { x: 0, y: 0, width: 1920, height: 1080 } }];
  screen.getAllDisplays = () => displays;
  screen.getPrimaryDisplay = screen.getDisplayMatching = () => displays[0];
  class Window extends EventEmitter {
    constructor(options) {
      super(); assert.equal(ready, true); this.options = options; this.visible = false; this.dead = false;
      this.bounds = { x: options.x, y: options.y, width: options.width, height: options.height };
      this.webContents = Object.assign(new EventEmitter(), { mainFrame: { url: 'baijie28://app/desktop.html' },
        send: (...args) => calls.push(['send', ...args]), setFrameRate: rate => calls.push(['frameRate', rate]),
        setWindowOpenHandler: fn => { this.openHandler = fn; } });
      windows.push(this); calls.push(['window', options]);
    }
    isDestroyed() { return this.dead; }
    isVisible() { return this.visible; }
    getBounds() { return { ...this.bounds }; }
    setBounds(value) { this.bounds = { ...value }; }
    setAlwaysOnTop() {}
    setIgnoreMouseEvents() {}
    setMenu() {}
    show() { assert.equal(this.dead, false, 'A destroyed window cannot be shown'); this.visible = true; calls.push(['show']); }
    showInactive() { assert.fail('No showInactive fallback'); }
    focus() { assert.fail('No focus fallback'); }
    hide() { this.visible = false; }
    loadURL(url) {
      calls.push(['load', url]);
      if (syncLoadFailure) throw Error('fixture synchronous load failure');
      return loadFailure ? Promise.reject(Error('fixture load failure')) : loadGate || Promise.resolve();
    }
    destroy() {
      if (this.dead) return;
      this.dead = true; this.visible = false;
      calls.push(['window-destroy']); lifecycle.push(['window-destroy']); this.emit('closed');
      if (!quitting && Window.getAllWindows().length === 0) allClosed();
    }
    static getAllWindows() { return windows.filter(window => !window.isDestroyed()); }
  }
  class Tray extends EventEmitter {
    constructor(icon) { super(); calls.push(['tray', icon]); this.dead = false; }
    setToolTip() {}
    setContextMenu() {}
    isDestroyed() { return this.dead; }
    destroy() { this.dead = true; calls.push(['tray-destroy']); }
  }
  const foreignSession = new EventEmitter();
  const electron = { app, protocol, session: {
    get defaultSession() { assert.equal(ready, true); return foreignSession; },
    fromPartition(name, options) {
      assert.equal(ready, true); assert.ok(name); assert.equal(name.startsWith('persist:'), false);
      assert.deepEqual(options, { cache: false }); return session;
    } },
    BrowserWindow: Window, screen, ipcMain, Tray,
    Menu: { buildFromTemplate: template => Object.assign(new EventEmitter(), { template }) },
    globalShortcut: { register(key) { calls.push(['register', key]); return true; },
      unregister(key) { calls.push(['unregister', key]); } } };
  const clock = { setTimeout(fn) { const id = ++timer; timers.set(id, fn); return id; }, clearTimeout(id) { timers.delete(id); } };
  const env = { KEEP: 'fixture' };
  const fsImpl = { ...fs, mkdirSync(file, options) {
    assert.equal(ready, false); assert.ok(path.relative(dir, file) && !path.relative(dir, file).startsWith('..'));
    calls.push(['mkdir', file]); return fs.mkdirSync(file, options);
  } };
  const options = { electron, env, clock, fsImpl, argv: ['product.exe'], defaultApp: false };
  return { dir, appDataRoot, calls, handles, timers, windows, session, options, electron, lifecycle, flushAllClosed };
}
function start(h, extra = {}) { return require('../product-main.cjs').startProduct({ ...h.options, ...extra }); }

const drainLifecycle = async h => { h.flushAllClosed(); await new Promise(resolve => setImmediate(resolve)); };
function assertFailureCleanup(h) {
  assert.equal(h.handles.size, 0); assert.equal(h.timers.size, 0);
  assert.ok(h.windows.every(window => window.isDestroyed()));
  for (const emitter of [h.electron.app, h.electron.ipcMain, h.electron.screen, h.session, ...h.windows.map(window => window.webContents)])
    assert.equal(emitter.eventNames().length, 0, 'All owned listeners must be released after delivery');
  for (const name of ['release-lock', 'unhandle', 'unregister', 'tray-destroy', 'window-destroy'])
    assert.equal(h.calls.filter(c => c[0] === name).length, 1, name);
  assert.deepEqual(h.calls.filter(c => c[0] === 'policy').map(c => c[1]), [true, false]);
  assert.equal(h.electron.app.hasSingleInstanceLock(), false);
}

for (const allClosedDelivery of ['sync', 'microtask', 'queued']) {
  test(`lifecycle model retains no-listener default quit and before-quit ordering: ${allClosedDelivery}`, async t => {
    const h = harness(t, { appReady: true, allClosedDelivery });
    const first = new h.electron.BrowserWindow({}), last = new h.electron.BrowserWindow({});
    first.destroy(); await drainLifecycle(h);
    assert.equal(h.calls.some(c => c[0] === 'quit'), false, 'A remaining window prevents all-closed');
    last.destroy(); await drainLifecycle(h);
    assert.deepEqual(h.lifecycle.slice(-4), [['window-all-closed', 0], ['default-quit'], ['quit'], ['before-quit']]);
    const q = harness(t, { appReady: true, allClosedDelivery });
    new q.electron.BrowserWindow({});
    q.electron.app.quit(); await drainLifecycle(q);
    assert.deepEqual(q.lifecycle, [['quit'], ['before-quit'], ['window-destroy']]);
  });

  for (const stage of ['load-rejection', 'sync-setup', 'sync-load']) {
    const failureOptions = { allClosedDelivery, loadFailure: stage === 'load-rejection', syncLoadFailure: stage === 'sync-load' };
    const injectSetup = h => { if (stage === 'sync-setup') h.electron.ipcMain.handle = () => { throw Error('fixture synchronous setup failure'); }; };
    test(`M1-R1 direct visible ${stage} reports before quit with ${allClosedDelivery} all-closed`, async t => {
      const h = harness(t, failureOptions), dialogs = [];
      injectSetup(h);
      h.electron.dialog = { showErrorBox(...args) { dialogs.push(args); h.lifecycle.push(['error-box']); } };
      const invocation = evaluateEntry({ main: true, electron: h.electron, argv: ['product.exe', '--visible'] });
      await new Promise(resolve => setImmediate(resolve));
      await drainLifecycle(h);
      assert.deepEqual(dialogs, [['白姐桌宠启动失败', '白姐桌宠未能启动，请关闭后重试。若仍无法启动，请联系支持。']], 'Failure cleanup must not impersonate intentional quit');
      assert.deepEqual(invocation.messages, ['Product startup failed.']);
      assert.equal(h.calls.filter(c => c[0] === 'quit').length, 1);
      const report = h.lifecycle.findIndex(c => c[0] === 'error-box'), quit = h.lifecycle.findIndex(c => c[0] === 'quit');
      assert.ok(report >= 0 && report < quit && quit < h.lifecycle.findIndex(c => c[0] === 'before-quit'));
      assert.equal(h.lifecycle.some(c => c[0] === 'default-quit'), false);
      assert.equal(h.calls.some(c => c[0] === 'show'), false);
      assertFailureCleanup(h);
    });

    test(`M1-R1 programmatic ${stage} rejects without quit with ${allClosedDelivery} all-closed`, async t => {
      const h = harness(t, failureOptions);
      injectSetup(h);
      h.electron.dialog = { showErrorBox() { assert.fail('Programmatic caller owns reporting'); } };
      let result;
      try {
        await assert.rejects(async () => { result = await start(h); await result.ready; }, /fixture.*failure/);
        assert.equal(h.calls.filter(c => c[0] === 'quit').length, 0, 'Startup rejection must not quit its caller');
        result?.destroy(); result?.destroy();
        await drainLifecycle(h);
        assert.equal(h.calls.filter(c => c[0] === 'quit').length, 0, 'Queued last-window cleanup must not default-quit its caller');
        assert.equal(h.lifecycle.filter(c => c[0] === 'window-all-closed').length, 1, 'Do not suppress the modeled event');
        assert.equal(h.lifecycle.some(c => ['default-quit', 'before-quit'].includes(c[0])), false);
        assert.equal(h.calls.some(c => c[0] === 'show'), false);
        assertFailureCleanup(h);
        const before = h.calls.length;
        result?.destroy(); result?.destroy();
        h.electron.app.emit('second-instance', {}, [], '.', { productVisible: true });
        assert.equal(h.calls.length, before, 'Cleanup is idempotent and cannot reactivate');
      } finally { result?.destroy(); h.electron.app.emit('before-quit'); await drainLifecycle(h); }
    });
  }

  test(`successful final-window closure still quits and releases ownership once: ${allClosedDelivery}`, async t => {
    const h = harness(t, { allClosedDelivery }), result = await start(h);
    try {
      await result.ready;
      result.window.destroy(); await drainLifecycle(h);
      assert.equal(h.calls.filter(c => c[0] === 'quit').length, 1);
      assert.equal(h.lifecycle.filter(c => c[0] === 'window-all-closed').length, 1);
      assert.equal(h.lifecycle.filter(c => c[0] === 'before-quit').length, 1);
      assert.equal(h.lifecycle.some(c => c[0] === 'default-quit'), false, 'Boot owns normal last-window exit');
      assertFailureCleanup(h);
      result.destroy(); result.destroy();
      assert.equal(h.calls.filter(c => c[0] === 'release-lock').length, 1);
    } finally { result.destroy(); await drainLifecycle(h); }
  });

  test(`startup failure does not retain lifecycle control over a foreign window: ${allClosedDelivery}`, async t => {
    const h = harness(t, { allClosedDelivery, loadFailure: true }), whenReady = h.electron.app.whenReady;
    let foreign;
    h.electron.app.whenReady = () => {
      const promise = whenReady(); foreign = new h.electron.BrowserWindow({}); return promise;
    };
    await assert.rejects(async () => { const result = await start(h); await result.ready; }, /fixture load failure/);
    await drainLifecycle(h);
    assert.equal(h.calls.some(c => c[0] === 'quit'), false);
    assert.equal(foreign.isDestroyed(), false);
    assert.equal(h.electron.app.eventNames().length, 0, 'No pending all-closed delivery exists while a foreign window remains');
    assert.equal(h.calls.filter(c => c[0] === 'release-lock').length, 1);
    foreign.destroy(); await drainLifecycle(h);
    assert.equal(h.calls.filter(c => c[0] === 'quit').length, 1, 'The caller retains the default last-window policy');
    assert.equal(h.lifecycle.filter(c => c[0] === 'default-quit').length, 1);
  });

  for (const phase of ['readiness', 'load']) for (const outcome of ['resolve', 'reject']) {
    test(`intentional app.quit during ${phase} ignores late ${outcome}: ${allClosedDelivery}`, async t => {
      let resolvePending, rejectPending;
      const gate = new Promise((resolve, reject) => { resolvePending = resolve; rejectPending = reject; });
      const h = harness(t, { allClosedDelivery, ...(phase === 'load' ? { loadGate: gate } : {}) }), dialogs = [];
      if (phase === 'readiness') h.electron.app.whenReady = () => gate;
      h.electron.dialog = { showErrorBox: (...args) => dialogs.push(args) };
      const invocation = evaluateEntry({ main: true, electron: h.electron });
      await new Promise(resolve => setImmediate(resolve));
      const windowCount = h.windows.length;
      h.electron.app.quit();
      if (outcome === 'reject') rejectPending(Error('fixture late shutdown failure')); else resolvePending();
      await drainLifecycle(h);
      assert.deepEqual(dialogs, []); assert.deepEqual(invocation.messages, []);
      assert.equal(h.windows.length, windowCount, 'Intentional shutdown cannot construct a late window');
      assert.equal(h.calls.some(c => c[0] === 'show'), false);
      assert.equal(h.calls.filter(c => c[0] === 'quit').length, 1, 'No additional quit request');
      assert.equal(h.calls.filter(c => c[0] === 'release-lock').length, 1);
      assert.equal(h.electron.app.eventNames().length, 0);
      assert.ok(h.windows.every(window => window.isDestroyed()));
      assert.equal(h.handles.size, 0); assert.equal(h.timers.size, 0);
    });
  }
}

for (const allClosedDelivery of ['sync', 'queued']) for (const syncLoadFailure of [false, true]) {
  for (const [storageLayout, mode] of [['product', 'hidden'], ['candidate', 'hidden'], ['candidate', 'visible']]) {
    test(`M1-R1 ${storageLayout}/${mode} failure preserves isolation: ${allClosedDelivery}, sync=${syncLoadFailure}`, async t => {
      const h = harness(t, { allClosedDelivery, syncLoadFailure, loadFailure: !syncLoadFailure });
      for (const name of ['hasSingleInstanceLock', 'requestSingleInstanceLock', 'releaseSingleInstanceLock'])
        h.electron.app[name] = () => assert.fail('Non-product-visible failure must not touch the product lock');
      h.electron.dialog = { showErrorBox() { assert.fail('Programmatic/hidden failure must not open a dialog'); } };
      await assert.rejects(async () => {
        const result = storageLayout === 'product'
          ? await start(h, { argv: ['product.exe', '--hidden', '--profile-root', path.join(h.appDataRoot, 'BaijieDesktopV1-Tests', 'hidden-failure')] })
          : await require('../desktop-main.cjs').boot({ electron: h.electron, root, mode, env: {},
            ...(mode === 'hidden' ? { profileRoot: path.resolve(root, '../runtime/tests/failure-no-visible-lock') } : {}),
            fsImpl: { ...fs, mkdirSync() {} }, stateIO: { loadStateResult: () => ({status:'missing',value:null,reason:null}), saveState() {} }, clock: h.options.clock });
        await result.ready;
      }, /fixture.*load failure/);
      await drainLifecycle(h);
      assert.equal(h.calls.some(c => c[0] === 'quit'), false);
      assert.equal(h.calls.some(c => c[0] === 'show'), false);
      if (mode === 'hidden') assert.equal(h.calls.some(c => ['tray', 'register'].includes(c[0])), false);
      assert.equal(h.electron.app.eventNames().length, 0);
      assert.equal(h.handles.size, 0); assert.equal(h.timers.size, 0);
      assert.ok(h.windows.every(window => window.isDestroyed()));
    });
  }
}

test('secondary visible product exits without creating another shell or rescue channel', async t => {
  const h = harness(t);
  h.electron.app.requestSingleInstanceLock = () => { h.calls.push(['request-lock']); return false; };
  const result = await start(h);
  try {
    assert.equal(result.secondary, true, 'A failed lock must be a clean secondary result');
    assert.equal(h.windows.length, 0);
    assert.equal(h.calls.some(c => ['ready', 'tray', 'register', 'handle', 'show', 'release-lock'].includes(c[0])), false);
    assert.equal(h.calls.filter(c => c[0] === 'request-lock').length, 1);
    assert.equal(h.calls.filter(c => c[0] === 'quit').length, 1);
    assert.equal(h.electron.app.eventNames().length, 0);
  } finally { result.destroy?.(); }
});

for (const ending of ['destroy', 'before-quit', 'window-all-closed', 'ready-rejection', 'sync-setup', 'session-creation', 'sync-load', 'load-rejection']) {
  test(`visible primary releases only its owned lock once on ${ending}`, async t => {
    const h = harness(t, { syncLoadFailure: ending === 'sync-load', loadFailure: ending === 'load-rejection' });
    const error = Error('fixture startup failure');
    if (ending === 'ready-rejection') h.electron.app.whenReady = () => Promise.reject(error);
    if (ending === 'sync-setup') h.electron.protocol.registerSchemesAsPrivileged = () => { throw error; };
    if (ending === 'session-creation') h.electron.session.fromPartition = () => { throw error; };
    let result;
    try {
      if (['destroy', 'before-quit', 'window-all-closed'].includes(ending)) {
        result = await start(h); await result.ready;
        assert.equal(h.electron.app.hasSingleInstanceLock(), true);
        if (ending === 'destroy') result.destroy(); else h.electron.app.emit(ending);
      } else await assert.rejects(async () => { result = await start(h); await result.ready; }, /fixture.*failure/);
      assert.equal(h.calls.filter(c => c[0] === 'release-lock').length, 1, 'Owned lock must be released on every terminal path');
      assert.equal(h.electron.app.hasSingleInstanceLock(), false);
      result?.destroy(); h.electron.app.emit('before-quit');
      assert.equal(h.calls.filter(c => c[0] === 'release-lock').length, 1);
      assert.equal(h.electron.app.eventNames().length, 0);
      assert.equal(h.handles.size, 0); assert.equal(h.timers.size, 0);
      assert.ok(h.windows.every(window => window.isDestroyed()));
    } finally { result?.destroy(); h.electron.app.emit('before-quit'); }
  });
}

test('pre-ready quit releases the product lock immediately and cannot create a late shell', async t => {
  const h = harness(t), whenReady = h.electron.app.whenReady;
  let releaseReady;
  h.electron.app.whenReady = () => new Promise(resolve => { releaseReady = () => whenReady().then(resolve); });
  const pending = start(h);
  t.after(async () => { releaseReady(); (await pending).destroy?.(); });
  h.electron.app.emit('before-quit');
  try {
    assert.equal(h.calls.filter(c => c[0] === 'release-lock').length, 1);
  } finally { releaseReady(); }
  const result = await pending;
  try {
    assert.equal(result.cancelled, true);
    assert.equal(h.windows.length, 0);
    assert.equal(h.calls.some(c => ['tray', 'register', 'handle', 'show'].includes(c[0])), false);
    assert.equal(h.electron.app.eventNames().length, 0);
  } finally { result.destroy?.(); }
});

for (const boundary of ['missing-query', 'missing-request', 'missing-release', 'preowned', 'query-failure', 'acquisition-failure', 'invalid-acquisition']) {
  test(`visible lock boundary fails closed without releasing foreign ownership: ${boundary}`, async t => {
    const h = harness(t), app = h.electron.app, failure = Error('fixture lock failure');
    if (boundary === 'missing-query') delete app.hasSingleInstanceLock;
    if (boundary === 'missing-request') delete app.requestSingleInstanceLock;
    if (boundary === 'missing-release') delete app.releaseSingleInstanceLock;
    if (boundary === 'preowned') app.hasSingleInstanceLock = () => true;
    if (boundary === 'query-failure') app.hasSingleInstanceLock = () => { throw failure; };
    if (boundary === 'acquisition-failure') app.requestSingleInstanceLock = () => { throw failure; };
    if (boundary === 'invalid-acquisition') app.requestSingleInstanceLock = () => undefined;
    let result;
    try {
      await assert.rejects(async () => { result = await start(h); await result.ready; }, /lock|instance/i);
      assert.equal(h.windows.length, 0);
      assert.equal(h.calls.some(c => ['release-lock', 'ready', 'tray', 'register', 'quit'].includes(c[0])), false);
      if (!['acquisition-failure', 'invalid-acquisition'].includes(boundary)) {
        assert.equal(h.calls.some(c => ['mkdir', 'name', 'path', 'logs', 'request-lock'].includes(c[0])), false);
        assert.deepEqual(h.options.env, { KEEP: 'fixture' });
      }
      assert.equal(app.eventNames().length, 0);
    } finally { result?.destroy?.(); app.emit('before-quit'); }
  });
}

test('hidden product and both candidate modes never inspect or acquire the visible product lock', async t => {
  for (const [storageLayout, mode] of [['product', 'hidden'], ['candidate', 'hidden'], ['candidate', 'visible']]) {
    const h = harness(t);
    for (const name of ['hasSingleInstanceLock', 'requestSingleInstanceLock', 'releaseSingleInstanceLock'])
      h.electron.app[name] = () => assert.fail('Non-product-visible entry must not touch single-instance APIs');
    let result;
    try {
      if (storageLayout === 'product') result = await start(h, { argv: ['product.exe', '--hidden', '--profile-root', path.join(h.appDataRoot, 'BaijieDesktopV1-Tests', 'hidden')] });
      else result = await require('../desktop-main.cjs').boot({ electron: h.electron, root, mode, env: {},
        ...(mode === 'hidden' ? { profileRoot: path.resolve(root, '../runtime/tests/no-visible-lock') } : {}),
        fsImpl: { ...fs, mkdirSync() {} }, stateIO: { loadStateResult: () => ({status:'missing',value:null,reason:null}), saveState() {} }, clock: h.options.clock });
      await result.ready;
      assert.equal(h.electron.app.listenerCount('second-instance'), 0);
      const before = h.calls.length;
      h.electron.app.emit('second-instance', {}, ['product.exe'], '.', { productVisible: true });
      assert.equal(h.calls.length, before);
    } finally { result?.destroy(); }
  }
});

test('second visible instance coalesces until real shell load then restores only that shell', async t => {
  let releaseLoad, releaseReady;
  const h = harness(t, { loadGate: new Promise(resolve => { releaseLoad = resolve; }) });
  const whenReady = h.electron.app.whenReady;
  h.electron.app.whenReady = () => new Promise(resolve => { releaseReady = () => whenReady().then(resolve); });
  const pending = start(h), app = h.electron.app;
  const activate = () => app.emit('second-instance', {}, ['https://untrusted.invalid', '--profile-root', 'untrusted'], 'untrusted', { productVisible: true });
  t.after(async () => { releaseReady(); releaseLoad(); (await pending).destroy(); });
  assert.deepEqual(h.calls.find(c => c[0] === 'request-lock')[1], { productVisible: true });
  activate(); activate(); activate();
  assert.equal(h.windows.length, 0);
  releaseReady(); const result = await pending;
  try {
    activate(); activate();
    assert.equal(h.calls.filter(c => c[0] === 'show').length, 0, 'Never show before load ready');
    releaseLoad(); await result.ready;
    assert.equal(h.calls.filter(c => c[0] === 'show').length, 2, 'Startup show plus one coalesced activation');
    result.shell.setClickThrough(true); result.shell.hide();
    assert.equal(result.window.isVisible(), false);
    activate();
    assert.equal(result.window.isVisible(), true);
    assert.equal(result.shell.snapshot().clickThrough, false);
    assert.equal(h.windows.length, 1);
    for (const action of ['tray', 'register', 'load']) assert.equal(h.calls.filter(c => c[0] === action).length, 1);
    assert.deepEqual(h.calls.find(c => c[0] === 'load'), ['load', 'baijie28://app/desktop.html']);
    result.shell.hide();
    for (const data of [undefined, null, {}, { productVisible: false }, { productVisible: 'true' }, { productVisible: true, mode: 'hidden' }])
      app.emit('second-instance', {}, ['product.exe', '--visible'], '.', data);
    assert.equal(result.window.isVisible(), false, 'Unmarked/invalid senders must not activate');
    const stale = app.listeners('second-instance')[0];
    result.destroy(); const before = h.calls.length;
    activate(); stale({}, [], '.', { productVisible: true });
    assert.equal(h.calls.length, before, 'Stale callbacks cannot resurrect a cleaned shell');
  } finally { result.destroy(); }
});

test('queued activation is discarded if quit happens during shell load', async t => {
  let releaseLoad;
  const h = harness(t, { loadGate: new Promise(resolve => { releaseLoad = resolve; }) });
  const result = await start(h), app = h.electron.app;
  try {
    app.emit('second-instance', {}, [], '.', { productVisible: true });
    assert.equal(app.listenerCount('second-instance'), 1);
    app.emit('before-quit'); releaseLoad(); await result.ready;
    assert.equal(h.calls.some(c => c[0] === 'show'), false);
    assert.equal(h.calls.filter(c => c[0] === 'release-lock').length, 1);
    assert.equal(app.listenerCount('second-instance'), 0);
    assert.equal(result.window.isDestroyed(), true);
  } finally { releaseLoad(); result.destroy(); }
});

for (const stage of ['path', 'dependency', 'readiness', 'load', 'dialog']) {
  test(`direct normal product entry gives fixed sanitized feedback and quits on ${stage} failure`, async t => {
    const h = harness(t, { loadFailure: stage === 'load' }), secret = 'SECRET argv env error path <img>';
    const dialogs = [];
    h.electron.dialog = { showErrorBox(...args) { dialogs.push(args); if (stage === 'dialog') throw Error(secret); } };
    if (['path', 'dialog'].includes(stage)) h.electron.app.getPath = () => { throw Error(secret); };
    if (stage === 'readiness') h.electron.app.whenReady = () => Promise.reject(Error(secret));
    let invocation;
    assert.doesNotThrow(() => { invocation = evaluateEntry({ main: true, electron: h.electron,
      ...(stage === 'dependency' ? { dependencyFailure: Error(secret) } : {}) }); }, 'Direct entry must catch early dependency failure');
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(dialogs, [['白姐桌宠启动失败', '白姐桌宠未能启动，请关闭后重试。若仍无法启动，请联系支持。']], stage);
    assert.deepEqual(invocation.messages, ['Product startup failed.']);
    assert.equal(h.calls.filter(c => c[0] === 'quit').length, 1);
    assert.ok(h.windows.every(window => window.isDestroyed()));
    assert.equal(h.handles.size, 0); assert.equal(h.electron.app.eventNames().length, 0);
  });
}

test('hidden or ambiguous entry arguments never cause a native error dialog or leak raw inputs', async t => {
  for (const args of [
    ['--hidden'], ['--hidden', '--profile-root', 'SECRET'], ['--visible', '--hidden'], ['--visible', '--visible'],
    ['--visible', '--unknown-SECRET'], ['--visible=SECRET'], ['--profile-root', '--hidden'], ['SECRET'],
  ]) {
    const h = harness(t), dialogs = [];
    h.electron.dialog = { showErrorBox: (...values) => dialogs.push(values) };
    const invocation = evaluateEntry({ main: true, electron: h.electron, argv: ['product.exe', ...args] });
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(dialogs, []); assert.equal(h.windows.length, 0);
    assert.deepEqual(invocation.messages, ['Product startup failed.']);
    assert.equal(h.calls.filter(c => c[0] === 'quit').length, 1);
  }
  const h = harness(t), expected = Error('programmatic original');
  h.electron.app.getPath = () => { throw expected; };
  h.electron.dialog = { showErrorBox() { assert.fail('Programmatic callers own error reporting'); } };
  await assert.rejects(async () => start(h), error => error === expected);
});

test('direct mode classification is conservative for valid hidden, defaultApp and malformed argv', async t => {
  const cases = [
    { argv: ['product.exe', '--visible'], defaultApp: false, visible: true },
    { argv: ['electron.exe', 'app'], defaultApp: true, visible: true },
    { argv: ['electron.exe', 'app', '--visible'], defaultApp: true, visible: true },
    { argv: [], defaultApp: false, visible: false },
    { argv: ['product.exe'], defaultApp: true, visible: false },
    { argv: ['product.exe'], defaultApp: 'false', visible: false },
    { argv: ['--hidden'], defaultApp: false, visible: false },
    { argv: ['product.exe', null], defaultApp: false, visible: false },
  ];
  for (const options of cases) {
    const h = harness(t), dialogs = [];
    h.electron.dialog = { showErrorBox: (...args) => dialogs.push(args) };
    h.electron.app.getPath = () => { throw Error('SECRET path'); };
    const invocation = evaluateEntry({ main: true, electron: h.electron, ...options });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(dialogs.length, options.visible ? 1 : 0);
    assert.deepEqual(invocation.messages, ['Product startup failed.']);
    assert.equal(h.calls.filter(c => c[0] === 'quit').length, 1);
  }
  const hidden = harness(t), dialogs = [], failure = Error('SECRET hidden startup');
  hidden.electron.app.whenReady = () => Promise.reject(failure);
  hidden.electron.dialog = { showErrorBox: (...args) => dialogs.push(args) };
  const argv = ['product.exe', '--hidden', '--profile-root', path.join(hidden.appDataRoot, 'BaijieDesktopV1-Tests', 'valid-hidden')];
  const invocation = evaluateEntry({ main: true, electron: hidden.electron, argv });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(dialogs, []); assert.deepEqual(invocation.messages, ['Product startup failed.']);
  assert.equal(hidden.calls.some(c => ['request-lock', 'release-lock', 'tray', 'register', 'show'].includes(c[0])), false);
  assert.equal(hidden.electron.app.eventNames().length, 0);
  const imported = evaluateEntry({ dependencyFailure: Error('Must not load startup dependency on import') });
  assert.equal(typeof imported.exports.startProduct, 'function');
});

for (const phase of ['readiness', 'load']) test(`direct quit during ${phase} cannot resurrect a late failure dialog`, async t => {
  let rejectPending;
  const gate = new Promise((_resolve, reject) => { rejectPending = reject; });
  const h = harness(t, phase === 'load' ? { loadGate: gate } : {}), dialogs = [];
  if (phase === 'readiness') h.electron.app.whenReady = () => gate;
  h.electron.dialog = { showErrorBox: (...args) => dialogs.push(args) };
  const invocation = evaluateEntry({ main: true, electron: h.electron });
  await new Promise(resolve => setImmediate(resolve));
  h.electron.app.emit('before-quit');
  rejectPending(Error('fixture aborted during shutdown'));
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(dialogs, [], 'An intentional shutdown must never reopen UI');
  assert.deepEqual(invocation.messages, []);
  assert.equal(h.calls.filter(c => c[0] === 'quit').length, 0, 'Do not request another quit while quitting');
  assert.equal(h.calls.filter(c => c[0] === 'release-lock').length, 1);
  assert.equal(h.calls.some(c => c[0] === 'show'), false);
  assert.equal(h.electron.app.eventNames().length, 0);
});

test('quit before direct startup microtask prevents every later startup side effect', async t => {
  const h = harness(t), dialogs = [];
  h.electron.dialog = { showErrorBox: (...args) => dialogs.push(args) };
  const invocation = evaluateEntry({ main: true, electron: h.electron });
  h.electron.app.emit('before-quit');
  await new Promise(resolve => setImmediate(resolve));
  try {
    assert.deepEqual(h.calls, [], 'A cancelled scheduled startup must not configure paths, lock or create a window');
    assert.deepEqual(invocation.messages, []); assert.deepEqual(dialogs, []);
    assert.equal(h.electron.app.eventNames().length, 0);
  } finally { h.electron.app.emit('before-quit'); }
});

test('direct secondary exits normally without error logs or a failure dialog', async t => {
  const h = harness(t), dialogs = [];
  h.electron.app.requestSingleInstanceLock = () => false;
  h.electron.dialog = { showErrorBox: (...args) => dialogs.push(args) };
  const invocation = evaluateEntry({ main: true, electron: h.electron });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(invocation.messages, []); assert.deepEqual(dialogs, []);
  assert.equal(h.windows.length, 0); assert.equal(h.calls.filter(c => c[0] === 'quit').length, 1);
});

test('default product boot reaches the real visible shell with a separate data tree', async t => {
  const h = harness(t);
  assert.equal(typeof require('../product-main.cjs').startProduct, 'function', 'Product start function must exist');
  const pending = start(h);
  assert.ok(pending instanceof Promise);
  const result = await pending;
  try {
    assert.equal(await result.ready, result.window);
    assert.equal(result.loadPromise, result.ready);
    assert.equal(result.window, result.shell.window);
    assert.equal(result.shell.snapshot().mode, 'visible');
    assert.equal(result.window.isVisible(), true);
    assert.equal(result.window.options.webPreferences.offscreen, false);
    assert.equal(result.paths.profileRoot, path.join(h.appDataRoot, 'BaijieDesktopV1'));
    result.shell.save();
    const state = JSON.parse(fs.readFileSync(path.join(result.paths.profileRoot, 'window-state.json'), 'utf8'));
    assert.equal(state.version, 1);
    assert.equal(state.size, 'medium');
    assert.equal(h.session.protocol.handler({ method: 'GET', url: 'baijie28://app/desktop.html' }).status, 200);
  } finally { result.destroy(); }
  assert.equal(h.handles.size, 0);
  assert.equal(h.timers.size, 0);
  assert.equal(h.electron.app.eventNames().length, 0);
});

test('product argv uses defaultApp slicing and hidden always needs an explicit test profile', async t => {
  for (const defaultApp of [true, false]) {
    for (const flags of ['hidden', 'visible', 'default']) {
      const h = harness(t), profile = path.join(h.appDataRoot, 'BaijieDesktopV1-Tests', 'case');
      h.electron.app.isPackaged = defaultApp; // Intentionally contradicts the launch form.
      const prefix = defaultApp ? ['electron.exe', 'some app'] : ['product.exe'];
      const args = flags === 'hidden' ? ['--hidden', '--profile-root', profile] : flags === 'visible' ? ['--visible'] : [];
      const result = await start(h, { argv: [...prefix, ...args], defaultApp });
      try {
        await result.ready;
        assert.equal(result.shell.snapshot().mode, flags === 'hidden' ? 'hidden' : 'visible');
        assert.equal(result.window.isVisible(), flags !== 'hidden');
        assert.equal(result.window.options.webPreferences.preload, path.join(root, 'desktop-preload.cjs'));
        assert.equal(result.paths.profileRoot, flags === 'hidden' ? profile : path.join(h.appDataRoot, 'BaijieDesktopV1'));
        if (flags === 'hidden') {
          result.shell.show(); result.shell.reset();
          assert.equal(h.calls.some(c => ['show', 'tray', 'register'].includes(c[0])), false);
        }
      } finally { result.destroy(); }
    }
  }
  for (const args of [
    ['--hidden'], ['--hidden', '--hidden'], ['--visible', '--hidden'], ['--visible', '--visible'],
    ['--profile-root', 'fixture'], ['--hidden', '--profile-root'], ['--visible', '--profile-root', 'fixture'],
    ['--hidden', '--profile-root', 'fixture', '--profile-root', 'fixture'], ['--remote-debugging-port=1234'],
    ['--app-data-root', 'fixture'], ['--unknown'], ['--'], ['extra-positional'],
  ]) {
    const h = harness(t);
    await assert.rejects(async () => {
      const result = await start(h, { argv: ['product.exe', ...args] });
      result.destroy();
    }, /argument|profile|mode|flags/i);
    assert.deepEqual(h.calls, [], 'Invalid CLI must fail before getPath, writes, identity or ready');
  }
  assert.deepEqual(require('../desktop-main.cjs').parseArgs([]), { mode: 'hidden' });
});
test('product identity and all data paths are configured before app readiness', async t => {
  const h = harness(t), result = await start(h);
  try {
    await result.ready;
    const readyAt = h.calls.findIndex(c => c[0] === 'ready');
    assert.deepEqual(h.calls.filter(c => c[0] === 'name'), [['name', 'BaijieDesktopV1']]);
    assert.ok(h.calls.findIndex(c => c[0] === 'name') < readyAt);
    for (const name of ['userData', 'sessionData', 'temp']) {
      const at = h.calls.findIndex(c => c[0] === 'path' && c[1] === name);
      assert.ok(at >= 0 && at < readyAt, name);
      assert.equal(h.calls[at][2], path.join(result.paths.profileRoot, name));
      assert.equal(fs.statSync(result.paths[name]).isDirectory(), true);
    }
    assert.deepEqual(h.calls.find(c => c[0] === 'logs'), ['logs', result.paths.logs]);
    assert.ok(h.calls.findIndex(c => c[0] === 'logs') < readyAt);
    assert.deepEqual(h.calls.filter(c => c[0] === 'getPath'), [['getPath', 'appData']]);
  } finally { result.destroy(); }
  const late = harness(t, { appReady: true });
  await assert.rejects(async () => start(late), /before.*ready/i);
  assert.deepEqual(late.calls, [['getPath', 'appData']]);
});
test('product boot removes inherited injection variables before readiness', async t => {
  const h = harness(t);
  Object.assign(h.options.env, { NODE_OPTIONS: 'fixture', node_path: 'fixture', ELECTRON_RUN_AS_NODE: 'fixture',
    ELECTRON_EXTRA_LAUNCH_ARGS: 'fixture', electron_extra_launch_args: 'fixture', PUPPET_PAGE: 'fixture',
    puppet_anything: 'fixture', TEMP: 'old', Tmp: 'old', tmpdir: 'old' });
  const whenReady = h.electron.app.whenReady;
  h.electron.app.whenReady = () => {
    assert.deepEqual(Object.keys(h.options.env).sort(), ['KEEP', 'TEMP', 'TMP', 'TMPDIR']);
    for (const name of ['TEMP', 'TMP', 'TMPDIR'])
      assert.equal(h.options.env[name], path.join(h.appDataRoot, 'BaijieDesktopV1', 'temp'));
    return whenReady();
  };
  const result = await start(h);
  try { await result.ready; assert.equal(h.options.env.KEEP, 'fixture'); }
  finally { result.destroy(); }
});
test('direct product invocation runs the same startup path and fails closed on entry errors', async t => {
  for (const bad of [false, true]) {
    const h = harness(t);
    const invocation = evaluateEntry({ main: true, electron: h.electron,
      argv: ['product.exe', ...(bad ? ['--unknown'] : [])] });
    try {
      await new Promise(resolve => setImmediate(resolve));
      if (bad) {
        assert.equal(h.windows.length, 0);
        assert.deepEqual(h.calls, [['quit']]);
        assert.equal(invocation.messages.length, 1);
        assert.match(invocation.messages[0], /startup failed/i);
      } else {
        assert.equal(h.windows.length, 1, 'Executable entry must call startProduct');
        assert.equal(h.windows[0].isVisible(), true);
        assert.deepEqual(h.calls.find(c => c[0] === 'name'), ['name', 'BaijieDesktopV1']);
        assert.equal(invocation.messages.length, 0);
      }
    } finally { h.electron.app.emit('before-quit'); }
    assert.equal(h.handles.size, 0);
  }
});
test('package metadata selects the product entry without claiming a release version', () => {
  const file = path.join(root, 'package.json');
  assert.ok(fs.existsSync(file), 'Product package metadata must exist');
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), {
    name: 'baijie-desktop-v1', version: '0.0.0-m0', private: true, main: 'product-main.cjs',
  });
  assert.equal(require(root).startProduct, require('../product-main.cjs').startProduct);
});
test('product callers cannot override the fixed resource root or internal storage policy', async t => {
  for (const extra of [
    { root: path.dirname(root) }, { appDataRoot: 'external' }, { profileRoot: 'external' },
    { storageLayout: 'candidate' }, { mode: 'hidden' }, { createShellImpl() { assert.fail('No shell substitution'); } },
  ]) {
    const h = harness(t);
    await assert.rejects(async () => { const r = await start(h, extra); r.destroy(); }, /option|root|layout/i);
    assert.deepEqual(h.calls, []);
  }
});
test('product path syntax is rejected before normalization or any write', t => {
  const h = harness(t), { configurePaths } = require('../desktop-main.cjs');
  const base = { app: h.electron.app, root, storageLayout: 'product', appDataRoot: h.appDataRoot, mode: 'hidden',
    profileRoot: path.join(h.appDataRoot, 'BaijieDesktopV1-Tests', 'case'), env: {} };
  const testsRoot = path.join(h.appDataRoot, 'BaijieDesktopV1-Tests');
  const variants = [
    { profileRoot: `${testsRoot}/unused/../case` }, { profileRoot: `${testsRoot}/ads:stream/../case` },
    { profileRoot: `${testsRoot}/bad./../case` }, { profileRoot: `${testsRoot}/bad /case` },
    { profileRoot: `${testsRoot}/bad\u0001/case` }, { profileRoot: `${testsRoot}/bad\u007f/case` },
    { profileRoot: `${testsRoot}/NUL/case` }, { profileRoot: `${testsRoot}/bad?/case` },
    { profileRoot: `${testsRoot}/bad\u0000/case` }, { profileRoot: 'relative' },
    { appDataRoot: `${h.appDataRoot}/bad./..` }, { appDataRoot: `${h.appDataRoot}/ads:stream/..` },
    { appDataRoot: `${h.appDataRoot}/bad\u0001/..` }, { appDataRoot: 'relative' },
    { root: `${root}/discard/..` }, { root: `${root}/.` },
    ...(process.platform === 'win32' ? [{ appDataRoot: '\\root-relative' }, { appDataRoot: '\\\\?\\C:\\data' }] : []),
  ];
  for (const variant of variants) {
    const writes = [], fsImpl = { lstatSync: () => ({ isSymbolicLink: () => false }), mkdirSync: p => writes.push(p) };
    h.calls.length = 0;
    assert.throws(() => configurePaths({ ...base, ...variant, fsImpl }), /path|root|absolute|unsafe/i, JSON.stringify(variant));
    assert.deepEqual(writes, []);
    assert.deepEqual(h.calls, []);
  }
});
test('product resource and app-data trees reject overlap in either ancestor direction', t => {
  const h = harness(t), { configurePaths } = require('../desktop-main.cjs');
  for (const appDataRoot of [root, path.join(root, 'data'), path.dirname(root)]) {
    const writes = [], fsImpl = { lstatSync: () => ({ isSymbolicLink: () => false }), mkdirSync: p => writes.push(p) };
    assert.throws(() => configurePaths({ app: h.electron.app, root, mode: 'visible', storageLayout: 'product',
      appDataRoot, env: {}, fsImpl }), /overlap|resource.*data/i);
    assert.deepEqual(writes, []);
    assert.deepEqual(h.calls, []);
  }
});
test('storage layouts fail closed and cannot reuse production, test or legacy profiles', t => {
  const h = harness(t), { validateProfile } = require('../resource-policy.cjs');
  for (const storageLayout of ['prodcut', '', null, 1])
    assert.throws(() => validateProfile({ root, mode: 'visible', storageLayout, appDataRoot: h.appDataRoot }), /layout/i);
  const production = path.join(h.appDataRoot, 'BaijieDesktopV1');
  const testRoot = path.join(h.appDataRoot, 'BaijieDesktopV1-Tests');
  const legacyVisible = path.resolve(root, '../runtime/interactive');
  const legacyTest = path.resolve(root, '../runtime/tests/legacy');
  const productTest = path.join(testRoot, 'independent');
  const cases = [
    { storageLayout: 'product', mode: 'hidden', profileRoot: production },
    { storageLayout: 'product', mode: 'hidden', profileRoot: testRoot },
    { storageLayout: 'product', mode: 'hidden', profileRoot: `${testRoot}-other/case` },
    { storageLayout: 'product', mode: 'hidden', profileRoot: legacyTest },
    { storageLayout: 'product', mode: 'hidden', profileRoot: legacyVisible },
    { storageLayout: 'product', mode: 'visible', profileRoot: productTest },
    { storageLayout: 'product', mode: 'visible', profileRoot: legacyVisible },
    { storageLayout: 'candidate', mode: 'visible', profileRoot: production },
    { storageLayout: 'candidate', mode: 'hidden', profileRoot: productTest },
    { storageLayout: 'candidate', mode: 'hidden', profileRoot: production },
  ];
  for (const options of cases) {
    assert.throws(() => validateProfile({ root, appDataRoot: h.appDataRoot, ...options }), /profile|path/i);
    assert.throws(() => require('../shell.cjs').createShell({ electron: {}, root, appDataRoot: h.appDataRoot, ...options }), /profile|path/i);
  }
  assert.equal(validateProfile({ root, storageLayout: 'product', mode: 'hidden', appDataRoot: h.appDataRoot, profileRoot: productTest }), productTest);
  assert.equal(validateProfile({ root, mode: 'visible' }), legacyVisible);
  assert.equal(validateProfile({ root, mode: 'hidden', profileRoot: legacyTest }), legacyTest);
});
test('product rejects linked storage components before mkdir or app changes', async t => {
  for (const component of ['window-state.json', 'appData', 'profile', 'userData', 'sessionData', 'logs', 'temp', 'resource-root']) {
    const h = harness(t), profile = path.join(h.appDataRoot, 'BaijieDesktopV1');
    if (component === 'resource-root') {
      const lstat = h.options.fsImpl.lstatSync;
      h.options.fsImpl.lstatSync = file => file === root ? { isSymbolicLink: () => true } : lstat(file);
    } else {
      const target = path.join(h.dir, 'link-target'); fs.mkdirSync(target);
      const linked = component === 'appData' ? h.appDataRoot : component === 'profile' ? profile : path.join(profile, component);
      fs.mkdirSync(path.dirname(linked), { recursive: true });
      fs.symlinkSync(target, linked, process.platform === 'win32' ? 'junction' : 'dir');
    }
    await assert.rejects(async () => start(h), /symlink|junction/i);
    assert.deepEqual(h.calls, [['getPath', 'appData']], component);
    assert.equal(h.windows.length, 0);
  }
});
test('product preflights resource links including preload before data writes', async t => {
  for (const relative of ['src', 'desktop-preload.cjs', 'shared/tray.png', 'assets/baijie-body.png']) {
    const h = harness(t), linked = path.join(root, relative), lstat = h.options.fsImpl.lstatSync;
    h.options.fsImpl.lstatSync = file => file === linked ? { isSymbolicLink: () => true } : lstat(file);
    await assert.rejects(async () => { const r = await start(h); r.destroy(); }, /symlink|junction/i);
    assert.deepEqual(h.calls, [['getPath', 'appData']], relative);
  }
});
test('startup load errors clean the real shell and policy ownership exactly once', async t => {
  for (const options of [{ syncLoadFailure: true }, { loadFailure: true }]) {
    const h = harness(t, options);
    try {
      await assert.rejects(async () => {
        const result = await start(h); await result.ready;
      }, /fixture.*load failure/);
      assert.equal(h.windows.length, 1);
      assert.equal(h.windows[0].isDestroyed(), true, 'Failed constructor path must destroy its native window');
      assert.equal(h.handles.size, 0);
      assert.equal(h.timers.size, 0);
      for (const emitter of [h.electron.app, h.electron.ipcMain, h.electron.screen, h.windows[0].webContents, h.session])
        assert.equal(emitter.eventNames().length, 0);
      assert.deepEqual(h.calls.filter(c => c[0] === 'policy').map(c => c[1]), [true, false]);
      for (const action of ['unhandle', 'tray-destroy', 'unregister', 'window-destroy'])
        assert.equal(h.calls.filter(c => c[0] === action).length, 1, action);
      assert.equal(h.calls.some(c => c[0] === 'show'), false);
    } finally { h.electron.app.emit('before-quit'); }
  }
});
test('malformed programmatic argv cannot bypass entry validation', async t => {
  for (const extra of [
    { argv: [] }, { argv: ['product.exe'], defaultApp: true }, { argv: 'product.exe' },
    { argv: [null] }, { argv: ['product.exe', 3] }, { argv: ['product.exe', , '--visible'] },
    { argv: [''] }, { argv: ['--hidden'] }, { defaultApp: 'false' }, { defaultApp: null },
    { electron: null },
  ]) {
    const h = harness(t);
    await assert.rejects(async () => { const r = await start(h, extra); r.destroy(); }, /argv|defaultApp|electron|argument/i);
    assert.deepEqual(h.calls, []);
  }
});
test('native shell setup failure cleans partial ownership without removing an existing IPC handler', async t => {
  const h = harness(t), existing = () => 'existing handler';
  h.handles.set('desktop:get-state', existing);
  h.electron.ipcMain.handle = () => { throw Error('fixture native setup failure'); };
  try {
    await assert.rejects(async () => start(h), /fixture native setup failure/);
    assert.equal(h.windows[0].isDestroyed(), true);
    assert.equal(h.handles.get('desktop:get-state'), existing);
    assert.equal(h.timers.size, 0);
    assert.equal(h.electron.ipcMain.eventNames().length, 0);
    assert.equal(h.electron.screen.eventNames().length, 0);
    assert.equal(h.electron.app.eventNames().length, 0);
    for (const action of ['unhandle', 'tray-destroy', 'unregister', 'window-destroy'])
      assert.equal(h.calls.filter(c => c[0] === action).length, 1, action);
  } finally { h.electron.app.emit('before-quit'); }
});
// Regression of the module-relative resource contract already exercised above.
// No new implementation is needed for relocation; native GPU verification is separate.
test('relocated real modules keep resources local and data independent of cwd', async t => {
  const h = harness(t), moved = path.join(h.dir, '中文 空格', 'resources', 'app');
  const manifest = require('../assets/manifest.json');
  const files = ['product-main.cjs', 'package.json', 'desktop-main.cjs', 'resource-policy.cjs', 'shell.cjs',
    'desktop-preload.cjs', 'desktop.html', 'desktop.css', 'shared/window-state.js', 'shared/resize-geometry.js',
    'shared/ipc-policy.js', 'shared/tray.png', 'assets/manifest.json',
    'assets/baijie-arm-screen-left.mesh.json', 'assets/baijie-arm-screen-right.mesh.json',
    ...manifest.interaction.skirts.parts.map(part => `assets/${part.mesh}`),
    ...['desktop-bootstrap', 'desktop-view', 'character-renderer', 'desktop-runtime', 'character', 'director', 'material-rig', 'view', 'hit-test'].map(name => `src/${name}.js`),
    ...Object.keys(manifest.images).map(name => `assets/${name}`)];
  for (const relative of files) {
    const dest = path.join(moved, relative);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(path.join(root, relative), dest);
  }
  const hash = file => require('node:crypto').createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  const fingerprints = () => files.map(name => [name, hash(path.join(moved, name))]);
  const before = fingerprints(), cwd = process.cwd();
  let result;
  try {
    process.chdir(h.dir);
    result = await require(moved).startProduct(h.options);
    await result.ready;
    assert.equal(result.window.options.webPreferences.preload, path.join(moved, 'desktop-preload.cjs'));
    assert.deepEqual(h.calls.find(c => c[0] === 'tray'), ['tray', path.join(moved, 'shared/tray.png')]);
    assert.equal(result.paths.profileRoot, path.join(h.appDataRoot, 'BaijieDesktopV1'));
    const response = h.session.protocol.handler({ method: 'GET', url: 'baijie28://app/desktop.html' });
    assert.equal(await response.text(), fs.readFileSync(path.join(moved, 'desktop.html'), 'utf8'));
    const policy = require(path.join(moved, 'resource-policy.cjs'));
    assert.equal(policy.resolveResource('baijie28://app/src/director.js', moved), path.join(moved, 'src/director.js'));
    assert.throws(() => policy.validateProfile({ root, mode: 'visible', storageLayout: 'product', appDataRoot: h.appDataRoot }), /root/i);
  } finally { result?.destroy(); process.chdir(cwd); }
  assert.deepEqual(fingerprints(), before, 'Startup must not write into relocated resources');
});
test('pre-ready filesystem errors cannot continue to identity, policy or a window', async t => {
  for (const stage of ['inspect', 'mkdir']) {
    const h = harness(t), original = h.options.fsImpl.lstatSync;
    if (stage === 'inspect') h.options.fsImpl.lstatSync = file => {
      if (file === h.appDataRoot) throw Object.assign(Error('fixture inspection failure'), { code: 'EACCES' });
      return original(file);
    };
    else h.options.fsImpl.mkdirSync = () => { throw Error('fixture mkdir failure'); };
    await assert.rejects(async () => start(h), /fixture.*failure/);
    assert.deepEqual(h.calls, [['getPath', 'appData']]);
    assert.deepEqual(h.options.env, { KEEP: 'fixture' });
    assert.equal(h.windows.length, 0);
  }
});
