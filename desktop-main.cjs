'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createShell } = require('./shell.cjs');
const { SCHEME, validateProfile, assertNoSymlinks, assertProfileTree, createOwnedSession, installResources, installPolicy } = require('./resource-policy.cjs');

function parseArgs(args) {
  const result = { mode: 'hidden' }; let explicitMode = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--hidden' || arg === '--visible') {
      if (explicitMode) throw new Error('Conflicting or duplicate mode flags');
      explicitMode = true; result.mode = arg.slice(2);
    } else if (arg === '--profile-root') {
      if (result.profileRoot !== undefined || !args[i + 1] || args[i + 1].startsWith('--'))
        throw new Error('Explicit profile path required once');
      result.profileRoot = args[++i];
    } else throw new Error(`Unsupported entry argument: ${arg}`);
  }
  if (result.mode === 'visible' && result.profileRoot !== undefined) throw new Error('Visible profile is fixed');
  return result;
}

function configurePaths({ app, root = __dirname, profileRoot, mode = 'hidden', storageLayout = 'candidate', appDataRoot, env = process.env, fsImpl = fs }) {
  if (app.isReady()) throw new Error('Configure isolated paths before app ready');
  profileRoot = validateProfile({ root, profileRoot, mode, storageLayout, appDataRoot, fsImpl });
  const paths = { profileRoot, userData: path.join(profileRoot, 'userData'),
    sessionData: path.join(profileRoot, 'sessionData'), logs: path.join(profileRoot, 'logs'), temp: path.join(profileRoot, 'temp') };
  // Validate the complete tree before the first write or app path change.
  for (const value of Object.values(paths)) assertNoSymlinks(value, { allowMissing: true, fsImpl });
  assertProfileTree(profileRoot, { fsImpl });
  // The lock belongs to this startup only; never inherit/release another caller's lock.
  // Check after path preflight, but before any directory, identity or environment mutation.
  if (storageLayout === 'product' && mode === 'visible') {
    for (const name of ['hasSingleInstanceLock', 'requestSingleInstanceLock', 'releaseSingleInstanceLock'])
      if (typeof app[name] !== 'function') throw new Error('Single-instance lock API unavailable');
    if (app.hasSingleInstanceLock() !== false) throw new Error('Single-instance lock already owned or unknown');
  }
  for (const value of Object.values(paths)) fsImpl.mkdirSync(value, { recursive: true });
  for (const value of Object.values(paths)) assertNoSymlinks(value, { allowMissing: true, fsImpl });
  for (const name of Object.keys(env))
    if (/^(NODE_OPTIONS|NODE_PATH|ELECTRON_RUN_AS_NODE|ELECTRON_EXTRA_LAUNCH_ARGS|PUPPET_.*|TEMP|TMP|TMPDIR)$/i.test(name)) delete env[name];
  for (const name of ['TEMP', 'TMP', 'TMPDIR']) env[name] = paths.temp;
  if (storageLayout === 'product') app.setName('BaijieDesktopV1');
  app.setPath('userData', paths.userData); app.setPath('sessionData', paths.sessionData);
  app.setPath('temp', paths.temp); app.setAppLogsPath(paths.logs);
  return paths;
}

/** Call BEFORE app.whenReady. Importing this module never imports Electron or starts a window. */
async function boot({ electron, root = __dirname, profileRoot, mode = 'hidden', storageLayout = 'candidate', appDataRoot, env = process.env,
  fsImpl = fs, createShellImpl = createShell, stateIO, clock, testPolicy, chatOptions } = {}) {
  if (!electron?.app) throw new TypeError('Explicit Electron dependency required');
  const { app, protocol } = electron;
  const paths = configurePaths({ app, root, profileRoot, mode, storageLayout, appDataRoot, env, fsImpl });
  let removePolicy, removeResources, shell, destroyed = false, ownsLock = false;
  let shellLoaded = false, activationPending = false, failureClosing = false;
  const cleanupErrors = [];
  function destroy() {
    if (destroyed) return cleanupErrors; destroyed = true;
    activationPending = false;
    for (const release of [
      () => app.removeListener('second-instance', onSecondInstance),
      () => app.removeListener('before-quit', destroy),
      () => app.removeListener('window-all-closed', onAllClosed),
      () => shell?.destroy(), () => removeResources?.(), () => removePolicy?.(),
      () => { if (ownsLock) { ownsLock = false; app.releaseSingleInstanceLock(); } },
    ]) {
      try { release(); } catch (error) { cleanupErrors.push(error); }
    }
    return cleanupErrors;
  }
  function onAllClosed() { if (!failureClosing) { destroy(); app.quit(); } }
  function onStartupFailure(window) {
    if (destroyed || window.isDestroyed()) return;
    failureClosing = true;
    if (electron.BrowserWindow.getAllWindows().some(open => open !== window)) return;
    // Failure cleanup is not an exit request. Keep a subscriber until the
    // last-window event is actually delivered, even after boot has rejected:
    // removing every subscriber sooner would enable Electron's default quit.
    // Explicit quit emits before-quit instead, so it also releases this guard.
    const releaseFailedClose = () => {
      app.removeListener('window-all-closed', releaseFailedClose);
      app.removeListener('before-quit', releaseFailedClose);
    };
    app.on('window-all-closed', releaseFailedClose);
    app.on('before-quit', releaseFailedClose);
  }
  function onSecondInstance(_event, _argv, _cwd, data) {
    // argv/cwd are untrusted and platform-dependent. Only our visible product
    // startup sends this marker; never open a URL or choose a profile from it.
    if (destroyed || !ownsLock || !data || typeof data !== 'object' || Array.isArray(data)
      || Object.keys(data).length !== 1 || !Object.hasOwn(data, 'productVisible') || data.productVisible !== true) return;
    if (!shellLoaded) activationPending = true;
    else shell.show();
  }
  try {
    if (storageLayout === 'product' && mode === 'visible') {
      const acquired = app.requestSingleInstanceLock({ productVisible: true });
      if (acquired === false) { app.quit(); return { secondary: true }; }
      if (acquired !== true) throw new Error('Invalid single-instance lock result');
      ownsLock = true;
      app.on('second-instance', onSecondInstance);
    }
    app.on('before-quit', destroy); app.on('window-all-closed', onAllClosed);
    protocol.registerSchemesAsPrivileged([{ scheme: SCHEME, privileges: {
      standard: true, secure: true, supportFetchAPI: true, corsEnabled: true,
      bypassCSP: false, allowServiceWorkers: false,
    } }]);
    app.enableSandbox?.();
    for (const name of ['disable-background-networking', 'disable-component-update']) app.commandLine?.appendSwitch(name);
    await app.whenReady();
    if (destroyed) return { cancelled: true };
    const session = createOwnedSession(electron.session);
    removePolicy = installPolicy({ session, root });
    removeResources = installResources({ protocol: session.protocol, root });
    shell = createShellImpl({ electron, session, root, profileRoot: paths.profileRoot, mode, storageLayout, appDataRoot, stateIO, clock, testPolicy, onStartupFailure, chatOptions });
    const ready = shell.ready.then(window => {
      if (!destroyed) {
        shellLoaded = true;
        if (activationPending) { activationPending = false; shell.show(); }
      }
      return window;
    }).catch(error => { destroy(); throw error; });
    // Keep the caller's rejection observable without an unhandled rejection if it attaches late.
    ready.catch(() => {});
    return { shell, window: shell.window, ready, loadPromise: ready, paths, destroy };
  } catch (error) { destroy(); throw error; }
}

module.exports = { boot, configurePaths, installPolicy, installResources, parseArgs, createShell };
if (require.main === module) {
  const electron = require('electron');
  let args;
  try { args = parseArgs(process.argv.slice(2)); }
  catch (error) { console.error(error.message); electron.app.quit(); }
  if (args) boot({ electron, ...args }).then(result => result.ready).catch(error => {
    console.error(`Candidate startup failed: ${error.message}`); electron.app.quit();
  });
}
