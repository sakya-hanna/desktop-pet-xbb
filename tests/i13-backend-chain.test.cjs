'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{EventEmitter}=require('node:events');
const {harness,settle}=require('./i13-backend.test.cjs'),{boot,rows,flush}=require('./i13-frontend-harness.cjs'),{createHarness}=require('./helpers/interaction-fixtures.cjs');
const root=path.resolve(__dirname,'..');
function preload(h,page,file){const ipc=new EventEmitter();let api;const target=()=>page==='desktop'?h.shell.window:h.get(page);
 ipc.invoke=(name,...args)=>Promise.resolve().then(()=>h.handles.get(name)(h.event(target()),...args));
 ipc.send=(name,...args)=>h.electron.ipcMain.emit(name,h.event(target()),...args);
 vm.runInNewContext(fs.readFileSync(path.join(root,file),'utf8'),{process:{isMainFrame:true},require(name){assert.equal(name,'electron');return {ipcRenderer:ipc,contextBridge:{exposeInMainWorld(_n,v){api=v;}}};}});
 if(page==='desktop'){const send=h.shell.window.webContents.send;h.shell.window.webContents.send=(channel,...args)=>{send(channel,...args);ipc.emit(channel,{},...args);};}
 return api;
}
test('I13 complete local chain: settings UI -> store -> chat UI/immediate user -> service -> desktop reply -> bubble; failure and cancel preserve drafts',async()=>{
 const requests=[];const h=harness({mode:'visible',request:args=>new Promise((resolve,reject)=>requests.push({args,resolve,reject}))});let r;
 try{
 await h.shell.ready;h.shell.setIdleEnabled(false);h.shell.command({name:'settings'});h.shell.command({name:'chat'});await settle();
 const settings=await boot('settings',preload(h,'settings','settings-preload.js'));
 settings.nodes['base-url'].value='https://local-test.invalid/v1';settings.nodes.model.value='LOCAL TEST — no network';await settings.submit();
 assert.equal(settings.nodes.status.textContent,'设置已保存。');assert.equal(requests.length,0,'saving never makes a request');
 const pet=preload(h,'desktop','desktop-preload.cjs');r=await createHarness({idle:false,configurePet:p=>Object.assign(p,pet)});r.runtime.start();await flush();r.tick(2);
 const ui=await boot('chat',preload(h,'chat','chat-preload.js'));assert.match(ui.nodes['model-state'].textContent,/模型已配置/);
 ui.input.value='这是本地整链测试';const first=ui.submit();assert.deepEqual(rows(ui),[{role:'user',text:'这是本地整链测试'}]);await flush();assert.equal(requests.length,1);
 assert.equal(requests[0].args.config.model,'LOCAL TEST — no network');assert.match(requests[0].args.system,/小伯白/);
 requests[0].resolve({reply:'本地测试回复，姐姐在这里。',face:3901,action:'blink'});await first;r.tick(1,80);assert.ok(r.runtime.status().motion.blink>0.9);r.tick(3,60);await settle();
 assert.deepEqual(rows(ui),[{role:'user',text:'这是本地整链测试'},{role:'assistant',text:'本地测试回复，姐姐在这里。'}]);assert.equal(ui.input.value,'');assert.equal(r.runtime.status().renderedFace,'3901');
 const bubble=h.get('feedback');assert.ok(bubble);assert.equal(bubble.messages.at(-1)[1].text,'本地测试回复，姐姐在这里。');assert.equal(bubble.options.focusable,false);
 ui.input.value='故障草稿';const failing=ui.submit();assert.equal(rows(ui).filter(x=>x.role==='user').length,2);await flush();requests[1].reject(Error('AI endpoint returned HTTP 429'));await failing;
 assert.equal(ui.input.value,'故障草稿');assert.match(rows(ui).at(-1).text,/429/);assert.equal(r.runtime.status().chatPresentation,null);
 ui.input.value='取消草稿';const cancelled=ui.submit();await flush();await ui.fire('cancel','click');assert.equal(requests[2].args.signal.aborted,true);
 requests[2].resolve({reply:'晚到绝不复活',face:3665,action:'hop'});await cancelled;assert.equal(ui.input.value,'取消草稿');assert.ok(!rows(ui).some(x=>x.text==='晚到绝不复活'));assert.equal(r.runtime.status().chatPresentation,null);
 ui.input.value='手选中断';const interrupted=ui.submit();await flush();h.shell.command({name:'face-next'});assert.equal(requests[3].args.signal.aborted,true);
 requests[3].resolve({reply:'不覆盖手选',face:3665,action:'hop'});await interrupted;assert.equal(r.runtime.status().manualFace,'3599');assert.equal(r.runtime.status().chatPresentation,null);
 assert.equal(ui.input.value,'手选中断');assert.ok(!rows(ui).some(x=>x.text==='不覆盖手选'));assert.deepEqual(r.errors,[]);
 const disk=JSON.parse(fs.readFileSync(path.join(h.profileRoot,'conversation.json'),'utf8'));assert.equal(disk.messages.filter(x=>x.role==='assistant').length,1);
 }finally{r?.runtime.destroy();h.dispose();}
 assert.equal(h.handles.size,0);assert.ok(h.windows.every(w=>w.dead));
});
