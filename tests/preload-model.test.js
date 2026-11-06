const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
test('actual pet preload forwards model replies without IPC event and exposes only fixed cancellation',()=>{
 let api;const listeners=new Map(),sent=[];
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../puppet/preload.js'),'utf8'),{require:()=>({contextBridge:{exposeInMainWorld:(name,value)=>{assert.equal(name,'pet');api=value;}},ipcRenderer:{on:(name,fn)=>listeners.set(name,fn),send:(...args)=>sent.push(args)}})});
 assert.equal(typeof api.onChatReply,'function');assert.equal(typeof api.cancelReply,'function');
 const seen=[];api.onChatReply((...args)=>seen.push(args));const reply={reply:'姐姐在呢',face:3942,action:'none'};
 listeners.get('chat:reply')({secret:'must not cross'},reply);assert.equal(seen.length,1);assert.deepEqual(seen[0],[reply]);
 api.cancelReply('not-an-ipc-channel',{arbitrary:true});assert.deepEqual(sent,[['model:cancel']]);
});
