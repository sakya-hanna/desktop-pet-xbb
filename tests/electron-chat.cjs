// Real main/preload/DOM acceptance. All BrowserWindows stay physically hidden.
const electron = require('electron'), { app } = electron;
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const Module = require('node:module'), { EventEmitter } = require('node:events');
const out = process.env.BAIJIE_CHAT_OUT;
if (!out) throw Error('BAIJIE_CHAT_OUT required (fresh isolated output directory)');
fs.mkdirSync(path.dirname(out), { recursive: true }); fs.mkdirSync(out);
app.setPath('userData', path.join(out, 'isolated-profile'));
app.commandLine.appendSwitch('use-angle', 'swiftshader');
app.commandLine.appendSwitch('enable-unsafe-swiftshader');
for (const k of Object.keys(process.env)) if (k.startsWith('PUPPET_')) delete process.env[k];
let host, chat, template; const windows = [], paints = new Map(), errors = [], requests = [], checks = [];
class HiddenWindow extends electron.BrowserWindow {
  constructor(options) {
    super({ ...options, show: false, webPreferences: { ...options.webPreferences, offscreen: true, backgroundThrottling: false } });
    this.logicalVisible = !options.parent; windows.push(this);
    const isChat = options.webPreferences.preload.endsWith('chat-preload.js');
    if (isChat) chat = this; else if (!options.parent) host = this;
    this.webContents.on('paint', (_e, _r, image) => { if (!image.isEmpty()) paints.set(this, image); });
    this.webContents.on('console-message', (_e, level, msg) => { if (level >= 3) errors.push(msg); });
    this.webContents.once('did-finish-load', () => { if (this === host) verify().catch(fail); });
  }
  show() { this.logicalVisible = true; }
  showInactive() { this.logicalVisible = true; }
  hide() { this.logicalVisible = false; this.emit('hide'); }
  focus() {} // Never steal desktop focus, including when manager calls focus after load.
  isVisible() { return this.logicalVisible; }
}
class Tray extends EventEmitter { setToolTip() {} }
const overrides = { BrowserWindow: HiddenWindow, Tray, globalShortcut: { register() { return true; }, unregisterAll() {} },
  Menu: { buildFromTemplate(t) { template = t; return { popup(o) { o.callback?.(); } }; } } };
const proxy = new Proxy(electron, { get(t, k) { return Object.hasOwn(overrides, k) ? overrides[k] : t[k]; } });
const load = Module._load, main = path.resolve(__dirname, '../puppet/main.js');
const logFs = new Proxy(fs, { get(t, k) { if (k !== 'appendFileSync') return t[k]; return (file, ...args) => {
  const logs = path.join(out, 'logs'); fs.mkdirSync(logs, { recursive: true }); return fs.appendFileSync(path.join(logs, path.basename(file)), ...args);
}; } });
Module._load = function(name, parent, isMain) {
  if (name === 'electron') return proxy;
  if (name === 'fs' && parent?.filename === main) return logFs;
  return load.call(this, name, parent, isMain);
};
const timer = setTimeout(() => fail(Error('chat deadline')), 60000);
function fail(error) {
  fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify({ passed: false, error: error.stack, checks, errors, requests }, null, 2)); app.exit(1);
}
const wait = ms => new Promise(r => setTimeout(r, ms));
async function until(fn) { const end = Date.now() + 12000; while (!await fn()) { if (Date.now() > end) throw Error('chat condition timeout: ' + fn); await wait(20); } }
const js = (w, code) => w.webContents.executeJavaScript(code);
const count = () => js(chat, 'document.querySelectorAll(".message").length');
const historyFile = () => path.join(app.getPath('userData'), 'baijie-desktop', 'conversation.json');
async function ready() { await until(() => chat && !chat.webContents.isLoading()); await until(() => js(chat, '!!window.chat && !document.querySelector("#clear").disabled')); }
function open() { electron.ipcMain.emit('menu', { sender: host.webContents, senderFrame:host.webContents.mainFrame }, null); template.find(i => i.label === '和白姐聊天').click(); }
async function input(text) { await js(chat, `document.querySelector('#message-input').value=${JSON.stringify(text)};document.querySelector('#message-input').dispatchEvent(new Event('input',{bubbles:true}))`); }
async function submit() { await js(chat, "document.querySelector('#composer').requestSubmit()"); }
async function screenshot(name) { await until(() => paints.has(chat)); await wait(150); fs.writeFileSync(path.join(out, name + '.png'), paints.get(chat).toPNG()); }
async function verify() {
  await until(() => js(host, '!!window.__rig?.ready'));
  const bounds = host.getBounds(), face = await js(host, '__rig.S.faceId');
  electron.session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] }, (details, callback) => { requests.push(details.url); callback({ cancel: true }); });
  open(); await ready(); assert.equal(await count(), 0);
  const prefs = chat.webContents.getLastWebPreferences();
  assert.equal(prefs.sandbox, true); assert.equal(prefs.contextIsolation, true); assert.equal(prefs.nodeIntegration, false); assert.equal(prefs.webSecurity, true);
  assert.equal(await js(chat, 'typeof require'), 'undefined'); assert.equal(await js(chat, 'typeof window.pet'), 'undefined');
  assert.deepEqual(await js(chat, 'Object.keys(window.chat).sort()'), ['cancel', 'clear', 'read', 'send']);
  checks.push({ name: 'real-menu-preload-secure-independent-window', passed: true });
  await input('  '); await submit(); await wait(80); assert.equal(await count(), 0);
  await input('输入法测试');
  await js(chat, `(()=>{const e=document.querySelector('#message-input');e.dispatchEvent(new CompositionEvent('compositionstart'));e.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));e.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',isComposing:true,bubbles:true}));})()`);
  await wait(80); assert.equal(await count(), 0);
  await js(chat, "document.querySelector('#message-input').dispatchEvent(new CompositionEvent('compositionend'))");
  const literal = '<img src=x onerror="window.injected=true">\n中文🌷 123 B';
  await input(literal); await js(chat, "document.querySelector('#message-input').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}))");
  await until(async () => await count() === 2);
  assert.equal(await js(chat, "document.querySelector('.message.user div').textContent"), literal);
  assert.equal(await js(chat, 'document.querySelectorAll("img").length'), 0); assert.equal(await js(chat, '!!window.injected'), false);
  assert.match(await js(chat, 'document.querySelector(".message.system").textContent'), /未配置模型/);
  assert.deepEqual(host.getBounds(), bounds); assert.equal(await js(host, '__rig.S.faceId'), face);
  assert.equal(await js(host, '__rig.dialogue.snapshot().visible'), false);
  assert.equal(JSON.parse(fs.readFileSync(historyFile())).messages[0].text, literal);
  checks.push({ name: 'empty-ime-enter-literal-text-system-only-no-rig-shortcuts', passed: true });
  await screenshot('chat-history');
  await input('🌷'.repeat(4001)); assert.equal(await js(chat, 'document.querySelector("#send").disabled'), true); await submit(); await wait(50); assert.equal(await count(), 2);
  await input('🌷'.repeat(4000)); assert.equal(await js(chat, 'document.querySelector("#send").disabled'), false); await submit(); await until(async () => await count() === 4);
  checks.push({ name: 'unicode-4000-accepted-4001-rejected', passed: true });
  const previous = chat; previous.close(); await until(() => previous.isDestroyed()); open(); await ready(); assert.notEqual(chat, previous); assert.equal(await count(), 4);
  const restored = require('../puppet/conversation-store').create({ file: historyFile() }).snapshot(); assert.equal(restored.length, 4); assert.equal(restored[0].text, literal);
  checks.push({ name: 'close-reopen-and-fresh-store-disk-restore', passed: true });
  await js(chat, "document.querySelector('#clear').click()"); assert.equal(await js(chat, 'document.querySelector("#clear-dialog").open'), true); await screenshot('chat-clear-confirm');
  await js(chat, "document.querySelector('#clear-cancel').click()"); assert.equal(await count(), 4);
  await js(chat, "document.querySelector('#clear').click();document.querySelector('#clear-confirm').click()"); await until(async () => await count() === 0);
  assert.deepEqual(require('../puppet/conversation-store').create({ file: historyFile() }).snapshot(), []);
  checks.push({ name: 'custom-clear-cancel-confirm-real-persistence', passed: true });
  await screenshot('chat-cleared');
  // Invalid top-level sender on the exact installed handler (no exposed renderer raw IPC).
  const handler = electron.ipcMain._invokeHandlers.get('chat:send');
  assert.throws(() => handler({ sender: host.webContents, senderFrame: host.webContents.mainFrame }, 'forged'), /sender/);
  assert.throws(() => handler({ sender: chat.webContents, senderFrame: {} }, 'forged'), /sender/);
  let prevented = false; chat.webContents.emit('will-navigate', { preventDefault() { prevented = true; } }, 'https://invalid.test/'); assert.equal(prevented, true);
  checks.push({ name: 'actual-installed-ipc-handler-refuses-host-and-subframe-navigation-blocked', passed: true });
  // Exercise production main->real preload->rig dialogue, not a fake pet API.
  assert.equal(await js(host,'typeof window.pet.onChatReply'), 'function');
  host.webContents.send('chat:reply',{reply:'桥接验收：姐姐在呢。',face:3942,action:'none'});
  await until(()=>js(host,"__rig.dialogue.snapshot().visible && __rig.dialogue.snapshot().text==='桥接验收：姐姐在呢。'"));
  assert.equal(await js(host,'__rig.dialogue.snapshot().source'),'model');
  let cancelled=false;electron.ipcMain.once('model:cancel',()=>{cancelled=true;});
  await js(host,`__rig.setFace(${JSON.stringify(face)})`);await until(()=>cancelled);
  checks.push({name:'real-pet-preload-model-bubble-and-manual-cancellation',passed:true});
  for (const w of windows) if (!w.isDestroyed()) assert.equal(electron.BrowserWindow.prototype.isVisible.call(w), false);
  app.emit('before-quit'); const saved = JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'baijie-desktop', 'window-state.json')));
  assert.equal('messages' in saved, false); assert.deepEqual(errors, []); assert.deepEqual(requests, []);
  fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify({ passed: true, checks, errors, requests, physicalWindowsVisible: false, saved, history: JSON.parse(fs.readFileSync(historyFile())) }, null, 2));
  clearTimeout(timer); app.quit();
}
require('../puppet/main.js');
