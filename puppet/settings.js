'use strict';
(() => {
  const element = id => document.getElementById(id);
  const form = element('settings-form'), baseUrl = element('base-url'), model = element('model');
  const key = element('api-key'), remove = element('remove-key'), indicator = element('key-status');
  const save = element('save'), test = element('test'), status = element('status');
  let busy = true;
  function setBusy(value) {
    busy = value;
    for (const control of [baseUrl,model,key,remove,save,test]) control.disabled = busy;
    key.disabled = busy || remove.checked;
  }
  function paint(value) {
    baseUrl.value = value.baseUrl;
    model.value = value.model;
    indicator.textContent = value.keyConfigured ? '已配置密钥' : '未配置密钥';
    key.value = ''; remove.checked = false;
  }
  remove.addEventListener('change', () => {
    key.disabled = busy || remove.checked;
    if (remove.checked) key.value = '';
  });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (busy) return;
    const value = {baseUrl:baseUrl.value.trim(), model:model.value.trim()};
    if (remove.checked) value.apiKey = '';
    else if (key.value !== '') value.apiKey = key.value;
    setBusy(true); status.textContent = '正在保存…';
    try {
      const result = await window.settings.save(value);
      if (result.ok) { paint(result.settings); status.textContent = '设置已保存。'; }
      else status.textContent = '保存失败，请检查配置和安全存储。';
    } catch { status.textContent = '保存失败，请检查配置和安全存储。'; }
    finally { key.value = ''; delete value.apiKey; setBusy(false); }
  });
  test.addEventListener('click', async () => {
    if (busy) return;
    setBusy(true); status.textContent = '正在测试已保存的连接…';
    try { const result = await window.settings.test(); status.textContent = result.ok ? '连接成功。' : '连接失败，请检查已保存的配置。'; }
    catch { status.textContent = '连接失败，请检查已保存的配置。'; }
    finally { setBusy(false); }
  });
  setBusy(true);
  window.settings.read().then(value => {
    paint(value); setBusy(false);
    status.textContent = '修改后请保存；连接测试需要单独点击。';
  }).catch(() => { status.textContent = '读取设置失败，请关闭窗口后重试。'; });
})();
