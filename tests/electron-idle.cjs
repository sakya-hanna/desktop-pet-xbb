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
let win, template, popupCallback;
const idleChecks=[];
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
  Menu: { buildFromTemplate(value) { menus.push(value); template = value; return { popup(options) { popupCallback=options.callback; } }; } },
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
async function waitFor(expression) {
  return win.webContents.executeJavaScript(`new Promise((resolve,reject)=>{const end=performance.now()+8000;function tick(){if(${expression})return resolve();if(performance.now()>end)return reject(Error('idle acceptance timeout: '+${JSON.stringify(expression)}));setTimeout(tick,15)}tick()})`);
}
async function readIdle(){return win.webContents.executeJavaScript('__rig.idle.snapshot()');}
async function verify() {
  await win.webContents.executeJavaScript(`new Promise((resolve,reject)=>{const deadline=performance.now()+16000;function tick(){if(window.__rig?.ready&&__rig.S.t>0.15)return resolve();if(performance.now()>deadline)return reject(Error('rig timeout'));setTimeout(tick,20)}tick()})`);
  const settings = path.join(app.getPath('userData'), 'baijie-desktop', 'window-state.json');
  const before = win.getBounds();
  assert.equal(win.isVisible(), false);
  if (phase === 'write') {
    await waitFor('__rig.idle.snapshot().enabled===true');
    await win.webContents.executeJavaScript('__rig.S.t=__rig.idle.snapshot().nextAt+0.05');
    await waitFor('__rig.idle.snapshot().active!==null');
    const first=await readIdle();
    const samples=[];
    for(let i=0;i<12;i++){
      await waitFor(`__rig.S.t>=${first.active.start+first.active.duration*i/11}`);
      const frame=await win.webContents.executeJavaScript(`new Promise(resolve=>requestAnimationFrame(()=>resolve({png:document.getElementById('stage').toDataURL('image/png'),t:__rig.S.t,x:__rig.S.angleX.x,y:__rig.S.angleY.x,idle:__rig.idle.snapshot()})))`);
      fs.writeFileSync(path.join(out,'turn-'+String(i).padStart(2,'0')+'.png'),electron.nativeImage.createFromDataURL(frame.png).toPNG());
      delete frame.png;samples.push(frame);
    }
    assert.ok(samples.some(s=>s.x>0.1) && samples.some(s=>s.x< -0.1));
    assert.ok(samples.every(s=>Number.isFinite(s.x) && Math.abs(s.x)<0.60));
    idleChecks.push({name:'finite-turn-sampled',samples});
    await win.webContents.executeJavaScript('__rig.S.t=__rig.idle.snapshot().nextAt+0.05');
    await waitFor('__rig.idle.snapshot().active!==null');
    idleChecks.push({name:'scheduled-turn-starts',state:await readIdle()});
    await win.webContents.executeJavaScript(`window.dispatchEvent(new PointerEvent('pointerdown',{button:0,pointerId:7,screenX:100,screenY:100}));__rig.S.t+=60`);
    await waitFor("__rig.idle.snapshot().active===null && __rig.idle.snapshot().held.includes('input')");
    const held=await readIdle();assert.equal(held.active,null);idleChecks.push({name:'held-input-cancels-and-blocks',state:held});
    await win.webContents.executeJavaScript(`window.dispatchEvent(new PointerEvent('pointerup',{button:0,pointerId:7,screenX:100,screenY:100}))`);
    const released=await readIdle();assert.equal(released.held.length,0);
    assert.ok(released.nextAt>await win.webContents.executeJavaScript('__rig.S.t')+13);
    idleChecks.push({name:'release-rearms-quiet-period',state:released});

    electron.ipcMain.emit('menu', { sender: win.webContents, senderFrame:win.webContents.mainFrame }, null);
    await waitFor("__rig.idle.snapshot().held.includes('menu')");
    popupCallback();
    await waitFor("!__rig.idle.snapshot().held.includes('menu')");
    idleChecks.push({name:'native-menu-release',state:await readIdle()});
    template.find(item=>item.label==='自动待机动作').click({checked:false});
    await waitFor('__rig.idle.snapshot().enabled===false');
    const initialClock=await win.webContents.executeJavaScript('__rig.S.t');
    await waitFor(`__rig.S.t>${initialClock+2}`);
    const pose=await win.webContents.executeJavaScript('({x:__rig.S.angleX.x,y:__rig.S.angleY.x,breath:__rig.S.breath.x})');
    assert.ok(Math.abs(pose.x)<0.005 && Math.abs(pose.y)<0.005);
    await waitFor(`Math.abs(__rig.S.breath.x-${pose.breath})>0.01`);
    idleChecks.push({name:'disabled-settles-but-breathes',pose,state:await readIdle()});
    const size = template.find(item => item.label === '大小');
    size.submenu[0].click();
    electron.ipcMain.emit('drag', { sender: win.webContents, senderFrame:win.webContents.mainFrame }, { dx: -35, dy: -25 });
    template.find(item => item.label === '始终置顶').click({ checked: false });
    app.emit('before-quit');
    const saved = JSON.parse(fs.readFileSync(settings, 'utf8'));
    assert.deepEqual(saved.bounds, win.getBounds());
    assert.equal(saved.size, 'small'); assert.equal(saved.alwaysOnTop, false); assert.equal(saved.idleEnabled,false);
    assert.ok(menus.some(menu => menu.some(item => item.label === '重置位置与大小')));
    fs.writeFileSync(path.join(out, 'expected.json'), JSON.stringify(saved));
  } else {
    const expected = JSON.parse(fs.readFileSync(path.join(out, 'expected.json'), 'utf8'));
    assert.deepEqual(win.getBounds(), expected.bounds);
    assert.equal(win.isAlwaysOnTop(), expected.alwaysOnTop);
    electron.ipcMain.emit('menu', { sender: win.webContents, senderFrame:win.webContents.mainFrame }, null);
    popupCallback();
    await waitFor('__rig.idle.snapshot().enabled===false');
    assert.equal(template.find(item=>item.label==='自动待机动作').checked,false);
    idleChecks.push({name:'disabled-preference-restored-to-renderer',state:await readIdle()});
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
  fs.writeFileSync(path.join(out, phase + '-result.json'), JSON.stringify({ passed: true, phase, idleChecks, before, bounds: win.getBounds(), settings: JSON.parse(fs.readFileSync(settings, 'utf8')), diagnostics }, null, 2));
  clearTimeout(timer); app.quit();
}
require('../puppet/main.js');
