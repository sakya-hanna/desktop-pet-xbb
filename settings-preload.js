'use strict';
const {contextBridge, ipcRenderer} = require('electron');
if (process.isMainFrame === true) contextBridge.exposeInMainWorld('settings', Object.freeze({
  read: () => ipcRenderer.invoke('settings:read'),
  save: value => ipcRenderer.invoke('settings:save', value),
  test: () => ipcRenderer.invoke('settings:test')
}));
