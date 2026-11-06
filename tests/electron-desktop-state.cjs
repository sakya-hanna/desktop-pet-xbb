// Exercise the real main/preload/renderer, replacing desktop-only tray/shortcut seams.
// Separate test profile; never shows windows or registers global shortcuts.
const electron = require('electron');
const { app } = electron;
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const Module = require('node:module');
const { EventEmitter } = require('node:events');
const out = process.env.BAIJIE_DESKTOP_OUT;
const phase = process.env.BAIJIE_DESKTOP_PHASE;
if (!out || !['write', 'restore'].includes(phase)) throw Error('Unique output and explicit phase required');
fs.mkdirSync(out, { recursive: true });
app.setPath('userData', path.join(out, 'isolated-profile'));
app.commandLine.appendSwitch('use-angle', 'swiftshader');
app.commandLine.appendSwitch('enable-unsafe-swiftshader');
for (const key of Object.keys(process.env)) if (key.startsWith('PUPPET_')) delete process.env[key];
let win, template;
const menus = [];
class HiddenWindow extends electron.BrowserWindow {
  constructor(options) {
    super({ ...options, show: false, webPreferences: { ...options.webPreferences, offscreen: true, backgroundThrottling: false } });
    win = this;
    win.webContents.once('did-finish-load', () => verify().catch(fail));
  }
}
class NoTray extends EventEmitter { setToolTip() {} setContextMenu() {} }
const overrides = {
  BrowserWindow: HiddenWindow,
  Tray: NoTray,
  globalShortcut: { register() { return true; }, unregisterAll() {} },
  Menu: { buildFromTemplate(value) { menus.push(value); template = value; return { popup() {} }; } },
};
const proxy = new Proxy(electron, { get(target, key) { return Object.hasOwn(overrides, key) ? overrides[key] : target[key]; } });
const load = Module._load;
const mainPath = path.resolve(__dirname, '../puppet/main.js');
const logFs = new Proxy(fs, { get(target, key) {
  if (key !== 'appendFileSync') return target[key];
  return (file, ...args) => {
    const logs = path.join(out, phase + '-logs'); fs.mkdirSync(logs, { recursive: true });
    return fs.appendFileSync(path.join(logs, path.basename(file)), ...args);
  };
} });
Module._load = function(name, parent, isMain) {
  if (name === 'electron') return proxy;
  if (name === 'fs' && parent?.filename === mainPath) return logFs;
  return load.call(this, name, parent, isMain);
};
const timer = setTimeout(() => fail(Error('desktop-state test deadline')), 30000);
function fail(error) {
  fs.writeFileSync(path.join(out, phase + '-failure.json'), JSON.stringify({ error: error.stack }));
  app.exit(1);
}
async function verify() {
  await win.webContents.executeJavaScript(`new Promise((resolve,reject)=>{const deadline=performance.now()+16000;function tick(){if(window.__rig?.ready&&__rig.S.t>0.15)return resolve();if(performance.now()>deadline)return reject(Error('rig timeout'));setTimeout(tick,20)}tick()})`);
  const settings = path.join(app.getPath('userData'), 'baijie-desktop', 'window-state.json');
  const before = win.getBounds();
  assert.equal(win.isVisible(), false);
  if (phase === 'write') {
    electron.ipcMain.emit('menu', { sender: win.webContents, senderFrame:win.webContents.mainFrame }, null);
    const size = template.find(item => item.label === '大小');
    size.submenu[0].click();
    electron.ipcMain.emit('drag', { sender: win.webContents, senderFrame:win.webContents.mainFrame }, { dx: -35, dy: -25 });
    template.find(item => item.label === '始终置顶').click({ checked: false });
    app.emit('before-quit');
    const saved = JSON.parse(fs.readFileSync(settings, 'utf8'));
    assert.deepEqual(saved.bounds, win.getBounds());
    assert.equal(saved.size, 'small'); assert.equal(saved.alwaysOnTop, false);
    assert.ok(menus.some(menu => menu.some(item => item.label === '重置位置与大小')));
    fs.writeFileSync(path.join(out, 'expected.json'), JSON.stringify(saved));
  } else {
    const expected = JSON.parse(fs.readFileSync(path.join(out, 'expected.json'), 'utf8'));
    assert.deepEqual(win.getBounds(), expected.bounds);
    assert.equal(win.isAlwaysOnTop(), expected.alwaysOnTop);
    electron.ipcMain.emit('menu', { sender: win.webContents, senderFrame:win.webContents.mainFrame }, null);
    const small = template.find(item => item.label === '大小').submenu[0];
    assert.equal(small.checked, true);
  }
  // Native capturePage may reject with UnknownVizError immediately after an
  // offscreen native resize. Sample the actual WebGL canvas after its viewport
  // catches up instead; no synthetic frame and no compositor sleep/retry.
  const viewport = win.getContentBounds();
  const dataURL = await win.webContents.executeJavaScript(`new Promise((resolve,reject)=>{const end=performance.now()+5000;function tick(){if(innerWidth===${viewport.width}&&innerHeight===${viewport.height})return requestAnimationFrame(()=>resolve(document.getElementById('stage').toDataURL('image/png')));if(performance.now()>end)return reject(Error('resized viewport timeout'));requestAnimationFrame(tick)}tick()})`);
  const image = electron.nativeImage.createFromDataURL(dataURL);
  assert.ok(image.toPNG().length > 1000);
  fs.writeFileSync(path.join(out, phase + '.png'), image.toPNG());
  const diagnostics = await win.webContents.executeJavaScript(`({...__rig.diagnostics(), clock:__rig.S.t, glError:document.getElementById('stage').getContext('webgl2').getError()})`);
  assert.equal(diagnostics.glError, 0);
  assert.ok(diagnostics.bodyFinite);
  for (const layer of diagnostics.hairLayers) {
    assert.ok(layer.finite); assert.equal(layer.flippedTriangles, 0);
  }
  fs.writeFileSync(path.join(out, phase + '-result.json'), JSON.stringify({ passed: true, phase, before, bounds: win.getBounds(), settings: JSON.parse(fs.readFileSync(settings, 'utf8')), diagnostics }, null, 2));
  clearTimeout(timer); app.quit();
}
require('../puppet/main.js');
