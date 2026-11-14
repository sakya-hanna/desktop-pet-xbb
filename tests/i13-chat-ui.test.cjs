'use strict';
const test=require('node:test'), assert=require('node:assert/strict');
const {boot,rows,state,deferred,flush}=require('./i13-frontend-harness.cjs');
test('refocus refreshes model header/footer but never draft; stale reads cannot overwrite a send',async()=>{
  let readCount=0;const refresh=deferred(),send=deferred();
  const ui=await boot('chat',{read:()=>{readCount++;return readCount===1?Promise.resolve(state([],undefined,'unconfigured')):refresh.promise;},send:()=>send.promise});
  assert.match(ui.nodes.status.textContent,/尚未配置/);
  ui.input.value='编辑中';assert.equal(typeof ui.window.listeners.focus,'function');
  const refreshing=ui.window.listeners.focus();
  assert.equal(ui.input.disabled,false);
  ui.input.value='新的草稿';const sending=ui.submit();
  refresh.resolve(state([{role:'assistant',text:'过期记录'}],undefined,'configured'));await refreshing;
  assert.deepEqual(rows(ui),[{role:'user',text:'新的草稿'}]);
  assert.equal(ui.input.value,'新的草稿');
  send.resolve(state([{role:'user',text:'新的草稿'}],'request-error'));await sending;
  await ui.window.listeners.focus();
  assert.match(ui.nodes['model-state'].textContent,/模型已配置/);
  assert.doesNotMatch(ui.nodes.status.textContent,/尚未配置/);
  assert.equal(ui.nodes.send.textContent,'发送');assert.equal(ui.input.value,'新的草稿');
});
test('focus during pending request defers refresh without disrupting cancel and clears no draft',async()=>{
  let reads=0; const send=deferred();
  const ui=await boot('chat',{read:async()=>{reads++;return state([],undefined,'settings-error');},send:()=>send.promise});
  ui.input.value='草稿';const pending=ui.submit();
  assert.equal(typeof ui.window.listeners.focus,'function');
  await ui.window.listeners.focus();assert.equal(reads,1);
  assert.equal(ui.nodes.cancel.disabled,false);assert.equal(rows(ui).length,1);
  send.resolve(state([{role:'user',text:'草稿'}],'request-error','configured'));await pending;await flush();
  assert.equal(reads,2);assert.match(ui.nodes['model-state'].textContent,/配置读取失败/);
  assert.doesNotMatch(ui.nodes['model-state'].textContent,/重新保存/);
  assert.match(ui.nodes.status.textContent,/配置读取失败/);assert.equal(ui.input.value,'草稿');
});
test('IME, Shift Enter and 4000 codepoint guards; confirmed clear alone removes history',async()=>{
  let sends=0,clears=0;
  const ui=await boot('chat',{read:async()=>state([{role:'assistant',text:'<img onerror=x>'}]),send:async()=>{sends++;return state([],'success');},clear:async()=>{clears++;return state();}});
  ui.input.value='输入';ui.fire('message-input','compositionstart');await ui.submit();ui.fire('message-input','keydown',{key:'Enter'});
  ui.fire('message-input','compositionend');ui.fire('message-input','keydown',{key:'Enter',isComposing:true});ui.fire('message-input','keydown',{key:'Enter',keyCode:229});ui.fire('message-input','keydown',{key:'Enter',shiftKey:true});
  assert.equal(sends,0);ui.input.value='😀'.repeat(4001);await ui.submit();assert.equal(sends,0);
  ui.input.value='😀'.repeat(4000);await ui.submit();assert.equal(sends,1);
  ui.fire('clear','click');assert.equal(ui.nodes['clear-dialog'].open,true);assert.equal(clears,0);
  ui.fire('clear-cancel','click');assert.equal(clears,0);ui.fire('clear','click');await ui.fire('clear-confirm','click');assert.equal(clears,1);
});
for (const [outcome, text] of [
  ['request-error','HTTP 401'], ['request-error','网络连接失败'], ['request-error','等待超时'],
  ['settings-error','配置读取失败'], ['cancelled','请求取消'], ['saved','仅本机保存'], [undefined,'未知结果']
]) test(`E02 ${outcome || 'missing outcome'} ${text} preserves draft and persisted user row; retry is explicit`,async()=>{
  const persisted=[]; let calls=0;
  const ui=await boot('chat',{read:async()=>state(),send:async draft=>{
    calls++; persisted.push({role:'user',text:draft});
    return state([...persisted,{role:'system',text:'<b>'+text+'</b>'}],outcome);
  }});
  ui.input.value='原草稿'; await ui.submit();
  assert.equal(ui.input.value,'原草稿');
  assert.equal(rows(ui).at(-1).text,'<b>'+text+'</b>');
  assert.equal(rows(ui).filter(r=>r.role==='user').length,1);
  assert.equal(calls,1); assert.equal(ui.nodes.send.disabled,false);
  await ui.submit();
  assert.equal(calls,2); assert.equal(rows(ui).filter(r=>r.role==='user').length,2);
});
test('rejected persistence removes optimistic phantom and restores acknowledged history without losing draft',async()=>{
  const before=[{role:'assistant',text:'之前已保存'}],wait=deferred();
  const ui=await boot('chat',{read:async()=>state(before),send:()=>wait.promise});
  ui.input.value='未落盘草稿';const pending=ui.submit();assert.equal(rows(ui).length,2);
  wait.reject(Error('write rejected'));await pending;
  assert.deepEqual(rows(ui),before);assert.equal(ui.input.value,'未落盘草稿');
  assert.match(ui.nodes.status.textContent,/失败/);assert.equal(ui.nodes.send.disabled,false);
});
for (const rejectCancel of [false,true]) test(`cancel is responsive, retains draft and fences stale success/rejection (${rejectCancel})`,async()=>{
  const old=deferred(),cancel=deferred();let calls=0;
  const ui=await boot('chat',{read:async()=>state(),send:()=>old.promise,cancel:()=>{calls++;return cancel.promise;}});
  ui.input.value='保留草稿'; const send=ui.submit();
  const stopping=ui.fire('cancel','click'); ui.fire('cancel','click');
  assert.equal(calls,1);
  if(rejectCancel)cancel.reject(Error('IPC'));else cancel.resolve(state([{role:'user',text:'保留草稿'}],'cancelled'));
  await stopping;
  assert.equal(ui.input.disabled,false);assert.equal(ui.input.value,'保留草稿');
  assert.equal(rows(ui).length,rejectCancel?0:1);
  ui.input.value='新草稿';
  old.resolve(state([{role:'assistant',text:'不许复活'}],'success')); await send;
  assert.equal(ui.input.value,'新草稿');assert.equal(rows(ui).some(r=>r.text==='不许复活'),false);
});
test('E01 pending send shows one user bubble immediately and reconciles final snapshot exactly once',async()=>{
  const wait=deferred(); let sends=0;
  const ui=await boot('chat',{read:async()=>state(),send:()=>{sends++;return wait.promise;}});
  ui.input.value='  <b>弟弟😀</b>  ';
  const pending=ui.submit();
  assert.deepEqual(rows(ui),[{role:'user',text:'<b>弟弟😀</b>'}]);
  assert.equal(ui.nodes.cancel.disabled,false);
  await ui.submit(); await ui.fire('message-input','keydown',{key:'Enter'});
  assert.equal(sends,1);
  wait.resolve(state([{role:'user',text:'<b>弟弟😀</b>'},{role:'assistant',text:'姐姐在呢'}],'success'));
  await pending;
  assert.deepEqual(rows(ui),[{role:'user',text:'<b>弟弟😀</b>'},{role:'assistant',text:'姐姐在呢'}]);
  assert.equal(ui.input.value,'');
});
