'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http');
const {create}=require('../awareness/controller.cjs'),{accepts:isCandidate}=require('../awareness/codex-work.cjs');
const target={id:101,owner:{path:'C:\\Apps\\Codex.exe',processId:10}};
function fixture(extra={}){
 let time=0,n=0;const timers=new Map(),calls={captures:0,classifies:0,deliveries:[]};
 const state={target,busy:false,available:true,idle:0};
 const clock={now:()=>time,setTimeout:f=>{timers.set(++n,f);return n;},clearTimeout:n=>timers.delete(n)};
 const controller=create({enabled:true,clock,random:()=>0,activeWindow:async()=>state.target,
  capture:async()=>{calls.captures++;return Buffer.from([255,216,255,217]);},
  classify:async()=>{calls.classifies++;return {codex:true,working:true,activity:'developing'};},
  getConfig:()=>({baseUrl:'https://test.invalid/v1',model:'vision',apiKey:'fixture'}),
  available:()=>state.available,busy:()=>state.busy,idleSeconds:()=>state.idle,
  deliver:async v=>{calls.deliveries.push(v);return true;},...extra});
 return {controller,calls,state,timers,advance(ms){time+=ms;},async step(ms=5000){time+=ms;return controller.tick();}};
}
const flush=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
test('candidate identity supports Codex desktop and ChatGPT host, never browser titles',()=>{
 assert.ok(isCandidate(target));assert.ok(isCandidate({...target,owner:{path:'C:\\ChatGPT.exe'}}));
 assert.equal(isCandidate({...target,title:'Codex',owner:{path:'C:\\chrome.exe'}}),false);
 assert.equal(isCandidate({...target,id:0}),false);
});
test('90 seconds sustained work -> one encouragement -> 15 minute cooldown',async()=>{
 const f=fixture();try{await f.controller.tick();for(let i=0;i<17;i++)await f.step();
 assert.equal(f.calls.captures,0);await f.step();assert.equal(f.calls.deliveries.length,1);
 assert.equal(f.controller.state().cooldownSeconds,900);
 for(let i=0;i<179;i++)await f.step();assert.equal(f.calls.captures,1);
 await f.step();assert.equal(f.calls.captures,2);assert.notEqual(f.calls.deliveries[0].text,f.calls.deliveries[1].text);
 }finally{f.controller.destroy();}assert.equal(f.timers.size,0);
});
test('foreground changes, input idle and hidden pet reset dwell before capturing',async()=>{
 for(const gate of ['target','idle','available']){
  const f=fixture();try{await f.controller.tick();for(let i=0;i<17;i++)await f.step();
   f.state[gate]=({target:null,idle:181,busy:true,available:false})[gate];await f.step();assert.equal(f.calls.captures,0);
   f.state[gate]=({target,idle:0,busy:false,available:true})[gate];await f.step();assert.equal(f.calls.captures,0);
  }finally{f.controller.destroy();}
 }
});
test('switching apps aborts in-flight vision and late positive result cannot speak',async()=>{
 let finish,signal;const f=fixture({classify:args=>{signal=args.signal;return new Promise(r=>finish=r);}});
 try{await f.controller.tick();for(let i=0;i<17;i++)await f.step();const pending=f.step();await flush();assert.ok(signal);
 f.state.target=null;await f.step();assert.equal(signal.aborted,true);finish({working:true,activity:'reading'});
 assert.equal(await pending,false);assert.equal(f.calls.deliveries.length,0);
 }finally{f.controller.destroy();}
});
test('brief pet reactions defer delivery without erasing continuous foreground time',async()=>{
 const f=fixture();try{await f.controller.tick();for(let i=0;i<8;i++)await f.step();
 f.state.busy=true;f.controller.interrupt();for(let i=0;i<3;i++)await f.step();assert.equal(f.calls.captures,0);
 f.state.busy=false;for(let i=0;i<7;i++)await f.step();assert.equal(f.calls.deliveries.length,1);
 }finally{f.controller.destroy();}
});
test('manual observe waits five seconds while auto disabled; missing settings never capture',async()=>{
 const f=fixture({enabled:false});try{await f.controller.tick();assert.equal(f.calls.captures,0);
 f.controller.arm();await f.step(4999);assert.equal(f.calls.captures,0);await f.step(1);assert.equal(f.calls.captures,1);
 assert.equal(f.controller.state().enabled,false);
 }finally{f.controller.destroy();}
 const missing=fixture({getConfig:()=>({baseUrl:'',model:''})});try{await missing.controller.tick(true);
 assert.equal(missing.controller.state().code,'model-missing');assert.equal(missing.calls.captures,0);
 }finally{missing.controller.destroy();}
});
test('negative image result and HTTP failures back off, rejected presentation consumes no cooldown',async()=>{
 for(const [classify,code] of [[async()=>({working:false,activity:'other'}),'no-match'],[async()=>{throw Error('AI endpoint returned HTTP 429');},'quota-error']]){
  const f=fixture({classify});try{await f.controller.tick(true);assert.equal(f.controller.state().code,code);
  for(let i=0;i<10;i++)await f.step();assert.equal(f.calls.captures,1);assert.equal(f.calls.deliveries.length,0);
  }finally{f.controller.destroy();}
 }
 const f=fixture({deliver:async()=>false});try{await f.controller.tick(true);assert.equal(f.controller.state().cooldownSeconds,0);}finally{f.controller.destroy();}
});
test('vision describes the scene independently; the Codex rule decides whether to encourage',()=>{
 const {parse}=require('../awareness/vision.cjs');
 const row={codex:true,working:true,activity:'reading',evidence:'代码差异'};
 assert.equal(parse(JSON.stringify(row)).working,true);
 assert.equal(parse('```json\n'+JSON.stringify(row)+'\n```').working,true);
 const otherWork=parse(JSON.stringify({...row,codex:false}));
 assert.equal(otherWork.working,true);
 assert.equal(require('../awareness/codex-work.cjs').matches(otherWork),false);
 assert.equal(parse(JSON.stringify({...row,activity:'unknown'})).working,false);
 assert.throws(()=>parse('{"working":true}'),/vision-response-invalid/);
});
test('real HTTP image payload uses vision model; ordinary chat keeps its text contract',async t=>{
 const requests=[];const server=http.createServer((req,res)=>{let body='';req.on('data',chunk=>body+=chunk);req.on('end',()=>{
  const row=JSON.parse(body);requests.push({url:req.url,body:row});
  res.end(JSON.stringify({choices:[{message:{content:row.model==='vision'?JSON.stringify({codex:true,working:true,activity:'developing',evidence:'代码修改'}):JSON.stringify({reply:'姐姐在呢',face:3901,action:'none'})}}]}));
 });});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>{server.closeAllConnections();return new Promise(r=>server.close(r));});
 const config={baseUrl:'http://127.0.0.1:'+server.address().port+'/v1',model:'chat',visionModel:'vision',apiKey:'fixture'};
 const image=Buffer.from([255,216,255,217]);
 assert.equal((await require('../awareness/vision.cjs').classify({config,image})).working,true);
 assert.equal(requests[0].url,'/v1/chat/completions');assert.equal(requests[0].body.model,'vision');
 assert.equal(requests[0].body.messages.at(-1).content[1].image_url.url,'data:image/jpeg;base64,'+image.toString('base64'));
 const chat=await require('../ai-client').request({config,system:'你是白姐',messages:[{role:'user',content:'你好'}]});
 assert.equal(chat.reply,'姐姐在呢');assert.equal(typeof requests[1].body.messages.at(-1).content,'string');
});
test('optional vision model persists without losing existing encrypted key or exposing it',()=>{
 const {memory,file,safe,valid}=require('./i13-settings-store.test.cjs'),io=memory(valid);
 const store=require('../settings-store').create({file,safeStorage:safe,fsImpl:io});
 store.save({baseUrl:'https://test.invalid/v1',model:'chat',visionModel:' vision '});
 assert.equal(store.getRequestConfig().visionModel,'vision');assert.equal(store.getRequestConfig().apiKey,'fixture-key');
 assert.equal(JSON.stringify(store.snapshot()).includes('fixture-key'),false);
 store.save({baseUrl:'https://test.invalid/v1',model:'changed'});assert.equal(store.snapshot().visionModel,'vision');
 store.save({baseUrl:'https://test.invalid/v1',model:'changed',visionModel:''});assert.equal(store.snapshot().visionModel,'');
});
