// Exercise the real main/preload/renderer, replacing desktop-only tray/shortcut seams.
// Separate test profile; never shows windows or registers global shortcuts.
const electron = require('electron');
const { app } = electron;
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const Module = require('node:module');
const { EventEmitter } = require('node:events');
const out = process.env.BAIJIE_DESKTOP_OUT;
const phase = process.env.BAIJIE_DESKTOP_PHASE;
if (!out || !['write', 'restore'].includes(phase)) throw Error('Unique output and explicit phase required');
fs.mkdirSync(out, { recursive: true });
app.setPath('userData', path.join(out, 'isolated-profile'));
app.commandLine.appendSwitch('use-angle', 'swiftshader');
app.commandLine.appendSwitch('enable-unsafe-swiftshader');
for (const key of Object.keys(process.env)) if (key.startsWith('PUPPET_')) delete process.env[key];
let win, template, popupCallback, lastPaint, ignored;
const checks=[];
const menus = [];
class HiddenWindow extends electron.BrowserWindow {
  setIgnoreMouseEvents(on, options){ignored=on;return super.setIgnoreMouseEvents(on,options);}
  constructor(options) {
    super({ ...options, show: false, webPreferences: { ...options.webPreferences, offscreen: true, backgroundThrottling: false } });
    win = this;
    this.webContents.on('paint',(_e,_rect,image)=>{if(!image.isEmpty())lastPaint=image;});
    win.webContents.once('did-finish-load', () => verify().catch(fail));
  }
}
class NoTray extends EventEmitter { setToolTip() {} setContextMenu() {} }
const overrides = {
  BrowserWindow: HiddenWindow,
  Tray: NoTray,
  globalShortcut: { register() { return true; }, unregisterAll() {} },
  Menu: { buildFromTemplate(value) { menus.push(value); template = value; return { popup(options) { popupCallback=options.callback; } }; } },
};
const proxy = new Proxy(electron, { get(target, key) { return Object.hasOwn(overrides, key) ? overrides[key] : target[key]; } });
const load = Module._load;
const mainPath = path.resolve(__dirname, '../puppet/main.js');
const logFs = new Proxy(fs, { get(target, key) {
  if (key !== 'appendFileSync') return target[key];
  return (file, ...args) => {
    const logs = path.join(out, phase + '-logs'); fs.mkdirSync(logs, { recursive: true });
    return fs.appendFileSync(path.join(logs, path.basename(file)), ...args);
  };
} });
Module._load = function(name, parent, isMain) {
  if (name === 'electron') return proxy;
  if (name === 'fs' && parent?.filename === mainPath) return logFs;
  return load.call(this, name, parent, isMain);
};
const timer = setTimeout(() => fail(Error('desktop-state test deadline')), 30000);
function fail(error) {
  fs.writeFileSync(path.join(out, phase + '-failure.json'), JSON.stringify({ error: error.stack }));
  app.exit(1);
}

async function evaluate(code){return win.webContents.executeJavaScript(code);}
async function waitFor(expression){return evaluate(`new Promise((resolve,reject)=>{const end=performance.now()+8000;function tick(){if(${expression})return resolve();if(performance.now()>end)return reject(Error('desktop control timeout'));setTimeout(tick,15)}tick()})`);}
async function waitHost(predicate){const end=Date.now()+8000;while(!predicate()){if(Date.now()>end)throw Error('main boundary timeout');await new Promise(r=>setTimeout(r,15));}}
async function mouse(x,y){await evaluate(`window.dispatchEvent(new MouseEvent('mousemove',{clientX:${x},clientY:${y},bubbles:true}))`);}
async function verify(){
 await waitFor('__rig.ready && __rig.S.t>0.2 && !!__rig.diagnostics().desktop');
 assert.equal(win.isVisible(),false);
 await waitHost(()=>!!lastPaint);
 fs.writeFileSync(path.join(out,phase+'-toolbar.png'),lastPaint.toPNG());
 const settings=path.join(app.getPath('userData'),'baijie-desktop','window-state.json');
 if(phase==='write'){
  electron.ipcMain.emit('menu',{sender:win.webContents,senderFrame:win.webContents.mainFrame},null);
  template.find(i=>i.label==='自动待机动作').click({checked:false});popupCallback();
  await waitFor('__rig.idle.snapshot().enabled===false');
  const samples=await evaluate(`new Promise(resolve=>requestAnimationFrame(()=>{
   const stage=document.getElementById('stage'),c=document.createElement('canvas');c.width=stage.width;c.height=stage.height;
   const ctx=c.getContext('2d');ctx.drawImage(stage,0,0);const rgba=ctx.getImageData(0,0,c.width,c.height).data;
   const solid=[],blank=[],sx=innerWidth/c.width,sy=innerHeight/c.height;
   for(let y=Math.ceil(c.height*.25);y<c.height-4;y+=4)for(let x=4;x<c.width-4;x+=4){
    const a=rgba[(y*c.width+x)*4+3];let stable=true;
    for(const [dx,dy] of [[-2,0],[2,0],[0,-2],[0,2]]){const b=rgba[((y+dy)*c.width+x+dx)*4+3];if((a>250&&b<250)||(a===0&&b!==0))stable=false;}
    if(!stable)continue;const target=a>250?solid:a===0?blank:null;if(!target||target.length>=8)continue;
    const px=(x+.5)*sx,py=(y+.5)*sy;target.push({x:px,y:py,alpha:a,hit:__rig.hitTest(px,py)});
   }resolve({solid,blank});
  }))`);
  assert.ok(samples.solid.length>=4&&samples.blank.length>=4);
  assert.ok(samples.solid.every(p=>p.hit));assert.ok(samples.blank.every(p=>!p.hit));
  checks.push({name:'actual-render-alpha-versus-hit-test',samples});
  await mouse(1,100);await waitHost(()=>ignored===true);
  const p=samples.solid[0];await mouse(p.x,p.y);await waitHost(()=>ignored===false);
  checks.push({name:'blank-forwards-mouse-character-recovers',passed:true});
  const before=win.getBounds(),face=await evaluate('__rig.S.faceId');
  await evaluate(`const c=document.getElementById('stage');for(const [type,x] of [['pointerdown',100],['pointermove',120],['pointerup',120]])c.dispatchEvent(new PointerEvent(type,{bubbles:true,button:0,pointerId:8,clientX:${p.x},clientY:${p.y},screenX:x,screenY:100}))`);
  await new Promise(r=>setTimeout(r,80));assert.deepEqual(win.getBounds(),before);assert.equal(await evaluate('__rig.S.faceId'),face);
  checks.push({name:'body-drag-does-not-move-window-or-change-face',bounds:before});
  await evaluate(`const g=document.getElementById('pet-grip');g.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0,pointerId:9,clientX:100,clientY:15,screenX:100,screenY:100}));window.dispatchEvent(new PointerEvent('pointermove',{button:0,pointerId:9,screenX:120,screenY:110}));window.dispatchEvent(new PointerEvent('pointerup',{button:0,pointerId:9,screenX:120,screenY:110}));`);
  await waitHost(()=>win.getBounds().x!==before.x);assert.equal(win.getBounds().x,before.x+20);assert.equal(win.getBounds().y,before.y+10);assert.equal(await evaluate('__rig.S.faceId'),face);
  checks.push({name:'grip-moves-window-only',bounds:win.getBounds()});
  const oldHeight=win.getBounds().height;
  await evaluate(`document.getElementById('pet-larger').click()`);await waitHost(()=>win.getBounds().height>oldHeight);
  await waitFor(`innerHeight===${win.getBounds().height}`);
  const zoomHeight=win.getBounds().height;
  await evaluate(`document.getElementById('pet-grip').dispatchEvent(new WheelEvent('wheel',{bubbles:true,ctrlKey:true,deltaY:-100,clientX:100,clientY:15,cancelable:true}))`);
  await waitHost(()=>win.getBounds().height>zoomHeight);
  checks.push({name:'plus-and-ctrl-wheel-real-preload-resize',bounds:win.getBounds()});
  app.emit('before-quit');const saved=JSON.parse(fs.readFileSync(settings,'utf8'));
  assert.equal(saved.size,'custom');assert.equal(saved.idleEnabled,false);assert.deepEqual(saved.bounds,win.getBounds());
  fs.writeFileSync(path.join(out,'expected.json'),JSON.stringify(saved));
 }else{
  const expected=JSON.parse(fs.readFileSync(path.join(out,'expected.json'),'utf8'));
  assert.deepEqual(win.getBounds(),expected.bounds);assert.equal(expected.size,'custom');
  await waitFor('__rig.idle.snapshot().enabled===false');
  checks.push({name:'custom-size-and-idle-restored',bounds:win.getBounds()});
 }
 const bounds=win.getContentBounds();await waitFor(`innerWidth===${bounds.width}&&innerHeight===${bounds.height}`);
 const data=await evaluate(`new Promise(resolve=>requestAnimationFrame(()=>resolve({png:document.getElementById('stage').toDataURL('image/png'),diagnostics:__rig.diagnostics(),glError:document.getElementById('stage').getContext('webgl2').getError(),buttons:[...document.querySelectorAll('#pet-controls button')].map(b=>{const r=b.getBoundingClientRect();return {id:b.id,left:r.left,right:r.right,top:r.top,bottom:r.bottom}})})))`);
 assert.equal(data.glError,0);assert.ok(data.diagnostics.bodyFinite);assert.ok(data.buttons.every(b=>b.left>=0&&b.right<=bounds.width&&b.top>=0&&b.bottom<=bounds.height));
 for(const layer of data.diagnostics.hairLayers){assert.ok(layer.finite);assert.equal(layer.flippedTriangles,0);}
 fs.writeFileSync(path.join(out,phase+'.png'),electron.nativeImage.createFromDataURL(data.png).toPNG());delete data.png;
 fs.writeFileSync(path.join(out,phase+'-result.json'),JSON.stringify({passed:true,phase,checks,bounds:win.getBounds(),settings:JSON.parse(fs.readFileSync(settings,'utf8')),...data},null,2));
 clearTimeout(timer);app.quit();
}
require('../puppet/main.js');
