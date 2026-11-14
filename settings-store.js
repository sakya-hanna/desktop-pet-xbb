'use strict';
const fs = require('node:fs');
// Main-only own-file store. Missing/valid loads allow writes; invalid/unknown,
// read-error and unavailable decryption latch writes closed for this instance.
// snapshot never returns plaintext or ciphertext. Absent apiKey preserves; '' clears
// only when the existing file is trusted and decryptable. No legacy imports.
// Atomic commit owns a temporary only after open('wx') succeeds.
function validateConfig(baseUrl,model) {
  try {
    if (typeof baseUrl !== 'string' || baseUrl.length > 2048 || !/^https?:\/\/[^/]/i.test(baseUrl) || /[\s?#\\]/u.test(baseUrl) || baseUrl.split('/')[2].includes('@')) throw new Error();
    const url = new URL(baseUrl);
    const loopback = url.hostname === 'localhost' || url.hostname === '[::1]' || /^127(?:\.\d{1,3}){3}$/.test(url.hostname);
    if (!['https:','http:'].includes(url.protocol) || (url.protocol === 'http:' && !loopback) || url.username || url.password) throw new Error();
    if (typeof model !== 'string' || !model.trim() || model.length > 200 || /[\x00-\x1f\x7f]/.test(model)) throw new Error();
    return {baseUrl:url.href.replace(/\/+$/,''),model:model.trim()};
  } catch { throw new Error('Invalid AI settings'); }
}
function create({file,safeStorage,fsImpl=fs}) {
  const persistence=require('./chat-persistence.cjs');
  const validKey=v=>typeof v==='string'&&v.length<=4096&&!/[^\x21-\x7e]/.test(v);
  const loaded=persistence.read(file,65536,v=>{
    if(Object.keys(v).some(k=>!['version','baseUrl','model','encryptedKey'].includes(k))||typeof v.encryptedKey!=='string'||v.encryptedKey.length>32768||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(v.encryptedKey))throw Error();
    return {version:1,...validateConfig(v.baseUrl,v.model),encryptedKey:v.encryptedKey};
  },fsImpl);
  let state=loaded.value||{version:1,baseUrl:'',model:'',encryptedKey:''},loadStatus=loaded.status,writeBlocked=!['valid','missing'].includes(loadStatus),saveError=null;
  function secure(fn){try{if(safeStorage?.isEncryptionAvailable()!==true)throw Error();return fn();}catch{throw Error('Secure key storage unavailable');}}
  function decrypt(){try{const key=secure(()=>safeStorage.decryptString(Buffer.from(state.encryptedKey,'base64')));if(!validKey(key))throw Error();return key;}catch{loadStatus='decrypt-failure';writeBlocked=true;throw Error('Secure key storage unavailable');}}
  if(state.encryptedKey){try{decrypt();}catch{loadStatus='decrypt-failure';writeBlocked=true;}}
  function check(){if(writeBlocked)throw Error('AI settings protected');if(state.encryptedKey){try{decrypt();}catch{loadStatus='decrypt-failure';writeBlocked=true;throw Error('AI settings protected');}}}
  const snapshot=()=>({baseUrl:state.baseUrl,model:state.model,keyConfigured:!!state.encryptedKey,loadStatus,writeBlocked,notice:writeBlocked?'设置文件受保护（'+loadStatus+'），本次运行禁止覆盖；请保留原文件并在受控恢复后重新启动。':null,saveError});
  function save(value){
    try{
      check();if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!['baseUrl','model','apiKey'].includes(k)))throw Error();
      const {baseUrl,model,apiKey}=value,validated=validateConfig(baseUrl,model);if(apiKey!==undefined&&!validKey(apiKey))throw Error();
      const encryptedKey=apiKey===undefined?state.encryptedKey:apiKey===''?'':secure(()=>{const bytes=safeStorage.encryptString(apiKey);if(!Buffer.isBuffer(bytes)||!bytes.length||bytes.length>24576)throw Error();return bytes.toString('base64');});
      const next={version:1,...validated,encryptedKey};persistence.commit(file,next,fsImpl);state=next;saveError=null;return snapshot();
    }catch{saveError='SETTINGS_SAVE_FAILED';throw Error('Could not save AI settings');}
  }
  function getRequestConfig(){check();return {baseUrl:state.baseUrl,model:state.model,apiKey:state.encryptedKey?decrypt():''};}
  return {snapshot,save,getRequestConfig};
}
module.exports = {create};
