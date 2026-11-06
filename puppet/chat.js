(() => {
  const el=id=>document.getElementById(id);
  const input=el('message-input'),send=el('send'),status=el('status'),dialog=el('clear-dialog');
  let composing=false,busy=true,operation=0,configured=false,modelState='unconfigured';
  function update(){const count=[...input.value].length;el('count').textContent=count+' / 4000 · Shift+Enter 换行';send.disabled=busy||composing||!input.value.trim()||count>4000;send.textContent=configured||modelState==='settings-error'?'发送':'保存消息';el('clear').disabled=busy;input.disabled=busy;if(el('cancel'))el('cancel').disabled=!busy;}
  function render(state){
    if(state.model){modelState=state.model;configured=modelState==='configured';}
    if(el('model-state'))el('model-state').textContent=modelState==='settings-error'?'模型配置读取失败 · 请在模型设置中重新保存密钥':configured?'模型已配置 · 最近对话保存在本机':'仅本机记录 · 模型尚未配置';
    const list=el('messages');list.replaceChildren();
    for(const row of state.messages){const item=document.createElement('article'),label=document.createElement('strong'),text=document.createElement('div');item.className='message '+row.role;label.textContent=row.role==='user'?'你':row.role==='system'?'系统提示':'白姐';text.textContent=row.text;item.append(label,text);list.append(item);}
    list.scrollTop=list.scrollHeight;
  }
  async function submit(event){
    event.preventDefault();if(busy||composing||!input.value.trim()||[...input.value].length>4000)return;
    const token=++operation;busy=true;update();status.textContent=configured?'正在等待白姐回复…':'正在保存到本机…';
    try{const state=await window.chat.send(input.value);if(token!==operation)return;render(state);if(modelState!=='settings-error')input.value='';const last=state.messages.at(-1);status.textContent=last?.role==='system'?last.text:configured?'回复已保存到本机。':'尚未配置模型，消息已保存在本机，未发送到网络。';}
    catch{if(token===operation)status.textContent='发送或保存失败，请保留输入并重试。';}
    finally{if(token===operation){busy=false;update();input.focus();}}
  }
  el('composer').addEventListener('submit',submit);input.addEventListener('input',update);
  input.addEventListener('compositionstart',()=>{composing=true;update();});input.addEventListener('compositionend',()=>{composing=false;update();});
  input.addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing&&!composing&&event.keyCode!==229)submit(event);});
  el('cancel')?.addEventListener('click',async()=>{if(!busy)return;operation++;try{render(await window.chat.cancel());input.value='';status.textContent='请求已取消，已保存的消息仍保留。';}catch{status.textContent='取消失败，请关闭聊天窗口重试。';}finally{busy=false;update();input.focus();}});
  el('clear').addEventListener('click',()=>{if(!busy)dialog.showModal();});
  el('clear-cancel').addEventListener('click',()=>{dialog.close();input.focus();});
  el('clear-confirm').addEventListener('click',async()=>{if(busy)return;busy=true;el('clear-confirm').disabled=true;update();try{render(await window.chat.clear());dialog.close();status.textContent='本机聊天记录已清空。';}catch{status.textContent='清空失败，原记录已保留，请重试。';}finally{busy=false;el('clear-confirm').disabled=false;update();input.focus();}});
  window.chat.read().then(render).catch(()=>{status.textContent='读取记录失败，请重新打开聊天窗口。';}).finally(()=>{busy=false;update();input.focus();});
})();
