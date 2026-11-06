'use strict';
function requestErrorText(error){
 const http=/^AI endpoint returned HTTP ([1-5]\d{2})$/.exec(error?.message||'');
 if(http){
  const status=Number(http[1]);
  if(status===401||status===403)return `模型接口拒绝认证（HTTP ${status}），请检查密钥和接口权限。`;
  if(status===402)return '模型接口要求检查账户余额或付费状态（HTTP 402）。';
  if(status===429)return '模型接口暂时限制请求（HTTP 429），请稍后再试。';
  return `模型接口返回 HTTP ${status}，请检查地址、模型或稍后重试。`;
 }
 if(error?.message==='AI request timed out')return '等待模型回复超时，请稍后重试。';
 if(error?.message==='Invalid AI response')return '模型接口已响应，但回复格式不符合白姐的 JSON 协议。';
 if(error?.message==='Invalid AI request')return '发送前的请求校验失败，请检查模型配置和消息内容。';
 if(error?.message==='AI response too large')return '模型接口回复过大，无法读取，请缩短请求后重试。';
 const codes=['ENOTFOUND','EAI_AGAIN','ECONNREFUSED','ECONNRESET','ETIMEDOUT','ENETUNREACH','EHOSTUNREACH','EPIPE','CERT_HAS_EXPIRED','ERR_TLS_CERT_ALTNAME_INVALID','UNABLE_TO_VERIFY_LEAF_SIGNATURE','SELF_SIGNED_CERT_IN_CHAIN','DEPTH_ZERO_SELF_SIGNED_CERT'];
 if(error?.message==='AI request failed'&&codes.includes(error.code))return `连接模型接口失败（${error.code}），请检查网络连接或证书。`;
 return '请求失败，请检查模型设置、网络或稍后重试。';
}
function create({store,settings,request,onReply=()=>{},system=''}){
 let generation=0,controller=null;
 const configured=c=>!!(c?.baseUrl&&c?.model);
 function state(){let model;try{model=configured(settings.getRequestConfig())?'configured':'unconfigured';}catch{model='settings-error';}return {messages:store.snapshot(),model,pending:!!controller};}
 function cancel(){generation++;controller?.abort();controller=null;return state();}
 function clear(){cancel();store.clear();return state();}
 async function send(text){
  if(typeof text!=='string'||!text.trim()||[...text].length>4000)throw Error('消息需要1–4000字');
  cancel();const token=generation;let config;
  try{config=settings.getRequestConfig();}catch{store.append('system','模型配置不可读取，请在设置中重新保存。','settings-error');return state();}
  if(!configured(config)){store.send(text);return state();}
  store.append('user',text.trim(),'chat-input');
  const messages=[];let remaining=32000;
  for(const {role,text} of store.snapshot().filter(r=>r.role==='user'||r.role==='assistant').slice(-40).reverse()){
   const size=[...text].length;if(size>remaining)break;
   messages.unshift({role,content:text});remaining-=size;
  }
  controller=new AbortController();const current=controller;
  try{
   const result=await request({config,messages,system,signal:current.signal});
   if(token!==generation||current.signal.aborted)return state();
   store.append('assistant',result.reply,'model');
   try{onReply(result);}catch{/* Persisted reply remains available if presentation window closed. */}
  }catch(error){
   if(token===generation&&!current.signal.aborted)store.append('system',requestErrorText(error),'request-error');
  }finally{if(controller===current)controller=null;}
  return state();
 }
 return {state,send,cancel,clear};
}
module.exports={create};
