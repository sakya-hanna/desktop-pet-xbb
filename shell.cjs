'use strict';
const path = require('node:path');
const windowState = require('./shared/window-state.js');
const { defaultBounds, fitBounds, SIZE_PRESETS } = windowState;
const { createResizeSession } = require('./shared/resize-geometry.js');
const { fromMainFrame } = require('./shared/ipc-policy.js');
const { createFeedbackWindow } = require('./feedback-window.cjs');
const { validateProfile, assertNoSymlinks, assertSessionPolicy } = require('./resource-policy.cjs');
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const keys = (value, required, optional = []) => record(value)
  && required.every(k => Object.hasOwn(value, k))
  && Object.keys(value).every(k => required.includes(k) || optional.includes(k));
const number = (value, min, max) => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
const ENTRY_URL = 'baijie28://app/desktop.html';
const SHORTCUT = 'Control+Alt+Shift+B';

function createShell({ electron, session, root, profileRoot, mode = 'hidden', storageLayout = 'candidate', appDataRoot, testPolicy, stateIO = windowState, clock = globalThis, onStartupFailure, chatOptions, character = require('./assets/manifest.json').character }) {
  if (!['hidden', 'visible'].includes(mode)) throw new TypeError('Invalid mode');
  if (testPolicy !== undefined && (mode !== 'hidden' || !keys(testPolicy, ['rescueAvailable']) || typeof testPolicy.rescueAvailable !== 'boolean')) throw new TypeError('Test rescue is hidden-only');
  profileRoot = validateProfile({ root, profileRoot, mode, storageLayout, appDataRoot });
  assertSessionPolicy(session);
  const { BrowserWindow, screen, ipcMain, app, Menu, Tray, globalShortcut } = electron;
  const stateFile = path.join(profileRoot, 'window-state.json');
  assertNoSymlinks(stateFile, { allowMissing: true });
  let loadResult;
  try {
    if (typeof stateIO?.loadStateResult !== 'function' || typeof stateIO?.saveState !== 'function') throw new Error();
    loadResult = stateIO.loadStateResult(stateFile);
    if (!keys(loadResult, ['status', 'value', 'reason'])) throw new Error();
    const { status, value, reason } = loadResult;
    if (status === 'valid') {
      if (reason !== null || !keys(value, ['bounds', 'size', 'alwaysOnTop'], ['idleEnabled'])
        || !keys(value.bounds, ['x', 'y', 'width', 'height']) || !windowState.validState(value)) throw new Error();
    } else if (value !== null || (status === 'invalid' ? !['json', 'schema'].includes(reason)
      : !['missing', 'unsupported-version', 'read-error'].includes(status) || reason !== null)) throw new Error();
  } catch { throw new TypeError('Invalid window state loader contract'); }
  const stateLoadStatus = loadResult.status;
  const stateWriteBlocked = !['valid', 'missing'].includes(stateLoadStatus);
  const stateNoticeCode = stateLoadStatus === 'invalid' ? 'WINDOW_STATE_INVALID'
    : stateLoadStatus === 'unsupported-version' ? 'WINDOW_STATE_UNSUPPORTED'
    : stateLoadStatus === 'read-error' ? 'WINDOW_STATE_READ_ERROR' : null;
  const saved = stateLoadStatus === 'valid' ? loadResult.value : null;
  const bounds = saved ? fitBounds(saved.bounds, screen.getAllDisplays(), screen.getPrimaryDisplay())
    : defaultBounds(screen.getAllDisplays(), screen.getPrimaryDisplay());
  let cachedBounds = bounds, size = saved?.size || 'medium', destroyed = false;
  let alwaysOnTop = saved?.alwaysOnTop ?? true, idleEnabled = saved?.idleEnabled ?? true;
  let saveTimer = null, lastSaved = null, menuDepth = 0, trayMenu = null, topmostTimer = null;
  let cursorTimer = null;
  let clickThrough = false, interactive = true, lastError = null, tray = null, shortcutAvailable = false;
  const unresolvedErrors = new Set();
  function updateError(code, active) {
    const previous = lastError;
    unresolvedErrors.delete(code);
    if (active) unresolvedErrors.add(code);
    lastError = [...unresolvedErrors].at(-1) || null;
    return lastError !== previous;
  }
  let shortcutStatus = mode === 'hidden' ? 'disabled-hidden' : 'not-registered';
  let stateHandlerInstalled = false;
  const nativeListeners = [], cleanupErrors = [];
  const resizeSession = createResizeSession();
  const listeners = [];
  const window = new BrowserWindow({ ...bounds, transparent: true, frame: false, resizable: false,
    show: false, focusable: mode === 'visible', alwaysOnTop, skipTaskbar: true,
    webPreferences: { session, preload: path.join(root, 'desktop-preload.cjs'), contextIsolation: true,
      nodeIntegration: false, sandbox: true, offscreen: mode === 'hidden', backgroundThrottling: false } });
  let presentation;
  const feedbackWindow = createFeedbackWindow({ BrowserWindow, screen, parent: window, session, root, mode, clock,
    retainOnBlur: () => presentation?.retainOnBlur() === true });
  presentation = require('./kaqiu/presentation.cjs').createPresentation({window:feedbackWindow,clock});
  const kaqiu = require('./kaqiu/integration.cjs').createKaqiu({root,profileRoot,mode,clock,presentation,
    onChange: () => { if (alive()) broadcast(); }});
  const alive = () => !destroyed && !window.isDestroyed();
  let chatIntegration = null, presentationId = 0;
  function publishChat(value) {
    if (!alive() || presentationId >= Number.MAX_SAFE_INTEGER) return;
    if (!value.clear && (mode !== 'visible' || !window.isVisible())) return;
    window.webContents.send('chat:presentation', { id: ++presentationId, ...value });
  }
  function cancelChat() {
    if (!alive()) return false;
    if (chatIntegration) chatIntegration.cancel(); else publishChat({ clear: true });
    return true;
  }
  function openChatPanel(which) {
    if (!alive()) return false;
    try {
      if (!chatIntegration) chatIntegration = require('./chat-integration.cjs').create({
        electron, session, root, profileRoot, mode, storageLayout, appDataRoot, chatOptions,
        onReply: reply => publishChat(reply), onCancel: () => publishChat({ clear: true }),
      });
      const opened = which === 'chat' ? chatIntegration.openChat() : chatIntegration.openSettings();
      updateError('Chat settings unavailable', false); return !!opened;
    } catch { updateError('Chat settings unavailable', true); notifyState(); return false; }
  }
  const rescueAvailable = () => !!(tray && !tray.isDestroyed()) || shortcutAvailable || testPolicy?.rescueAvailable === true;
  const snapshot = () => ({ bounds: window.isDestroyed() ? { ...cachedBounds } : window.getBounds(), size, alwaysOnTop,
    clickThrough, visible: !window.isDestroyed() && window.isVisible(), idleEnabled,
    shortcut: SHORTCUT, shortcutAvailable, shortcutStatus, rescueAvailable: rescueAvailable(),
    testRescue: testPolicy?.rescueAvailable === true, lastError, mode,
    stateLoadStatus, stateWriteBlocked, stateNoticeCode, kaqiu:kaqiu.snapshot() });
  function save() {
    if (saveTimer !== null) { clock.clearTimeout(saveTimer); saveTimer = null; }
    if (stateWriteBlocked) return false;
    const state = { bounds: snapshot().bounds, size, alwaysOnTop, idleEnabled };
    const serialized = JSON.stringify(state);
    try {
      if (serialized !== lastSaved || unresolvedErrors.has('Window state save failed')) {
        assertNoSymlinks(stateFile, { allowMissing: true }); stateIO.saveState(stateFile, state); lastSaved = serialized;
      }
    } catch {
      if (updateError('Window state save failed', true)) notifyState();
      return false;
    }
    if (updateError('Window state save failed', false)) notifyState();
    return true;
  }
  function scheduleSave() {
    if (saveTimer !== null) { clock.clearTimeout(saveTimer); saveTimer = null; }
    if (stateWriteBlocked || !alive()) return;
    saveTimer = clock.setTimeout(() => { saveTimer = null; if (alive()) save(); }, 200);
    saveTimer?.unref?.();
  }
  function notifyState() { if (alive()) {
    cachedBounds = window.getBounds();
    feedbackWindow.sync();
    window.webContents.send('desktop:state', snapshot());
  } }
  // Error/recovery notifications are not persistence requests: never retry from them.
  const broadcast = () => { if (alive()) {
    notifyState(); scheduleSave();
    if (tray && !tray.isDestroyed() && !menuDepth) refreshTrayMenu();
  } };
  function trusted(event) {
    return alive() && fromMainFrame(event, window) && event.senderFrame.url === ENTRY_URL;
  }
  function on(channel, count, handler) {
    const listener = (event, ...args) => {
      if (trusted(event) && args.length === count) handler(...args);
    };
    ipcMain.on(channel, listener); listeners.push([channel, listener]);
  }
  function moveWithStableSize(target) {
    // Fractional Windows scaling can round both setBounds and setPosition outward.
    // Correct the native readback, bounded to small rounding errors and three calls.
    let request = { ...target };
    for (let attempt = 0; attempt < 3; attempt++) {
      window.setBounds(request);
      const actual = window.getBounds(), dw = target.width - actual.width, dh = target.height - actual.height;
      if (dw === 0 && dh === 0) { updateError('Native drag dimensions did not settle', false); return true; }
      if (Math.abs(dw) > 2 || Math.abs(dh) > 2 || request.width + dw < 1 || request.height + dh < 1) break;
      request = { ...request, width: request.width + dw, height: request.height + dh };
    }
    updateError('Native drag dimensions did not settle', true);
    return false;
  }
  function drag(value) {
    if (!alive() || clickThrough || !keys(value, ['dx', 'dy']) || !number(value.dx, -10000, 10000) || !number(value.dy, -10000, 10000)) return false;
    const b = window.getBounds();
    resizeSession.reset();
    const next=fitBounds({ ...b, x: b.x + value.dx, y: b.y + value.dy }, screen.getAllDisplays(), screen.getPrimaryDisplay());
    const moved = moveWithStableSize(next);
    broadcast(); return moved;
  }
  function resizeBy(value) {
    if (!alive() || clickThrough) return false;
    let factor = value, anchor;
    if (record(value)) {
      if (!keys(value, ['factor'], ['anchor'])) return false;
      factor = value.factor; anchor = value.anchor;
      if (anchor !== undefined && (!keys(anchor, ['x', 'y']) || !number(anchor.x, 0, 1) || !number(anchor.y, 0, 1))) return false;
    }
    if (!number(factor, 0.5, 2)) return false;
    const b = window.getBounds();
    const next = resizeSession.resize(b, factor, screen.getDisplayMatching(b).workArea, anchor);
    if (!next) return false;
    size = 'custom'; window.setBounds(next); broadcast(); return true;
  }
  const action = name => { if (alive()) {
    if (['shell:cancel', 'shell:hide', 'blink', 'face-next'].includes(name) || name.startsWith('face:')) cancelChat();
    if (['shell:cancel', 'idle:hold', 'idle:off'].includes(name)) presentation.clearNormal();
    if (name === 'shell:hide') presentation.setEnabled(false);
    if (name === 'shell:show') presentation.setEnabled(true);
    window.webContents.send('action', name);
  } };
  function listen(target, event, fn) { target.on(event, fn); nativeListeners.push([target, event, fn]); }
  function applyInteractive() { if (alive()) window.setIgnoreMouseEvents(menuDepth ? false : clickThrough || !interactive, { forward: true }); }
  function holdMenu() {
    if (!alive() || mode === 'hidden') return;
    menuDepth++; action('shell:cancel'); action('idle:hold'); applyInteractive();
  }
  function releaseMenu() {
    if (!alive() || !menuDepth) return;
    menuDepth--; applyInteractive();
    if (!menuDepth) { action('idle:release'); broadcast(); }
  }
  function detachTrayMenu() {
    if (trayMenu) { trayMenu.removeListener('menu-will-show', holdMenu); trayMenu.removeListener('menu-will-close', releaseMenu); trayMenu = null; }
  }
  function refreshTrayMenu() {
    detachTrayMenu(); trayMenu = Menu.buildFromTemplate(menuTemplate());
    trayMenu.on('menu-will-show', holdMenu); trayMenu.on('menu-will-close', releaseMenu);
    tray.setContextMenu(trayMenu);
  }
  function setInteractive(value) {
    if (!alive() || typeof value !== 'boolean') return false;
    interactive = value; applyInteractive(); return true;
  }
  function setClickThrough(value) {
    if (!alive() || typeof value !== 'boolean') return false;
    if (value && !rescueAvailable()) { updateError('No rescue channel available', true); broadcast(); return false; }
    clickThrough = value; interactive = true;
    if (rescueAvailable()) updateError('No rescue channel available', false);
    action('shell:cancel'); applyInteractive(); broadcast(); pollCursor(); return true;
  }
  function stopCursorTimer() {
    if (cursorTimer !== null) {clock.clearTimeout(cursorTimer);cursorTimer=null;}
  }
  function pollCursor() {
    stopCursorTimer();
    if (!alive() || mode!=='visible' || !window.isVisible() || clickThrough) return;
    // Chieri/Meihua read the system cursor independently of Chromium's mouse
    // forwarding. Otherwise a missed move can leave alpha pass-through stuck.
    const point=screen.getCursorScreenPoint(), bounds=window.getBounds();
    window.webContents.send('desktop:cursor',{x:point.x-bounds.x,y:point.y-bounds.y});
    cursorTimer=clock.setTimeout(pollCursor,33);
    cursorTimer?.unref?.();
  }
  function setTopmost(value) {
    if (!alive() || typeof value !== 'boolean') return false;
    alwaysOnTop = value; window.setAlwaysOnTop(value, 'screen-saver');
    maintainTopmost(); broadcast(); return true;
  }
  function stopTopmostTimer() {
    if (topmostTimer !== null) {clock.clearTimeout(topmostTimer);topmostTimer=null;}
  }
  function maintainTopmost() {
    stopTopmostTimer();
    if (!alive() || mode!=='visible' || !alwaysOnTop || !window.isVisible()) return;
    // Like Meihua: restore z-order without activating the pet or stealing game
    // input. Leave our own menus and focused chat/settings windows in front.
    const focused=BrowserWindow.getFocusedWindow?.();
    if (!menuDepth && (!focused || focused===window)) {
      if (!window.isAlwaysOnTop()) window.setAlwaysOnTop(true,'screen-saver');
      window.moveTop();
    }
    topmostTimer=clock.setTimeout(maintainTopmost,4000);
    topmostTimer?.unref?.();
  }
  function setIdleEnabled(value) {
    if (!alive() || typeof value !== 'boolean') return false;
    idleEnabled = value; action('shell:cancel'); action(value ? 'idle:on' : 'idle:off'); broadcast(); return true;
  }
  function setSize(value) {
    if (!alive() || !Object.hasOwn(SIZE_PRESETS, value)) return false;
    const b = window.getBounds(), preset = SIZE_PRESETS[value];
    resizeSession.reset(); size = value;
    window.setBounds(fitBounds({ x: b.x + b.width - preset.w, y: b.y + b.height - preset.h,
      width: preset.w, height: preset.h }, screen.getAllDisplays(), screen.getPrimaryDisplay()));
    broadcast(); return true;
  }
  function hide() {
    if (!alive()) return false;
    if (mode === 'visible' && !rescueAvailable()) { updateError('No rescue channel available', true); broadcast(); return false; }
    if (rescueAvailable()) updateError('No rescue channel available', false);
    action('shell:cancel'); action('shell:hide'); interactive = true;
    applyInteractive(); window.hide(); broadcast(); return true;
  }
  function show() {
    if (!alive()) return false;
    setClickThrough(false);
    // Like Chieri/Meihua, revealing the pet must not activate it over a game.
    // Explicit chat/settings windows retain their own normal focus behavior.
    if (mode === 'visible') window.showInactive();
    action('shell:show'); broadcast(); return true;
  }
  function reset() {
    if (!alive()) return false;
    resizeSession.reset(); size = 'medium';
    window.setBounds(defaultBounds(screen.getAllDisplays(), screen.getPrimaryDisplay()));
    setTopmost(true); show(); broadcast(); return true;
  }
  function quit() { if (!alive()) return false; destroy(); app.quit(); return true; }
  function menuTemplate() {
    return [
      { id: 'chat', label: '和白姐聊天', click: () => openChatPanel('chat') },
      { id: 'settings', label: '模型设置', click: () => openChatPanel('settings') },
      kaqiu.menu(),
      { id: 'blink', label: '眨眼', click: () => action('blink') },
      { id: 'face-next', label: '下一个表情', click: () => action('face-next') },
      { id: 'hop', label: '小跳', click: () => action('hop') },
      { id: 'reference-motions', label: '千绘莉动作', submenu: [
        { id: 'motion:all', label: '顺序演示全部', click: () => action('motion:all') },
        { id: 'motion:stop', label: '停止当前演示', click: () => action('motion:stop') },
        { type: 'separator' },
        ...require('./src/reference-motion.js').catalog.map(a => ({id:'motion:'+a.id,label:a.label,click:()=>action('motion:'+a.id)})),
      ] },
      { id: 'face', label: '表情', submenu: [
        { id: 'face:auto', label: '自动表情', click: () => action('face:auto') },
        ...character.faceOrder.filter(id => !character.skip.includes(id)).map(id => ({ id: `face:${id}`, label: character.labels[id], click: () => action(`face:${id}`) })),
      ] },
      { id: 'idle', label: '自动待机动作', type: 'checkbox', checked: idleEnabled, click: item => setIdleEnabled(item.checked) },
      { id: 'size', label: '尺寸', submenu: Object.entries(SIZE_PRESETS).map(([id, value]) => ({
        id: `size:${id}`, label: value.label, type: 'radio', checked: size === id, click: () => setSize(id),
      })).concat([{ id: 'size:custom', label: '自定义（Ctrl+滚轮）', type: 'radio', checked: size === 'custom', enabled: false }]) },
      { type: 'separator' },
      { id: 'click-through', label: '整窗穿透', type: 'checkbox', checked: clickThrough,
        enabled: rescueAvailable(), click: item => setClickThrough(item.checked) },
      { id: 'topmost', label: '置顶', type: 'checkbox', checked: alwaysOnTop, click: item => setTopmost(item.checked) },
      { id: 'toolbar', label: '显示 / 收起功能栏', click: () => action('toolbar:toggle') },
      { id: 'show', label: '显示 / 解除穿透', click: show },
      { id: 'hide', label: '隐藏', click: hide }, { id: 'reset', label: '重置位置与尺寸', click: reset },
      { type: 'separator' }, { id: 'quit', label: '退出', click: quit },
    ];
  }
  function menu(point) {
    if (!alive() || !keys(point, ['x', 'y']) || !number(point.x, 0, 10000) || !number(point.y, 0, 10000) || mode === 'hidden') return false;
    holdMenu();
    try {
      const b = window.getBounds();
      Menu.buildFromTemplate(menuTemplate()).popup({ window,
        x: Math.min(b.width - 1, Math.round(point.x)), y: Math.min(b.height - 1, Math.round(point.y)),
        callback: releaseMenu });
      if (updateError('Native menu unavailable', false)) notifyState();
      return true;
    } catch { releaseMenu(); updateError('Native menu unavailable', true); broadcast(); return false; }
  }
  function command(value) {
    if (!keys(value, ['name'], ['value'])) return false;
    if (value.name === 'click-through') return setClickThrough(value.value);
    if (value.name === 'topmost') return setTopmost(value.value);
    if (Object.hasOwn(value, 'value')) return false;
    if (value.name === 'chat-cancel') return cancelChat();
    if (value.name === 'chat' || value.name === 'settings') return openChatPanel(value.name);
    if (value.name === 'blink' || value.name === 'face-next') { if (!alive()) return false; action(value.name); return true; }
    if (value.name === 'hide') return hide();
    if (value.name === 'reset') return reset();
    if (value.name === 'quit') return quit();
    return false;
  }
  let ready;
  try {
    if (mode === 'visible') {
      try {
        tray = new Tray(path.join(root, 'shared/tray.png'));
        tray.setToolTip('小伯白桌宠');
        refreshTrayMenu();
        listen(tray, 'double-click', show);
      } catch { if (tray) tray.destroy(); tray = null; }
      try { shortcutAvailable = globalShortcut.register(SHORTCUT, show) === true; }
      catch { shortcutAvailable = false; }
      shortcutStatus = shortcutAvailable ? 'registered' : 'registration-failed';
    }
    applyInteractive();
    if (alwaysOnTop) window.setAlwaysOnTop(true,'screen-saver');
    if (mode === 'hidden') window.webContents.setFrameRate(60);
    window.setMenu(null);
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    for (const name of ['will-navigate', 'will-frame-navigate', 'will-redirect', 'will-attach-webview'])
      listen(window.webContents, name, event => event.preventDefault());
    function refit() {
      if (!alive()) return;
      resizeSession.reset();
      window.setBounds(fitBounds(window.getBounds(), screen.getAllDisplays(), screen.getPrimaryDisplay()));
      broadcast();
    }
    for (const name of ['display-added', 'display-removed', 'display-metrics-changed']) listen(screen, name, refit);
    listen(window, 'move', broadcast); listen(window, 'resize', broadcast);
    listen(window, 'close', save); listen(window, 'closed', destroy); listen(app, 'before-quit', destroy);
    listen(window, 'blur', () => action('shell:cancel'));
    listen(window, 'show', () => {maintainTopmost();pollCursor();});
    listen(window, 'restore', () => {maintainTopmost();pollCursor();});
    listen(window, 'minimize', () => {stopTopmostTimer();stopCursorTimer();});
    listen(window, 'hide', () => { stopTopmostTimer(); stopCursorTimer(); action('shell:cancel'); action('shell:hide'); broadcast(); });
    on('desktop:feedback', 1, value => presentation.fromRenderer(value));
    on('drag', 1, drag); on('resize-by', 1, resizeBy);
    on('interactive', 1, setInteractive); on('menu', 1, menu); on('desktop:command', 1, command);
    on('idle-ready', 0, () => { broadcast(); action(idleEnabled ? 'idle:on' : 'idle:off'); });
    ipcMain.handle('desktop:get-state', (event, ...args) => trusted(event) && !args.length ? snapshot() : null);
    stateHandlerInstalled = true;
    ready = window.loadURL(ENTRY_URL)
      .then(() => { if (alive() && mode === 'visible') show(); return window; })
      .catch(failStartup);
    ready.catch(() => {});
  } catch (error) { failStartup(error); }
  function failStartup(error) {
    // Notify the lifecycle owner before cleanup can close the last window.
    try { if (!destroyed) onStartupFailure?.(window); }
    catch (cleanupError) { cleanupErrors.push(cleanupError); }
    destroy(); throw error;
  }
  function destroy() {
    if (destroyed) return cleanupErrors;
    destroyed = true;
    const releases = [stopTopmostTimer, stopCursorTimer, () => chatIntegration?.destroy(), () => kaqiu.destroy(), () => presentation.destroy(), () => feedbackWindow.destroy(), save,
      ...listeners.map(([name, fn]) => () => ipcMain.removeListener(name, fn)),
      ...nativeListeners.map(([target, name, fn]) => () => target.removeListener(name, fn)),
    ];
    if (shortcutAvailable) { shortcutAvailable = false; releases.push(() => globalShortcut.unregister(SHORTCUT)); }
    if (trayMenu) {
      const ownedMenu = trayMenu; trayMenu = null;
      releases.push(() => ownedMenu.removeListener('menu-will-show', holdMenu),
        () => ownedMenu.removeListener('menu-will-close', releaseMenu));
    }
    if (tray) { const ownedTray = tray; tray = null; releases.push(() => ownedTray.destroy()); }
    if (stateHandlerInstalled) { stateHandlerInstalled = false; releases.push(() => ipcMain.removeHandler('desktop:get-state')); }
    releases.push(() => { if (!window.isDestroyed()) window.destroy(); });
    for (const release of releases) {
      try { release(); } catch (error) { cleanupErrors.push(error); }
    }
    return cleanupErrors;
  }
  return { window, ready, snapshot, drag, resizeBy, setInteractive, setClickThrough, setTopmost, setIdleEnabled,
    setSize, hide, show, reset, quit, menu, menuTemplate, command, save, destroy, kaqiu };
}
module.exports = { createShell, ENTRY_URL, SHORTCUT };
