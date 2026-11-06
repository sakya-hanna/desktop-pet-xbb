// Real main/preload/page/companion integration; all windows physically hidden.
const electron=require('electron'),{app}=electron;
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const Module=require('node:module'),{EventEmitter}=require('node:events');
const out=process.env.BAIJIE_FEEDBACK_OUT;if(!out)throw Error('isolated output required');
fs.mkdirSync(out,{recursive:true});app.setPath('userData',path.join(out,'isolated-profile'));
app.commandLine.appendSwitch('use-angle','swiftshader');app.commandLine.appendSwitch('enable-unsafe-swiftshader');
for(const k of Object.keys(process.env))if(k.startsWith('PUPPET_'))delete process.env[k];
process.env.PUPPET_QUERY_RAW=JSON.stringify({still:'1'});process.env.PUPPET_W='480';process.env.PUPPET_H='696';
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
const frame=()=>js(host,'new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
async function advance(ms){await js(host,`window.__visualClock+=${ms}`);await frame();}
async function grab(name){
 const data=await js(host,`new Promise(resolve=>requestAnimationFrame(()=>{const s=document.getElementById('stage'),c=document.createElement('canvas');c.width=s.width;c.height=s.height;const x=c.getContext('2d');x.drawImage(s,0,0);window.__gpuFrames??={};__gpuFrames[${JSON.stringify(name)}]={data:x.getImageData(0,0,c.width,c.height).data,width:c.width,height:c.height,view:__rig.diagnostics().view};resolve({png:c.toDataURL(),diagnostics:__rig.diagnostics(),glError:s.getContext('webgl2').getError()});}))`);
 assert.equal(data.glError,0);assert.ok(data.diagnostics.bodyFinite);assert.ok(data.diagnostics.hairLayers.every(l=>l.finite&&l.flippedTriangles===0));
 fs.writeFileSync(path.join(out,name+'.png'),electron.nativeImage.createFromDataURL(data.png).toPNG());delete data.png;return data;
}
async function manual(id){host.webContents.send('action','face:'+id);await frame();}
async function verify(){
 await until(()=>js(host,'!!window.__rig?.ready && __rig.S.t>.1'));host.setPosition(20,20);
 await js(host,"window.__visualClock=performance.now();Object.defineProperty(performance,'now',{value:()=>window.__visualClock,configurable:true})");
 const base=await js(host,'__rig.S.faceId'),bounds=host.getBounds();
 // Deliberate contact expression, pose onset, valid release, and recovery.
 const a=await locate(274,50);await pointer('pointerdown',a);await advance(120);
 const preview=await grab('head-preview');assert.equal(preview.diagnostics.feedback.face,3942);assert.ok(preview.diagnostics.feedback.pose.angleY>0);assert.equal(await js(host,'__rig.S.faceId'),base);
 await pointer('pointermove',await locate(314,50));await advance(120);await pointer('pointermove',await locate(274,50));await pointer('pointerup',await locate(274,50));await frame();
 await until(()=>bubble&&!bubble.webContents.isLoading());await until(()=>js(bubble,"document.getElementById('speech-text').textContent==='怎么突然模姐姐的头，是希望姐姐做什么呢。'"));
 const reply=await grab('head-reply');assert.equal(reply.diagnostics.feedback.face,3942);await screenshot(bubble,'head-bubble');
 await advance(1600);await advance(300);const recovered=await grab('head-recovered');assert.equal(recovered.diagnostics.feedback.face,null);assert.equal(recovered.diagnostics.faceBlend.target,base);assert.equal(recovered.diagnostics.feedback.pose.angleY,0);
 checks.push({name:'head-contact-expression-pose-release-bubble-and-recovery',passed:true,preview:preview.diagnostics.feedback,reply:reply.diagnostics.feedback});await clear();
 // Chest has no speculative expression until a valid release.
 const chest=await locate(295,222);await pointer('pointerdown',chest);await advance(60);assert.equal(await js(host,'__rig.feedback.update().face'),null);
 await pointer('pointerup',await locate(295,222));await frame();assert.equal(await js(host,'__rig.feedback.update().face'),3563);
 await advance(120);await grab('chest-surprise');await advance(180);assert.equal(await js(host,'__rig.feedback.update().face'),3665);await advance(240);await grab('chest-pout');await screenshot(bubble,'chest-bubble');
 checks.push({name:'valid-chest-only-surprise-to-pout-with-original-line',passed:true});
 // Manual selection while the reaction is live cannot be undone by old recovery.
 await manual(3901);await advance(1800);const overridden=await grab('manual-override');assert.equal(overridden.diagnostics.faceBlend.target,3901);assert.equal(await js(host,'__rig.S.faceId'),3901);assert.equal(overridden.diagnostics.feedback.face,null);
 const p=await locate(294,50);await pointer('pointerdown',p);await advance(150);await manual(3599);await pointer('pointerup',p);await advance(1600);assert.equal(await js(host,'__rig.diagnostics().faceBlend.target'),3599);
 checks.push({name:'manual-face-during-reply-or-hold-wins-over-stale-release',passed:true});await clear();
 // Pixel-level test of the real FBO premultiplied half mixture. No synthesized PNGs.
 await manual(3599);await advance(300);await grab('blend-a');
 await manual(3942);await advance(120);const mid=await grab('blend-mid');assert.ok(mid.diagnostics.faceBlend.layers.length>=2);
 await advance(120);await grab('blend-b');
 const metrics=await js(host,`(()=>{const a=__gpuFrames['blend-a'],b=__gpuFrames['blend-b'],m=__gpuFrames['blend-mid'],v=a.view;let maxError=0,changed=0,interior=0,outsideChanged=0;for(let y=0;y<a.height;y++)for(let x=0;x<a.width;x++){const i=(y*a.width+x)*4;const outside=x<(248*v.s+v.ox)||x>(348*v.s+v.ox)||y<(54*v.s+v.oy)||y>(143*v.s+v.oy);if(outside){for(let k=0;k<4;k++)if(a.data[i+k]!==m.data[i+k]){outsideChanged++;break;}continue;}if(a.data[i+3]===255&&b.data[i+3]===255&&m.data[i+3]===255){interior++;let different=false;for(let k=0;k<3;k++){maxError=Math.max(maxError,Math.abs(m.data[i+k]-(a.data[i+k]+b.data[i+k])/2));if(a.data[i+k]!==b.data[i+k])different=true;}if(different)changed++;}}return {maxError,changed,interior,outsideChanged,layers:__rig.diagnostics().faceBlend.layers};})()`);
 assert.ok(metrics.interior>100&&metrics.changed>20);assert.ok(metrics.maxError<=3,JSON.stringify(metrics));assert.equal(metrics.outsideChanged,0);
 checks.push({name:'actual-webgl-midpoint-rgb-and-outside-face-protection',passed:true,metrics,midLayers:mid.diagnostics.faceBlend.layers});
 // Mid-fade retargeting preserves the displayed weighted mixture at the interruption instant.
 await manual(3496);await advance(90);const before=await js(host,'__rig.diagnostics().faceBlend.layers');await manual(3901);const after=await js(host,'__rig.diagnostics().faceBlend.layers');assert.deepEqual(after,before);await advance(300);
 checks.push({name:'mid-fade-retarget-has-no-weight-discontinuity',passed:true});
 // Cancel and hide do not leave expression/pose ownership; release cannot replay.
 for(const finish of ['pointercancel','lostpointercapture','blur','hide']){
  const q=await locate(294,50);await pointer('pointerdown',q);await advance(150);
  if(finish==='hide'){host.hide();await frame();host.show();}else if(finish==='blur')await js(host,"window.dispatchEvent(new Event('blur'))");else await pointer(finish,q);
  await pointer('pointerup',q);await advance(500);assert.equal(await js(host,'__rig.feedback.update().face'),null);assert.equal(await js(host,'__rig.feedback.update().pose.angleY'),0);
 }
 checks.push({name:'cancel-focus-capture-hide-release-expression-pose-ownership',passed:true});
 assert.deepEqual(host.getBounds(),bounds);for(const w of windows)assert.equal(electron.BrowserWindow.prototype.isVisible.call(w),false);assert.deepEqual(errors,[]);
 fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({passed:true,checks,errors,physicalWindowsVisible:false,final:await js(host,'__rig.diagnostics()')},null,2));clearTimeout(timer);app.quit();
}
require('../puppet/main.js');
