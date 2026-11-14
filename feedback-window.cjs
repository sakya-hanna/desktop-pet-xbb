'use strict';
const path = require('node:path');
const { layoutSpeech } = require('./shared/speech-layout.js');
const { assertSessionPolicy } = require('./resource-policy.cjs');
const FEEDBACK_URL = 'baijie28://app/feedback.html';
const DEFAULT_DURATION = 3400;
const MAX_DURATION = 15000;
function validFeedback(value) {
  if (value === null) return true;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = Reflect.ownKeys(value);
  if (!keys.includes('id') || !keys.includes('text')
    || keys.some(key => !['id', 'text', 'durationMs', 'kind'].includes(key))) return false;
  const id = Object.getOwnPropertyDescriptor(value, 'id'), text = Object.getOwnPropertyDescriptor(value, 'text');
  const duration = Object.getOwnPropertyDescriptor(value, 'durationMs');
  const kind = Object.getOwnPropertyDescriptor(value, 'kind');
  if (kind && (!Object.hasOwn(kind,'value') || kind.value !== 'chat')) return false;
  const chat = kind?.value === 'chat';
  return !!id && !!text && Object.hasOwn(id, 'value') && Object.hasOwn(text, 'value')
    && Number.isSafeInteger(id.value) && id.value > 0 && typeof text.value === 'string'
    && text.value.length > 0 && [...text.value].length <= (chat ? 4000 : 200)
    && (!duration || (Object.hasOwn(duration, 'value') && Number.isInteger(duration.value)
      && duration.value >= DEFAULT_DURATION && duration.value <= (chat ? 60000 : MAX_DURATION)));
}

// Owns one passive child, one expiry and the lifetime ID high-water mark.
// Never changes parent bounds or falls back to a default session/file URL.
function createFeedbackWindow({ BrowserWindow, screen, parent, session, root, mode = 'hidden', clock = globalThis, retainOnBlur = () => false }) {
  if (!['hidden', 'visible'].includes(mode)) throw new TypeError('Invalid feedback mode');
  assertSessionPolicy(session);
  const now = typeof clock.now === 'function' ? () => clock.now() : () => performance.now();
  let bubble = null, loaded = false, destroyed = false, enabled = true;
  let current = null, highWater = 0, timer = null;
  const parentListeners = [], childListeners = [];
  const alive = () => !destroyed && !parent.isDestroyed();
  const childAlive = () => bubble && !bubble.isDestroyed();
  function listen(target, name, fn, list) { target.on(name, fn); list.push([target, name, fn]); }
  function unlisten(list) { for (const [target, name, fn] of list.splice(0)) target.removeListener(name, fn); }
  function clear() {
    const hadState = current !== null;
    current = null;
    if (timer !== null) { clock.clearTimeout(timer); timer = null; }
    if (childAlive()) {
      try { if (hadState && loaded) bubble.webContents.send('feedback:state', null); } catch {}
      try { bubble.hide(); } catch {}
    }
  }
  function retire() {
    clear(); const owned = bubble; bubble = null; loaded = false;
    unlisten(childListeners);
    if (owned && !owned.isDestroyed()) { try { owned.destroy(); } catch {} }
  }
  function sync() {
    if (!alive() || !current) return;
    if (!enabled || now() >= current.deadline || (mode === 'visible' && !parent.isVisible())) { clear(); return; }
    if (!childAlive() || !loaded) return;
    try {
      const bounds = parent.getBounds();
      const placement = layoutSpeech(bounds, screen.getDisplayMatching(bounds).workArea,
        { scale: Math.min(1.5, Math.max(0.75, bounds.height / 348)), textLength: current.kind==='chat'&&[...current.text].length>50?101:[...current.text].length });
      if (!placement) { clear(); return; }
      bubble.setBounds(placement);
      // Match the pet's level. The default 'floating' inserts behind the Windows
      // taskbar; when that is non-topmost it also demotes this window's owner.
      bubble.setAlwaysOnTop(parent.isAlwaysOnTop(), 'screen-saver');
      if (mode === 'visible') bubble.showInactive();
    } catch { retire(); }
  }
  function deliver() {
    if (!alive() || !current || !loaded || !childAlive()) return;
    if (!enabled || now() >= current.deadline || (mode === 'visible' && !parent.isVisible())) { clear(); return; }
    try { bubble.webContents.send('feedback:state', { id: current.id, text: current.text }); sync(); }
    catch { retire(); }
  }
  function ensureWindow() {
    if (childAlive()) return;
    const owned = new BrowserWindow({ parent, width: 300, height: 130, show: false,
      transparent: true, backgroundColor: '#00000000', frame: false, focusable: false,
      resizable: false, minimizable: false, maximizable: false, skipTaskbar: true, hasShadow: false,
      webPreferences: { session, preload: path.join(root, 'feedback-preload.cjs'),
        nodeIntegration: false, contextIsolation: true, webSecurity: true, sandbox: true,
        offscreen: mode === 'hidden', backgroundThrottling: false } });
    bubble = owned; loaded = false;
    owned.setMenu(null); owned.setIgnoreMouseEvents(true, { forward: true });
    owned.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    for (const name of ['will-navigate', 'will-frame-navigate', 'will-redirect', 'will-attach-webview'])
      listen(owned.webContents, name, event => event.preventDefault(), childListeners);
    const fail = () => { if (bubble === owned) retire(); };
    listen(owned.webContents, 'did-fail-load', (_event, _code, _description, _url, isMainFrame) => {
      if (isMainFrame !== false) fail();
    }, childListeners);
    listen(owned.webContents, 'render-process-gone', fail, childListeners);
    listen(owned, 'closed', fail, childListeners);
    Promise.resolve(owned.loadURL(FEEDBACK_URL)).then(() => {
      if (!alive() || bubble !== owned || owned.isDestroyed()) return;
      loaded = true; deliver();
    }).catch(fail);
  }
  function set(value) {
    if (!alive() || !validFeedback(value)) return false;
    if (value === null) { clear(); return true; }
    if (value.id <= highWater) return false;
    highWater = value.id;
    clear();
    // Consume hidden IDs too: queued traffic cannot revive on a later show.
    if (!enabled || (mode === 'visible' && !parent.isVisible())) return false;
    const durationMs = Object.getOwnPropertyDescriptor(value, 'durationMs')?.value ?? DEFAULT_DURATION;
    // A passive, click-through bubble cannot scroll a full 4000-codepoint reply.
    // Show an explicit excerpt; the unabridged message remains in the chat page.
    const normalized=value.kind==='chat'?value.text.replace(/\s+/gu,' ').trim():value.text;
    const chars=[...normalized],text=value.kind==='chat'&&chars.length>100
      ? chars.slice(0,100).join('')+'…（完整回复见聊天窗口）' : normalized;
    current = { id: value.id, text, kind:value.kind, deadline: now() + durationMs };
    const ownedState = current;
    timer = clock.setTimeout(() => { if (current === ownedState) clear(); }, durationMs);
    timer?.unref?.();
    try { ensureWindow(); deliver(); }
    catch { retire(); return false; }
    return true;
  }
  function setEnabled(value) { enabled = value === true; if (!enabled) clear(); }
  function destroy() {
    if (destroyed) return;
    destroyed = true; retire(); unlisten(parentListeners);
  }
  listen(parent, 'move', sync, parentListeners); listen(parent, 'resize', sync, parentListeners);
  listen(parent, 'blur', () => { if (!retainOnBlur()) clear(); }, parentListeners);
  listen(parent, 'hide', () => setEnabled(false), parentListeners);
  listen(parent, 'closed', destroy, parentListeners);
  return { set, clear, sync, setEnabled, destroy };
}
module.exports = { createFeedbackWindow, validFeedback, FEEDBACK_URL, DEFAULT_DURATION, MAX_DURATION };
