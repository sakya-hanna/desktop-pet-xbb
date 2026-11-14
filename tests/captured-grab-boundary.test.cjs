'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createHarness}=require('./helpers/interaction-fixtures.cjs');
const character=require('../src/character.js'),rig=require('../src/material-rig.js');
const own=v=>JSON.parse(JSON.stringify(v));
function contact(h,id){
 if(id==='arm-screen-left')return [784*530/2612,1814*800/3941];
 if(id==='arm-screen-right')return [1828.5*530/2612,1579.5*800/3941];
 const entry=h.meta.interaction.skirts.parts.find(p=>p.id===id),im=h.load(entry.texture),[x0,y0,x1,y1]=h.meta.images[entry.texture].alpha_bbox,aim=[(x0+x1)/2,y1-80];let best=null,distance=Infinity;
 const alpha=(x,y)=>x<0||y<0||x>=im.width||y>=im.height?0:im.data[(y*im.width+x)*4+3];
 for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++){const d=(x-aim[0])**2+(y-aim[1])**2;if(d>=distance||alpha(x,y)<245||![-4,0,4].every(dy=>[-4,0,4].every(dx=>alpha(x+dx,y+dy)>240)))continue;distance=d;best=[x+0.5,y+0.5];}
 assert.ok(best);return best.map((v,i)=>v*character.binding[i?'height':'width']/[im.width,im.height][i]);
}
function begin(h,id,activate=true){
 const p=h.css(rig.deformPoint(contact(h,id),h.runtime.status().motion.pose,character.binding));
 assert.equal(h.renderer.hitPart(p.clientX,p.clientY)?.partId,id,'real alpha/material hit');
 h.emit(h.canvas,'pointerdown',p);assert.equal(h.runtime.status().pointerKind,'grab-pending');
 if(activate){h.emit(h.win,'pointermove',{...p,clientX:p.clientX+12});h.tick(3);assert.equal(h.runtime.status().pointerKind,'grab');}
 return p;
}
function held(h,id){const s=h.runtime.status();assert.equal(s.activePointer,7);assert.equal(s.motion.pointerId,7);assert.equal(s.pointerKind,'grab');assert.equal(h.captured()?.id,7);assert.equal(s.motion.grab.partId,id);assert.equal(s.interactive,true);return s;}
function bounded(h,id){const s=held(h,id),part=character.grabs[id];for(const delta of [s.motion.grab.target,s.motion.pose.grab[id],rig.grabOffset(s.motion.pose,part)]){assert.ok(delta.every(Number.isFinite));assert.ok(Math.hypot(...delta.map((v,i)=>v/part.limit[i]))<=1.000001,'original deformation ellipse');}for(const d of h.draws)assert.ok(d.positions.every(Number.isFinite));return s;}
const speech=h=>h.calls.filter(c=>c[0]==='feedback'&&c[1]).length;
const leaves=[['canvas-pointerleave','canvas','pointerleave'],['window-pointerleave','win','pointerleave'],['window-mouseleave','win','mouseleave'],['window-mouseout','win','mouseout']];
for(const id of ['skirt-front','skirt-right','arm-screen-left','arm-screen-right'])test('I12 boundary '+id+' stays captured outside through long stationary hold then recovers on owner release',async t=>{
 const idle=id==='skirt-front',h=await createHarness({idle});t.after(()=>h.runtime.destroy());h.runtime.start();h.tick(2);begin(h,id);
 const mapped=[],map=h.renderer.clientToMaterial;h.renderer.clientToMaterial=(x,y,...args)=>{mapped.push([x,y]);return map(x,y,...args);};
 const expr=h.runtime.status().motion.expression,outs=[{clientX:-30.8,clientY:200},{clientX:300,clientY:400},{clientX:130,clientY:-40},{clientX:250,clientY:368}];
 for(const p of outs){h.emit(h.win,'pointermove',p);const r=h.rect;assert.deepEqual(mapped.at(-1),[Math.max(r.x,Math.min(p.clientX,r.x+r.width-0.5)),Math.max(r.y,Math.min(p.clientY,r.y+r.height-0.5))],'predictable CSS clamp reaches real material mapping');h.tick(2);bounded(h,id);}
 const outside=outs[0];h.emit(h.win,'pointermove',outside);
 for(const [,target,type]of leaves){h.emit(h[target],type,{...outside,relatedTarget:null});held(h,id);}
 for(let n=0;n<36;n++){h.tick(1,100);bounded(h,id);}
 const state=held(h,id);assert.ok(state.motion.time>3.4);assert.equal(state.motion.expression.id,expr.id);assert.equal(state.motion.expression.semantic,id.startsWith('skirt')?'pout':'smile');assert.equal(state.motion.expression.phase,'hold');
 assert.equal(state.renderedFace,state.motion.expression.face);assert.deepEqual(own(h.renderer.status().faceBlend),[{face:state.renderedFace,weight:1}]);assert.equal(state.motion.bubble,null);assert.equal(speech(h),1);
 const pose=own(state.motion.pose),releaseTime=state.motion.time;h.emit(h.win,'pointerup',{...outside,buttons:0});
 const released=h.runtime.status();assert.equal(released.activePointer,null);assert.equal(released.motion.pointerId,null);assert.equal(h.captured(),null);assert.equal(released.motion.expression.phase,'recover');assert.deepEqual(own(released.motion.pose),pose,'release keeps spring continuity');assert.equal(released.interactive,false);
 h.tick(5,100);assert.equal(h.runtime.status().motion.expression.id,expr.id);assert.equal(h.runtime.status().renderedFace,state.renderedFace);assert.notDeepEqual(own(h.runtime.status().motion.pose.grab[id]),pose.grab[id],'spring recoil advances');
 h.tick(1,100);assert.ok(h.runtime.status().motion.expression,'650ms recovery still active at 600ms');h.tick(1,100);assert.equal(h.runtime.status().motion.expression,null,'recovery ended by 700ms');h.tick(4,100);
 assert.deepEqual(own(h.renderer.status().faceBlend),[{face:h.runtime.status().motion.face,weight:1}]);assert.equal(speech(h),1);assert.equal(h.calls.some(c=>c[0]==='drag'),false);assert.deepEqual(h.errors,[]);
 console.log('I12_RESULT '+JSON.stringify({id,idle,heldTime:releaseTime,expressionId:expr.id,outsideRelease:true,recovery650ms:true,speechCount:speech(h),cancelReasons:own(h.runtime.status().cancelReasons)}));
});
for(const [name,target,type]of leaves)test('I12 notification '+name+' alone cannot end a captured active grab',async t=>{
 const h=await createHarness({idle:false});t.after(()=>h.runtime.destroy());h.runtime.start();begin(h,'skirt-front');h.emit(h[target],type,{clientX:-5,clientY:200,relatedTarget:null});held(h,'skirt-front');assert.deepEqual(h.errors,[]);
});

test('I12 protections: real cancellation still clears outside grab and cannot be revived by late up',async t=>{
 const cases={
  pointercancel:h=>h.emit(h.win,'pointercancel'),lostcapture:h=>h.canvas.releasePointerCapture(7),
  blur:h=>h.emit(h.win,'blur'),hide:h=>h.action('shell:hide'),stop:h=>h.runtime.stop(),
  visibility:h=>{h.doc.hidden=true;h.emit(h.doc,'visibilitychange');},
  buttonsLost:h=>h.emit(h.win,'pointermove',{clientX:-30,buttons:0}),secondaryOnly:h=>h.emit(h.win,'pointermove',{clientX:-30,buttons:2}),
  mouseButtonsLost:h=>h.emit(h.win,'mousemove',{buttons:0}),
  invalidMove:h=>h.emit(h.win,'pointermove',{clientX:NaN}),invalidUp:h=>h.emit(h.win,'pointerup',{clientY:Infinity,buttons:0}),
  viewport:h=>{h.rect.width+=10;h.tick();},dpr:h=>{h.setDpr(2);h.tick();},
  viewportLeave:h=>{h.rect.x+=1;h.emit(h.canvas,'pointerleave',{clientX:-30});},
  dprUp:h=>{h.setDpr(2);h.emit(h.win,'pointerup',{clientX:-30,buttons:0});},
 };
 for(const [name,target,type]of leaves){cases[name+'-buttons-lost']=h=>h.emit(h[target],type,{clientX:-30,buttons:0,relatedTarget:null});cases[name+'-invalid']=h=>h.emit(h[target],type,{clientY:NaN,relatedTarget:null});}
 const results=[];
 for(const [name,trigger]of Object.entries(cases)){
  const h=await createHarness({idle:false});try{h.runtime.start();begin(h,'skirt-front');h.emit(h.win,'pointermove',{clientX:-30});h.tick(3);bounded(h,'skirt-front');assert.ok(h.runtime.status().motion.expression);trigger(h);
   const s=h.runtime.status();assert.equal(s.activePointer,null,name);assert.equal(s.motion.pointerId,null,name);assert.equal(s.motion.expression,null,name);assert.equal(h.captured(),null,name);assert.ok(Object.values(s.motion.pose.grab).flat().every(v=>v===0),name);
   h.emit(h.win,'pointerup',{clientX:-30,buttons:0});h.tick(2);assert.equal(h.runtime.status().motion.expression,null,name+' late up cannot revive');assert.equal(speech(h),1);assert.deepEqual(h.errors,[]);results.push({name,reason:s.cancelReasons.at(-1)});
  }finally{h.runtime.destroy();}
 }
 console.log('I12_RESULT '+JSON.stringify({protections:results}));
});
test('I12 ownership: foreign pointers cannot move, end or replace an outside captured owner',async t=>{
 const h=await createHarness({idle:true});t.after(()=>h.runtime.destroy());h.runtime.start();begin(h,'skirt-right');h.emit(h.win,'pointermove',{clientX:-30});h.tick(3);const before=own(h.runtime.status());
 for(const type of ['pointerdown','pointermove','pointerup','pointercancel','lostpointercapture','pointerleave'])for(const target of [h.canvas,h.win])h.emit(target,type,{pointerId:99,clientX:NaN,clientY:Infinity,buttons:0});
 assert.deepEqual(own(h.runtime.status()),before);held(h,'skirt-right');assert.equal(speech(h),1);
 h.emit(h.win,'pointerup',{clientX:-30,button:2,buttons:1});held(h,'skirt-right');h.emit(h.win,'pointerup',{clientX:-30,button:2,buttons:0});assert.equal(h.runtime.status().activePointer,null);assert.equal(h.runtime.status().motion.expression,null);
});
test('I12 exceptions stay narrow: outside down, pending grab, head, chest and window drag retain cancellation semantics',async t=>{
 const h=await createHarness({idle:false});t.after(()=>h.runtime.destroy());h.runtime.start();
 h.emit(h.canvas,'pointerdown',{clientX:-30});assert.equal(h.runtime.status().activePointer,null);assert.equal(h.captured(),null);
 for(const type of ['pointermove','pointerup','pointerleave','mouseleave','mouseout']){
  begin(h,'skirt-front',false);h.emit(type==='pointerleave'?h.canvas:h.win,type,{clientX:-30,relatedTarget:null,buttons:type==='pointerup'?0:1});assert.equal(h.runtime.status().activePointer,null,type+' pending remains cancelled');assert.equal(h.runtime.status().motion.expression??null,null);assert.equal(speech(h),0);
 }
 for(const type of ['pointermove','pointerup','pointerleave','mouseleave','mouseout']){
  const p=h.renderer.headInputPoint(),at={clientX:p.x,clientY:p.y};assert.equal(h.renderer.hitPart(p.x,p.y)?.partId,'head');h.emit(h.canvas,'pointerdown',at);assert.equal(h.runtime.status().pointerKind,'head');h.emit(type==='pointerleave'?h.canvas:h.win,type,{clientX:-30,relatedTarget:null,buttons:type==='pointerup'?0:1});assert.equal(h.runtime.status().activePointer,null,type+' head remains cancelled');assert.equal(h.runtime.status().motion.completedGestures,0);
 }
 const chest=h.css([295,222]);assert.equal(h.renderer.hitPart(chest.clientX,chest.clientY)?.partId,'chest');h.emit(h.canvas,'pointerdown',chest);assert.equal(h.runtime.status().pointerKind,'chest');h.emit(h.win,'pointerup',{clientX:-30,buttons:0});assert.equal(h.runtime.status().activePointer,null);assert.equal(speech(h),0);
 h.emit(h.buttons.grip,'pointerdown',{clientX:100,clientY:30,screenX:300,screenY:400});assert.equal(h.runtime.status().pointerKind,'drag');h.emit(h.win,'pointermove',{clientX:-30,screenX:310,screenY:405});assert.deepEqual(own(h.calls.filter(c=>c[0]==='drag')),[['drag',10,5]]);h.emit(h.win,'mouseleave',{clientX:-30});assert.equal(h.runtime.status().activePointer,null);
 assert.deepEqual(h.errors,[]);
});
