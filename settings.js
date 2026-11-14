'use strict';
(() => {
  const element = id => document.getElementById(id);
  const form = element('settings-form'), baseUrl = element('base-url'), model = element('model');
  const key = element('api-key'), remove = element('remove-key'), indicator = element('key-status');
  const save = element('save'), test = element('test'), status = element('status'), notice = element('store-notice');
  let busy = true, writeBlocked = false;
  function setBusy(value) {
    busy = value;
    for (const control of [baseUrl,model,key,remove,save,test]) control.disabled = busy || writeBlocked;
    key.disabled = busy || writeBlocked || remove.checked;
  }
  function protection(value) {
    // Never unlock a store that has reported a protected load during this window.
    writeBlocked = writeBlocked || value.writeBlocked === true ||
      (typeof value.loadStatus === 'string' && !['valid','missing'].includes(value.loadStatus));
    notice.textContent = typeof value.notice === 'string' && value.notice ? value.notice
      : writeBlocked ? '设置读取异常，本次运行禁止覆盖；请保留原文件，受控恢复后重新打开。' : '';
    notice.hidden = !notice.textContent;
  }
  function paint(value) {
    protection(value);
    baseUrl.value = value.baseUrl;
    model.value = value.model;
    indicator.textContent = value.keyConfigured ? '已配置密钥' : '未配置密钥';
    // Only the boolean is consumed; never assign any returned credential to DOM.
    key.value = ''; remove.checked = false;
  }
  async function refreshProtection() {
    try { protection(await window.settings.read()); }
    catch {
      writeBlocked = true;
      notice.textContent = '读取设置状态失败，已禁止继续写入，请关闭窗口后重试。';
      notice.hidden = false;
    }
  }
  remove.addEventListener('change', () => {
    key.disabled = busy || writeBlocked || remove.checked;
    if (remove.checked) key.value = '';
  });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (busy || writeBlocked) return;
    const value = {baseUrl:baseUrl.value.trim(), model:model.value.trim()};
    if (remove.checked) value.apiKey = '';
    else if (key.value !== '') value.apiKey = key.value;
    setBusy(true); status.textContent = '正在保存…';
    try {
      const result = await window.settings.save(value);
      if (result.ok === true) { paint(result.settings); status.textContent = '设置已保存。'; }
      else { status.textContent = '保存失败，请检查配置和安全存储。'; await refreshProtection(); }
    } catch { status.textContent = '保存失败，请检查配置和安全存储。'; await refreshProtection(); }
    finally { key.value = ''; delete value.apiKey; setBusy(false); }
  });
  test.addEventListener('click', async () => {
    if (busy || writeBlocked) return;
    setBusy(true); status.textContent = '正在测试已保存的连接…';
    try {
      const result = await window.settings.test();
      status.textContent = result.ok === true ? '连接成功。' : '连接失败，请检查已保存的配置。';
      if (result.ok !== true) await refreshProtection();
    } catch { status.textContent = '连接失败，请检查已保存的配置。'; await refreshProtection(); }
    finally { setBusy(false); }
  });
  setBusy(true);
  window.settings.read().then(value => {
    paint(value); setBusy(false);
    status.textContent = writeBlocked ? '设置加载失败，已阻止保存和连接测试。' : '修改后请保存；连接测试需要单独点击。';
  }).catch(() => { status.textContent = '读取设置失败，请关闭窗口后重试。'; });
})();
