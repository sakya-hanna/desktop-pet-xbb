// Real main/preload/page/companion integration; all windows physically hidden.
const electron=require('electron'),{app}=electron;
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const Module=require('node:module'),{EventEmitter}=require('node:events');
const out=process.env.BAIJIE_DIALOGUE_OUT;if(!out)throw Error('isolated output required');
fs.mkdirSync(out,{recursive:true});app.setPath('userData',path.join(out,'isolated-profile'));
app.commandLine.appendSwitch('use-angle','swiftshader');app.commandLine.appendSwitch('enable-unsafe-swiftshader');
for(const k of Object.keys(process.env))if(k.startsWith('PUPPET_'))delete process.env[k];
let host,bubble,template;const windows=[],paints=new Map(),errors=[],checks=[];
class HiddenWindow extends electron.BrowserWindow{
 constructor(options){
  super({...options,show:false,webPreferences:{...options.webPreferences,offscreen:true,backgroundThrottling:false}});
  this.logicalVisible=!options.parent;windows.push(this);if(options.parent)bubble=this;else host=this;
  this.webContents.on('paint',(_e,_r,image)=>{if(!image.isEmpty())paints.set(this,image);});
  this.webContents.on('console-message',(_e,level,msg)=>{if(level>=3)errors.push(msg);});
  this.webContents.once('did-finish-load',()=>{if(this===host)verify().catch(fail);});
 }
 show(){this.logicalVisible=true;this.emit('show');}
 showInactive(){this.logicalVisible=true;}
 hide(){const was=this.logicalVisible;this.logicalVisible=false;if(was)this.emit('hide');}
 isVisible(){return this.logicalVisible;}
 setIgnoreMouseEvents(on,options){this.ignored=on;return super.setIgnoreMouseEvents(on,options);}
}
class Tray extends EventEmitter{setToolTip(){}}
const overrides={BrowserWindow:HiddenWindow,Tray,globalShortcut:{register(){return true},unregisterAll(){}},
 Menu:{buildFromTemplate(t){template=t;return {popup(o){o.callback?.();}}}}};
const proxy=new Proxy(electron,{get(t,k){return Object.hasOwn(overrides,k)?overrides[k]:t[k];}});
const load=Module._load,main=path.resolve(__dirname,'../puppet/main.js');
const logFs=new Proxy(fs,{get(t,k){if(k!=='appendFileSync')return t[k];return (file,...args)=>{const logs=path.join(out,'logs');fs.mkdirSync(logs,{recursive:true});return fs.appendFileSync(path.join(logs,path.basename(file)),...args);};}});
Module._load=function(name,parent,isMain){if(name==='electron')return proxy;if(name==='fs'&&parent?.filename===main)return logFs;return load.call(this,name,parent,isMain);};
const timer=setTimeout(()=>fail(Error('dialogue deadline')),60000);
function fail(e){fs.writeFileSync(path.join(out,'failure.json'),JSON.stringify({error:e.stack,errors},null,2));app.exit(1);}
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn){const end=Date.now()+10000;while(!await fn()){if(Date.now()>end)throw Error('dialogue condition timeout: '+fn);await wait(20);}}
const js=(w,code)=>w.webContents.executeJavaScript(code);
const state=()=>js(host,'__rig.dialogue.snapshot()');
function nonoverlap(a,b){return a.x+a.width<=b.x||b.x+b.width<=a.x||a.y+a.height<=b.y||b.y+b.height<=a.y;}
async function screenshot(w,name){await until(()=>paints.has(w));await wait(100);fs.writeFileSync(path.join(out,name+'.png'),paints.get(w).toPNG());}
async function verify(){
 await until(()=>js(host,'!!window.__rig?.ready && __rig.S.t>.1'));
 const original=host.getBounds(),view=await js(host,'__rig.diagnostics().view'),face=await js(host,'__rig.S.faceId');
 electron.ipcMain.emit('menu',{sender:host.webContents,senderFrame:host.webContents.mainFrame},null);
 const menu=template.find(i=>i.label==='气泡对白预览');assert.ok(menu);menu.submenu[0].click();
 await until(()=>bubble&&!bubble.webContents.isLoading());
 await until(()=>js(bubble,"document.body.innerText.includes('怎么突然模姐姐的头，是希望姐姐做什么呢。')"));
 assert.deepEqual(host.getBounds(),original);assert.equal(await js(host,'__rig.S.faceId'),face);
 assert.deepEqual(await js(host,'__rig.diagnostics().view'),view);
 assert.ok(await js(host,"__rig.idle.snapshot().held.includes('dialogue')"));
 assert.ok(nonoverlap(host.getBounds(),bubble.getBounds()));
 const first=await state();assert.ok(first.visible);
 checks.push({name:'native-menu-real-preload-text-nonoverlap-and-anchor',passed:true,host:original,bubble: bubble.getBounds()});
 await screenshot(host,'character');await screenshot(bubble,'head-bubble');
 menu.submenu[1].click();await until(()=>js(bubble,"document.body.innerText.includes('姆，弟弟你这个色鬼。')"));
 const second=await state();assert.ok(second.id>first.id);
 await js(host,`__rig.dismissDialogue(${first.id})`);assert.equal((await state()).id,second.id);assert.ok((await state()).visible);
 checks.push({name:'replacement-and-old-id-refusal',passed:true});await screenshot(bubble,'chest-bubble');
 await js(bubble,"document.querySelector('button').click()");await until(async()=>!(await state()).visible);
 assert.ok(!bubble.logicalVisible);assert.equal(await js(host,"__rig.idle.snapshot().held.includes('dialogue')"),false);
 checks.push({name:'close-real-bridge-clears-idle',passed:true});
 const literal='<img src=x onerror="window.injected=true">\n中文对白';
 await js(host,`__rig.say({text:${JSON.stringify(literal)},source:'test'})`);
 await until(()=>js(bubble,"document.body.innerText.includes('<img')"));
 assert.equal(await js(bubble,"document.querySelectorAll('img').length"),0);assert.equal(await js(bubble,'!!window.injected'),false);
 assert.equal(await js(bubble,"typeof require"),'undefined');
 checks.push({name:'literal-text-no-renderer-node',passed:true});
 await js(host,`__rig.say({text:${JSON.stringify('长文本测试。'.repeat(250))},source:'test'})`);
 await until(()=>js(bubble,"document.body.innerText.includes('长文本测试。')"));
 const metrics=await js(bubble,`(()=>{const b=document.querySelector('button').getBoundingClientRect();return {width:innerWidth,height:innerHeight,button:{x:b.x,y:b.y,right:b.right,bottom:b.bottom},scrollable:[...document.querySelectorAll('*')].some(e=>e.scrollHeight>e.clientHeight&&['auto','scroll'].includes(getComputedStyle(e).overflowY))}})()`);
 assert.ok(metrics.scrollable);assert.ok(metrics.button.x>=0&&metrics.button.y>=0&&metrics.button.right<=metrics.width&&metrics.button.bottom<=metrics.height);
 checks.push({name:'long-chinese-scroll-close-reachable',passed:true,metrics});await screenshot(bubble,'long-bubble');
 const before=host.getBounds();electron.ipcMain.emit('drag',{sender:host.webContents,senderFrame:host.webContents.mainFrame},{dx:-25,dy:-15});
 assert.equal(host.getBounds().width,before.width);assert.ok(nonoverlap(host.getBounds(),bubble.getBounds()));
 const moved=host.getBounds();electron.ipcMain.emit('resize-by',{sender:host.webContents,senderFrame:host.webContents.mainFrame},1.05);assert.ok(host.getBounds().height>moved.height);
 assert.ok(nonoverlap(host.getBounds(),bubble.getBounds()));
 checks.push({name:'drag-resize-do-not-inflate-character-for-bubble',passed:true});
 const area=electron.screen.getDisplayMatching(host.getBounds()).workArea,layouts=[];
 for(const size of ['小','中','大']){
  electron.ipcMain.emit('menu',{sender:host.webContents,senderFrame:host.webContents.mainFrame},null);
  template.find(i=>i.label==='大小').submenu.find(i=>i.label?.startsWith(size+'（')).click();
  for(const [x,y] of [[area.x,area.y],[area.x+area.width-host.getBounds().width,area.y],[area.x,area.y+area.height-host.getBounds().height]]){
   const b=host.getBounds();host.setBounds({...b,x,y});await wait(40);
   const p=host.getBounds(),s=bubble.getBounds();assert.ok(nonoverlap(p,s));
   assert.ok(s.x>=area.x&&s.y>=area.y&&s.x+s.width<=area.x+area.width&&s.y+s.height<=area.y+area.height);
   layouts.push({size,host:p,bubble:s});
  }
 }
 checks.push({name:'three-presets-three-display-edges',passed:true,layouts});
 electron.ipcMain.emit('menu',{sender:host.webContents,senderFrame:host.webContents.mainFrame},null);
 template.find(i=>i.label?.startsWith('鼠标穿透')).click({checked:true});assert.equal(bubble.ignored,true);
 template.find(i=>i.label?.startsWith('鼠标穿透')).click({checked:false});assert.equal(bubble.ignored,false);
 checks.push({name:'explicit-pass-through-includes-companion',passed:true});
 host.hide();await until(async()=>!(await state()).visible);assert.equal(bubble.logicalVisible,false);host.show();
 await wait(100);assert.equal(bubble.logicalVisible,false);
 checks.push({name:'hide-show-does-not-replay-old-dialogue',passed:true});
 await js(host,"__rig.say({text:'超时测试',source:'test'})");await until(()=>bubble.logicalVisible);
 await until(async()=>!(await state()).visible);await until(()=>!bubble.logicalVisible);
 checks.push({name:'real-clock-auto-expiry',passed:true});
 for(const w of windows)assert.equal(electron.BrowserWindow.prototype.isVisible.call(w),false,'no physical window may be shown');
 app.emit('before-quit');const saved=JSON.parse(fs.readFileSync(path.join(app.getPath('userData'),'baijie-desktop/window-state.json'),'utf8'));
 assert.deepEqual(saved.bounds,host.getBounds());assert.equal('dialogue' in saved,false);
 assert.deepEqual(errors,[]);
 fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({passed:true,checks,saved,errors,physicalWindowsVisible:false},null,2));
 clearTimeout(timer);app.quit();
}
require('../puppet/main.js');
