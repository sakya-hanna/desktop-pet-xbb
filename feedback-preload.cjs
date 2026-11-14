'use strict';
// Sandboxed, receive-only: no dismiss, invoke, arbitrary channel or raw event API.
const { contextBridge, ipcRenderer } = require('electron');
function valid(value) {
  if (value === null) return true;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = Reflect.ownKeys(value);
  return keys.length === 2 && keys.includes('id') && keys.includes('text')
    && Number.isSafeInteger(value.id) && value.id > 0 && typeof value.text === 'string'
    && value.text.length > 0 && [...value.text].length <= 200;
}
if (process.isMainFrame) contextBridge.exposeInMainWorld('feedback', Object.freeze({
  onState(callback) {
    if (typeof callback !== 'function') throw new TypeError('Expected callback');
    const listener = (_event, ...args) => {
      if (args.length !== 1 || !valid(args[0])) return;
      const value = args[0]; callback(value === null ? null : { id: value.id, text: value.text });
    };
    ipcRenderer.on('feedback:state', listener);
    return () => ipcRenderer.removeListener('feedback:state', listener);
  },
}));
