// Hidden, project-only Electron render acceptance. No tray, input or global shortcuts.
const {app,BrowserWindow,ipcMain}=require('electron');
const fs=require('fs');const path=require('path');const assert=require('assert/strict');
// SSH session 0 may have no usable D3D context; test with bundled CPU WebGL.
// These flags affect this test process only, not the normal desktop launcher.
app.commandLine.appendSwitch('use-angle','swiftshader');
app.commandLine.appendSwitch('enable-unsafe-swiftshader');
const out=process.env.BAIJIE_TEST_OUT;
if(!out)throw new Error('BAIJIE_TEST_OUT must point to a new project report directory');
app.setPath('userData',path.join(out,'electron-profile'));
const report={cases:[],errors:[]};
const inputMessages=[];
ipcMain.on('menu',(_event,p)=>inputMessages.push(['menu',p]));
ipcMain.on('drag',(_event,p)=>inputMessages.push(['drag',p]));
let win;
const deadline=setTimeout(()=>{fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'timeout.txt'),'render acceptance exceeded 90 seconds');app.exit(2);},90000);
async function evaluate(query,name,width=420,height=560){
 win=new BrowserWindow({width,height,show:false,frame:false,backgroundColor:'#59636d',webPreferences:{offscreen:true,backgroundThrottling:false,contextIsolation:true,nodeIntegration:false,preload:path.join(__dirname,'../puppet/preload.js'),webSecurity:false}});
 win.webContents.on('console-message',details=>{if(details.level==='error')report.errors.push({name,message:details.message});});
 await win.loadFile(path.join(__dirname,'../puppet/rig/index.html'),{query});
 await win.webContents.executeJavaScript(`new Promise((resolve,reject)=>{const start=performance.now();const tick=()=>{if(window.__rig?.ready&&window.__rig.S.t>0.8)return resolve(true);if(performance.now()-start>15000)return reject(Error('RIG_READY timeout'));setTimeout(tick,30)};tick()})`);
 const data=await win.webContents.executeJavaScript(`({ ...__rig.diagnostics(),face:__rig.S.faceId,glError:document.getElementById('stage').getContext('webgl2').getError()})`);
 assert.equal(data.glError,0,'WebGL error');assert.ok(data.bodyFinite,'body has non-finite vertices');
 assert.equal(data.hairLayers.length,query.layers==='0'?0:2);
 assert.ok(data.hairLayers.every(x=>x.finite&&x.vertices>0));
 const image=await win.webContents.capturePage();const png=image.toPNG();assert.ok(png.length>15000,'empty render');
 fs.writeFileSync(path.join(out,name+'.png'),png);
 report.cases.push({name,query,size:image.getSize(),pngBytes:png.length,...data});
 if(name==='06-normal-window'){
  inputMessages.length=0;
  const input=await win.webContents.executeJavaScript(`(()=>{
   const before=__rig.S.faceId;
   const pointer=(type,x,y)=>window.dispatchEvent(new PointerEvent(type,{button:0,pointerId:42,screenX:x,screenY:y}));
   window.dispatchEvent(new MouseEvent('contextmenu',{screenX:100,screenY:200}));
   pointer('pointerdown',10,20);pointer('pointermove',20,25);pointer('pointermove',23,27);pointer('pointerup',23,27);
   const afterDrag=__rig.S.faceId;
   pointer('pointerdown',10,20);pointer('pointerup',10,20);
   return {before,afterDrag,afterClick:__rig.S.faceId};
  })()`);
  await new Promise((resolve,reject)=>{const start=Date.now();const tick=()=>{if(inputMessages.length===3)return resolve();if(Date.now()-start>2000)return reject(Error('IPC input timeout'));setTimeout(tick,10)};tick();});
  assert.equal(input.before,input.afterDrag);assert.notEqual(input.before,input.afterClick);
  assert.deepEqual(inputMessages,[['menu',{x:100,y:200}],['drag',{dx:10,dy:5}],['drag',{dx:3,dy:2}]]);
  report.inputBridge={passed:true,...input,messages:inputMessages.slice()};
 }
 win.destroy();win=null;
}
app.whenReady().then(async()=>{
 fs.mkdirSync(out,{recursive:true});
 try{
  const base={still:'1',ax:'0',ay:'0',roll:'0',face:'3901'};
  await evaluate({...base,layers:'0'},'01-original');
  await evaluate({...base,hair:'0'},'02-layered-rest');
  await evaluate({...base,hair:'-0.06'},'03-hair-left');
  await evaluate({...base,hair:'0.06'},'04-hair-right');
  await evaluate({},'05-natural-idle');
  await evaluate({},'06-normal-window',240,348);
  // All existing expression assets still load, including the optional comic faces.
  for(const face of ['3496','3523','3563','3599','3625','3665','3711','3751','3791','3831','3861','3942','4006'])
   await evaluate({...base,face,hair:'0'},'face-'+face,240,348);
  assert.equal(report.errors.length,0,'renderer console errors');report.passed=true;
 }catch(error){report.passed=false;report.failure=error.stack;}
 fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(report,null,2));
 if(win)win.destroy();clearTimeout(deadline);app.exit(report.passed?0:1);
});
app.on('window-all-closed',()=>{});
