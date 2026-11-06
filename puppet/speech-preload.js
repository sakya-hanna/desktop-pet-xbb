// Sandboxed preload: Electron is the only permitted require.
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('speech', {
  onState(callback) {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('speech:state', listener);
    return () => ipcRenderer.removeListener('speech:state', listener);
  },
  dismiss(id) { ipcRenderer.send('speech:dismiss', id); },
});
