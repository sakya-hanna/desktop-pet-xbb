'use strict';
const {create:createPanel}=require('./chat-panel.cjs');
function publicSnapshot(store){
 const v=store.snapshot();
 if(!v||typeof v.baseUrl!=='string'||typeof v.model!=='string'||typeof v.keyConfigured!=='boolean'||!['valid','missing','invalid','unknown','read-error','decrypt-failure'].includes(v.loadStatus)||typeof v.writeBlocked!=='boolean'||v.writeBlocked!==!['valid','missing'].includes(v.loadStatus)||(v.notice!==null&&typeof v.notice!=='string'))throw Error('Invalid settings loader contract');
 return {baseUrl:v.baseUrl,model:v.model,...(v.visionModel!==undefined?{visionModel:v.visionModel}:{}),keyConfigured:v.keyConfigured,loadStatus:v.loadStatus,writeBlocked:v.writeBlocked,notice:v.notice};
}
function create({BrowserWindow,ipcMain,session,root,mode,store,testConnection,onChange=()=>{},cancelTest=()=>{}}){
 publicSnapshot(store);let destroyed=false;
 const snapshot=()=>publicSnapshot(store);
 const panel=createPanel({BrowserWindow,ipcMain,session,root,mode,page:'settings',title:'模型设置',width:500,height:620,onClose:cancelTest,actions:{
  read:{arity:0,run:snapshot},
  save:{arity:1,run:payload=>{
   try{
    if(!payload||typeof payload!=='object'||Array.isArray(payload)||Object.keys(payload).some(k=>!['baseUrl','model','visionModel','apiKey'].includes(k))||typeof payload.baseUrl!=='string'||typeof payload.model!=='string'||(Object.hasOwn(payload,'apiKey')&&typeof payload.apiKey!=='string'))throw Error();
    onChange();cancelTest();const value={baseUrl:payload.baseUrl,model:payload.model};if(Object.hasOwn(payload,'apiKey'))value.apiKey=payload.apiKey;
    if(Object.hasOwn(payload,'visionModel'))value.visionModel=payload.visionModel;
    store.save(value);return {ok:true,settings:snapshot()};
   }catch{return {ok:false,message:'保存失败，请检查配置和安全存储。',settings:snapshot()};}
  }},
  test:{arity:0,run:async()=>{try{const r=await testConnection();return !destroyed&&r?.ok===true?{ok:true,message:'连接成功。'}:{ok:false,message:'连接失败或已取消，请检查已保存的配置。'};}catch{return {ok:false,message:'连接失败，请检查已保存的配置。'};}}}
 }});
 return {open:panel.open,destroy(){if(destroyed)return;destroyed=true;cancelTest();panel.destroy();}};
}
module.exports={create,publicSnapshot};
