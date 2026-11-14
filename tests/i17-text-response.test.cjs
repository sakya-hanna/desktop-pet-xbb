'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {parse}=require('../ai-response');
test('ordinary non-JSON reply is displayed without face or action',()=>{
 assert.deepEqual(parse('  姐姐在这里，今天过得怎么样？  '),{reply:'姐姐在这里，今天过得怎么样？',face:null,action:'none'});
});
test('broken structures, code fences and reasoning markup are not plain replies',()=>{
 for(const text of ['{"reply":"断掉', '[{"reply":"x"}', '"断掉', '```json\n{"reply":', '```text\n普通文字\n```', '<think>内部推理</think>你好', '你好\n<thinking>内部</thinking>', '<html>error</html>', '{reply:"x"}', 'reply: "x", action: "hop"', '回复如下：\n{"reply":"断掉']) {
  assert.throws(()=>parse(text),/^Error: Invalid AI response$/,text);
 }
});
test('JSON objects, fenced JSON and supported hints retain existing behavior',()=>{
 for(const content of [{reply:'姐姐在呢',emotion:3901,action:'hop'},JSON.stringify({reply:'姐姐在呢',emotion:3901,action:'hop'}),'```json\n{"reply":"姐姐在呢","emotion":3901,"action":"hop"}\n```'])
  assert.deepEqual(parse(content),{reply:'姐姐在呢',face:3901,action:'hop'});
 assert.deepEqual(parse('{"reply":"你好","emotion":"gentle","action":"blink"}'),{reply:'你好',face:3942,action:'blink'});
 assert.deepEqual(parse('{"reply":"你好","emotion":"unknown","action":"execute"}'),{reply:'你好',face:null,action:'none'});
});
test('ordinary multiline Unicode replies never infer actions from words',()=>{
 const reply='姐姐可以陪你聊聊。\n小跳、眨眼和 hop 都只是这句话里的文字。😀';
 assert.deepEqual(parse(reply),{reply,face:null,action:'none'});
});
test('blank, overlimit, invalid types and invalid JSON schema still fail closed',()=>{
 for(const value of ['', ' \n ', '😀'.repeat(4001), null, undefined, [], 42, {}, {reply:3}, {reply:' '}, {reply:'😀'.repeat(4001)}, 'null', 'true', '123', '"只是JSON字符串"', '[]', '{}', '{"reply":false}'])
  assert.throws(()=>parse(value),/^Error: Invalid AI response$/);
 assert.equal([...parse('😀'.repeat(4000)).reply].length,4000);
});
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{EventEmitter}=require('node:events');
// Only synthetic envelopes. Production client/service execute; no sockets or profiles.
function transportClient(envelopes){
 const state={calls:0,destroyed:0,bodies:[]};
 const transport={request(_url,_options,callback){
  state.calls++;const response=envelopes.shift(),req=new EventEmitter();
  req.destroy=()=>{state.destroyed++;};req.end=body=>{state.bodies.push(JSON.parse(body));queueMicrotask(()=>{
   const res=new EventEmitter();res.statusCode=200;res.destroy=()=>{};callback(res);
   res.emit('data',Buffer.from(JSON.stringify(response)));res.emit('end');
  });};return req;
 }};
 const mod={exports:{}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../ai-client.js'),'utf8'),{module:mod,exports:mod.exports,URL,AbortSignal,Buffer,setTimeout,clearTimeout,require(name){
  if(name==='node:http'||name==='node:https')return transport;
  if(name==='./ai-response')return {parse};throw Error('Unexpected dependency');
 }});
 return {request:mod.exports.request,state};
}
const envelope=content=>({choices:[{finish_reason:'stop',message:{content,reasoning_content:'synthetic private reasoning not displayed'}}]});
const config={baseUrl:'https://synthetic.invalid/v1',model:'fixture',apiKey:''};
function serviceFor(client){
 const rows=[],shown=[];let sequence=0;
 const store={snapshot:()=>rows.map(r=>({...r})),append:(role,text)=>rows.push({id:++sequence,role,text}),clear:()=>{rows.length=0;}};
 const service=require('../chat-service').create({store,settings:{getRequestConfig:()=>config},request:client.request,system:'Synthetic protocol fixture',onReply:r=>shown.push(r)});
 return {service,rows,shown};
}
test('production client/service accept plain replies and later JSON without duplicate rows or reasoning',async()=>{
 const client=transportClient([envelope('姐姐在这里。'),envelope('{"reply":"继续聊吧","emotion":3901,"action":"blink"}')]);
 const h=serviceFor(client);
 assert.equal((await h.service.send('合成输入一')).outcome,'success');
 assert.deepEqual(h.shown[0],{reply:'姐姐在这里。',face:null,action:'none'});
 assert.equal((await h.service.send('合成输入二')).outcome,'success');
 assert.deepEqual(h.shown[1],{reply:'继续聊吧',face:3901,action:'blink'});
 assert.deepEqual(h.rows.map(r=>r.role),['user','assistant','user','assistant']);
 assert.equal(client.state.calls,2);assert.ok(!JSON.stringify(h.rows).includes('private reasoning'));
 h.service.destroy();
});
test('bad envelope and malformed content remain errors without automatic retries or presentation',async()=>{
 for(const response of [{},envelope(null),envelope(''),envelope('{"reply":"broken')]){
  const client=transportClient([response]),h=serviceFor(client);
  assert.equal((await h.service.send('合成失败输入')).outcome,'request-error');
  assert.equal(client.state.calls,1);assert.equal(h.shown.length,0);
  assert.deepEqual(h.rows.map(r=>r.role),['user','system']);h.service.destroy();
 }
});
test('cancelling before the synthetic transport responds never presents or stores a late plain reply',async()=>{
 const client=transportClient([envelope('不能显示的晚到回复')]),h=serviceFor(client);
 const pending=h.service.send('合成取消输入');h.service.cancel();
 assert.equal((await pending).outcome,'cancelled');assert.equal(h.shown.length,0);
 assert.deepEqual(h.rows.map(r=>r.role),['user']);assert.equal(client.state.calls,1);h.service.destroy();
});
