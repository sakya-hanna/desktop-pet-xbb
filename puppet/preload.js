const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pet', {
  drag: (dx, dy) => ipcRenderer.send('drag', { dx, dy }),
  menu: (pos) => ipcRenderer.send('menu', pos || {}),
  quit: () => ipcRenderer.send('quit'),
  ready: () => ipcRenderer.send('idle-ready'),
  speechState: state => ipcRenderer.send('speech-state', state),
  setInteractive: on => ipcRenderer.send('interactive', on),
  resizeBy: (factor, anchor) => ipcRenderer.send('resize-by', anchor === undefined ? factor : {factor, anchor}),
  onAction: (handler) => ipcRenderer.on('action', (_e, name) => handler(name)),
  onChatReply: handler => ipcRenderer.on('chat:reply', (_event, reply) => handler(reply)),
  cancelReply: () => ipcRenderer.send('model:cancel'),
});
