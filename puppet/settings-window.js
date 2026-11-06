'use strict';
const path = require('node:path');
function create({BrowserWindow, ipcMain, store, testConnection}) {
  let window = null, loaded = false, destroyed = false;
  const channels = ['read', 'save', 'test'];
  const snapshot = () => {
    const value = store.snapshot();
    return {baseUrl:value.baseUrl, model:value.model, keyConfigured:value.keyConfigured === true};
  };
  for (const action of channels) ipcMain.handle('settings:' + action, (event, payload) => {
    if (destroyed || !window || window.isDestroyed() || event.sender !== window.webContents ||
        !event.senderFrame || event.senderFrame !== window.webContents.mainFrame) throw Error('Invalid settings sender');
    if (action === 'read') return snapshot();
    if (action === 'test') return Promise.resolve().then(() => testConnection()).then(
      result => result?.ok === true ? {ok:true,message:'连接成功。'} : {ok:false,message:'连接失败，请检查已保存的配置。'},
      () => ({ok:false,message:'连接失败，请检查已保存的配置。'}));
    return Promise.resolve().then(async () => {
      try {
        if (!payload || typeof payload !== 'object' || Array.isArray(payload) ||
            typeof payload.baseUrl !== 'string' || typeof payload.model !== 'string' ||
            (Object.hasOwn(payload,'apiKey') && typeof payload.apiKey !== 'string')) throw Error();
        const value = {baseUrl:payload.baseUrl, model:payload.model};
        if (Object.hasOwn(payload,'apiKey')) value.apiKey = payload.apiKey;
        await store.save(value);
        return {ok:true,settings:snapshot()};
      } catch { return {ok:false,message:'保存失败，请检查配置和安全存储。'}; }
    });
  });
  function open() {
    if (destroyed) return;
    if (window && !window.isDestroyed()) {
      if (loaded) { window.show(); window.focus(); }
      return window;
    }
    loaded = false;
    const current = new BrowserWindow({width:500, height:620, minWidth:360, minHeight:500,
      show:false, title:'模型设置', backgroundColor:'#faf8f5', autoHideMenuBar:true,
      webPreferences:{preload:path.join(__dirname,'settings-preload.js'), sandbox:true,
        contextIsolation:true, nodeIntegration:false, webSecurity:true}});
    window = current;
    current.webContents.setWindowOpenHandler(() => ({action:'deny'}));
    for (const name of ['will-navigate','will-frame-navigate','will-redirect','will-attach-webview'])
      current.webContents.on(name, event => event.preventDefault());
    current.webContents.on('did-finish-load', () => {
      if (destroyed || window !== current || current.isDestroyed()) return;
      loaded = true; current.show(); current.focus();
    });
    current.on('closed', () => { if (window === current) { window = null; loaded = false; } });
    current.loadFile(path.join(__dirname,'settings.html')).catch(() => { if (!current.isDestroyed()) current.destroy(); });
    return current;
  }
  function destroy() {
    if (destroyed) return;
    destroyed = true;
    for (const action of channels) ipcMain.removeHandler('settings:' + action);
    if (window && !window.isDestroyed()) window.destroy();
    window = null;
  }
  return {open, destroy};
}
module.exports = {create};
