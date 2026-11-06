// Real hidden Electron + preload + WebGL acceptance. No OS input or desktop window.
const {app,BrowserWindow}=require('electron');
const fs=require('fs'),path=require('path'),http=require('http'),assert=require('assert/strict');
app.commandLine.appendSwitch('use-angle','swiftshader');
app.commandLine.appendSwitch('enable-unsafe-swiftshader');
const out=process.env.BAIJIE_TEST_OUT;if(!out)throw Error('New BAIJIE_TEST_OUT is required');
app.setPath('userData',path.join(out,'electron-profile'));
const rigRoot=path.resolve(__dirname,'../puppet/rig');
const cfgScript=fs.readFileSync(path.join(rigRoot,'js/assets.js'),'utf8');
const cfg=JSON.parse(cfgScript.split('=').slice(1).join('=').trim().replace(/;$/,'' )).baijie;
const report={scenes:[],eyePairs:[],faultRequests:[],hopFrames:[],consoleErrors:[],passed:false};
let win,server,port;
const timeout=setTimeout(()=>{fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'timeout.json'),JSON.stringify(report));app.exit(2);},140000);
const fixed={still:'1',ax:'0',ay:'0',roll:'0',hair:'0'};
function verify(d){
 assert.equal(d.glError,0);assert.ok(d.bodyFinite);
 for(const layer of d.hairLayers){
  assert.ok(layer.finite&&layer.vertices>0);assert.equal(layer.flippedTriangles,0,layer.name+' actual mesh folded');
  const b=layer.bounds,v=d.view;
  assert.ok(b.minX*v.s+v.ox>=0&&b.maxX*v.s+v.ox<=d.viewport[0],'hair clipped horizontally');
  assert.ok(b.minY*v.s+v.oy>=0&&b.maxY*v.s+v.oy<=d.viewport[1],'hair clipped vertically');
 }
}
async function state(){return win.webContents.executeJavaScript(`({...__rig.diagnostics(),selectedFace:__rig.S.faceId,clock:__rig.S.t,glError:document.getElementById('stage').getContext('webgl2').getError()})`);}
async function open(query,name,mode='normal'){
 win=new BrowserWindow({width:420,height:560,show:false,frame:false,backgroundColor:'#59636d',webPreferences:{offscreen:true,backgroundThrottling:false,contextIsolation:true,nodeIntegration:false,preload:path.join(__dirname,'../puppet/preload.js')}});
 win.webContents.on('console-message',details=>{if(details.level==='error')report.consoleErrors.push({name,mode,message:details.message});});
 await win.loadURL(`http://127.0.0.1:${port}/${mode}/index.html?`+new URLSearchParams(query));
 await win.webContents.executeJavaScript(`new Promise((resolve,reject)=>{const start=performance.now();function tick(){if(window.__rig?.ready&&__rig.S.t>0.40)return resolve();if(performance.now()-start>16000)return reject(Error('Rig startup timeout'));setTimeout(tick,20)};tick()})`);
 const data=await state();verify(data);
 const image=await win.webContents.capturePage();assert.ok(image.toPNG().length>15000);
 fs.writeFileSync(path.join(out,name+'.png'),image.toPNG());
 report.scenes.push({name,mode,query,...data});return {image,data};
}
function close(){win.destroy();win=null;}
function pixelDelta(a,b,rect){
 const ia=a.toBitmap(),ib=b.toBitmap(),w=a.getSize().width,h=a.getSize().height;
 let count=0,max=0;
 const x0=Math.max(0,Math.floor(rect.x)),y0=Math.max(0,Math.floor(rect.y));
 const x1=Math.min(w,Math.ceil(rect.x+rect.w)),y1=Math.min(h,Math.ceil(rect.y+rect.h));
 for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++){
  let changed=false;for(let k=0;k<4;k++){const d=Math.abs(ia[(y*w+x)*4+k]-ib[(y*w+x)*4+k]);max=Math.max(max,d);changed ||= d!==0;}if(changed)count++;
 }
 return {changedPixels:count,maxChannelError:max};
}
function mapped(rect,view){return {x:rect.x*view.s+view.ox,y:rect.y*view.s+view.oy,w:rect.w*view.s,h:rect.h*view.s};}
app.whenReady().then(async()=>{
 fs.mkdirSync(out,{recursive:true});
 try{
  server=http.createServer((req,res)=>{
   try{
    const pathname=new URL(req.url,'http://localhost').pathname;
    if(pathname==='/favicon.ico'){res.writeHead(204);return res.end();}
    const route=decodeURIComponent(pathname).split('/');const mode=route[1];
    const relative=route.slice(2).join('/');const file=path.resolve(rigRoot,relative);
    if(!file.startsWith(rigRoot+path.sep)){res.writeHead(403);return res.end();}
    const missing=(mode==='fault-hair'&&relative==='assets/baijie-outer-right.png')||(mode==='fault-blink'&&relative==='assets/baijie-blink-3711.png');
    if(missing){report.faultRequests.push({mode,relative});res.writeHead(404);return res.end('expected missing fixture');}
    if(!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);return res.end();}
    res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.html')?'text/html':file.endsWith('.png')?'image/png':'application/octet-stream');
    fs.createReadStream(file).pipe(res);
   }catch(error){res.writeHead(500);res.end(String(error));}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));port=server.address().port;
  for(const face of cfg.faceOrder){
   const before=await open({...fixed,face:String(face),blink:'0'},'face-'+face+'-open');close();
   const after=await open({...fixed,face:String(face),blink:'1'},'face-'+face+'-closed');close();
   assert.equal(after.data.renderedFace,face);assert.equal(after.data.selectedFace,face);
   const mouth=pixelDelta(before.image,after.image,mapped({x:254,y:117,w:90,h:22},before.data.view));
   const brows=pixelDelta(before.image,after.image,mapped({x:254,y:69,w:90,h:10},before.data.view));
   assert.equal(mouth.changedPixels,0,'mouth changed during blink: '+face);assert.equal(brows.changedPixels,0,'brows changed during blink: '+face);
   const noBlink=[3496,3523,3625,3861,4006].includes(face);
   const full=pixelDelta(before.image,after.image,{x:0,y:0,w:420,h:560});
   assert.equal(after.data.blinkApplied,!noBlink);
   if(noBlink)assert.equal(full.changedPixels,0,'already closed/comic expression changed');else assert.ok(full.changedPixels>50,'eyes did not visibly close');
   report.eyePairs.push({face,mouth,brows,full,noBlink});
  }
  let scene=await open({...fixed,face:'3711',blink:'1'},'fault-hair','fault-hair');
  assert.equal(scene.data.bodySource,'baijie-body.png');assert.equal(scene.data.hairLayers.length,0);assert.ok(scene.data.assetFallback);close();
  scene=await open({...fixed,face:'3711',blink:'1'},'fault-blink','fault-blink');
  assert.equal(scene.data.blinkApplied,false);assert.equal(scene.data.renderedFace,3711);assert.equal(scene.data.hairLayers.length,2);close();
  for(const sign of [-1,1]){
   await open({ax:String(sign*0.95),ay:String(sign*0.6),roll:String(sign*0.03),hair:String(sign*0.08),blink:'0'},'combo-'+(sign<0?'left':'right'));close();
  }
  await open({...fixed,face:'3711'},'manual-ipc-before');
  win.webContents.send('action','blink');
  await win.webContents.executeJavaScript(`new Promise((resolve,reject)=>{const start=performance.now();const tick=()=>{if(__rig.diagnostics().blinkApplied)return resolve();if(performance.now()-start>1500)return reject(Error('Manual blink did not close'));requestAnimationFrame(tick)};tick()})`);
  const closed=await state();assert.ok(closed.blinkApplied);assert.equal(closed.selectedFace,3711);
  await win.webContents.executeJavaScript(`new Promise(resolve=>{const tick=()=>__rig.diagnostics().blinkApplied?requestAnimationFrame(tick):resolve();tick()})`);
  const opened=await state();assert.equal(opened.selectedFace,3711);report.manualBlink={closed,opened,passed:true};close();
  await open({ax:'0.95',ay:'0.6',roll:'0.03',hair:'0.08',blink:'0'},'hop-before');
  win.webContents.send('action','hop');
  const frames=await win.webContents.executeJavaScript(`(async()=>{const frames=[];for(let i=0;i<44;i++){await new Promise(requestAnimationFrame);if(i%2===0){const d=__rig.diagnostics();frames.push({i,...d,selectedFace:__rig.S.faceId,clock:__rig.S.t,glError:document.getElementById('stage').getContext('webgl2').getError(),png:document.getElementById('stage').toDataURL('image/png')});}}return frames;})()`);
  for(const frame of frames){
   verify(frame);const {png,...data}=frame;assert.ok(png.length>15000);fs.writeFileSync(path.join(out,'hop-'+String(frame.i).padStart(2,'0')+'.png'),Buffer.from(png.split(',')[1],'base64'));report.hopFrames.push(data);
  }
  assert.ok(Math.max(...frames.map(x=>x.hop))>20);assert.equal(frames.at(-1).hop,0);assert.equal(frames.at(-1).squash,0);assert.equal(frames.at(-1).hopActive,false);close();
  assert.ok(report.faultRequests.some(x=>x.mode==='fault-hair')&&report.faultRequests.some(x=>x.mode==='fault-blink'));
  assert.ok(!report.consoleErrors.some(x=>x.message.includes('BOOT_FAIL')));
  assert.equal(report.consoleErrors.filter(x=>x.mode==='normal'&&!x.message.includes('favicon.ico')).length,0);
  report.passed=true;
 }catch(error){report.failure=error.stack;}
 fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(report,null,2));if(win)close();if(server)server.close();clearTimeout(timeout);app.exit(report.passed?0:1);
});
app.on('window-all-closed',()=>{});
