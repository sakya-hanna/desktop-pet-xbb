const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
test('cancel stops waiting, fences old send completion and renders configured state honestly',async()=>{
 const html=fs.readFileSync(path.join(__dirname,'../puppet/chat.html'),'utf8');assert.match(html,/id="cancel"/);assert.match(html,/id="model-state"/);
 class E{constructor(){this.listeners={};this.value='';this.children=[];this.disabled=false;this.textContent='';}addEventListener(k,f){this.listeners[k]=f;}append(...x){this.children.push(...x);}replaceChildren(){this.children=[];}focus(){}showModal(){}close(){} }
 const nodes=Object.fromEntries(['messages','message-input','send','composer','status','count','clear','clear-dialog','clear-cancel','clear-confirm','cancel','model-state'].map(k=>[k,new E()]));let finish,cancels=0;
 const api={read:async()=>({messages:[],model:'configured'}),send:()=>new Promise(r=>{finish=r;}),clear:async()=>({messages:[]}),cancel:async()=>{cancels++;return {messages:[],model:'configured'};}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../puppet/chat.js'),'utf8'),{window:{chat:api},document:{getElementById:k=>nodes[k],createElement:()=>new E()}});await new Promise(setImmediate);
 assert.match(nodes['model-state'].textContent,/已配置/);nodes['message-input'].value='hello';const pending=nodes.composer.listeners.submit({preventDefault(){}});assert.equal(nodes.cancel.disabled,false);await nodes.cancel.listeners.click();assert.equal(cancels,1);assert.equal(nodes['message-input'].disabled,false);
 nodes['message-input'].value='new draft';finish({messages:[{role:'assistant',text:'stale'}],model:'configured'});await pending;assert.equal(nodes.messages.children.length,0);assert.equal(nodes['message-input'].value,'new draft');
});
test('unreadable configured key is explained and sending failure preserves the input draft',async()=>{
 class E{constructor(){this.listeners={};this.value='';this.children=[];this.disabled=false;this.textContent='';}addEventListener(k,f){this.listeners[k]=f;}append(...x){this.children.push(...x);}replaceChildren(){this.children=[];}focus(){}showModal(){}close(){} }
 const nodes=Object.fromEntries(['messages','message-input','send','composer','status','count','clear','clear-dialog','clear-cancel','clear-confirm','cancel','model-state'].map(k=>[k,new E()]));
 const api={read:async()=>({messages:[],model:'settings-error'}),send:async()=>({messages:[{role:'system',text:'模型配置不可读取，请在设置中重新保存。'}],model:'settings-error'})};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../puppet/chat.js'),'utf8'),{window:{chat:api},document:{getElementById:k=>nodes[k],createElement:()=>new E()}});await new Promise(setImmediate);
 assert.match(nodes['model-state'].textContent,/配置读取失败/);assert.doesNotMatch(nodes['model-state'].textContent,/尚未配置|网络/);
 nodes['message-input'].value='这段话应该保留';await nodes.composer.listeners.submit({preventDefault(){}});
 assert.equal(nodes['message-input'].value,'这段话应该保留');assert.equal(nodes['message-input'].disabled,false);assert.match(nodes.status.textContent,/配置不可读取/);
});
