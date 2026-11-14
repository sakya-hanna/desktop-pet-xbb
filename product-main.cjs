'use strict';
function productArgs(argv, defaultApp) {
  if (defaultApp !== undefined && typeof defaultApp !== 'boolean') throw new TypeError('Invalid defaultApp argument');
  const offset = defaultApp ? 2 : 1;
  if (!Array.isArray(argv) || argv.length < offset || [...argv].some(arg => typeof arg !== 'string' || !arg)
    || argv.slice(0, offset).some(arg => arg.startsWith('--'))) throw new TypeError('Invalid product argv');
  return argv.slice(offset);
}

function startProduct({ electron, argv = process.argv, defaultApp = process.defaultApp, env = process.env,
  fsImpl, stateIO, clock, ...unsupported } = {}) {
  if (Object.keys(unsupported).length) throw new TypeError('Unsupported product startup option');
  if (!electron?.app) throw new TypeError('Explicit Electron dependency required');
  const args = productArgs(argv, defaultApp);
  // Keep dependency/resource preflight failures inside the direct-entry error boundary.
  const { boot, parseArgs } = require('./desktop-main.cjs');
  const options = parseArgs(args.some(arg => arg === '--hidden' || arg === '--visible') ? args : ['--visible', ...args]);
  if (options.mode === 'hidden' && options.profileRoot === undefined) throw new Error('Explicit hidden profile required');
  return boot({ electron, root: __dirname, ...options, storageLayout: 'product',
    appDataRoot: electron.app.getPath('appData'), env, fsImpl, stateIO, clock });
}
module.exports = { startProduct };
if (require.main === module) {
  const electron = require('electron');
  let normalVisible = false;
  try {
    const args = productArgs(process.argv, process.defaultApp);
    normalVisible = args.length === 0 || (args.length === 1 && args[0] === '--visible');
  } catch { /* Ambiguous/invalid modes must never open a native dialog. */ }
  let quitting = false;
  const onQuit = () => { quitting = true; };
  electron.app.once('before-quit', onQuit);
  Promise.resolve().then(() => quitting ? { cancelled: true } : startProduct({ electron })).then(result => result.ready).catch(() => {
    if (quitting) return;
    console.error('Product startup failed.');
    try {
      if (normalVisible) electron.dialog?.showErrorBox('白姐桌宠启动失败',
        '白姐桌宠未能启动，请关闭后重试。若仍无法启动，请联系支持。');
    } catch { /* A failed dialog must not prevent exit or disclose the native error. */ }
    finally { electron.app.quit(); }
  }).finally(() => electron.app.removeListener('before-quit', onQuit));
}
