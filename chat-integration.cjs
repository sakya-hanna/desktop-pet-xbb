'use strict';
const fs=require('node:fs'),path=require('node:path');
const {validateProfile,assertNoSymlinks,assertSessionPolicy}=require('./resource-policy.cjs');
// Called lazily by the shell, never by renderer data. No legacy profile lookup.
function create({electron,session,root,profileRoot,mode,storageLayout,appDataRoot,chatOptions={},onReply,onCancel,onSettingsChange=()=>{}}){
 profileRoot=validateProfile({root,profileRoot,mode,storageLayout,appDataRoot});assertSessionPolicy(session);
 if(!chatOptions||typeof chatOptions!=='object'||Array.isArray(chatOptions)||Object.keys(chatOptions).some(k=>!['request','settingsStore'].includes(k))||(chatOptions.request!==undefined&&typeof chatOptions.request!=='function'))throw Error('Invalid main chat options');
 const settingsFile=path.join(profileRoot,'model-settings.json'),historyFile=path.join(profileRoot,'conversation.json'),personaFile=path.join(root,'persona.md');
 for(const file of [settingsFile,historyFile])assertNoSymlinks(file,{allowMissing:true});assertNoSymlinks(personaFile);
 const system=fs.readFileSync(personaFile,'utf8');if(!system.trim()||system.length>16000)throw Error('Invalid persona');
 const settings=chatOptions.settingsStore||require('./settings-store').create({file:settingsFile,safeStorage:electron.safeStorage});
 if(['snapshot','save','getRequestConfig'].some(k=>typeof settings[k]!=='function'))throw Error('Invalid settings store');
 require('./settings-window').publicSnapshot(settings);
 const store=require('./conversation-store').create({file:historyFile});
 const request=chatOptions.request||require('./ai-client').request;
 const service=require('./chat-service').create({store,settings,request,system,onReply,onCancel});
 let destroyed=false,testController=null,testGeneration=0,chat,settingsWindow;
 function cancelTest(){testGeneration++;testController?.abort();testController=null;}
 async function testConnection(){
  if(destroyed)return {ok:false};cancelTest();const generation=testGeneration;
  const config=settings.getRequestConfig();if(!config.baseUrl||!config.model)return {ok:false};
  const controller=new AbortController();testController=controller;
  try{await request({config,messages:[{role:'user',content:'连接测试，请简短回复。'}],system,signal:controller.signal});return {ok:!destroyed&&generation===testGeneration&&!controller.signal.aborted};}
  catch{return {ok:false};}finally{if(testController===controller)testController=null;}
 }
 function destroy(){if(destroyed)return;destroyed=true;cancelTest();service.destroy();chat?.destroy();settingsWindow?.destroy();}
 const common={BrowserWindow:electron.BrowserWindow,ipcMain:electron.ipcMain,session,root,mode};
 try{
  chat=require('./chat-window').create({...common,service});
  settingsWindow=require('./settings-window').create({...common,store:settings,testConnection,cancelTest,onChange:()=>{service.cancel();onSettingsChange();}});
 }catch(error){destroy();throw error;}
 return {openChat:()=>!destroyed&&chat.open(),openSettings:()=>!destroyed&&settingsWindow.open(),cancel:()=>service.cancel(),busy:()=>service.state().pending,destroy};
}
module.exports={create};
