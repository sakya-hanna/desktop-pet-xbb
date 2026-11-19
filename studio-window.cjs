'use strict';
const path=require('node:path');
const {assertSessionPolicy}=require('./resource-policy.cjs');
const {fromMainFrame}=require('./shared/ipc-policy.js');
const URL='baijie28://app/studio.html';
function create({electron,session,root,mode,read,command,onEnter,onReturn}){
 assertSessionPolicy(session);
 let window=null,entered=false,dead=false;
 const trusted=e=>!dead&&fromMainFrame(e,window)&&e.senderFrame.url===URL;
 const handlers={
  'studio:read':e=>{if(!trusted(e))throw Error('Invalid studio sender');return read();},
  'studio:command':(e,name,value)=>{
   if(!trusted(e))throw Error('Invalid studio sender');
   if(name==='desktop'){close();return true;}
   if(['chat','settings','chat-cancel','tools'].includes(name)&&value===undefined)return command(name,undefined,window);
   if(['idle','follow','effects'].includes(name)&&typeof value==='boolean')return command(name,value,window);
   return false;
  }
 };
 for(const [name,fn]of Object.entries(handlers))electron.ipcMain.handle(name,fn);
 function ready(e){
  if(!trusted(e)||entered)return;
  entered=true;onEnter();
  if(mode==='visible'){window.show();window.focus();}
 }
 electron.ipcMain.on('studio:ready',ready);
 function close(){if(window&&!window.isDestroyed())window.close();}
 function open(){
  if(dead)return null;
  if(window&&!window.isDestroyed()){if(entered&&mode==='visible'){window.show();window.focus();}return window;}
  const area=electron.screen.getDisplayMatching(read().bounds).workArea;
  const w=new electron.BrowserWindow({width:Math.min(1280,area.width),height:Math.min(820,area.height),minWidth:720,minHeight:560,
   show:false,title:'白姐 · 窗边小憩',backgroundColor:'#eef5f7',autoHideMenuBar:true,focusable:mode==='visible',
   webPreferences:{session,preload:path.join(root,'studio-preload.cjs'),sandbox:true,contextIsolation:true,nodeIntegration:false,
    webSecurity:true,offscreen:mode==='hidden',backgroundThrottling:false}});
  window=w;entered=false;w.setMenu(null);
  if(mode==='hidden')w.webContents.setFrameRate(60);
  w.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  for(const name of ['will-navigate','will-frame-navigate','will-redirect','will-attach-webview'])w.webContents.on(name,e=>e.preventDefault());
  w.on('closed',()=>{if(window!==w)return;const returnToPet=entered;window=null;entered=false;if(returnToPet&&!dead)onReturn();});
  const fail=()=>{if(!w.isDestroyed())w.destroy();};
  w.webContents.on('render-process-gone',fail);
  w.webContents.on('did-fail-load',(_e,_code,_message,_url,main)=>{if(main!==false)fail();});
  try{Promise.resolve(w.loadURL(URL)).catch(fail);}catch{fail();}
  return w;
 }
 function publish(channel,value){if(!window||window.isDestroyed()||!entered)return false;window.webContents.send(channel,value);return true;}
 function destroy(){dead=true;for(const name of Object.keys(handlers))electron.ipcMain.removeHandler(name);electron.ipcMain.removeListener('studio:ready',ready);if(window&&!window.isDestroyed())window.destroy();window=null;}
 return {open,close,destroy,isOpen:()=>!!window&&!window.isDestroyed(),publishChat:value=>publish('studio:chat',value),publishState:()=>publish('studio:state',read())};
}
module.exports={create,URL};
