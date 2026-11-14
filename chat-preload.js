'use strict';
const { contextBridge, ipcRenderer } = require('electron');
if (process.isMainFrame === true) contextBridge.exposeInMainWorld('chat', Object.freeze({
  read: () => ipcRenderer.invoke('chat:read'),
  send: text => ipcRenderer.invoke('chat:send', text),
  cancel: () => ipcRenderer.invoke('chat:cancel'),
  clear: () => ipcRenderer.invoke('chat:clear'),
}));
