'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { configurePaths, boot } = require('../desktop-main.cjs');
const { startProduct } = require('../product-main.cjs');
const policy = require('../resource-policy.cjs');
const root = path.resolve(__dirname, '..');

function fixture(t) {
  const scratch = process.env.TMPDIR;
  assert.match(scratch.replaceAll('\\', '/'), /hermes\/cache\/scratch\/baijie28-shell-tests$/);
  const parent = process.env.BAIJIE_FIX_FIXTURE || scratch;
  const relative = path.relative(scratch, parent);
  assert.ok(relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative)));
  const dir = fs.mkdtempSync(path.join(parent, 'regression-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
function config(appDataRoot, fsOverrides = {}) {
  const calls = [], env = { KEEP: 'fixture', TEMP: 'untouched', PUPPET_PAGE: 'fixture' };
  const app = new EventEmitter();
  app.isReady = () => false;
  for (const method of ['setName', 'setPath', 'setAppLogsPath'])
    app[method] = (...args) => calls.push([method, ...args]);
  const fsImpl = { ...fs, mkdirSync: (...args) => calls.push(['mkdir', ...args]), ...fsOverrides };
  return { calls, options: { app, root, appDataRoot, mode: 'visible', storageLayout: 'product', env, fsImpl } };
}
function rejectUnchanged(h, pattern) {
  const before = { ...h.options.env };
  assert.throws(() => configurePaths(h.options), pattern);
  assert.deepEqual(h.calls, [], 'No mkdir, identity, path or log mutation before rejection');
  assert.deepEqual(h.options.env, before, 'Rejected startup must not change TEMP or injection environment');
}

test('S1 real Windows short resource alias cannot become product appData (including missing tail)', async t => {
  // The runner queries GetShortPathNameW without changing volume settings.
  // Without that metadata this portable test still exercises the lexical cases;
  // the evidence runner records whether an actual distinct alias was exercised.
  const alias = process.env.BAIJIE_FIX_RESOURCE_ALIAS || root;
  assert.equal(fs.realpathSync.native(alias), fs.realpathSync.native(root));
  t.diagnostic(`native alias distinct: ${path.resolve(alias).toLowerCase() !== root.toLowerCase()}`);
  for (const appDataRoot of [alias, path.join(alias, 'not-created', 'tail'), path.dirname(alias)]) {
    const h = config(appDataRoot), before = { ...h.options.env };
    const electron = { app: h.options.app, protocol: { registerSchemesAsPrivileged() { assert.fail('No scheme registration'); } } };
    electron.app.getPath = name => { assert.equal(name, 'appData'); return appDataRoot; };
    await assert.rejects(startProduct({ electron, argv: ['product.exe'], defaultApp: false,
      fsImpl: h.options.fsImpl, env: h.options.env }), /overlap/i);
    assert.deepEqual(h.calls, []);
    assert.deepEqual(h.options.env, before);
  }
});

test('S1 physical ancestor inspection fails closed before creating a missing appData suffix', t => {
  const dir = fixture(t), appDataRoot = path.join(dir, 'missing', 'tail');
  for (const code of ['EACCES', 'EIO']) {
    const h = config(appDataRoot, { realpathSync: { native(file) {
      if (path.resolve(file) === dir) throw Object.assign(Error('fixture physical metadata failure'), { code });
      return fs.realpathSync.native(file);
    } } });
    rejectUnchanged(h, /fixture physical metadata failure/);
  }
});

test('S1 an unrelated real short-path ancestor permits safe new tail components', t => {
  const dir = fixture(t);
  const base = process.env.BAIJIE_FIX_SHORT_PATH || dir;
  if (process.env.BAIJIE_FIX_LONG_PATH)
    assert.equal(fs.realpathSync.native(base), fs.realpathSync.native(process.env.BAIJIE_FIX_LONG_PATH));
  const appDataRoot = path.join(base, 'new', 'nested');
  const h = config(appDataRoot);
  const result = configurePaths(h.options);
  assert.equal(result.profileRoot, path.join(appDataRoot, 'BaijieDesktopV1'));
  assert.equal(h.calls.filter(c => c[0] === 'mkdir').length, 5);
  assert.equal(fs.existsSync(appDataRoot), false, 'Mock writes must not create the tail');
});

test('S2 real nested and deep profile junctions fail before any startup mutation', t => {
  const dir = fixture(t);
  for (const relative of ['sessionData/Cache', 'userData/a/b/c/d/e/link']) {
    const appDataRoot = path.join(dir, relative.startsWith('session') ? 'session-case' : 'deep-case');
    const profile = path.join(appDataRoot, 'BaijieDesktopV1');
    const link = path.join(profile, relative), target = path.join(dir, 'target-' + path.basename(appDataRoot));
    fs.mkdirSync(target); fs.mkdirSync(path.dirname(link), { recursive: true });
    fs.symlinkSync(target, link, process.platform === 'win32' ? 'junction' : 'dir');
    assert.equal(fs.lstatSync(link).isSymbolicLink(), true, 'Fixture must contain a real link');
    let visited = false;
    const h = config(appDataRoot, { lstatSync(file) {
      if (path.resolve(file) === link) visited = true;
      return fs.lstatSync(file);
    }, readdirSync(file, options) {
      assert.notEqual(path.resolve(file), link, 'Never enumerate through a link');
      assert.notEqual(path.resolve(file), target, 'Never inspect link target');
      return fs.readdirSync(file, options);
    } });
    rejectUnchanged(h, /symlink|junction|link/i);
    assert.equal(visited, true);
    assert.equal(fs.lstatSync(link).isSymbolicLink(), true, 'Rejected data must be preserved');
  }
});

test('S2 existing ordinary target data is inspected only as metadata and preserved', t => {
  const dir = fixture(t), appDataRoot = path.join(dir, 'app-data'), profile = path.join(appDataRoot, 'BaijieDesktopV1');
  const leaf = path.join(profile, 'sessionData', 'a', 'b', 'c');
  fs.mkdirSync(leaf, { recursive: true });
  const file = path.join(leaf, 'fixture-data'); fs.writeFileSync(file, 'ordinary existing fixture');
  const sibling = path.join(appDataRoot, 'unrelated-profile'); fs.mkdirSync(sibling);
  const inspected = [];
  const h = config(appDataRoot, {
    readdirSync(file, options) {
      const relative = path.relative(profile, file);
      assert.ok(relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative)), 'Only target profile is scanned');
      inspected.push(path.resolve(file)); return fs.readdirSync(file, options);
    },
    readFileSync() { assert.fail('Profile scan must not read file contents'); },
  });
  configurePaths(h.options);
  assert.ok(inspected.includes(leaf), 'Scan must reach deep existing directories');
  assert.equal(fs.readFileSync(file, 'utf8'), 'ordinary existing fixture');
  assert.equal(fs.existsSync(sibling), true);
});

test('S2 descendant metadata failures and vanished entries reject the whole preflight', t => {
  const dir = fixture(t), appDataRoot = path.join(dir, 'app-data'), profile = path.join(appDataRoot, 'BaijieDesktopV1');
  const child = path.join(profile, 'sessionData', 'Cache'); fs.mkdirSync(child, { recursive: true });
  for (const method of ['lstatSync', 'readdirSync']) {
    for (const code of ['EACCES', 'EIO', 'ENOENT']) {
      const h = config(appDataRoot, { [method](file, ...args) {
        if (path.resolve(file) === child) throw Object.assign(Error(`fixture ${method} ${code}`), { code });
        return fs[method](file, ...args);
      } });
      rejectUnchanged(h, new RegExp(`fixture ${method} ${code}`));
      assert.equal(fs.statSync(child).isDirectory(), true);
    }
  }
});

test('S3 Windows device aliases reject raw spelling before even metadata inspection', t => {
  const dir = fixture(t), appDataRoot = path.join(dir, 'data');
  const names = ['COM¹', 'COM²', 'COM³', 'LPT¹', 'LPT²', 'LPT³',
    'CON', 'PRN', 'AUX', 'NUL', 'CONIN$', 'CONOUT$',
    ...Array.from({ length: 9 }, (_, i) => `COM${i + 1}`),
    ...Array.from({ length: 9 }, (_, i) => `LPT${i + 1}`)];
  for (const name of names) for (const suffix of ['', '.txt', '.tar.gz', ' .txt']) {
    for (const location of ['appData', 'profile']) {
      const h = config(appDataRoot, { lstatSync() { assert.fail('No metadata before syntax rejection'); } });
      if (location === 'appData') h.options.appDataRoot = `${appDataRoot}/${name.toLowerCase()}${suffix}/data`;
      else Object.assign(h.options, { mode: 'hidden',
        profileRoot: `${appDataRoot}/BaijieDesktopV1-Tests/${name}${suffix}/case` });
      rejectUnchanged(h, /unsafe product path component/i);
    }
  }
});

test('S3 similar ordinary names are not normalized into device names', t => {
  const dir = fixture(t);
  for (const name of ['COM10', 'LPT0', 'COM⁴', 'CONSOLE', 'CONIN-other', 'a COM¹']) {
    const h = config(path.join(dir, name));
    assert.equal(configurePaths(h.options).profileRoot, path.join(dir, name, 'BaijieDesktopV1'));
  }
});

const policyPoints = ['request', 'permissionRequest', 'permissionCheck', 'device', 'display', 'download'];
function policySession({ failAt, after = true, cleanupFailAt } = {}) {
  const session = new EventEmitter(), values = new Map(), calls = [];
  const original = Error('fixture original installation failure');
  function set(name, value) {
    calls.push([value === null ? 'remove' : 'install', name]);
    if (value !== null && name === failAt && !after) throw original;
    if (value === null) values.delete(name); else values.set(name, value);
    if (value !== null && name === failAt) throw original;
    if (value === null && name === cleanupFailAt) throw Error('fixture cleanup failure');
  }
  session.webRequest = { onBeforeRequest: (_filter, fn) => set('request', fn) };
  for (const [method, name] of [['setPermissionRequestHandler', 'permissionRequest'],
    ['setPermissionCheckHandler', 'permissionCheck'], ['setDevicePermissionHandler', 'device'],
    ['setDisplayMediaRequestHandler', 'display']]) session[method] = fn => set(name, fn);
  session.on = (event, fn) => {
    assert.equal(event, 'will-download');
    // Simulate both throwing before registration and after acquiring ownership.
    if (failAt === 'download' && !after) { set('download', fn); }
    EventEmitter.prototype.on.call(session, event, fn);
    set('download', fn); return session;
  };
  session.removeListener = (event, fn) => {
    EventEmitter.prototype.removeListener.call(session, event, fn);
    set('download', null); return session;
  };
  return { session, values, calls, original };
}
function acquirePolicyFixture(h) {
  assert.equal(policy.createOwnedSession({ defaultSession: {}, fromPartition: () => h.session }), h.session);
  return h;
}

test('L1 every policy installation failure rolls back all attempted ownership and preserves its error', () => {
  for (const failAt of policyPoints) for (const after of [false, true]) {
    const h = acquirePolicyFixture(policySession({ failAt, after }));
    assert.throws(() => policy.installPolicy({ session: h.session, root }), error => error === h.original);
    assert.equal(h.values.size, 0, `${failAt}: no installed handlers may remain`);
    assert.equal(h.session.listenerCount('will-download'), 0);
    const attempted = policyPoints.slice(0, policyPoints.indexOf(failAt) + 1);
    assert.deepEqual(h.calls.filter(c => c[0] === 'remove').map(c => c[1]).sort(), [...attempted].sort());
  }
});

test('L1 rollback cleanup failures never mask installation failure or block other cleanup', () => {
  for (const cleanupFailAt of policyPoints) {
    const h = acquirePolicyFixture(policySession({ failAt: 'download', cleanupFailAt }));
    assert.throws(() => policy.installPolicy({ session: h.session, root }), error => error === h.original);
    assert.deepEqual(h.calls.filter(c => c[0] === 'remove').map(c => c[1]).sort(), [...policyPoints].sort());
    assert.equal(h.values.size, 0);
    assert.equal(h.session.listenerCount('will-download'), 0);
  }
});

test('L1 normal and repeated cleanup attempts each owned resource once despite removal errors', () => {
  for (const cleanupFailAt of [undefined, ...policyPoints]) {
    const h = acquirePolicyFixture(policySession({ cleanupFailAt })), external = () => {};
    EventEmitter.prototype.on.call(h.session, 'will-download', external);
    const remove = policy.installPolicy({ session: h.session, root });
    assert.equal(h.values.size, policyPoints.length);
    assert.doesNotThrow(() => { remove(); remove(); });
    assert.deepEqual(h.calls.filter(c => c[0] === 'remove').map(c => c[1]).sort(), [...policyPoints].sort());
    assert.deepEqual(h.session.listeners('will-download'), [external]);
    assert.equal(h.values.size, 0);
  }
});

test('L1 boot cleanup continues past shell and protocol errors and preserves ready rejection', async t => {
  const h = config(path.join(fixture(t), 'data')), ps = policySession();
  let resourceRemoved = 0, shellRemoved = 0;
  const original = Error('fixture original load failure');
  Object.assign(h.options.app, { whenReady: () => Promise.resolve() });
  ps.session.protocol = { handle() {}, unhandle() { resourceRemoved++; throw Error('resource cleanup failure'); } };
  const electron = { app: h.options.app, protocol: { registerSchemesAsPrivileged() {} },
    session: { defaultSession: {}, fromPartition: () => ps.session } };
  const result = await boot({ ...h.options, electron, createShellImpl: () => ({ window: {},
    ready: Promise.reject(original), destroy() { shellRemoved++; throw Error('shell cleanup failure'); } }) });
  await assert.rejects(result.ready, error => error === original);
  assert.doesNotThrow(() => { result.destroy(); result.destroy(); });
  assert.equal(resourceRemoved, 1); assert.equal(shellRemoved, 1);
  assert.deepEqual(ps.calls.filter(c => c[0] === 'remove').map(c => c[1]).sort(), [...policyPoints].sort());
  assert.equal(h.options.app.eventNames().length, 0);
});

const partitionsSeen = new Set();
function ownedBootHarness(t, { policyFailure, stage } = {}) {
  const h = config(path.join(fixture(t), 'data'));
  const foreign = policySession(), owned = policySession({ failAt: policyFailure });
  const foreignHandlers = new Map();
  for (const name of policyPoints.slice(0, -1)) {
    const handler = () => `external ${name}`;
    foreign.values.set(name, handler); foreignHandlers.set(name, handler);
  }
  const externalDownload = () => {};
  EventEmitter.prototype.on.call(foreign.session, 'will-download', externalDownload);
  const externalProtocol = () => 'external protocol';
  foreign.session.protocol = {
    handler: externalProtocol,
    handle() { throw Error('External protocol already owned'); },
    unhandle() { assert.fail('Must not remove external protocol'); },
  };
  const original = stage ? Error(`fixture ${stage} failure`) : owned.original;
  const protocolCalls = [], windows = [], sessionCalls = [];
  owned.session.protocol = {
    handle(scheme, fn) { if (stage === 'protocol') throw original; protocolCalls.push(['handle', scheme]); this.handler = fn; },
    unhandle(scheme) { protocolCalls.push(['unhandle', scheme]); this.handler = null; },
  };
  let ready = false;
  h.options.app.isReady = () => ready;
  h.options.app.getPath = name => { assert.equal(name, 'appData'); return h.options.appDataRoot; };
  h.options.app.whenReady = () => { ready = true; return Promise.resolve(); };
  h.options.app.quit = () => {};
  const screen = Object.assign(new EventEmitter(), {
    getAllDisplays: () => [{ id: 1, workArea: { x: 0, y: 0, width: 1920, height: 1080 } }],
  });
  screen.getPrimaryDisplay = screen.getDisplayMatching = () => screen.getAllDisplays()[0];
  const ipcMain = new EventEmitter(), handles = new Map();
  ipcMain.handle = (name, fn) => handles.set(name, fn);
  ipcMain.removeHandler = name => handles.delete(name);
  class Window extends EventEmitter {
    constructor(options) {
      super(); if (stage === 'window') throw original;
      this.options = options; this.bounds = { x: options.x, y: options.y, width: options.width, height: options.height };
      this.webContents = Object.assign(new EventEmitter(), { mainFrame: { url: policy.ENTRY_URL },
        session: options.webPreferences.session, send() {}, setFrameRate() {}, setWindowOpenHandler() {} });
      windows.push(this);
    }
    isDestroyed() { return !!this.dead; }
    isVisible() { return !!this.visible; }
    getBounds() { return this.bounds; }
    setBounds(bounds) { this.bounds = bounds; }
    setAlwaysOnTop() {}
    setIgnoreMouseEvents() {}
    setMenu() {}
    show() { this.visible = true; }
    hide() { this.visible = false; }
    loadURL() { return stage === 'load' ? Promise.reject(original) : Promise.resolve(); }
    destroy() { if (!this.dead) { this.dead = true; this.emit('closed'); } }
  }
  if (stage === 'listener') h.options.app.on = () => { throw original; };
  const electron = { app: h.options.app,
    protocol: { registerSchemesAsPrivileged() { assert.equal(ready, false); },
      handle() { assert.fail('Global/default protocol must not be changed'); },
      unhandle() { assert.fail('Global/default protocol must not be cleared'); } },
    session: { defaultSession: foreign.session,
      fromPartition(name, options) {
        assert.equal(ready, true); assert.ok(name.length > 0); assert.equal(name.startsWith('persist:'), false);
        assert.equal(partitionsSeen.has(name), false, 'Every acquisition needs a fresh private partition'); partitionsSeen.add(name);
        assert.deepEqual(options, { cache: false }); sessionCalls.push(name); return owned.session;
      } },
    BrowserWindow: Window, screen, ipcMain,
    Tray: class { constructor() { throw Error('No native tray in fixture'); } },
    Menu: {}, globalShortcut: { register: () => false },
  };
  const stateIO = { loadStateResult: () => ({status:'missing',value:null,reason:null}), saveState() {} };
  const clock = { setTimeout: () => 1, clearTimeout() {} };
  function assertForeignUnchanged() {
    assert.deepEqual(foreign.values, foreignHandlers);
    assert.deepEqual(foreign.session.listeners('will-download'), [externalDownload]);
    assert.equal(foreign.session.protocol.handler, externalProtocol);
    assert.deepEqual(foreign.calls, [], 'No external setter or remover may be called');
  }
  return { ...h, electron, owned, foreign, original, protocolCalls, windows, sessionCalls, handles,
    stateIO, clock, assertForeignUnchanged };
}

test('L2 product visible, product hidden and development hidden bind one private session everywhere', async t => {
  for (const mode of ['visible', 'hidden', 'development-hidden']) {
    const h = ownedBootHarness(t);
    let result;
    try {
      if (mode === 'development-hidden') result = await boot({ electron: h.electron, root,
        profileRoot: path.resolve(root, '../runtime/tests/session-ownership-fixture'),
        env: h.options.env, fsImpl: h.options.fsImpl, stateIO: h.stateIO, clock: h.clock });
      else result = await startProduct({ electron: h.electron, argv: ['product.exe', ...(mode === 'hidden'
        ? ['--hidden', '--profile-root', path.join(h.options.appDataRoot, 'BaijieDesktopV1-Tests', 'case')] : [])],
        defaultApp: false, env: h.options.env, fsImpl: h.options.fsImpl, stateIO: h.stateIO, clock: h.clock });
      await result.ready;
      assert.equal(h.sessionCalls.length, 1);
      assert.equal(result.window.options.webPreferences.session, h.owned.session);
      assert.equal(result.window.webContents.session, h.owned.session);
      assert.equal(h.owned.values.size, policyPoints.length);
      assert.equal(h.owned.session.protocol.handler({ method: 'GET', url: policy.ENTRY_URL }).status, 200);
      assert.equal(result.window.isVisible(), mode === 'visible');
      assert.equal(result.window.options.webPreferences.partition, undefined);
      h.assertForeignUnchanged();
    } finally { result?.destroy(); result?.destroy(); }
    h.assertForeignUnchanged();
    assert.equal(h.owned.values.size, 0); assert.equal(h.handles.size, 0);
    assert.deepEqual(h.protocolCalls.map(c => c[0]), ['handle', 'unhandle']);
  }
});

test('L2 all private-session startup failure stages leave external owners intact', async t => {
  for (const failure of [...policyPoints.map(policyFailure => ({ policyFailure })),
    ...['protocol', 'window', 'load', 'listener'].map(stage => ({ stage }))]) {
    const h = ownedBootHarness(t, failure);
    await assert.rejects(async () => {
      const result = await startProduct({ electron: h.electron, argv: ['product.exe'], defaultApp: false,
        env: h.options.env, fsImpl: h.options.fsImpl, stateIO: h.stateIO, clock: h.clock });
      await result.ready;
    }, error => error === h.original);
    h.assertForeignUnchanged();
    assert.equal(h.owned.values.size, 0);
    assert.equal(h.owned.session.listenerCount('will-download'), 0);
    assert.equal(h.handles.size, 0);
    for (const window of h.windows) assert.equal(window.isDestroyed(), true);
  }
});

test('L2 missing private-session API must fail without falling back to defaultSession', async t => {
  const h = ownedBootHarness(t); delete h.electron.session.fromPartition;
  await assert.rejects(boot({ ...h.options, electron: h.electron,
    createShellImpl() { assert.fail('No window without owned session'); } }), /session|fromPartition/i);
  h.assertForeignUnchanged();
});

test('L1 actual shell cleanup errors preserve load failure and release other owned resources', async t => {
  for (const failAt of ['screen', 'ipc', 'window']) {
    const h = ownedBootHarness(t, { stage: 'load' });
    if (failAt === 'screen') {
      const original = h.electron.screen.removeListener.bind(h.electron.screen);
      h.electron.screen.removeListener = (...args) => { original(...args); throw Error('fixture screen cleanup failure'); };
    } else if (failAt === 'ipc') {
      const original = h.electron.ipcMain.removeHandler;
      h.electron.ipcMain.removeHandler = (...args) => { original(...args); throw Error('fixture IPC cleanup failure'); };
    } else {
      const original = h.electron.BrowserWindow.prototype.destroy;
      h.electron.BrowserWindow.prototype.destroy = function () { original.call(this); throw Error('fixture window cleanup failure'); };
    }
    await assert.rejects(async () => {
      const result = await startProduct({ electron: h.electron, argv: ['product.exe'], defaultApp: false,
        env: h.options.env, fsImpl: h.options.fsImpl, stateIO: h.stateIO, clock: h.clock });
      await result.ready;
    }, error => error === h.original);
    h.assertForeignUnchanged();
    assert.equal(h.owned.values.size, 0); assert.equal(h.handles.size, 0);
    assert.equal(h.windows[0].isDestroyed(), true);
    for (const target of [h.electron.screen, h.electron.app, h.electron.ipcMain, h.windows[0].webContents])
      assert.equal(target.eventNames().length, 0, failAt);
    assert.deepEqual(h.protocolCalls.map(c => c[0]), ['handle', 'unhandle']);
  }
});

test('L2 arbitrary sessions cannot receive destructive policy installation', () => {
  const h = policySession();
  assert.throws(() => policy.installPolicy({ session: h.session, root }), /owned|independent|session/i);
  assert.deepEqual(h.calls, []);
});

test('L2 direct shell cannot silently fall back to the default session', () => {
  let reachedWindow = false;
  assert.throws(() => require('../shell.cjs').createShell({ electron: { BrowserWindow: class {
    constructor() { reachedWindow = true; }
  } }, root, profileRoot: path.resolve(root, '../runtime/tests/session-required'),
  stateIO: { loadStateResult() { assert.fail('Unexpected state read'); } } }), /owned|independent|session/i);
  assert.equal(reachedWindow, false);
});
