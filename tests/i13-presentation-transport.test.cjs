'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{EventEmitter}=require('node:events');
const root=path.resolve(__dirname,'..');
function bridge(){const ipc=new EventEmitter(),calls=[];let api;ipc.send=(...a)=>calls.push(a);vm.runInNewContext(fs.readFileSync(path.join(root,'desktop-preload.cjs'),'utf8'),{process:{isMainFrame:true},require(name){assert.equal(name,'electron');return {ipcRenderer:ipc,contextBridge:{exposeInMainWorld(_name,value){api=value;}}};}});return {ipc,calls,api};}
test('I13 preload keeps chat presentation receive-only, validates IDs/hints/arity, removes listener',()=>{
 const b=bridge(),seen=[];assert.equal(typeof b.api.onChatPresentation,'function');const off=b.api.onChatPresentation(v=>seen.push(v));
 const good={id:1,reply:'姐姐在这里。',face:3901,action:'blink'};b.ipc.emit('chat:presentation',{secret:'not passed'},good);good.reply='mutated';assert.equal(seen[0].reply,'姐姐在这里。');
 b.ipc.emit('chat:presentation',{}, {id:2,clear:true});
 for(const value of [{id:3,clear:false},{id:0,clear:true},{...good,action:'exec'},{...good,extra:'x'},{...good,reply:'😀'.repeat(4001)}])b.ipc.emit('chat:presentation',{},value);
 b.ipc.emit('chat:presentation',{},good,'extra');assert.equal(seen.length,2);off();assert.equal(b.ipc.listenerCount('chat:presentation'),0);
 for(const name of ['chat','settings','chat-cancel'])b.api.command(name);assert.deepEqual(b.calls.map(c=>c[1].name),['chat','settings','chat-cancel']);
 b.api.command('chat','payload');assert.equal(b.calls.length,3);
});
test('I13 long chat crosses desktop feedback bridge without weakening short interaction limits',()=>{
 const b=bridge(),{validFeedback}=require('../feedback-window.cjs');const good={id:1,text:'😀'.repeat(4000),kind:'chat',durationMs:15000};
 b.api.feedback(good);assert.equal(b.calls.length,1);assert.equal(b.calls[0][1].kind,'chat');assert.equal(validFeedback(b.calls[0][1]),true);
 for(const value of [{...good,text:'😀'.repeat(4001)},{...good,kind:'other'},{id:2,text:'😀'.repeat(201)},{...good,durationMs:60001}]){b.api.feedback(value);assert.equal(validFeedback(value),false);}
 assert.equal(b.calls.length,1);
});
test('I13 native bubble receives bounded explicit excerpt while full long answer stays in chat, cancellation cannot revive',async()=>{
 const {harness,settle}=require('./feedback-shell.test.cjs'),h=harness();try{
 await h.shell.ready;const b=bridge();b.ipc.send=(...args)=>h.electron.ipcMain.emit(args[0],h.event(),...args.slice(1));
 const text='完整回答😀\n\n'.repeat(500);b.api.feedback({id:1,text,kind:'chat',durationMs:15000});await settle();
 assert.ok(h.bubble());const shown=h.bubble().messages.at(-1)[1].text;
 assert.ok([...shown].length<=120);assert.doesNotMatch(shown,/\n/);assert.match(shown,/完整回复见聊天窗口/);assert.ok(shown.startsWith('完整回答😀'));assert.equal(text.length>shown.length,true);
 h.send(null);h.advance(15000);assert.equal(h.bubble().messages.at(-1)[1],null);h.send({id:1,text:'晚到',kind:'chat'});assert.equal(h.bubble().messages.at(-1)[1],null);
 }finally{h.dispose();}
});
