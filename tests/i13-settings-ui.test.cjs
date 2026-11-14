'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {boot,deferred}=require('./i13-frontend-harness.cjs');
const safe={baseUrl:'https://example.invalid/v1',model:'fixture',keyConfigured:true,loadStatus:'valid',writeBlocked:false,notice:null};
for(const loadStatus of ['invalid','read-error','decrypt-failure','unknown'])test(`settings visibly protects ${loadStatus}; no write/test or stored key display`,async()=>{
  let calls=0;
  const ui=await boot('settings',{read:async()=>({...safe,loadStatus,writeBlocked:true,notice:'本次运行禁止覆盖；请保留原文件。',apiKey:'fixture-never-render'}),save:async()=>{calls++;},test:async()=>{calls++;}});
  assert.equal(ui.nodes.save.disabled,true);assert.equal(ui.nodes.test.disabled,true);
  assert.match(ui.nodes['store-notice']?.textContent||'',/禁止覆盖/);
  assert.equal(ui.nodes['api-key'].value,'');
  await ui.submit();await ui.fire('test','click');assert.equal(calls,0);
  assert.equal(Object.values(ui.nodes).some(n=>n.textContent.includes('fixture-never-render')||n.value.includes('fixture-never-render')),false);
});
test('settings save failure re-reads protection status without clobbering edits',async()=>{
  let reads=0;
  const ui=await boot('settings',{read:async()=>++reads===1?safe:{...safe,loadStatus:'decrypt-failure',writeBlocked:true,notice:'密钥不可读取，本次运行禁止覆盖。'},save:async()=>({ok:false})});
  ui.nodes['base-url'].value='https://edited.invalid/v1';ui.nodes.model.value='edited';
  await ui.submit();assert.equal(reads,2);assert.equal(ui.nodes['base-url'].value,'https://edited.invalid/v1');assert.equal(ui.nodes.model.value,'edited');
  assert.equal(ui.nodes.save.disabled,true);assert.match(ui.nodes['store-notice']?.textContent||'',/禁止覆盖/);assert.match(ui.nodes.status.textContent,/失败/);
});
test('settings omission preserves key while explicit clear is sent; busy guard suppresses duplicate submit',async()=>{
  const wait=deferred(),payloads=[];
  const ui=await boot('settings',{read:async()=>safe,save:value=>{payloads.push({...value});return payloads.length===1?wait.promise:Promise.resolve({ok:true,settings:{...safe,keyConfigured:false}});}});
  const pending=ui.submit();await ui.submit();assert.equal(payloads.length,1);assert.equal(Object.hasOwn(payloads[0],'apiKey'),false);
  wait.resolve({ok:true,settings:safe});await pending;
  ui.nodes['remove-key'].checked=true;ui.fire('remove-key','change');await ui.submit();assert.equal(payloads[1].apiKey,'');assert.equal(ui.nodes['api-key'].value,'');
});
for(const rejects of [false,true])test(`connection-test failure refreshes newly blocked store without clobbering edits (${rejects})`,async()=>{
  let reads=0;
  const ui=await boot('settings',{read:async()=>++reads===1?safe:{...safe,loadStatus:'decrypt-failure',writeBlocked:true,notice:'密钥不可读取，禁止覆盖。'},test:async()=>{if(rejects)throw Error('IPC');return {ok:false};}});
  ui.nodes.model.value='未保存编辑';await ui.fire('test','click');
  assert.equal(reads,2);assert.equal(ui.nodes.model.value,'未保存编辑');assert.equal(ui.nodes.save.disabled,true);
  assert.match(ui.nodes['store-notice'].textContent,/禁止覆盖/);assert.match(ui.nodes.status.textContent,/连接失败/);
});
test('settings rejected load remains visibly unavailable and never enables save',async()=>{
  const ui=await boot('settings',{read:async()=>{throw Error('read');}});
  assert.equal(ui.nodes.save.disabled,true);assert.match(ui.nodes.status.textContent,/读取设置失败/);
});
