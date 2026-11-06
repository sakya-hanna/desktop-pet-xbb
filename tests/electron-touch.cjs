// Real main/preload/page/companion integration; all windows physically hidden.
const electron=require('electron'),{app}=electron;
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const Module=require('node:module'),{EventEmitter}=require('node:events');
const out=process.env.BAIJIE_TOUCH_OUT;if(!out)throw Error('isolated output required');
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
const timer=setTimeout(()=>fail(Error('touch deadline')),60000);
function fail(e){fs.writeFileSync(path.join(out,'failure.json'),JSON.stringify({error:e.stack,errors},null,2));app.exit(1);}
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn){const end=Date.now()+10000;while(!await fn()){if(Date.now()>end)throw Error('dialogue condition timeout: '+fn);await wait(20);}}
const js=(w,code)=>w.webContents.executeJavaScript(code);
const state=()=>js(host,'__rig.dialogue.snapshot()');
function nonoverlap(a,b){return a.x+a.width<=b.x||b.x+b.width<=a.x||a.y+a.height<=b.y||b.y+b.height<=a.y;}
async function screenshot(w,name){await until(()=>paints.has(w));await wait(100);fs.writeFileSync(path.join(out,name+'.png'),paints.get(w).toPNG());}
// Locate a point on the actual current deformed mesh and independently read rendered alpha.
async function locate(wx,wy){return js(host,`new Promise(resolve=>requestAnimationFrame(()=>{
 const wx=${JSON.stringify(wx)},wy=${JSON.stringify(wy)},v=__rig.diagnostics().view,offsets=[];
 for(let y=-14;y<=14;y+=2)for(let x=-14;x<=14;x+=2)offsets.push([x,y]);offsets.sort((a,b)=>Math.hypot(...a)-Math.hypot(...b));
 let best=null;
 for(const [dx,dy] of offsets){const x=wx*v.s+v.ox+dx,y=wy*v.s+v.oy+dy,p=__rig.pickTest(x,y);if(!p)continue;const d=Math.hypot(p.x-wx,p.y-wy);if(!best||d<best.distance)best={clientX:x,clientY:y,distance:d,rest:{x:p.x,y:p.y,part:p.part},region:__rig.touchRegion(x,y)};if(d<1.5)break;}
 if(best){const c=document.getElementById('stage'),a=document.createElement('canvas');a.width=c.width;a.height=c.height;const ctx=a.getContext('2d');ctx.drawImage(c,0,0);const x=Math.floor(best.clientX*c.width/innerWidth),y=Math.floor(best.clientY*c.height/innerHeight);best.alpha=ctx.getImageData(x,y,1,1).data[3];}resolve(best);
 }))`);}
async function pointer(type,p,id=77,target='stage'){
 await js(host,`document.getElementById(${JSON.stringify(target)}).dispatchEvent(new PointerEvent(${JSON.stringify(type)},{bubbles:true,button:0,buttons:${type==='pointerup'?0:1},pointerId:${id},clientX:${p.clientX},clientY:${p.clientY},screenX:${p.clientX+100},screenY:${p.clientY+100}}))`);
}
async function clear(){await js(host,'__rig.dismissDialogue()');await until(async()=>!(await state()).visible);}
async function tap(wx=295,wy=222){const p=await locate(wx,wy);assert.ok(p&&p.distance<4);assert.ok(p.alpha>200);await pointer('pointerdown',p);await wait(70);await pointer('pointerup',await locate(wx,wy));return p;}
async function pat(){const a=await locate(274,50);assert.ok(a&&a.distance<4&&a.alpha>200);await pointer('pointerdown',a);await wait(120);const b=await locate(314,50);assert.ok(b&&b.distance<4&&b.alpha>200);await pointer('pointermove',b);await wait(120);const c=await locate(274,50);await pointer('pointermove',c);await pointer('pointerup',c);return [a,b,c];}
async function verify(){
 await until(()=>js(host,'!!window.__rig?.ready && __rig.S.t>.1'));
 electron.ipcMain.emit('menu',{sender:host.webContents,senderFrame:host.webContents.mainFrame},null);template.find(i=>i.label==='自动待机动作').click({checked:false});
 await wait(250);
 const initial=host.getBounds(),face=await js(host,'__rig.S.faceId');
 const chest=await tap();await until(()=>bubble&&!bubble.webContents.isLoading());
 await until(()=>js(bubble,"document.getElementById('speech-text').textContent==='姆，弟弟你这个色鬼。'"));
 assert.equal((await state()).source,'touch');assert.deepEqual(host.getBounds(),initial);assert.equal(await js(host,'__rig.S.faceId'),face);
 checks.push({name:'actual-render-alpha-chest-pointer-to-preload-to-speech',passed:true,point:chest,host:initial,bubble:bubble.getBounds()});
 await screenshot(host,'chest-character');await screenshot(bubble,'chest-bubble');
 const id=(await state()).id;await tap();assert.equal((await state()).id,id);
 checks.push({name:'repeated-touch-cooldown-no-face-cycle',passed:true});
 await clear();await wait(1250);
 const head=await pat();await until(()=>js(bubble,"document.getElementById('speech-text').textContent==='怎么突然模姐姐的头，是希望姐姐做什么呢。'"));
 assert.equal((await state()).source,'touch');assert.deepEqual(host.getBounds(),initial);assert.equal(await js(host,'__rig.S.faceId'),face);
 checks.push({name:'actual-render-deformed-rest-head-reversal-to-speech',passed:true,points:head});await screenshot(host,'head-character');await screenshot(bubble,'head-bubble');
 await js(bubble,"document.getElementById('speech-close').click()");await until(async()=>!(await state()).visible);
 assert.equal(await js(host,"__rig.idle.snapshot().held.includes('dialogue')"),false);
 checks.push({name:'touch-reply-close-button-releases-idle',passed:true});
 for(const finish of ['pointercancel','lostpointercapture','blur','hide']){
  const p=await locate(295,222);await pointer('pointerdown',p);
  if(finish==='hide'){host.hide();await wait(50);host.show();}
  else if(finish==='blur')await js(host,"window.dispatchEvent(new Event('blur'))");
  else await pointer(finish,p);
  await pointer('pointerup',p);assert.equal((await state()).visible,false,finish);
  assert.equal(await js(host,'__rig.touch.snapshot().active'),false);assert.equal(await js(host,"__rig.idle.snapshot().held.includes('input')"),false);
 }
 checks.push({name:'cancel-capture-loss-blur-hide-no-reply-or-stuck-input',passed:true});
 const a=await locate(295,222);await pointer('pointerdown',a);await pointer('pointermove',{clientX:1,clientY:100});await pointer('pointermove',a);await pointer('pointerup',a);
 assert.equal((await state()).visible,false);
 const h=await locate(294,50);await pointer('pointerdown',h);await pointer('pointerup',h);assert.equal((await state()).visible,false);assert.equal(await js(host,'__rig.S.faceId'),face);
 checks.push({name:'outside-return-and-head-single-tap-never-trigger-or-cycle',passed:true});
 await pointer('pointerdown',{clientX:1,clientY:100});await pointer('pointerup',{clientX:1,clientY:100});
 const before=host.getBounds();await pointer('pointerdown',{clientX:90,clientY:15},79,'pet-grip');await pointer('pointermove',{clientX:110,clientY:25},79,'pet-grip');await pointer('pointerup',{clientX:110,clientY:25},79,'pet-grip');
 await until(()=>host.getBounds().x===before.x+20);assert.equal((await state()).visible,false);assert.equal(await js(host,'__rig.S.faceId'),face);
 checks.push({name:'transparent-blank-and-grip-not-touch-grip-still-drags',passed:true});
 const variants=[];
 for(const size of ['小','中','大']){
  electron.ipcMain.emit('menu',{sender:host.webContents,senderFrame:host.webContents.mainFrame},null);template.find(i=>i.label==='大小').submenu.find(i=>i.label?.startsWith(size+'（')).click();
  await until(()=>js(host,`innerHeight===${host.getBounds().height}`));
  // Exercise a real transient deformed pose, not just a shifted window rectangle.
  await wait(1250);await js(host,'__rig.S.angleX.x=.6;__rig.S.angleY.x=-.25');await wait(20);
  const poseBefore=await js(host,'({x:__rig.S.angleX.x,y:__rig.S.angleY.x})');
  const p=await tap();await until(async()=>(await state()).visible);assert.equal((await state()).text,'姆，弟弟你这个色鬼。');
  const d=await js(host,'__rig.diagnostics()');assert.ok(d.bodyFinite);assert.ok(d.hairLayers.every(l=>l.finite&&l.flippedTriangles===0));
  await clear();await wait(1250);await js(host,'__rig.S.angleX.x=-.5;__rig.S.angleY.x=.2');await wait(20);
  const hp=await pat();assert.equal((await state()).text,'怎么突然模姐姐的头，是希望姐姐做什么呢。');
  variants.push({size,point:p,head:hp,poseBefore,bounds:host.getBounds(),view:d.view});await clear();
 }
 checks.push({name:'three-size-actual-mesh-picking-after-pose-change',passed:true,variants});
 for(const w of windows)assert.equal(electron.BrowserWindow.prototype.isVisible.call(w),false,'no physical window may be shown');
 assert.deepEqual(errors,[]);
 fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({passed:true,checks,errors,physicalWindowsVisible:false,final:await js(host,'__rig.diagnostics()')},null,2));
 clearTimeout(timer);app.quit();
}
require('../puppet/main.js');
