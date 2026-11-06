const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('chat', {
  read: () => ipcRenderer.invoke('chat:read'),
  send: text => ipcRenderer.invoke('chat:send', text),
  cancel: () => ipcRenderer.invoke('chat:cancel'),
  clear: () => ipcRenderer.invoke('chat:clear'),
});
