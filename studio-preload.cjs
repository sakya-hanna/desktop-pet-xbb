'use strict';
const {contextBridge,ipcRenderer}=require('electron');
function subscribe(channel,fn){if(typeof fn!=='function')throw Error('Expected callback');const listener=(_e,value)=>fn(value);ipcRenderer.on(channel,listener);return()=>ipcRenderer.removeListener(channel,listener);}
if(process.isMainFrame)contextBridge.exposeInMainWorld('studio',Object.freeze({
 read:()=>ipcRenderer.invoke('studio:read'),ready:()=>ipcRenderer.send('studio:ready'),
 command:(name,value)=>ipcRenderer.invoke('studio:command',name,value),
 onChat:fn=>subscribe('studio:chat',fn),onState:fn=>subscribe('studio:state',fn)
}));
