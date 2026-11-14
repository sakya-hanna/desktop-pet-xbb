(() => {
  const el = id => document.getElementById(id);
  const input = el('message-input'), send = el('send');
  const status = el('status'), dialog = el('clear-dialog'), list = el('messages');
  let composing = false, busy = true, operation = 0, sending = false;
  let configured = false, modelState = 'unconfigured';
  let acknowledged = { messages: [], model: 'unconfigured', pending: false };
  let refreshWanted = false, refreshGeneration = 0;

  function modelHint() {
    return modelState === 'settings-error' ? '模型配置读取失败，请打开模型设置检查。'
      : configured ? '模型已配置，可以发送消息。' : '模型尚未配置，消息仅保存在本机。';
  }

  async function refreshModel() {
    if (busy) { refreshWanted = true; return; }
    refreshWanted = false;
    const token = operation, refresh = ++refreshGeneration;
    try {
      const state = await window.chat.read();
      if (busy || token !== operation || refresh !== refreshGeneration) return;
      // Refocus reads model status only: never replace an active draft or history.
      render({ ...acknowledged, model: state.model });
      status.textContent = modelHint();
      update();
    } catch {
      if (!busy && token === operation && refresh === refreshGeneration)
        status.textContent = '刷新模型状态失败，输入已保留，请重新聚焦窗口重试。';
    }
  }

  function finish() {
    busy = false;
    update();
    input.focus();
    if (refreshWanted) void refreshModel();
  }

  function fitInput() {
    const follow = list.scrollHeight - list.clientHeight - list.scrollTop <= 48;
    input.style.height = 'auto';
    // scrollHeight includes padding but not the two 1px borders (border-box).
    input.style.height = (input.scrollHeight + 2) + 'px';
    if (follow) list.scrollTop = list.scrollHeight;
  }

  function update() {
    fitInput();
    const count = [...input.value].length;
    el('count').textContent = count + ' / 4000 · Shift+Enter 换行';
    send.disabled = busy || composing || !input.value.trim() || count > 4000;
    send.textContent = configured || modelState === 'settings-error' ? '发送' : '保存消息';
    el('clear').disabled = busy;
    input.disabled = busy;
    if (el('cancel')) el('cancel').disabled = !sending;
  }

  function render(state, forceFollow = false, acknowledge = true) {
    if (acknowledge) acknowledged = state;
    if (state.model) {
      modelState = state.model;
      configured = modelState === 'configured';
    }
    if (el('model-state')) el('model-state').textContent = modelState === 'settings-error'
      ? '模型配置读取失败 · 请打开模型设置检查'
      : configured ? '模型已配置 · 最近对话保存在本机' : '仅本机记录 · 模型尚未配置';
    if (el('empty-state')) el('empty-state').hidden = state.messages.length !== 0;

    // Read before replacing DOM: removing the children can reset scrollTop.
    const previousTop = list.scrollTop;
    const follow = forceFollow || list.scrollHeight - list.clientHeight - previousTop <= 48;
    list.replaceChildren();
    for (const row of state.messages) {
      const item = document.createElement('article');
      const label = document.createElement('strong'), text = document.createElement('div');
      item.className = 'message ' + row.role;
      label.className = 'message-name';
      label.textContent = row.role === 'user' ? '你' : row.role === 'system' ? '系统提示' : '白姐';
      text.className = 'message-text';
      text.textContent = row.text;
      item.append(label, text);
      if (row.role !== 'system') {
        const avatar = document.createElement('span');
        avatar.className = 'message-avatar ' + (row.role === 'user' ? 'user-avatar' : 'assistant-avatar');
        if (row.role === 'user') avatar.textContent = '你';
        else {
          const portrait = document.createElement('img');
          portrait.src = 'assets/chat/baijie-avatar.png';
          portrait.alt = '';
          portrait.width = 40;
          portrait.height = 40;
          avatar.append(portrait);
        }
        item.append(avatar);
      }
      list.append(item);
    }
    list.scrollTop = follow ? list.scrollHeight : previousTop;
  }

  async function submit(event) {
    event.preventDefault();
    if (busy || composing || !input.value.trim() || [...input.value].length > 4000) return;
    // Explicit send opts into following; scrolling up while waiting opts out again.
    list.scrollTop = list.scrollHeight;
    const token = ++operation;
    sending = true;
    busy = true;
    update();
    render({ ...acknowledged, messages: [...acknowledged.messages, { role: 'user', text: input.value.trim() }] }, true, false);
    status.textContent = configured ? '正在等待白姐回复…' : '正在保存到本机…';
    try {
      const state = await window.chat.send(input.value);
      if (token !== operation) return;
      render(state);
      if (state.outcome === 'success') input.value = '';
      const last = state.messages.at(-1);
      status.textContent = last?.role === 'system' ? last.text : {
        success: '回复已保存到本机。',
        saved: '消息已保存在本机，未发送到网络；草稿已保留。',
        'request-error': '请求失败，草稿已保留，请重试。',
        'settings-error': '模型配置读取失败，草稿已保留。',
        cancelled: '请求已取消，草稿已保留。',
      }[state.outcome] || '未确认发送结果，草稿已保留。';
    } catch {
      if (token === operation) {
        render(acknowledged);
        status.textContent = '发送或保存失败，请保留输入并重试。';
      }
    } finally {
      if (token === operation) { sending = false; finish(); }
    }
  }

  el('composer').addEventListener('submit', submit);
  input.addEventListener('input', update);
  input.addEventListener('compositionstart', () => { composing = true; update(); });
  input.addEventListener('compositionend', () => { composing = false; update(); });
  input.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && !composing && event.keyCode !== 229) submit(event);
  });
  el('cancel')?.addEventListener('click', async () => {
    if (!sending) return;
    operation++;
    sending = false;
    update();
    try {
      render(await window.chat.cancel());
      status.textContent = '请求已取消，已保存的消息仍保留；草稿已保留。';
    } catch {
      render(acknowledged);
      status.textContent = '取消失败，草稿已保留，请关闭聊天窗口重试。';
    } finally { finish(); }
  });
  el('clear').addEventListener('click', () => { if (!busy) dialog.showModal(); });
  el('clear-cancel').addEventListener('click', () => { dialog.close(); input.focus(); });
  el('clear-confirm').addEventListener('click', async () => {
    if (busy) return;
    busy = true;
    operation++;
    el('clear-confirm').disabled = true;
    update();
    try {
      render(await window.chat.clear());
      dialog.close();
      status.textContent = '本机聊天记录已清空。';
    } catch {
      status.textContent = '清空失败，原记录已保留，请重试。';
    } finally {
      el('clear-confirm').disabled = false;
      finish();
    }
  });
  window.addEventListener('focus', refreshModel);
  update();
  window.chat.read().then(state => {
    render(state, true);
    status.textContent = modelHint();
  }).catch(() => {
    status.textContent = '读取记录失败，请重新打开聊天窗口。';
  }).finally(finish);
})();
