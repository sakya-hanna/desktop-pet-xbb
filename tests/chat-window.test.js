const test=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {create}=require('../puppet/chat-window');
test('chat manager routes async model service sends and cancellation without echoing credentials',async()=>{const handlers=new Map();const ipcMain={handle:(k,f)=>handlers.set(k,f),removeHandler:k=>handlers.delete(k)};let w,canceled=0;class W extends EventEmitter{constructor(){super();w=this;this.webContents=new EventEmitter();this.webContents.mainFrame={};this.webContents.setWindowOpenHandler=()=>{};}loadFile(){return Promise.resolve();}isDestroyed(){return false;}destroy(){}show(){}focus(){}}const service={state:()=>({messages:[],model:'configured'}),send:async text=>({messages:[{text}],model:'configured'}),cancel:()=>{canceled++;return service.state();},clear:()=>service.state()};const m=create({BrowserWindow:W,ipcMain,store:{},service});m.open();const event={sender:w.webContents,senderFrame:w.webContents.mainFrame};assert.equal((await handlers.get('chat:send')(event,'hello')).messages[0].text,'hello');handlers.get('chat:cancel')(event);assert.equal(canceled,1);m.destroy();});
const vm=require('node:vm');
test('main lazily wires chat into both menus and destroys it on quit',()=>{const main=source('main.js');assert.match(main,/function openChat\(/);assert.equal((main.match(/label: '和白姐聊天'/g)||[]).length,2);assert.match(main,/chat\?\.destroy\(\)/);});
const source=n=>fs.readFileSync(path.join(__dirname,'../puppet',n),'utf8');
test('narrow preload exposes only read/send/clear invokes',()=>{
 let api;const calls=[];vm.runInNewContext(source('chat-preload.js'),{require(name){assert.equal(name,'electron');return {contextBridge:{exposeInMainWorld(name,value){assert.equal(name,'chat');api=value;}},ipcRenderer:{invoke:(...args)=>calls.push(args)}};}});
 assert.deepEqual(Object.keys(api).sort(),['cancel','clear','read','send']);api.read();api.send('hello');api.clear();api.cancel();assert.deepEqual(calls,[['chat:read'],['chat:send','hello'],['chat:clear'],['chat:cancel']]);
});
test('renderer guards IME, empty and Unicode overflow; literal history; custom clear cancellation',async()=>{
 class Element{constructor(){this.listeners={};this.value='';this.children=[];this.textContent='';this.disabled=false;this.open=false;}addEventListener(k,f){this.listeners[k]=f;}replaceChildren(){this.children=[];}append(...items){this.children.push(...items);}focus(){}showModal(){this.open=true;}close(){this.open=false;}setAttribute(){} }
 const ids=['messages','message-input','send','composer','status','count','clear','clear-dialog','clear-cancel','clear-confirm'];const nodes=Object.fromEntries(ids.map(id=>[id,new Element()]));let rows=[],sent=[],cleared=0;
 const api={async read(){return {messages:rows,model:'unconfigured'};},async send(text){sent.push(text);rows=[{role:'user',text}];return {messages:rows};},async clear(){cleared++;rows=[];return {messages:[]};}};
 vm.runInNewContext(source('chat.js'),{document:{getElementById:id=>nodes[id],createElement:()=>new Element()},window:{chat:api}});await new Promise(setImmediate);
 const input=nodes['message-input'],event={preventDefault(){}};input.value=' ';await nodes.composer.listeners.submit(event);assert.equal(sent.length,0);
 input.value='中文';input.listeners.compositionstart();input.listeners.keydown({...event,key:'Enter',shiftKey:false,isComposing:false});assert.equal(sent.length,0);input.listeners.compositionend();
 input.value='🌷'.repeat(4001);input.listeners.input();assert.equal(nodes.send.disabled,true);await nodes.composer.listeners.submit(event);assert.equal(sent.length,0);
 input.value='<img src=x>🌷';input.listeners.input();await nodes.composer.listeners.submit(event);assert.deepEqual(sent,['<img src=x>🌷']);assert.equal(nodes.messages.children[0].children[1].textContent,'<img src=x>🌷');
 nodes.clear.listeners.click();assert.equal(nodes['clear-dialog'].open,true);nodes['clear-cancel'].listeners.click();assert.equal(cleared,0);nodes.clear.listeners.click();await nodes['clear-confirm'].listeners.click();assert.equal(cleared,1);assert.equal(nodes.messages.children.length,0);
 assert.match(source('chat.html'),/default-src 'none'/);assert.match(source('chat.html'),/connect-src 'none'/);assert.doesNotMatch(source('chat.js'),/innerHTML|window.confirm/);
});
function fixture(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'chat-window-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const handlers=new Map(),windows=[];
 const ipcMain={handle:(k,f)=>handlers.set(k,f),removeHandler:k=>handlers.delete(k)};
 class Window extends EventEmitter{constructor(options){super();this.options=options;this.webContents=new EventEmitter();this.webContents.mainFrame={};this.webContents.setWindowOpenHandler=f=>this.openHandler=f;windows.push(this);}isDestroyed(){return !!this.dead;}loadFile(f){this.file=f;return Promise.resolve();}show(){this.shown=true;}focus(){this.focused=true;}destroy(){this.dead=true;this.emit('closed');}}
 const api=create({BrowserWindow:Window,ipcMain,file:path.join(dir,'history.json')});t.after(()=>api.destroy());
 const call=(channel,payload,event)=>handlers.get('chat:'+channel)(event||{sender:windows.at(-1).webContents,senderFrame:windows.at(-1).webContents.mainFrame},payload);
 return {api,windows,handlers,call};}
test('lazy secure local panel closes/reopens, refusing stale and subframe senders',async t=>{
 const f=fixture(t);assert.equal(f.windows.length,0);f.api.open();const w=f.windows[0];f.api.open();assert.equal(f.windows.length,1);
 assert.deepEqual(w.options.webPreferences,{preload:path.resolve(__dirname,'../puppet/chat-preload.js'),sandbox:true,contextIsolation:true,nodeIntegration:false,webSecurity:true});
 assert.equal(w.options.show,false);w.webContents.emit('did-finish-load');assert.equal(w.shown,true);assert.equal(w.focused,true);
 assert.throws(()=>f.call('send','bad',{sender:{},senderFrame:{}}),/sender/);assert.throws(()=>f.call('send','bad',{sender:w.webContents,senderFrame:{}}),/sender/);
 assert.equal(f.call('send','你好').messages.length,2);w.destroy();f.api.open();assert.equal(f.windows.length,2);assert.equal(f.call('read').messages[0].text,'你好');
 assert.throws(()=>f.call('read',undefined,{sender:w.webContents,senderFrame:w.webContents.mainFrame}),/sender/);
 let prevented=false;f.windows[1].webContents.emit('will-navigate',{preventDefault(){prevented=true;}});assert.ok(prevented);assert.deepEqual(w.openHandler(),{action:'deny'});
 f.call('clear');assert.deepEqual(f.call('read').messages,[]);f.api.destroy();assert.equal(f.handlers.size,0);f.api.open();assert.equal(f.windows.length,2);
});
