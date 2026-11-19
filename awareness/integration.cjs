'use strict';
const path=require('node:path'),persistence=require('../chat-persistence.cjs');
const {assertNoSymlinks}=require('../resource-policy.cjs');
const {fromMainFrame}=require('../shared/ipc-policy.js');
function create({electron,window,profileRoot,mode,getConfig,available,busy,menuOpen=()=>false,onChange=()=>{},clock=globalThis,options={}}){
  if(mode!=='hidden'&&Object.keys(options).length)throw Error('Awareness test options are hidden-only');
  const file=path.join(profileRoot,'awareness-settings.json');assertNoSymlinks(file,{allowMissing:true});
  const loaded=persistence.read(file,4096,v=>{if(Object.keys(v).some(k=>!['version','enabled'].includes(k))||typeof v.enabled!=='boolean')throw Error();return v;});
  const writable=['valid','missing'].includes(loaded.status);
  const journal=require('./journal.cjs').create({file:path.join(profileRoot,'logs','awareness.jsonl')});
  journal.write({phase:'session-start'});
  let rendererBusy=true,sequence=0,pending=null,dead=false,locked=false;
  const native=options.native||require('./native.cjs').create(electron);
  const idleSeconds=options.idleSeconds||(()=>electron.powerMonitor?.getSystemIdleTime?.()??0);
  function settle(accepted){if(!pending)return;clock.clearTimeout(pending.timer);const resolve=pending.resolve;pending=null;resolve(accepted);}
  function deliver(value){
    if(dead)return Promise.resolve(false);
    return new Promise(resolve=>{
      settle(false);const id=++sequence;
      pending={id,resolve,timer:clock.setTimeout(()=>settle(false),1500)};
      window.webContents.send('awareness:present',{id,text:value.text});
    });
  }
  const controller=require('./controller.cjs').create({
    activeWindow:native.activeWindow,manualTarget:native.screenTarget||native.activeWindow,capture:native.capture,classify:options.classify||require('./vision.cjs').classify,
    getConfig,available:()=>!locked&&available(),busy:()=>rendererBusy||busy(),paused:menuOpen,idleSeconds,deliver,clock,onChange,onDiagnostic:journal.write,
    enabled:loaded.value?.enabled===true,...(options.timing||{})
  });
  const trusted=event=>!dead&&fromMainFrame(event,window)&&event.senderFrame.url==='baijie28://app/desktop.html';
  const onState=(event,...args)=>{if(trusted(event)&&args.length===1&&typeof args[0]==='boolean'){rendererBusy=args[0];if(rendererBusy){controller.interrupt();settle(false);}}};
  const onResult=(event,...args)=>{if(trusted(event)&&args.length===2&&pending&&args[0]===pending.id&&typeof args[1]==='boolean')settle(args[1]);};
  const onEvent=(event,value)=>{if(trusted(event)&&value&&['gesture-started','bubble-sent','response-ended'].includes(value.phase))journal.write(value);};
  electron.ipcMain.on('awareness:busy',onState);electron.ipcMain.on('awareness:result',onResult);
  electron.ipcMain.on('awareness:event',onEvent);
  const pause=()=>{locked=true;controller.interrupt();settle(false);};
  const resume=()=>{locked=false;controller.interrupt();};
  for(const name of ['lock-screen','suspend'])electron.powerMonitor?.on?.(name,pause);
  for(const name of ['unlock-screen','resume'])electron.powerMonitor?.on?.(name,resume);
  function setEnabled(value){
    if(!writable)return false;
    try{assertNoSymlinks(file,{allowMissing:true});persistence.commit(file,{version:1,enabled:value===true});}
    catch{return false;}
    settle(false);controller.setEnabled(value);return true;
  }
  function menu(){const state=controller.state();return {id:'screen-companion',label:'屏幕陪伴',submenu:[
    {id:'awareness:enabled',label:'在 Codex 工作时鼓励我',type:'checkbox',checked:state.enabled,enabled:writable,click:item=>setEnabled(item.checked)},
    {id:'awareness:now',label:'现在看看（5 秒后看鼠标所在屏幕）',click:()=>controller.arm()},
    {type:'separator'},{label:writable?(state.code==='cooldown'?'自动鼓励冷却中（约 '+Math.ceil(state.cooldownSeconds/60)+' 分钟）':state.label):'陪伴设置读取失败，未覆盖原文件',enabled:false},
    ...(state.lastManual?[{label:'上次手动观察：'+state.lastManual.label,enabled:false}]:[]),
    ...(journal.failed()?[{label:'诊断日志写入失败',enabled:false}]:[]),
    {label:'手动看所在屏幕；自动看符合互动规则的窗口',enabled:false},
    {label:'图像发送到模型设置中的接口；不保存截图',enabled:false}
  ]};}
  function destroy(){
    dead=true;controller.destroy();settle(false);electron.ipcMain.removeListener('awareness:busy',onState);electron.ipcMain.removeListener('awareness:result',onResult);
    electron.ipcMain.removeListener('awareness:event',onEvent);
    for(const name of ['lock-screen','suspend'])electron.powerMonitor?.removeListener?.(name,pause);
    for(const name of ['unlock-screen','resume'])electron.powerMonitor?.removeListener?.(name,resume);
  }
  return {menu,state:controller.state,setEnabled,observeNow:()=>controller.tick(true),arm:controller.arm,diagnostic:journal.write,
    interrupt(){controller.interrupt();settle(false);},destroy};
}
module.exports={create};
