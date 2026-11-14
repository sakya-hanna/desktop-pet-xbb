const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

function create({ file, fsImpl = fs }) {
  const persistence=require('./chat-persistence.cjs');
  const loaded=persistence.read(file,4*1024*1024,data=>{
    const ids = new Set();
    if (Object.keys(data).some(k=>!['version','messages'].includes(k)) || !Array.isArray(data.messages) || data.messages.length > 200
      || !data.messages.every(row => row && Object.keys(row).every(k=>['id','role','source','text','timestamp'].includes(k)) && typeof row.id === 'string' && row.id.length > 0 && row.id.length <= 64
        && !ids.has(row.id) && ids.add(row.id) && ['user', 'system', 'assistant'].includes(row.role)
        && typeof row.source === 'string' && row.source.length <= 64
        && typeof row.text === 'string' && [...row.text].length <= 4000
        && Number.isSafeInteger(row.timestamp) && row.timestamp >= 0)) throw Error('invalid history');
    return data.messages;
  },fsImpl);
  let messages=loaded.value||[],saveError=null;
  const writeBlocked=!['valid','missing'].includes(loaded.status);
  const diagnostics=()=>({loadStatus:loaded.status,writeBlocked,notice:writeBlocked?'聊天记录受保护，未覆盖原文件。':null,saveError});
  function snapshot() { return messages.map(row => ({ ...row })); }
  function commit(next) {
    if(writeBlocked)throw Error('Conversation protected');
    try{persistence.commit(file,{version:1,messages:next},fsImpl);}catch{saveError='CONVERSATION_SAVE_FAILED';throw Error('Could not save conversation');}
    messages=next;saveError=null;return snapshot();
  }
  function send(text) {
    if (typeof text !== 'string' || text.length > 8000 || [...text].length > 4000 || !text.trim()) throw Error('请输入 1–4000 字的消息');
    const timestamp = Date.now();
    return commit([...messages.slice(-198),
      { id: randomUUID(), role: 'user', source: 'chat-input', text: text.trim(), timestamp },
      { id: randomUUID(), role: 'system', source: 'model-unconfigured', text: '尚未配置模型，消息已保存在本机，未发送到网络。', timestamp }]);
  }
  function append(role,text,source) {
    if(!['user','assistant','system'].includes(role)||typeof text!=='string'||!text.trim()||[...text].length>4000||typeof source!=='string'||source.length>64)throw Error('Invalid conversation message');
    return commit([...messages.slice(-199),{id:randomUUID(),role,text:text.trim(),source,timestamp:Date.now()}]);
  }
  return { snapshot, diagnostics, send, append, clear: () => commit([]) };
}
module.exports = { create };
