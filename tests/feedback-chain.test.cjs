'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{EventEmitter}=require('node:events');
const {createHarness,root}=require('./helpers/interaction-fixtures.cjs');
const {harness,settle}=require('./feedback-shell.test.cjs');
// Existing production modules connected end-to-end. Only native/DOM/GL surfaces
// are faked. This is NOT an Electron visibility, focus or GPU result.
test('I10 complete material-hit -> expression/render -> configured speech -> preload -> trusted shell -> bubble chain',async t=>{
 const customHand='弟弟，'+ '姐姐在这里。'.repeat(16);
 const native=harness(),h=await createHarness({idle:false,responseConfig:{lines:{hand:customHand}}});t.after(()=>{h.runtime.destroy();native.dispose();});await native.shell.ready;
 const mainIPC=new EventEmitter(),bubbleIPC=new EventEmitter(),api={};
 mainIPC.send=(channel,...args)=>native.electron.ipcMain.emit(channel,native.event(),...args);
 const preload=(file,ipc)=>vm.runInNewContext(fs.readFileSync(path.join(root,file),'utf8'),{process:{isMainFrame:true},require:name=>{assert.equal(name,'electron');return {ipcRenderer:ipc,contextBridge:{exposeInMainWorld:(name,value)=>api[name]=value}};}});
 preload('desktop-preload.cjs',mainIPC);preload('feedback-preload.cjs',bubbleIPC);
 h.pet.feedback=api.pet.feedback;
 const card={hidden:true},text={textContent:''},win={feedback:api.feedback,addEventListener(){}};
 vm.runInNewContext(fs.readFileSync(path.join(root,'src/feedback-view.js'),'utf8'),{window:win,document:{getElementById:id=>id==='feedback-card'?card:text}});
 const oldSend=native.shell.window.webContents.send;
 native.shell.window.webContents.send=(channel,...args)=>{oldSend(channel,...args);mainIPC.emit(channel,{},...args);if(channel==='action')h.action(args[0]);};
 h.runtime.start();const p=h.css([784*530/2612,1814*800/3941]);
 h.emit(h.canvas,'pointerdown',p);h.emit(h.win,'pointermove',{...p,clientX:p.clientX+12});
 const bubble=native.bubble();assert.ok(bubble,'runtime must reach actual shell factory');
 const childSend=bubble.webContents.send;bubble.webContents.send=(channel,...args)=>{childSend(channel,...args);bubbleIPC.emit(channel,{},...args);};
 await settle();assert.equal(card.hidden,false);assert.equal(text.textContent,customHand);
 const first=bubble.messages.at(-1)[1].id,n=bubble.messages.length;h.tick(20);assert.equal(bubble.messages.length,n,'RAF must not resend');
 assert.equal(h.runtime.status().renderedFace,'3901');assert.equal(h.runtime.status().motion.expression.semantic,'smile');
 native.advance(3400);h.tick(210);assert.equal(card.hidden,false,'configured readable duration must survive the old fixed deadline');
 assert.equal(h.runtime.status().motion.expression,null);assert.equal(h.runtime.status().renderedFace,'3942','face recovers independently of long speech');
 h.emit(h.win,'pointerup',{...p,buttons:0});h.emit(h.win,'blur');assert.equal(card.hidden,true);assert.equal(text.textContent,'');
 // Resetting the director on idle changes must not reset transport identities.
 h.action('idle:on');h.action('idle:off');const chest=h.css([295,222]);h.emit(h.canvas,'pointerdown',chest);h.emit(h.win,'pointerup',{...chest,buttons:0});await settle();
 assert.equal(card.hidden,false);assert.equal(text.textContent,'姆，弟弟你这个色鬼。');assert.ok(bubble.messages.at(-1)[1].id>first);
 native.shell.hide();assert.equal(card.hidden,true);assert.equal(h.runtime.status().motion.bubble,null);native.shell.show();h.tick(2);assert.equal(card.hidden,true);
 const head=h.css([298.2,80]);h.emit(h.canvas,'pointerdown',head);h.emit(h.win,'pointermove',{...head,clientX:head.clientX-12});h.tick(20);h.emit(h.win,'pointerup',{...head,buttons:0});await settle();
 assert.equal(text.textContent,'怎么突然模姐姐的头，是希望姐姐做什么呢。');native.advance(3400);assert.equal(card.hidden,true);assert.equal(text.textContent,'');
 assert.deepEqual(h.errors,[]);assert.equal(bubble.calls.some(c=>['show','showInactive','focus'].includes(c[0])),false,'hidden test never opens a window');
});
