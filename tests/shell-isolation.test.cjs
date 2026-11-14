'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const root = path.resolve(__dirname, '..');
function loadPreload(main = true) {
  const file = path.join(root, 'desktop-preload.cjs');
  assert.ok(fs.existsSync(file), 'narrow sandbox preload must exist');
  let pet; const sent = [], ipcRenderer = new EventEmitter();
  ipcRenderer.send = (...args) => sent.push(args);
  ipcRenderer.invoke = (...args) => { sent.push(args); return Promise.resolve({ mode: 'hidden' }); };
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), { process: { isMainFrame: main },
    require: name => { assert.equal(name, 'electron'); return { ipcRenderer, contextBridge: {
      exposeInMainWorld(name, value) { assert.equal(name, 'pet'); pet = value; } } }; } }, { filename: file });
  return { pet, sent, ipcRenderer };
}

test('sandbox preload exposes only narrow commands and strips Electron events', async () => {
  const h = loadPreload();
  assert.deepEqual(Object.keys(h.pet).sort(), ['command', 'drag', 'getState', 'menu', 'onAction', 'onState', 'ready', 'resizeBy', 'setInteractive'].sort());
  assert.ok(Object.isFrozen(h.pet));
  h.pet.drag(2, -3); h.pet.resizeBy(1.1); h.pet.resizeBy(0.9, { x: 0.5, y: 1 });
  h.pet.setInteractive(true); h.pet.menu({ x: 4, y: 5 }); h.pet.ready(); h.pet.command('topmost', false);
  assert.deepEqual(JSON.parse(JSON.stringify(h.sent)), [
    ['drag', { dx: 2, dy: -3 }], ['resize-by', 1.1], ['resize-by', { factor: 0.9, anchor: { x: 0.5, y: 1 } }],
    ['interactive', true], ['menu', { x: 4, y: 5 }], ['idle-ready'], ['desktop:command', { name: 'topmost', value: false }],
  ]);
  const seen = [], off = h.pet.onAction((...args) => seen.push(args));
  h.ipcRenderer.emit('action', { privileged: true }, 'hop');
  h.ipcRenderer.emit('action', {}, 'face:3901');
  h.ipcRenderer.emit('action', {}, 'face:9999');
  for (const id of [3523,3861,4006]) h.ipcRenderer.emit('action', {}, 'face:'+id);
  h.ipcRenderer.emit('action', {}, 'shell:cancel');
  h.ipcRenderer.emit('action', {}, '<script>');
  assert.deepEqual(seen, [['hop'], ['face:3901'], ['shell:cancel']]);
  off(); off(); assert.equal(h.ipcRenderer.listenerCount('action'), 0);
  const states = [], offState = h.pet.onState((...args) => states.push(args));
  h.ipcRenderer.emit('desktop:state', { privileged: true }, { mode: 'hidden' });
  assert.deepEqual(states, [[{ mode: 'hidden' }]]); offState();
  assert.deepEqual(await h.pet.getState(), { mode: 'hidden' });
  assert.equal(loadPreload(false).pet, undefined);
});


function resources() {
  assert.ok(fs.existsSync(path.join(root, 'resource-policy.cjs')), 'resource policy must exist');
  return require('../resource-policy.cjs');
}
function resourceFixture(t) {
  const scratch = process.env.TMPDIR;
  assert.match(scratch.replaceAll('\\', '/'), /hermes\/cache\/scratch\/baijie28-shell-tests$/);
  const dir = fs.mkdtempSync(path.join(scratch, 'resources-'));
  fs.mkdirSync(path.join(dir, 'src')); fs.mkdirSync(path.join(dir, 'assets'));
  fs.writeFileSync(path.join(dir, 'desktop.html'), '<!doctype html><p>fixture</p>');
  fs.writeFileSync(path.join(dir, 'desktop.css'), 'body{}');
  fs.writeFileSync(path.join(dir, 'assets/baijie-body.png'), 'fixture-not-real-png');
  fs.writeFileSync(path.join(dir, 'assets/manifest.json'), '{}');
  for (const name of ['desktop-bootstrap', 'desktop-view', 'character-renderer', 'desktop-runtime', 'character', 'director', 'material-rig', 'view', 'hit-test']) fs.writeFileSync(path.join(dir, `src/${name}.js`), 'export {};');
  t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return dir;
}

test('resource whitelist serves only the candidate page, new modules and frozen artwork', async t => {
  const dir = resourceFixture(t), policy = resources();
  const protocol = { handle(scheme, fn) { assert.equal(scheme, 'baijie28'); this.handler = fn; }, unhandle(scheme) { this.removed = scheme; } };
  const cleanup = policy.installResources({ protocol, root: dir });
  for (const name of ['desktop.html', 'desktop.css', 'src/desktop-bootstrap.js', 'src/desktop-view.js', 'src/character-renderer.js', 'src/desktop-runtime.js', 'src/character.js', 'src/director.js', 'src/material-rig.js', 'src/view.js', 'src/hit-test.js', 'assets/manifest.json', 'assets/baijie-body.png']) {
    const response = await protocol.handler({ method: 'GET', url: `baijie28://app/${name}` });
    assert.equal(response.status, 200, name);
    assert.match(response.headers.get('content-security-policy'), /default-src 'none'/);
    assert.match(response.headers.get('content-security-policy'), /connect-src 'self'/);
    assert.doesNotMatch(response.headers.get('content-security-policy'), /unsafe-|https:/);
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.ok((await response.arrayBuffer()).byteLength > 0);
  }
  for (const url of ['https://example.invalid/', 'file:///C:/secret', 'baijie28://else/desktop.html',
    'baijie28://u:p@app/desktop.html', 'baijie28://app:80/desktop.html', 'baijie28://app/../desktop.html',
    'baijie28://app/src/../desktop.html', 'baijie28://app/%2e%2e/desktop.html', 'baijie28://app/src%2fdirector.js',
    'baijie28://app/src\\director.js', 'baijie28://app/src/director.js?x=1', 'baijie28://app/desktop.html#x',
    'baijie28://app/shared/window-state.js', 'baijie28://app/desktop-preload.cjs', 'baijie28://app/assets/conversation.json',
    'baijie28://app/src/app.js', 'baijie28://app/src/director.js%00']) {
    assert.equal(policy.resolveResource(url, dir), null, url);
    assert.equal((await protocol.handler({ method: 'GET', url })).status, 404, url);
  }
  assert.equal((await protocol.handler({ method: 'POST', url: 'baijie28://app/desktop.html' })).status, 405);
  cleanup(); assert.equal(protocol.removed, 'baijie28');
});

test('resource resolver rejects symlink/junction components even inside allowed root', t => {
  const dir = resourceFixture(t), policy = resources();
  const original = path.join(dir, 'assets'); const target = path.join(dir, 'real-assets');
  fs.renameSync(original, target);
  fs.symlinkSync(target, original, process.platform === 'win32' ? 'junction' : 'dir');
  assert.equal(policy.resolveResource('baijie28://app/assets/baijie-body.png', dir), null);
  assert.throws(() => policy.assertNoSymlinks(path.join(original, 'manifest.json')), /symbolic|symlink|junction/i);
});

test('session policy denies external/file traffic, permissions and downloads', t => {
  const dir = resourceFixture(t), policy = resources();
  const session = new EventEmitter();
  session.webRequest = { onBeforeRequest(filter, fn) { this.filter = filter; this.check = fn; } };
  session.setPermissionRequestHandler = fn => { session.request = fn; };
  session.setPermissionCheckHandler = fn => { session.check = fn; };
  session.setDevicePermissionHandler = fn => { session.device = fn; };
  session.setDisplayMediaRequestHandler = fn => { session.display = fn; };
  assert.equal(policy.createOwnedSession({ defaultSession: {}, fromPartition: () => session }), session);
  const cleanup = policy.installPolicy({ session, root: dir });
  for (const url of ['https://example.invalid/a', 'http://127.0.0.1/a', 'file:///C:/secret', 'ws://localhost/a', 'data:text/html,hi', 'baijie28://app/desktop-preload.cjs']) {
    let value; session.webRequest.check({ url }, v => { value = v; }); assert.deepEqual(value, { cancel: true });
  }
  let local; session.webRequest.check({ url: 'baijie28://app/desktop.html' }, v => { local = v; }); assert.deepEqual(local, { cancel: false });
  assert.equal(session.check(null, 'media', 'baijie28://app'), false);
  assert.equal(session.device({}), false);
  let permission; session.request(null, 'clipboard-read', v => { permission = v; }); assert.equal(permission, false);
  let display; session.display({}, v => { display = v; }); assert.deepEqual(display, {});
  let prevented = false; session.emit('will-download', { preventDefault() { prevented = true; } }); assert.equal(prevented, true);
  cleanup(); assert.equal(session.listenerCount('will-download'), 0);
  assert.equal(session.request, null); assert.equal(session.check, null); assert.equal(session.webRequest.check, null);
});


function main() {
  assert.ok(fs.existsSync(path.join(root, 'desktop-main.cjs')), 'testable isolated main entry must exist');
  return require('../desktop-main.cjs');
}
function bootHarness() {
  const calls = [], app = new EventEmitter(); let ready = false;
  app.isReady = () => ready;
  app.getPath = () => { throw new Error('must not inspect default user data'); };
  app.setPath = (name, value) => { assert.equal(ready, false); calls.push(['path', name, value]); };
  app.setAppLogsPath = value => { assert.equal(ready, false); calls.push(['logs', value]); };
  app.whenReady = () => { calls.push(['ready']); ready = true; return Promise.resolve(); };
  app.quit = () => calls.push(['quit']);
  const protocol = { registerSchemesAsPrivileged(value) { assert.equal(ready, false); calls.push(['scheme', value]); },
    handle(name, handler) { calls.push(['protocol', name]); this.handler = handler; }, unhandle: name => calls.push(['unhandle', name]) };
  const session = new EventEmitter();
  session.webRequest = { onBeforeRequest: (filter, fn) => calls.push(['request-policy', !!fn]) };
  for (const name of ['setPermissionRequestHandler', 'setPermissionCheckHandler', 'setDevicePermissionHandler', 'setDisplayMediaRequestHandler']) session[name] = fn => calls.push([name, !!fn]);
  session.protocol = { handle: protocol.handle, unhandle: protocol.unhandle };
  const foreignSession = new EventEmitter();
  const electron = { app, protocol, session: {
    get defaultSession() { assert.equal(ready, true); return foreignSession; },
    fromPartition(name, options) {
      assert.equal(ready, true); assert.ok(name); assert.equal(name.startsWith('persist:'), false);
      assert.deepEqual(options, { cache: false }); return session;
    } } };
  const fsImpl = { lstatSync: file => fs.lstatSync(file), mkdirSync: file => calls.push(['mkdir', file]) };
  const createShellImpl = options => {
    calls.push(['shell', options]); const window = { testOnly: true };
    return { window, ready: Promise.resolve(window), snapshot: () => ({ mode: options.mode }), destroy: () => calls.push(['shell-destroy']) };
  };
  return { calls, electron, fsImpl, createShellImpl, env: { TEMP: 'old-temp', PUPPET_PAGE: 'https://bad.invalid', NODE_OPTIONS: '--inspect', ELECTRON_RUN_AS_NODE: '1' } };
}

test('isolated boot configures all paths before ready and uses real policy installers', async () => {
  const h = bootHarness(), module = main();
  const profileRoot = path.resolve(root, '../evidence/shell-hidden-unit/profile');
  const result = await module.boot({ ...h, root, profileRoot, mode: 'hidden' });
  assert.ok(result.shell); assert.equal(result.window, result.shell.window);
  assert.equal(await result.ready, result.window); assert.equal(await result.loadPromise, result.window);
  assert.deepEqual(result.paths, {
    profileRoot, userData: path.join(profileRoot, 'userData'), sessionData: path.join(profileRoot, 'sessionData'),
    logs: path.join(profileRoot, 'logs'), temp: path.join(profileRoot, 'temp'),
  });
  for (const name of ['userData', 'sessionData', 'temp']) assert.ok(h.calls.some(c => c[0] === 'path' && c[1] === name && c[2] === result.paths[name]));
  assert.deepEqual(h.calls.find(c => c[0] === 'logs'), ['logs', result.paths.logs]);
  assert.ok(h.calls.findIndex(c => c[0] === 'scheme') < h.calls.findIndex(c => c[0] === 'ready'));
  assert.ok(h.calls.findIndex(c => c[0] === 'protocol') < h.calls.findIndex(c => c[0] === 'shell'));
  for (const k of ['TEMP', 'TMP', 'TMPDIR']) assert.equal(h.env[k], result.paths.temp);
  assert.equal(h.env.NODE_OPTIONS, undefined); assert.equal(h.env.ELECTRON_RUN_AS_NODE, undefined); assert.equal(h.env.PUPPET_PAGE, undefined);
  const scheme = h.calls.find(c => c[0] === 'scheme')[1][0];
  assert.equal(scheme.scheme, 'baijie28'); assert.equal(scheme.privileges.standard, true);
  assert.equal(scheme.privileges.secure, true); assert.equal(scheme.privileges.supportFetchAPI, true);
  assert.notEqual(scheme.privileges.bypassCSP, true); assert.notEqual(scheme.privileges.allowServiceWorkers, true);
  assert.equal(h.calls.find(c => c[0] === 'shell')[1].mode, 'hidden');
  assert.equal(h.calls.find(c => c[0] === 'shell')[1].profileRoot, profileRoot);
  assert.equal(typeof module.configurePaths, 'function'); assert.equal(typeof module.installPolicy, 'function');
  result.destroy(); result.destroy();
  assert.equal(h.calls.filter(c => c[0] === 'shell-destroy').length, 1);
  assert.equal(h.calls.filter(c => c[0] === 'unhandle').length, 1);
  assert.equal(h.electron.app.eventNames().length, 0);
});

test('entry defaults hidden and rejects arbitrary URL/profile, conflicting flags and late setup', () => {
  const module = main();
  assert.deepEqual(module.parseArgs([]), { mode: 'hidden' });
  assert.deepEqual(module.parseArgs(['--visible']), { mode: 'visible' });
  const profileRoot = path.resolve(root, '../runtime/tests/cli/profile');
  assert.deepEqual(module.parseArgs(['--hidden', '--profile-root', profileRoot]), { mode: 'hidden', profileRoot });
  for (const args of [['--visible', '--hidden'], ['--url', 'https://bad.invalid'], ['--profile-root'], ['--visible', '--profile-root', profileRoot], ['--visible', '--visible']]) assert.throws(() => module.parseArgs(args));
  for (const profile of [undefined, root, path.resolve(root, '../runtime/interactive'), path.resolve(root, '../../01-当前工程'), path.resolve(root, '../runtime/tests'), 'relative-profile']) {
    const h = bootHarness();
    assert.throws(() => module.configurePaths({ ...h, app: h.electron.app, root, mode: 'hidden', profileRoot: profile }), /profile|path|hidden/i);
    assert.equal(h.calls.length, 0);
  }
  const h = bootHarness();
  const result = module.configurePaths({ ...h, app: h.electron.app, root, mode: 'visible' });
  assert.equal(result.profileRoot, path.resolve(root, '../runtime/interactive'));
  h.electron.app.isReady = () => true;
  assert.throws(() => module.configurePaths({ ...h, app: h.electron.app, root, mode: 'visible' }), /before.*ready/i);
});


test('profile and nested sessionData symlinks are rejected before any mkdir or app change', () => {
  const module = main();
  for (const child of ['', 'sessionData', 'logs', 'temp', 'userData']) {
    const h = bootHarness(), profileRoot = path.resolve(root, '../evidence/shell-link-test/profile');
    const linked = path.join(profileRoot, child);
    h.fsImpl.lstatSync = file => file === linked ? { isSymbolicLink: () => true } : fs.lstatSync(file);
    assert.throws(() => module.configurePaths({ ...h, app: h.electron.app, root, profileRoot }), /symlink|junction/i);
    assert.equal(h.calls.length, 0);
  }
});

test('entry never auto-boots when imported and cleans real policy hooks on failed shell creation', async () => {
  const h = bootHarness(), module = main();
  assert.equal(h.calls.length, 0);
  await assert.rejects(module.boot({ ...h, root, mode: 'hidden',
    profileRoot: path.resolve(root, '../evidence/shell-error-test/profile'),
    createShellImpl() { throw new Error('constructor failed'); },
  }), /constructor failed/);
  assert.equal(h.calls.filter(c => c[0] === 'unhandle').length, 1);
  assert.deepEqual(h.calls.filter(c => c[0] === 'request-policy').map(c => c[1]), [true, false]);
  assert.equal(h.electron.app.eventNames().length, 0);
});


test('all real frozen manifest image names resolve to candidate assets only', () => {
  const policy = resources(), manifest = require('../assets/manifest.json');
  const names = Object.keys(manifest.images);
  assert.ok(names.length > 0);
  for (const name of names) {
    assert.equal(policy.resolveResource(`baijie28://app/assets/${name}`, root), path.join(root, 'assets', name));
  }
});

test('resource bootstrap refuses a linked manifest before importing its content', () => {
  const file = path.join(root, 'resource-policy.cjs'); let assetImported = false;
  const fsImpl = { ...fs, lstatSync(target) {
    if (target === path.join(root, 'assets/manifest.json')) return { isSymbolicLink: () => true };
    return fs.lstatSync(target);
  } };
  assert.throws(() => vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
    __dirname: root, module: { exports: {} }, require(name) {
      if (name === 'node:fs') return fsImpl;
      if (name === 'node:path') return path;
      if (name === 'node:crypto') return require('node:crypto');
      if (name === './assets/manifest.json') { assetImported = true; return require('../assets/manifest.json'); }
      throw new Error('Unexpected dependency');
    },
  }), /symlink|junction/i);
  assert.equal(assetImported, false);
});

test('preload refuses malformed booleans, enums, numbers and callback types', () => {
  const h = loadPreload();
  for (const value of [0, 1, 'true', null, {}, undefined]) { h.pet.setInteractive(value); h.pet.command('click-through', value); h.pet.command('topmost', value); }
  for (const factor of [0, NaN, Infinity, 2.1, '1.1']) h.pet.resizeBy(factor);
  h.pet.resizeBy(1.1, { x: -1, y: 0 }); h.pet.resizeBy(1.1, { x: 1, y: 0, z: 0 });
  h.pet.drag(NaN, 2); h.pet.drag(1e9, 2); h.pet.menu({ x: '1', y: 2 }); h.pet.menu({ x: 1, y: 2, z: 3 });
  h.pet.command('chat'); h.pet.command('hide', 'extra'); h.pet.command('__proto__', true);
  assert.equal(h.sent.length, 0);
  assert.throws(() => h.pet.onAction(null), /callback/i);
  assert.throws(() => h.pet.onState('bad'), /callback/i);
});
