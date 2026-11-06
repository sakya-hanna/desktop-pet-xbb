const { app, BrowserWindow, ipcMain, screen, Menu, Tray, dialog, nativeImage, globalShortcut } = require('electron');
const path = require('path');
const { protocol } = require('electron');
const resourceProtocol = require(path.join(__dirname, 'resource-protocol.js'));
const { fromMainFrame } = require(path.join(__dirname, 'ipc-policy.js'));
if (protocol?.registerSchemesAsPrivileged) protocol.registerSchemesAsPrivileged([{scheme:'baijie',privileges:{standard:true,secure:true,supportFetchAPI:true,corsEnabled:true}}]);
const fs = require('fs');

// 父进程管道关掉后 console.log 会抛 EPIPE，把整个 app 干掉 —— 直接吞掉
process.stdout.on('error', (e) => { if (e && e.code === 'EPIPE') return; });
process.stderr.on('error', (e) => { if (e && e.code === 'EPIPE') return; });

let win = null;
let tray = null;
let speech = null;
let chat = null;
let modelSettings=null, modelService=null, settingsWindow=null;
let clickThrough = false;
let automaticInteractive = true, menuDepth = 0, lastIgnored = null;
let baseBounds = null;   // 创建/切换大小时记下的基准尺寸，拖动时永远用它
const resizeSession = require(path.join(__dirname, 'resize-geometry.js')).createResizeSession();

const { SIZE_PRESETS, loadState, saveState, fitBounds, defaultBounds } = require('./window-state');
let currentSize = 'medium';
let idleEnabled = true;
let stateFile = null;
let saveTimer = null;
// Diagnostic launches must never overwrite the interactive desktop's preferences.
const stateless = ['PUPPET_STATELESS', 'PUPPET_W', 'PUPPET_H', 'PUPPET_BG', 'PUPPET_URL',
  'PUPPET_SEQ', 'PUPPET_SNAPSHOT', 'PUPPET_QUERY', 'PUPPET_QUERY_RAW', 'PUPPET_TOPMOST'].some(key => !!process.env[key])
  || (process.env.PUPPET_PAGE || '').includes('?');

function persistWindow() {
  if (!stateFile || !win || win.isDestroyed()) return;
  try {
    saveState(stateFile, { bounds: win.getBounds(), size: currentSize, alwaysOnTop: win.isAlwaysOnTop(), idleEnabled });
  } catch (error) { console.error('[window-state] 保存失败：', error.message); }
}
function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { saveTimer = null; persistWindow(); }, 300);
}
function fitOnDisplays(bounds) {
  return fitBounds(bounds, screen.getAllDisplays(), screen.getPrimaryDisplay());
}

function createWindow() {
  stateFile = stateless ? null : path.join(app.getPath('userData'), 'baijie-desktop', 'window-state.json');
  const saved = stateFile ? loadState(stateFile) : null;
  if (saved) { currentSize = saved.size; idleEnabled = saved.idleEnabled ?? true; }
  const initial = saved ? fitOnDisplays(saved.bounds)
    : defaultBounds(screen.getAllDisplays(), screen.getPrimaryDisplay(), currentSize);
  const W = Number(process.env.PUPPET_W || initial.width);
  const H = Number(process.env.PUPPET_H || initial.height);

  win = new BrowserWindow({
    width: W,
    height: H,
    x: initial.x,
    y: initial.y,
    frame: false,
    transparent: !process.env.PUPPET_BG,
    backgroundColor: process.env.PUPPET_BG || '#00000000',
    resizable: false,
    alwaysOnTop: process.env.PUPPET_TOPMOST !== undefined ? process.env.PUPPET_TOPMOST !== '0'
      : saved ? saved.alwaysOnTop : true,
    skipTaskbar: true,
    hasShadow: false,
    focusable: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      sandbox: true,
    },
  });

  win.webContents.setWindowOpenHandler?.(() => ({action:'deny'}));
  for(const event of ['will-navigate','will-frame-navigate','will-redirect','will-attach-webview'])win.webContents.on(event,e=>e.preventDefault());
  speech = require(path.join(__dirname, 'speech-window.js')).create({BrowserWindow, screen, ipcMain, parent: win,
    onDismiss: id => { if (!win.isDestroyed()) win.webContents.send('action', 'dialogue:dismiss:' + id); }});
  win.on('move', () => speech.sync());
  win.on('resize', () => speech.sync());
  win.on('hide', () => { modelService?.cancel(); speech.hide(); sendIdle('dialogue:clear'); });
  win.on('closed', () => { speech.destroy(); speech = null; });
  if (win.isAlwaysOnTop()) win.setAlwaysOnTop(true, 'screen-saver');
  baseBounds = { width: W, height: H };
  const evLog = path.join(__dirname, '..', 'build', 'puppet-events.log');
  const logEv = (tag) => {
    try {
      const b = win.getBounds();
      fs.appendFileSync(evLog, `${new Date().toISOString()} ${tag} ${b.width}x${b.height} @${b.x},${b.y}\n`);
    } catch (e) {}
  };
  win.on('resize', () => logEv('resize'));
  win.on('move', () => logEv('move'));
  win.on('move', scheduleSave);
  win.on('resize', scheduleSave);
  win.on('close', persistWindow);
  win.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    try {
      const line2 = `[${new Date().toISOString()}] ${message}\n`;
      fs.appendFileSync(path.join(__dirname, '..', 'build', 'pet-log.txt'), line2);
    } catch (err) {}
  });
  win.webContents.on('did-fail-load', (_e, code, desc, url) => {
    console.log(`[fail-load] ${code} ${desc} ${url}`);
  });
  // PUPPET_PAGE 支持 "页面?k=v&k2=v2" 写法（loadFile 不能直接吃 query）
  const rawPage = process.env.PUPPET_PAGE || 'rig/index.html';
  const qi = rawPage.indexOf('?');
  const pagePath = qi < 0 ? rawPage : rawPage.slice(0, qi);
  const pageQuery = {};
  if (qi >= 0) for (const [k, v] of new URLSearchParams(rawPage.slice(qi + 1))) pageQuery[k] = v;
  const extraQuery = process.env.PUPPET_QUERY_RAW ? JSON.parse(process.env.PUPPET_QUERY_RAW)
    : (process.env.PUPPET_QUERY ? { blink: '1' } : {});
  if (process.env.PUPPET_URL) { win.loadURL(process.env.PUPPET_URL); } else if (protocol?.handle && pagePath.startsWith('rig/')) {
    win.loadURL('baijie://app/' + pagePath + '?' + new URLSearchParams({...pageQuery,...extraQuery}));
  } else win.loadFile(path.join(__dirname, pagePath),
    { query: { ...pageQuery, ...extraQuery } });

  // 调试用：PUPPET_SEQ / PUPPET_SNAPSHOT
  if (process.env.PUPPET_SEQ) {
    win.webContents.on('did-finish-load', () => {
      const dir = process.env.PUPPET_SEQ;
      const n = Number(process.env.PUPPET_SEQ_N || 8);
      const ms = Number(process.env.PUPPET_SEQ_MS || 350);
      fs.mkdirSync(dir, { recursive: true });
      let i = 0;
      const tick = setInterval(async () => {
        try {
          const img = await win.capturePage();
          fs.writeFileSync(path.join(dir, 'seq-' + String(i).padStart(3, '0') + '.png'), img.toPNG());
        } catch (e) { console.error('seq failed', e); }
        i += 1;
        if (i >= n) { clearInterval(tick); app.quit(); }
      }, ms);
    });
  }
  if (process.env.PUPPET_SNAPSHOT) {
    win.webContents.on('did-finish-load', () => {
      setTimeout(async () => {
        try {
          const img = await win.capturePage();
          fs.writeFileSync(process.env.PUPPET_SNAPSHOT, img.toPNG());
          console.log('snapshot saved:', process.env.PUPPET_SNAPSHOT);
        } catch (e) { console.error('snapshot failed', e); }
        app.quit();
      }, Number(process.env.PUPPET_SNAPSHOT_DELAY || 2500));
    });
  }

  // 调试用：PUPPET_MENU=1 加载完直接弹菜单（方便截图）
  if (process.env.PUPPET_MENU) {
    win.webContents.on('did-finish-load', () => setTimeout(popupMenu, 1200));
  }
}

/* ---------------- 大小 ---------------- */
function applySize(key) {
  if (!win || !SIZE_PRESETS[key]) return;
  resizeSession.reset();
  currentSize = key;
  const { w, h } = SIZE_PRESETS[key];
  const b = win.getBounds();
  // Keep the bottom-right anchor, then recover from work-area edges.
  const fitted = fitOnDisplays({ x: b.x + (b.width - w), y: b.y + (b.height - h), width: w, height: h });
  win.setBounds(fitted);
  // 记住新的基准尺寸，拖动时用它（否则切完大小再拖会被拽回旧尺寸）
  baseBounds = { width: fitted.width, height: fitted.height };
  scheduleSave();
}

function resizeBy(factor, anchor) {
  if (!win || win.isDestroyed()) return;
  const b = win.getBounds();
  const display = screen.getDisplayMatching ? screen.getDisplayMatching(b) : screen.getPrimaryDisplay();
  const fitted = resizeSession.resize(b, factor, display.workArea, anchor);
  if (!fitted) return;
  currentSize = 'custom';
  baseBounds = {width:fitted.width,height:fitted.height};
  win.setBounds(fitted); scheduleSave();
}

function resetWindow() {
  if (!win || win.isDestroyed()) return;
  resizeSession.reset();
  currentSize = 'medium';
  const bounds = defaultBounds(screen.getAllDisplays(), screen.getPrimaryDisplay(), currentSize);
  baseBounds = { width: bounds.width, height: bounds.height };
  win.setBounds(bounds);
  setClickThrough(false);
  win.show();
  scheduleSave();
}

/* ---------------- 鼠标穿透 ---------------- */
function applyMousePolicy() {
  if (!win || win.isDestroyed()) return;
  const ignored = clickThrough || (!automaticInteractive && menuDepth === 0);
  if (ignored === lastIgnored) return;
  lastIgnored = ignored;
  if (ignored) win.setIgnoreMouseEvents(true, {forward:true});
  else win.setIgnoreMouseEvents(false);
}
function setClickThrough(on) {
  clickThrough = !!on;
  speech?.setClickThrough(clickThrough);
  applyMousePolicy();
}

function sendIdle(name) {
  if (win && !win.isDestroyed()) win.webContents.send('action', name);
}
function setIdleEnabled(on) {
  idleEnabled = !!on;
  sendIdle(idleEnabled ? 'idle:on' : 'idle:off');
  scheduleSave();
}
function showNativeMenu(menu, options) {
  menuDepth++; applyMousePolicy(); sendIdle('idle:hold');
  let closed = false;
  const close = () => {
    if (closed) return; closed = true;
    menuDepth = Math.max(0, menuDepth - 1); applyMousePolicy();
    if (menuDepth === 0) sendIdle('idle:release');
  };
  try { menu.popup({ ...options, callback: close }); }
  catch (error) { close(); throw error; }
}

function getModelSettings(){
  if(!modelSettings)modelSettings=require(path.join(__dirname,'settings-store.js')).create({file:path.join(app.getPath('userData'),'baijie-desktop','model-settings.json'),safeStorage:require('electron').safeStorage});
  return modelSettings;
}
function getChatService(){
  if(!modelService){
    const store=require(path.join(__dirname,'conversation-store.js')).create({file:path.join(app.getPath('userData'),'baijie-desktop','conversation.json')});
    modelService=require(path.join(__dirname,'chat-service.js')).create({store,settings:getModelSettings(),request:require(path.join(__dirname,'ai-client.js')).request,system:fs.readFileSync(path.join(__dirname,'persona.md'),'utf8'),onReply:reply=>{if(win&&!win.isDestroyed()&&win.isVisible())win.webContents.send('chat:reply',reply);}});
  }
  return modelService;
}
function openChat() {
  if (!chat) chat = require('./chat-window').create({ BrowserWindow, ipcMain,
    file: path.join(app.getPath('userData'), 'baijie-desktop', 'conversation.json'),service: getChatService() });
  chat.open();
}
function openSettings(){
  if(!settingsWindow){
    const store=getModelSettings();
    settingsWindow=require(path.join(__dirname,'settings-window.js')).create({BrowserWindow,ipcMain,store:{snapshot:()=>store.snapshot(),save:value=>{modelService?.cancel();return store.save(value);}},testConnection:async()=>{
      await require(path.join(__dirname,'ai-client.js')).request({config:store.getRequestConfig(),messages:[{role:'user',content:'连接测试，请简短回复。'}],system:fs.readFileSync(path.join(__dirname,'persona.md'),'utf8'),timeoutMs:10000});
      return {ok:true,message:'模型连接成功。'};
    }});
  }
  settingsWindow.open();
}

/* ---------------- 右键菜单 ---------------- */
function popupMenu(pos) {
  if (!win) return;
  const b = win.getBounds();
  const menuW = 230, menuH = 300;
  let px = 6, py = 6;
  if (pos && typeof pos.x === 'number') {
    px = Math.round(pos.x - b.x);
    py = Math.round(pos.y - b.y);
  }
  px = Math.min(Math.max(4, px), Math.max(4, b.width - menuW));
  py = Math.min(Math.max(4, py), Math.max(4, b.height - menuH));
  const template = [
    { label: '和白姐聊天', click: openChat },
    { label: '模型设置', click: openSettings },
    { label: '气泡对白预览', submenu: [
      {label:'摸头台词预览',click:()=>sendIdle('dialogue:preview-head')},
      {label:'轻触台词预览',click:()=>sendIdle('dialogue:preview-chest')},
      {label:'收起气泡',click:()=>sendIdle('dialogue:clear')},
    ]},
    {
      label: '动作',
      submenu: [
        { label: '眨个眼', click: () => win.webContents.send('action', 'blink') },
        { label: '跳一下', click: () => win.webContents.send('action', 'hop') },
        { label: '换个表情', click: () => win.webContents.send('action', 'face-next') },
      ],
    },
    {
      label: '表情',
      submenu: [
        { label: '微笑', click: () => win.webContents.send('action', 'face:3901') },
        { label: '温柔', click: () => win.webContents.send('action', 'face:3942') },
        { label: '平静', click: () => win.webContents.send('action', 'face:3599') },
        { label: '疑问', click: () => win.webContents.send('action', 'face:3831') },
        { label: '生气', click: () => win.webContents.send('action', 'face:3711') },
        { label: '难过', click: () => win.webContents.send('action', 'face:3751') },
        { label: '意外', click: () => win.webContents.send('action', 'face:3791') },
        { label: '别扭', click: () => win.webContents.send('action', 'face:3496') },
        { label: '嘟嘴', click: () => win.webContents.send('action', 'face:3665') },
        { label: '小惊讶', click: () => win.webContents.send('action', 'face:3563') },
        { type: 'separator' },
        { label: '闭眼', click: () => win.webContents.send('action', 'face:3625') },
      ],
    },
    {
      label: '大小',
      submenu: [...Object.entries(SIZE_PRESETS).map(([key, v]) => ({
        label: `${v.label}（${v.w}×${v.h}）`,
        type: 'radio',
        checked: key === currentSize,
        click: () => applySize(key),
      })), {type:'separator'},
      {label:`当前：${b.width}×${b.height}`,enabled:false},
      {label:'放大（也可 Ctrl+滚轮）',click:()=>resizeBy(1.05)},
      {label:'缩小',click:()=>resizeBy(1/1.05)}],
    },
    { type: 'separator' },
    {
      label: '始终置顶',
      type: 'checkbox',
      checked: win.isAlwaysOnTop(),
      click: (item) => { win.setAlwaysOnTop(item.checked, 'screen-saver'); speech?.sync(); scheduleSave(); },
    },
    {
      label: '鼠标穿透（Ctrl+Alt+B 取消）',
      type: 'checkbox',
      checked: clickThrough,
      click: (item) => setClickThrough(item.checked),
    },
    { type: 'separator' },
    {
      label: '关于白姐桌宠',
      click: () => {
        dialog.showMessageBox(win, {
          type: 'info',
          title: '白姐桌宠',
          message: '白姐桌宠 · 2D 网格桌宠',
          detail:
            '素材：玉响未来（タマユラミライ）小伯白立绘及表情差分，仅供个人学习。\n' +
            '播放器：Electron + WebGL2 自研网格；安全外侧长发独立摆动、局部眨眼、连续跳跃。\n' +
            '窗口位置、大小与置顶自动保存；托盘可重置位置。鼠标穿透不跨次保存。',
          buttons: ['好'],
        });
      },
    },
    { label: '自动待机动作', type: 'checkbox', checked: idleEnabled, click: item => setIdleEnabled(item.checked) },
    { label: '重置位置与大小', click: resetWindow },
    { label: '退出', click: () => app.quit() },
  ];
  showNativeMenu(Menu.buildFromTemplate(template), { window: win, x: px, y: py });
}

/* ---------------- 托盘 ---------------- */
function createTray() {
  const iconPath = path.join(__dirname, 'tray.png');
  let img = nativeImage.createFromPath(iconPath);
  if (img.isEmpty()) img = nativeImage.createEmpty();
  tray = new Tray(img);
  tray.setToolTip('白姐桌宠');
  tray.on('right-click', () => showNativeMenu(Menu.buildFromTemplate([
    { label: '和白姐聊天', click: openChat },
    { label: '模型设置', click: openSettings },
    { label: '显示/隐藏', click: () => { if (win) { win.isVisible() ? win.hide() : win.show(); } } },
    { label: '取消鼠标穿透', click: () => setClickThrough(false) },
    { type: 'separator' },
    { label: '自动待机动作', type: 'checkbox', checked: idleEnabled, click: item => setIdleEnabled(item.checked) },
    { label: '重置位置与大小', click: resetWindow },
    { label: '退出', click: () => app.quit() },
  ]), { window: win }));
  tray.on('click', () => { if (win) { win.isVisible() ? win.hide() : win.show(); } });
}

/* ---------------- IPC ---------------- */
function onPet(channel,handler){ipcMain.on(channel,(event,...args)=>{if(fromMainFrame(event,win))handler(event,...args);});}
onPet('speech-state', (event, state) => {
  if (!win || event.sender !== win.webContents || !state || typeof state !== 'object'
    || typeof state.visible !== 'boolean'
    || typeof state.text !== 'string' || state.text.length > 8000 || typeof state.source !== 'string'
    || (state.visible && (!Number.isSafeInteger(state.id) || state.id < 1 || !Number.isFinite(state.expiresAt)))
    || (!state.visible && (state.id !== null || state.expiresAt !== null))) return;
  if (state.visible && state.text.trim()) speech?.show(state); else speech?.hide();
});
onPet('drag', (_e, delta) => {
  if (!win || !delta || !Number.isFinite(delta.dx) || !Number.isFinite(delta.dy)) return;
  const { dx, dy } = delta;
  resizeSession.reset();
  if (!baseBounds) baseBounds = win.getBounds();
  const b = win.getBounds();
  // 尺寸用创建时的固定值，避免 125% 缩放下 setBounds 反复取整导致"越拖越大"
  win.setBounds({
    x: Math.round(b.x + dx),
    y: Math.round(b.y + dy),
    width: baseBounds.width,
    height: baseBounds.height,
  });
});
onPet('menu', (_e, pos) => popupMenu(pos));
onPet('quit', () => app.quit());
onPet('model:cancel', () => modelService?.cancel());
onPet('resize-by', (event, payload) => {
  if (!win || event.sender !== win.webContents || clickThrough) return;
  if (typeof payload === 'number') resizeBy(payload);
  else if (payload && typeof payload === 'object' && !Array.isArray(payload)
    && Object.hasOwn(payload,'factor') && Object.hasOwn(payload,'anchor') && payload.anchor !== undefined) {
    resizeBy(payload.factor, payload.anchor);
  }
});
onPet('interactive', (event, value) => {
  if (!win || event.sender !== win.webContents || typeof value !== 'boolean') return;
  automaticInteractive = value; applyMousePolicy();
});
onPet('idle-ready', event => {
  if (win && event.sender === win.webContents) sendIdle(idleEnabled ? 'idle:on' : 'idle:off');
});

app.whenReady().then(() => {
  if(protocol?.handle) resourceProtocol.install({protocol,root:__dirname});
  createWindow();
  createTray();
  const recoverDisplay = () => {
    if (!win || win.isDestroyed()) return;
    resizeSession.reset();
    const fitted = fitOnDisplays(win.getBounds());
    baseBounds = { width: fitted.width, height: fitted.height };
    win.setBounds(fitted);
    scheduleSave();
  };
  screen.on('display-removed', recoverDisplay);
  screen.on('display-added', recoverDisplay);
  screen.on('display-metrics-changed', recoverDisplay);
  // 穿透状态下的"救命键"
  globalShortcut.register('Control+Alt+B', () => setClickThrough(false));
});

app.on('before-quit', () => {
  modelService?.cancel();settingsWindow?.destroy();
  chat?.destroy();
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = null;
  persistWindow();
});
app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => app.quit());
