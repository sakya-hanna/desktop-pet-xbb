'use strict';
// Shared main-only window policy. Pages never own a session or choose a URL.
const path=require('node:path');
const {assertSessionPolicy}=require('./resource-policy.cjs');
const {fromMainFrame}=require('./shared/ipc-policy.js');
function create({BrowserWindow,ipcMain,session,root=__dirname,mode='hidden',page,title,width,height,actions,onClose=()=>{}}){
 assertSessionPolicy(session);
 if(path.resolve(root)!==path.resolve(__dirname)||!['hidden','visible'].includes(mode)||!['chat','settings'].includes(page))throw Error('Invalid panel configuration');
 const url='baijie28://app/'+page+'.html',channels=[];let window=null,loaded=false,destroyed=false;
 function trusted(event){return !destroyed&&fromMainFrame(event,window)&&event.senderFrame.url===url;}
 try{for(const [action,{arity,run}] of Object.entries(actions)){
  const channel=page+':'+action;ipcMain.handle(channel,(event,...args)=>{if(!trusted(event)||args.length!==arity)throw Error('Invalid '+page+' sender or arguments');return run(...args);});channels.push(channel);
 }}catch(error){for(const channel of channels)ipcMain.removeHandler(channel);throw error;}
 function open(){
  if(destroyed)return null;
  if(window&&!window.isDestroyed()){if(loaded&&mode==='visible'){window.show();window.focus();}return window;}
  loaded=false;
  const current=new BrowserWindow({width,height,minWidth:320,minHeight:360,show:false,focusable:mode==='visible',title,backgroundColor:'#f2f6fa',autoHideMenuBar:true,
   webPreferences:{session,preload:path.join(root,page+'-preload.js'),sandbox:true,contextIsolation:true,nodeIntegration:false,webSecurity:true,offscreen:mode==='hidden'}});
  window=current;current.setMenu(null);current.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  for(const name of ['will-navigate','will-frame-navigate','will-redirect','will-attach-webview'])current.webContents.on(name,event=>event.preventDefault());
  current.on('closed',()=>{if(window===current){window=null;loaded=false;onClose();}});
  function failed(){if(!current.isDestroyed())current.destroy();}
  try{Promise.resolve(current.loadURL(url)).then(()=>{if(destroyed||window!==current||current.isDestroyed())return;loaded=true;if(mode==='visible'){current.show();current.focus();}},failed);}catch{failed();}
  return current;
 }
 function destroy(){if(destroyed)return;destroyed=true;for(const channel of channels)ipcMain.removeHandler(channel);try{if(window&&!window.isDestroyed())window.destroy();}finally{window=null;loaded=false;}}
 return {open,destroy};
}
module.exports={create};
