'use strict';
const {create:createPanel}=require('./chat-panel.cjs');
function create({BrowserWindow,ipcMain,session,root,mode,service}){
 if(!service||['state','send','clear','cancel'].some(k=>typeof service[k]!=='function'))throw Error('Explicit chat service required');
 const panel=createPanel({BrowserWindow,ipcMain,session,root,mode,page:'chat',title:'和白姐聊天',width:440,height:720,onClose:()=>service.cancel(),actions:{
  read:{arity:0,run:()=>service.state()},send:{arity:1,run:text=>service.send(text)},clear:{arity:0,run:()=>service.clear()},cancel:{arity:0,run:()=>service.cancel()}
 }});
 return {open:panel.open,destroy(){service.cancel();panel.destroy();}};
}
module.exports={create};
