const test=require('node:test'),assert=require('node:assert/strict');
const {create}=require('../puppet/chat-service');
function fixture(config={baseUrl:'http://localhost:1/v1',model:'test',apiKey:''}){let rows=[];const store={snapshot:()=>structuredClone(rows),send:text=>{rows.push({role:'user',text},{role:'system',text:'未配置模型'});return structuredClone(rows);},append:(role,text,source)=>{rows.push({role,text,source});return structuredClone(rows);},clear:()=>{rows=[];}};let resolve;const replies=[];const request=({signal})=>new Promise(r=>{resolve=r;});const api=create({store,settings:{getRequestConfig:()=>config},request,onReply:r=>replies.push(r),system:'system'});return {api,replies,complete:x=>resolve(x)};}
test('configured send records real result and presentation, never adds unconfigured fake status',async()=>{const f=fixture();const p=f.api.send('你好');assert.equal(f.api.state().pending,true);f.complete({reply:'弟弟，姐姐在呢。',face:3942,action:'none'});const state=await p;assert.equal(state.pending,false);assert.deepEqual(state.messages.map(x=>x.role),['user','assistant']);assert.equal(f.replies.length,1);});
test('cancel or clear fences an old result even when transport ignores abort',async()=>{const f=fixture();const p=f.api.send('old');f.api.clear();f.complete({reply:'must not show'});const s=await p;assert.deepEqual(s.messages,[]);assert.equal(f.replies.length,0);assert.equal(s.pending,false);});
test('unconfigured uses honest existing local notice without request',async()=>{const f=fixture({});const s=await f.api.send('本地');assert.equal(s.model,'unconfigured');assert.equal(s.messages[1].role,'system');assert.equal(f.replies.length,0);});
test('unreadable saved key has its own state, never contacts transport, and recovers after settings save',async()=>{
 let unreadable=true,calls=0;const rows=[];
 const settings={getRequestConfig(){if(unreadable)throw Error('private-key-error');return {baseUrl:'https://example.test/v1',model:'test',apiKey:'private-key'};}};
 const store={snapshot:()=>structuredClone(rows),append:(role,text,source)=>rows.push({role,text,source})};
 const api=create({store,settings,request:async()=>{calls++;return {reply:'ok',face:null,action:'none'};},system:'system'});
 assert.equal(api.state().model,'settings-error');
 const failed=await api.send('保留草稿');assert.equal(failed.model,'settings-error');assert.equal(calls,0);
 assert.equal(rows.length,1);assert.equal(rows[0].source,'settings-error');assert.doesNotMatch(JSON.stringify(failed),/private-key/);
 unreadable=false;assert.equal(api.state().model,'configured');
 await api.send('正常发送');assert.equal(calls,1);assert.equal(rows.at(-1).role,'assistant');
});
test('long history keeps newest complete Unicode messages within both client budgets without deleting stored history',async()=>{
 const rows=Array.from({length:9},(_,i)=>({role:i%2?'assistant':'user',text:'😀'.repeat(4000)}));let sent;
 const store={snapshot:()=>structuredClone(rows),append:(role,text,source)=>rows.push({role,text,source})};
 const service=create({store,settings:{getRequestConfig:()=>({baseUrl:'https://example.com',model:'test',apiKey:''})},request:async({messages})=>{sent=messages;assert.ok(messages.reduce((n,r)=>n+[...r.content].length,0)<=32000);assert.ok(messages.length<=40);return {reply:'ok',face:null,action:'none'};},system:'system'});
 await service.send('最新消息');assert.ok(sent);assert.equal(sent.length,8);assert.equal(sent.at(-1).content,'最新消息');assert.equal(rows.length,11);assert.equal(rows.at(-1).role,'assistant');
});

test('request failures identify the failed stage with fixed messages and keep native secrets out',async()=>{
 const cases=[
  ['AI endpoint returned HTTP 401',undefined,/HTTP 401/],
  ['AI endpoint returned HTTP 429',undefined,/HTTP 429/],
  ['AI request timed out',undefined,/超时/],
  ['Invalid AI response',undefined,/回复格式/],
  ['Invalid AI request',undefined,/请求校验/],
  ['AI request failed','ENOTFOUND',/ENOTFOUND/],
  ['AI request failed','CERT_HAS_EXPIRED',/CERT_HAS_EXPIRED/],
  ['private-key private-chat','private-code',/^请求失败，请检查模型设置、网络或稍后重试。$/]
 ];
 for(const [message,code,expected] of cases){
  const rows=[];let calls=0;
  const api=create({store:{snapshot:()=>structuredClone(rows),append:(role,text,source)=>rows.push({role,text,source})},settings:{getRequestConfig:()=>({baseUrl:'https://example.test',model:'m',apiKey:'private-key'})},system:'system',request:async()=>{calls++;const error=Error(message);error.code=code;throw error;}});
  const state=await api.send('诊断草稿');assert.equal(calls,1);assert.equal(state.model,'configured');assert.equal(state.pending,false);assert.equal(rows.at(-1).source,'request-error');assert.match(rows.at(-1).text,expected);assert.doesNotMatch(JSON.stringify(state),/private/);
 }
});
