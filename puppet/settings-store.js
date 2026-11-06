'use strict';
const fs = require('node:fs');
const path = require('node:path');
// Main-only: create({file,safeStorage}) -> {snapshot,save,getRequestConfig}.
// save requires baseUrl/model; absent apiKey preserves, '' clears. Never send
// getRequestConfig() to a renderer. No defaults or other configuration imports.
// snapshot/save -> {baseUrl,model,keyConfigured}; getRequestConfig replaces the
// boolean with apiKey. keyConfigured means ciphertext exists, not decryptability.
// HTTP: only localhost, 127/8 and ::1; HTTPS: explicit custom endpoints allowed.
// No credentials/query/hash/backslashes/whitespace in URLs (max 2048 chars).
// Model: nonblank max 200 UTF-16 units; key: '' or max 4096 printable ASCII.
// Inject Electron safeStorage in main; encryption unavailable fails closed for
// new keys/reads. Existing ciphertext may be preserved or explicitly cleared.
// Versioned own-file load only (64 KiB max); invalid stores start unconfigured.
// Synchronous same-directory temp + rename: failed saves retain old memory/file.
function validateConfig(baseUrl,model) {
  try {
    if (typeof baseUrl !== 'string' || baseUrl.length > 2048 || !/^https?:\/\/[^/]/i.test(baseUrl) || /[\s?#\\]/u.test(baseUrl) || baseUrl.split('/')[2].includes('@')) throw new Error();
    const url = new URL(baseUrl);
    const loopback = url.hostname === 'localhost' || url.hostname === '[::1]' || /^127(?:\.\d{1,3}){3}$/.test(url.hostname);
    if (!['https:','http:'].includes(url.protocol) || (url.protocol === 'http:' && !loopback) || url.username || url.password) throw new Error();
    if (typeof model !== 'string' || !model.trim() || model.length > 200 || /[\x00-\x1f\x7f]/.test(model)) throw new Error();
    return {baseUrl:url.href.replace(/\/+$/,''),model:model.trim()};
  } catch { throw new Error('Invalid AI settings'); }
}
function create({file,safeStorage}) {
  let state = {version:1,baseUrl:'',model:'',encryptedKey:''};
  try {
    if (fs.statSync(file).size > 65536) throw new Error();
    const stored = JSON.parse(fs.readFileSync(file,'utf8'));
    if (!stored || stored.version !== 1 || Object.hasOwn(stored,'apiKey') || typeof stored.encryptedKey !== 'string' || stored.encryptedKey.length > 32768 ||
        !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(stored.encryptedKey)) throw new Error();
    state = {version:1,...validateConfig(stored.baseUrl,stored.model),encryptedKey:stored.encryptedKey};
  } catch {}
  const snapshot = () => ({baseUrl:state.baseUrl,model:state.model,keyConfigured:!!state.encryptedKey});
  function secure(operation) {
    try {
      if (safeStorage?.isEncryptionAvailable() !== true) throw new Error();
      return operation();
    } catch { throw new Error('Secure key storage unavailable'); }
  }
  return {
    snapshot,
    save({baseUrl,model,apiKey}) {
      const validated = validateConfig(baseUrl,model);
      if (apiKey !== undefined && (typeof apiKey !== 'string' || apiKey.length > 4096 || /[^\x21-\x7e]/.test(apiKey))) throw new Error('Invalid AI settings');
      const encryptedKey = apiKey === undefined ? state.encryptedKey : apiKey === '' ? '' : secure(()=>safeStorage.encryptString(apiKey).toString('base64'));
      const next = {version:1,...validated,encryptedKey};
      const temp = `${file}.${require('node:crypto').randomUUID()}.tmp`;
      try {
        fs.mkdirSync(path.dirname(file),{recursive:true});
        fs.writeFileSync(temp,JSON.stringify(next),{mode:0o600,flag:'wx'});
        fs.renameSync(temp,file);
      } catch { throw new Error('Could not save AI settings'); }
      finally { try { fs.unlinkSync(temp); } catch {} }
      state=next;
      return snapshot();
    },
    getRequestConfig() { return {baseUrl:state.baseUrl,model:state.model,apiKey:state.encryptedKey ? secure(()=>safeStorage.decryptString(Buffer.from(state.encryptedKey,'base64'))) : ''}; }
  };
}
module.exports = {create};
