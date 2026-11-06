// Offline production main/preload/rig test, all windows hidden and data isolated.
const electron=require('electron'),{app}=electron,fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const out=process.env.BAIJIE_TEXT_OUT;if(!out)throw Error('isolated output required');fs.mkdirSync(out,{recursive:true});app.setPath('userData',path.join(out,'profile'));
app.commandLine.appendSwitch('use-angle','swiftshader');app.commandLine.appendSwitch('enable-unsafe-swiftshader');
for(const key of Object.keys(process.env))if(key.startsWith('PUPPET_'))delete process.env[key];process.env.PUPPET_QUERY_RAW=JSON.stringify({still:'1'});process.env.PUPPET_W='480';process.env.PUPPET_H='696';
let host;const windows=[],errors=[],checks=[];
class HiddenWindow extends electron.BrowserWindow{constructor(options){super({...options,show:false,webPreferences:{...options.webPreferences,offscreen:true,backgroundThrottling:false}});this.logicalVisible=!options.parent;windows.push(this);if(!options.parent)host=this;this.webContents.on('console-message',(_e,level,msg)=>{if(level>=3)errors.push(msg);});this.webContents.once('did-finish-load',()=>{if(this===host)verify().catch(fail);});}show(){this.logicalVisible=true;}showInactive(){this.logicalVisible=true;}hide(){this.logicalVisible=false;this.emit('hide');}isVisible(){return this.logicalVisible;}}
class Tray extends EventEmitter{setToolTip(){}}
const overrides={BrowserWindow:HiddenWindow,Tray,globalShortcut:{register(){return true},unregisterAll(){}},Menu:{buildFromTemplate(){return {popup(o){o.callback?.();}}}}};
const proxy=new Proxy(electron,{get:(t,k)=>Object.hasOwn(overrides,k)?overrides[k]:t[k]});const load=Module._load,main=path.resolve(__dirname,'../puppet/main.js');
Module._load=function(name,parent,isMain){if(name==='electron')return proxy;if(name==='fs'&&parent?.filename===main)return new Proxy(fs,{get(t,k){if(k!=='appendFileSync')return t[k];return()=>{};}});return load.call(this,name,parent,isMain);};
const deadline=setTimeout(()=>fail(Error('text-only deadline')),30000);
function fail(e){fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({passed:false,error:e.stack,errors},null,2));app.exit(1);}
const js=code=>host.webContents.executeJavaScript(code),frame=()=>js('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn){const end=Date.now()+8000;while(!await fn()){if(Date.now()>end)throw Error('UI readiness timeout');await wait(20);}}
async function advance(ms){await js(`__clock+=${ms}`);await frame();}
async function pixels(name){return js(`new Promise(resolve=>requestAnimationFrame(()=>{const s=document.getElementById('stage'),c=document.createElement('canvas');c.width=s.width;c.height=s.height;c.getContext('2d').drawImage(s,0,0);window.__pixels??={};__pixels[${JSON.stringify(name)}]=c.getContext('2d').getImageData(0,0,c.width,c.height).data;resolve(c.toDataURL());}))`);}
async function verify(){
 await until(()=>js('!!window.__rig?.ready'));await js("window.__clock=performance.now();Object.defineProperty(performance,'now',{value:()=>__clock,configurable:true})");
 host.webContents.send('chat:reply',{reply:'姐姐在这里，弟弟慢慢说。',face:3942,action:'none'});await frame();await advance(300);
 const state=await js('__rig.diagnostics()');assert.equal(state.faceBlend.target,3942);assert.equal(state.dialogue.text,'姐姐在这里，弟弟慢慢说。');assert.equal(await js('typeof __rig.speechMotion'),'undefined');
 await pixels('first');await advance(500);const image=await pixels('later');
 const changed=await js("(()=>{let count=0;for(let i=0;i<__pixels.first.length;i++)if(__pixels.first[i]!==__pixels.later[i])count++;return count;})()");assert.equal(changed,0);
 fs.writeFileSync(path.join(out,'text-only-chat.png'),electron.nativeImage.createFromDataURL(image).toPNG());checks.push({name:'production-reply-keeps-mouth-static',passed:true,changedChannels:changed});
 host.webContents.send('action','blink');await advance(35);assert.equal(await js('__rig.diagnostics().blinkApplied'),true);checks.push({name:'manual-blink-preserved',passed:true});
 host.webContents.send('action','face:3711');await frame();await advance(300);assert.equal(await js('__rig.diagnostics().faceBlend.target'),3711);
 await js('__rig.dismissDialogue()');await advance(300);assert.equal(await js('__rig.S.faceId'),3711);checks.push({name:'manual-expression-and-dismiss-preserved',passed:true});
 assert.deepEqual(errors,[]);assert.equal(windows.some(w=>electron.BrowserWindow.prototype.isVisible.call(w)),false);
 fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({passed:true,checks,errors,physicalWindowsVisible:false,networkRequests:0},null,2));clearTimeout(deadline);app.quit();
}
require(main);
