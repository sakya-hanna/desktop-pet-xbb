const path = require('node:path');
const { create: createStore } = require('./conversation-store');

function create({ BrowserWindow, ipcMain, file, store = createStore({ file }), service }) {
  let window = null, loaded = false, destroyed = false;
  const channels = ['read', 'send', 'clear', 'cancel'];
  for (const action of channels) ipcMain.handle('chat:' + action, (event, payload) => {
    if (destroyed || !window || window.isDestroyed() || event.sender !== window.webContents
      || event.senderFrame !== window.webContents.mainFrame) throw Error('Invalid chat sender');
    if(service){
      if(action==='send')return service.send(payload);
      if(action==='clear')return service.clear();
      if(action==='cancel')return service.cancel();
      return service.state();
    }
    if (action === 'send') store.send(payload);
    if (action === 'clear') store.clear();
    return { messages: store.snapshot(), model: 'unconfigured' };
  });
  function open() {
    if (destroyed) return;
    if (window && !window.isDestroyed()) {
      if (loaded) { window.show(); window.focus(); }
      return;
    }
    loaded = false;
    const current = new BrowserWindow({ width: 420, height: 580, minWidth: 320, minHeight: 360,
      show: false, title: '和白姐聊天', backgroundColor: '#faf8f5', autoHideMenuBar: true,
      webPreferences: { preload: path.join(__dirname, 'chat-preload.js'), sandbox: true,
        contextIsolation: true, nodeIntegration: false, webSecurity: true } });
    window = current;
    current.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    for (const event of ['will-navigate', 'will-frame-navigate', 'will-redirect'])
      current.webContents.on(event, e => e.preventDefault());
    current.webContents.on('will-attach-webview', e => e.preventDefault());
    current.webContents.on('did-finish-load', () => {
      if (destroyed || window !== current || current.isDestroyed()) return;
      loaded = true; current.show(); current.focus();
    });
    current.on('closed', () => { service?.cancel(); if (window === current) { window = null; loaded = false; } });
    current.loadFile(path.join(__dirname, 'chat.html')).catch(() => {
      if (!current.isDestroyed()) current.destroy();
    });
  }
  function destroy() {
    if (destroyed) return;
    destroyed = true;service?.cancel();
    for (const action of channels) ipcMain.removeHandler('chat:' + action);
    if (window && !window.isDestroyed()) window.destroy();
    window = null;
  }
  return { open, destroy };
}
module.exports = { create };
