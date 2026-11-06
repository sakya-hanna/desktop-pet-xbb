const path = require('node:path');
const { layoutSpeech } = require('./speech-layout');

// Parent integration owns event wiring and expiry. This module never changes parent bounds.
function create({ BrowserWindow, screen, ipcMain, parent, onDismiss }) {
  let bubble = null, state = null, loaded = false, destroyed = false, clickThrough = false;
  function hide() {
    state = null;
    if (bubble && !bubble.isDestroyed()) bubble.hide();
  }
  function dismiss() {
    if (!state) return;
    const id = state.id;
    // Clear BEFORE notifying: the callback may synchronously show a replacement.
    hide();
    if (onDismiss) onDismiss(id);
  }
  function onCloseRequest(event, id) {
    if (destroyed || !loaded || !bubble || bubble.isDestroyed() || !state) return;
    if (event.sender !== bubble.webContents || id !== state.id) return;
    dismiss();
  }
  ipcMain.on('speech:dismiss', onCloseRequest);
  function setClickThrough(on) {
    clickThrough = !!on;
    if (!bubble || bubble.isDestroyed()) return;
    if (clickThrough) bubble.setIgnoreMouseEvents(true, { forward: true });
    else bubble.setIgnoreMouseEvents(false);
  }
  function show(next) {
    if (destroyed || parent.isDestroyed()) return;
    state = { ...next };
    if (!bubble || bubble.isDestroyed()) {
      loaded = false;
      const window = new BrowserWindow({ parent, width: 300, height: 130, show: false,
        transparent: true, backgroundColor: '#00000000', frame: false,
        resizable: false, skipTaskbar: true, hasShadow: false,
        webPreferences: { preload: path.join(__dirname, 'speech-preload.js'),
          nodeIntegration: false, contextIsolation: true, webSecurity: true, sandbox: true } });
      bubble = window;
      setClickThrough(clickThrough);
      window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      window.webContents.on('will-navigate', event => event.preventDefault());
      window.webContents.on('did-finish-load', () => {
        if (destroyed || bubble !== window || window.isDestroyed()) return;
        loaded = true;
        if (state) window.webContents.send('speech:state', state);
        sync();
      });
      window.webContents.on('did-fail-load', (_event, _code, _description, _url, isMainFrame) => {
        if (!destroyed && bubble === window && isMainFrame !== false) dismiss();
      });
      window.loadFile(path.join(__dirname, 'speech.html'));
    } else if (loaded) bubble.webContents.send('speech:state', state);
    if (loaded) sync();
  }
  function sync() {
    if (destroyed || !bubble || bubble.isDestroyed() || !loaded || !state) return;
    if (parent.isDestroyed() || !parent.isVisible()) { bubble.hide(); return; }
    const bounds = parent.getBounds();
    const placement = layoutSpeech(bounds, screen.getDisplayMatching(bounds).workArea);
    if (!placement) { dismiss(); return; }
    bubble.setBounds(placement);
    bubble.setAlwaysOnTop(parent.isAlwaysOnTop(), 'screen-saver');
    bubble.showInactive();
  }
  function destroy() {
    if (destroyed) return;
    destroyed = true;
    state = null;
    ipcMain.removeListener('speech:dismiss', onCloseRequest);
    if (bubble && !bubble.isDestroyed()) bubble.destroy();
    bubble = null;
    loaded = false;
  }
  return { show, hide, sync, destroy, setClickThrough };
}
module.exports = { create };
