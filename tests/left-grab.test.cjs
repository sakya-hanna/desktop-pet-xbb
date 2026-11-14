'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {createHarness:handHarness,root,E}=require('./helpers/interaction-fixtures.cjs');
// Keep the established hand cancellation matrix in its original hand-only mode;
// the new skirt integration tests separately exercise the combined scene.
const createHarness=(options={})=>handHarness({...options,mutateManifest:meta=>{meta.interaction.skirts.enabled=false;options.mutateManifest?.(meta);}});
const binding=require('../src/character.js'),rig=require('../src/material-rig.js');
const armName='baijie-arm-screen-left.png';
const material=(x,y)=>[x*530/2612,y*800/3941];
test('I1 H1: live triangles and real alpha pick the arm, while fixed cloth blocks through-grabs',async()=>{
 const h=await createHarness({idle:false});h.runtime.start();
 assert.equal(typeof h.renderer.hitPart,'function','part picking must use the rendered layer stack');
 const palm=h.css(material(784,1814)),hit=h.renderer.hitPart(palm.clientX,palm.clientY);
 assert.equal(hit?.partId,'arm-screen-left');assert.equal(hit.layer,armName);
 assert.ok(Math.hypot(hit.materialPoint[0]-784*530/2612,hit.materialPoint[1]-1814*800/3941)<0.001);
 const blocked=h.css(material(850,1703)),top=h.renderer.hitPart(blocked.clientX,blocked.clientY);
 assert.equal(top?.layer,'baijie-arm-screen-left-cloth.png');assert.equal(top.partId,null);
 const transparent=h.css(material(1176,756));assert.notEqual(h.renderer.hitPart(transparent.clientX,transparent.clientY)?.partId,'arm-screen-left');
 assert.equal(h.load(armName).data[(756*2612+1176)*4+3],0,'real transparent alpha counterexample');
 assert.equal(h.renderer.hitPart(-1,-1),null);
 const mapped=h.renderer.clientToMaterial(palm.clientX,palm.clientY,hit);
 assert.ok(Math.hypot(mapped.point[0]-784*530/2612,mapped.point[1]-1814*800/3941)<0.001,'CSS input is not multiplied by DPR');
 h.runtime.destroy();
});
test('I1 R1: actual runtime down-threshold-drag-release drives the authored palm through the one director and rig',async()=>{
 const h=await createHarness({idle:false});h.runtime.start();const p=h.css(material(784,1814));
 h.emit(h.canvas,'pointerdown',p);
 assert.equal(h.runtime.status().pointerKind,'grab-pending','left palm down must own a pending grab, not a head stroke');
 h.emit(h.win,'pointermove',{...p,clientX:p.clientX+3});h.tick(8);
 const base=h.draws.find(d=>d.texture===armName);assert.deepEqual([...base.positions],[...base.rest]);
 assert.equal(h.runtime.status().pointerKind,'grab-pending');
 h.emit(h.win,'pointermove',{...p,clientX:p.clientX+50,clientY:p.clientY-35});h.tick(90);
 const state=h.runtime.status(),m=h.draws.find(d=>d.texture===armName),delta=state.motion.pose.grab['arm-screen-left'];
 assert.equal(state.pointerKind,'grab');assert.ok(Math.hypot(...delta)>15,'must be a visible candidate envelope, not the historical micro-shift');
 assert.ok((delta[0]/24)**2+(delta[1]/18)**2<=1.000001);
 const src=JSON.parse(fs.readFileSync(path.join(root,'assets/baijie-arm-screen-left.mesh.json'))),mesh=rig.authoredMesh(src,binding.binding),part=binding.grabs['arm-screen-left'];
 assert.deepEqual(m.positions,rig.deformMesh(mesh,state.motion.pose,binding.binding,part),'actual drawing combines the common parent with the independent left grab');
 let palm=0,roots=0;
 for(let i=0;i<src.vertices.length;i++){const v=src.vertices[i],rest=[mesh.rest[i*2],mesh.rest[i*2+1]],local=rig.localPoint(rest,state.motion.pose,part,mesh.weights.subarray(i*3,i*3+3));if(v.xy[1]>=1703){palm++;assert.ok(Math.abs(local[0]-rest[0]-delta[0])<0.0001);assert.ok(Math.abs(local[1]-rest[1]-delta[1])<0.0001);}if(v.weights[0]===1){roots++;const parent=rig.deformPoint(rest,state.motion.pose,binding.binding);assert.equal(m.positions[i*2],Math.fround(parent[0]));assert.equal(m.positions[i*2+1],Math.fround(parent[1]));}}
 assert.ok(palm>0&&roots>0);assert.equal(h.raf.size,1);assert.equal(h.calls.filter(x=>x[0]==='drag').length,0);
 const moved=h.css(rig.deformPoint(material(784,1814),state.motion.pose,binding.binding,part,[0,0,1]));const movedHit=h.renderer.hitPart(moved.clientX,moved.clientY);assert.equal(movedHit?.layer,'baijie-arm-screen-left-cloth.png','up/right extreme is correctly behind fixed lace');assert.equal(movedHit.partId,null);
 h.emit(h.win,'pointermove',{...p,clientX:p.clientX-30,clientY:p.clientY+8});h.tick(90);
 const visible=h.css(rig.deformPoint(material(784,1814),h.runtime.status().motion.pose,binding.binding,part,[0,0,1]));
 assert.equal(h.renderer.hitPart(visible.clientX,visible.clientY)?.partId,'arm-screen-left','outward moved palm uses this frame geometry');
 h.emit(h.win,'pointerup',{...p,buttons:0});assert.equal(h.runtime.status().activePointer,null);assert.equal(h.runtime.status().motion.bubble,null);assert.equal(h.runtime.status().motion.completedGestures,0);
 h.tick(150);assert.ok(Math.hypot(...h.runtime.status().motion.pose.grab['arm-screen-left'])<0.001);assert.equal(h.captured(),null);h.runtime.destroy();
});
test('I1 R2: every existing cancellation exit revokes the same grab owner and resets real rendered local geometry',async()=>{
 const cases={
  pointercancel:h=>h.emit(h.win,'pointercancel'),lostcapture:h=>h.emit(h.canvas,'lostpointercapture'),
  buttons:h=>h.emit(h.win,'pointermove',{buttons:0}),invalidMove:h=>h.emit(h.win,'pointermove',{clientX:NaN}),invalidUp:h=>h.emit(h.win,'pointerup',{clientX:NaN,buttons:0}),
  blur:h=>h.emit(h.win,'blur'),hidden:h=>{h.doc.hidden=true;h.emit(h.doc,'visibilitychange');},stop:h=>h.runtime.stop(),destroy:h=>h.runtime.destroy(),
  longFrame:h=>h.tick(1,500),windowLeaveButtonsLost:h=>h.emit(h.win,'mouseleave',{buttons:0}),shellHide:h=>h.action('shell:hide'),clickThrough:h=>h.state({clickThrough:true}),captureThrow:()=>{},captureSilent:()=>{}
 };
 for(const [name,trigger]of Object.entries(cases)){
  const h=await createHarness({idle:false,captureFailure:name==='captureThrow',captureSilent:name==='captureSilent'});h.runtime.start();h.action('face:3831');const p=h.css(material(784,1814));h.emit(h.canvas,'pointerdown',p);
  if(!name.startsWith('capture')){h.emit(h.win,'pointermove',{...p,clientX:p.clientX-20});h.tick(12);assert.equal(h.runtime.status().motion.pointerId,7,name);
   for(const type of ['pointercancel','lostpointercapture'])h.emit(h.win,type,{pointerId:99});assert.equal(h.runtime.status().motion.pointerId,7,'foreign pointer must not cancel '+name);
  }
  trigger(h);const s=h.runtime.status();assert.equal(s.activePointer,null,name+' runtime owner');assert.equal(s.motion.pointerId,null,name+' director owner');assert.equal(s.motion.grab,null,name+' local target');assert.deepEqual([...s.motion.pose.grab['arm-screen-left']],[0,0],name+' cancelled local pose');
  const drawn=h.draws.find(d=>d.texture===armName);for(let i=0;i<drawn.positions.length;i+=2){const expected=rig.deformPoint([drawn.rest[i],drawn.rest[i+1]],s.motion.pose,binding.binding,binding.grabs['arm-screen-left']);assert.ok(Math.hypot(drawn.positions[i]-expected[0],drawn.positions[i+1]-expected[1])<0.0001,name+' rendered restore');}
  assert.equal(s.renderedFace,'3831');assert.equal(s.motion.bubble,null);assert.equal(s.motion.completedGestures,0);assert.equal(h.captured(),null);
  h.emit(h.win,'pointermove',{...p,clientX:p.clientX+30});h.emit(h.win,'pointerup',{...p,buttons:0});assert.equal(h.runtime.status().activePointer,null);assert.equal(h.runtime.status().motion.pointerId,null);assert.equal(h.calls.some(c=>c[0]==='drag'),false);h.runtime.destroy();
 }
});
test('I1 R3: viewport/DPR/frame generations reject stale picks and cancel held grabs even without pointer movement',async()=>{
 for(const change of [h=>{h.rect.x+=2;},h=>{h.rect.width+=20;},h=>{h.rect.height+=10;},h=>h.setDpr(2)]){
  const h=await createHarness({idle:false});h.runtime.start();const p=h.css(material(784,1814)),old=h.renderer.hitPart(p.clientX,p.clientY);h.emit(h.canvas,'pointerdown',p);h.emit(h.win,'pointermove',{...p,clientX:p.clientX-20});h.tick(8);change(h);
  assert.equal(h.renderer.hitPart(p.clientX,p.clientY),null,'old rendered viewport is unusable');assert.equal(h.renderer.hitOpaque(p.clientX,p.clientY),false);
  h.tick();assert.equal(h.runtime.status().motion.pointerId,null,'RAF must cancel before painting a new viewport');assert.equal(h.runtime.status().activePointer,null);assert.equal(h.renderer.clientToMaterial(p.clientX,p.clientY,old),null,'old frame token rejected after render');
  assert.deepEqual([...h.runtime.status().motion.pose.grab['arm-screen-left']],[0,0]);h.runtime.destroy();
 }
 const h=await createHarness({idle:false});h.runtime.start();const p=h.css(material(784,1814));h.emit(h.canvas,'pointerdown',p);h.state({bounds:{width:300,height:435}});assert.equal(h.runtime.status().activePointer,null,'shell resize generation cancels before DOM resize arrives');h.runtime.destroy();
});
test('I1 R4: all four jump phases and pending/active grabs are mutually exclusive through runtime',async()=>{
 for(const phase of ['prepare','air','land','recover']){
  const h=await createHarness({idle:false});h.runtime.start();h.action('hop');for(let i=0;i<90&&h.runtime.status().motion.phase!==phase;i++)h.tick();assert.equal(h.runtime.status().motion.phase,phase);
  const p=h.css(rig.deformPoint(material(784,1814),h.runtime.status().motion.pose,binding.binding));assert.equal(h.renderer.hitPart(p.clientX,p.clientY)?.partId,'arm-screen-left');h.emit(h.canvas,'pointerdown',p);
  assert.equal(h.runtime.status().activePointer,null,'no grab during jump '+phase);assert.equal(h.runtime.status().motion.phase,phase);h.runtime.destroy();
 }
 for(const drag of [false,true]){const h=await createHarness({idle:false});h.runtime.start();const p=h.css(material(784,1814));h.emit(h.canvas,'pointerdown',p);if(drag){h.emit(h.win,'pointermove',{...p,clientX:p.clientX-20});h.tick(10);}const before=h.runtime.status().motion.phase;
  h.action('hop');h.emit(h.buttons.hop,'click',p);assert.equal(h.runtime.status().motion.phase,before,'toolbar cannot cancel a held grab to smuggle in a jump');assert.equal(h.runtime.status().motion.pointerId,7);
  h.emit(h.win,'pointercancel');h.action('hop');assert.equal(h.runtime.status().motion.phase,'prepare','cancelled grab must not deadlock jump');h.runtime.destroy();}
});
test('I1 R5: toolbar foreground wins even when the event target is the character canvas',async()=>{
 const h=await createHarness({idle:false,toolbarHit:true});h.runtime.start();const p=h.css(material(784,1814));assert.equal(h.renderer.hitPart(p.clientX,p.clientY)?.partId,'arm-screen-left');
 h.emit(h.canvas,'pointerdown',p);assert.equal(h.runtime.status().activePointer,null,'toolbar must preempt character hit');
 h.emit(h.buttons.grip,'pointerdown',p);h.emit(h.win,'pointermove',{...p,screenX:320,screenY:410});assert.equal(h.runtime.status().pointerKind,'drag');assert.equal(h.calls.filter(x=>x[0]==='drag').length,1);assert.equal(h.runtime.status().motion.pointerId,null);h.runtime.destroy();
});
test('I1 R6: locked material contact is inverted through the current parent pose rather than using camera delta or head x',async()=>{
 const h=await createHarness({idle:true});h.runtime.start();h.tick(240);h.action('face:3599');
 const at=material(784,1814),p=h.css(rig.deformPoint(at,h.runtime.status().motion.pose,binding.binding)),hit=h.renderer.hitPart(p.clientX,p.clientY);assert.equal(hit.partId,'arm-screen-left');h.emit(h.canvas,'pointerdown',p);
 const destination={...p,clientX:p.clientX-6};h.emit(h.win,'pointermove',destination);h.tick(60);h.emit(h.win,'pointermove',destination);
 const s=h.runtime.status(),rest=hit.materialPoint,part=binding.grabs['arm-screen-left'],pose=s.motion.pose,b=binding.binding;
 const base=rig.deformPoint(rest,pose,b,part),world=h.renderer.clientToMaterial(destination.clientX,destination.clientY).point;
 const smooth=(a,b,v)=>{const t=Math.max(0,Math.min(1,(v-a)/(b-a)));return t*t*t*(t*(t*6-15)+10);};
 // The palm belongs to the torso, outside the neck field. Independently
 // undo squash, weighted body rotation, then breathing width, in reverse order.
 // A single inverse angle misses the reference's blended rotation and scaling.
 const body=1-smooth(...(pose.referenceMotion?b.referenceBodyFade:b.bodyFade),rest[1]);
 const angle=pose.bodyRoll||0,c=pose.referenceMotion?1+(Math.cos(angle)-1)*body:Math.cos(angle*body),sn=pose.referenceMotion?Math.sin(angle)*body:Math.sin(angle*body);
 const expand=smooth(b.breathing.expand[0],b.breathing.expand[1],rest[1])*(1-smooth(b.breathing.expand[2],b.breathing.expand[3],rest[1]));
 const width=1+(pose.breath||0)*b.breathing.width*expand,det=c*c+sn*sn;
 const dx=(world[0]-base[0])/(1-(pose.squash||0)*.5),dy=(world[1]-base[1])/(1+(pose.squash||0));
 const expected=[(c*dx+sn*dy)/det/width/hit.influence,(-sn*dx+c*dy)/det/hit.influence];
 assert.ok(Math.hypot(s.motion.grab.target[0]-expected[0],s.motion.grab.target[1]-expected[1])<0.001,'target must use inverse parent at locked rest weights');
 const mesh=rig.authoredMesh(JSON.parse(fs.readFileSync(path.join(root,'assets/baijie-arm-screen-left.mesh.json'))),binding.binding),positions=rig.deformMesh(mesh,s.motion.pose,binding.binding,part),actual=h.draws.find(d=>d.texture===armName).positions;
 assert.deepEqual([...actual],[...positions],'actual GL vertices use that same rig and saved rest weights');assert.equal(s.renderedFace,'3599');h.runtime.destroy();
});
test('I1 R7: arm contact never impersonates head feedback or accepts head-protocol release',async()=>{
 const h=await createHarness({idle:false});h.runtime.start();const before=h.runtime.status().motion,p=h.css(material(784,1814));h.emit(h.canvas,'pointerdown',p);
 assert.equal(h.runtime.status().motion.face,before.face,'a pending arm press must not borrow head notice expression');
 h.emit(h.win,'pointermove',{...p,clientX:p.clientX+5});h.emit(h.win,'pointerup',{...p,buttons:0});assert.equal(h.runtime.status().motion.bubble,null);assert.equal(h.runtime.status().motion.completedGestures,0);h.runtime.destroy();
 const e=require('../src/director.js').createDirector({idle:false});for(const partId of ['arm-screen-unknown','skirt-unknown','unknown'])assert.equal(e.send({type:'grab-down',pointerId:7,partId}),false);
 e.send({type:'grab-down',pointerId:7,partId:'arm-screen-left'});
 for(const type of ['move','up','cancel'])assert.equal(e.send({type,pointerId:7,x:0.8}),false,'wrong semantic channel '+type);
 for(const event of [{type:'grab-move',pointerId:99,x:10,y:10},{type:'grab-up',pointerId:99},{type:'grab-cancel',pointerId:99},{type:'grab-move',pointerId:7,x:NaN,y:10}])assert.equal(e.send(event),false);
 assert.equal(e.snapshot().pointerId,7);assert.equal(e.snapshot().completedGestures,0);assert.equal(e.send({type:'grab-cancel',pointerId:7}),true);assert.equal(e.send({type:'grab-move',pointerId:7,x:10,y:10}),false);
});
// I1-L1 uses the real runtime/director/renderer and the existing boundary fakes.
const localArm=h=>[...h.runtime.status().motion.pose.grab['arm-screen-left']];
function idleControlAt(time){const control=require('../src/director.js').createDirector({idle:true,seed:17});for(let i=0;i<Math.round(time*120);i++)control.advance(1/120);return control;}
function parentMotion(h,expectedAfterCancel=false){
 const motion=JSON.parse(JSON.stringify(h.runtime.status().motion));
 // These cancellation fixtures run seeded idle plus grabs only. Expected
 // recovery is the untouched idle trajectory, not the pre-cancel reaction.
 // Actual observations always retain every body/hair channel for comparison.
 if(expectedAfterCancel)motion.pose=idleControlAt(motion.time).snapshot().pose;
 delete motion.pose.grab;delete motion.pose.cloth;delete motion.grab;return motion;
}
async function releasedRebound(options={}){
 const h=await createHarness({idle:true,...options});h.runtime.start();h.tick(240);h.action('face:3831');
 const p=h.css(rig.deformPoint(material(784,1814),h.runtime.status().motion.pose,binding.binding));
 assert.equal(h.renderer.hitPart(p.clientX,p.clientY)?.partId,'arm-screen-left');
 h.emit(h.canvas,'pointerdown',p);h.emit(h.win,'pointermove',{...p,clientX:p.clientX-20});
 h.tick(8);const previous=localArm(h);h.tick();const held=localArm(h);
 assert.ok(Math.hypot(...held)>1,'nonzero local position before release');
 assert.ok(Math.hypot(...held.map((v,i)=>v-previous[i]))>0.001,'nonzero local velocity before release');
 h.emit(h.win,'pointerup',{...p,buttons:0});
 assert.equal(h.runtime.status().activePointer,null);assert.equal(h.runtime.status().pointerKind,null);
 assert.equal(h.runtime.status().motion.pointerId,null);assert.equal(h.runtime.status().motion.grab,null);
 assert.equal(h.captured(),null);assert.deepEqual(localArm(h),held,'ordinary release and its lostcapture must not snap to zero');
 h.tick();const released=localArm(h);
 assert.ok(Math.hypot(...released)>1,'residual exists with no pointer');
 assert.ok(Math.hypot(...released.map((v,i)=>v-held[i]))>0.001,'released spring is still moving');
 assert.equal(h.runtime.status().activePointer,null);
 return h;
}
function assertLocalResetDrawn(h){
 const s=h.runtime.status(),drawn=h.draws.find(d=>d.texture===armName);
 assert.deepEqual(localArm(h),[0,0],'cancel must clear the released local spring');
 assert.equal(s.motion.grab,null);assert.equal(s.activePointer,null);assert.equal(s.motion.pointerId,null);
 for(let i=0;i<drawn.positions.length;i+=2){
  const expected=rig.deformPoint([drawn.rest[i],drawn.rest[i+1]],s.motion.pose,binding.binding,binding.grabs['arm-screen-left']);
  assert.ok(Math.hypot(drawn.positions[i]-expected[0],drawn.positions[i+1]-expected[1])<0.0001,'actual GL vertices must contain the restored limb');
 }
 assert.equal(s.renderedFace,'3831');assert.equal(h.renderer.status().face,'3831');
 assert.equal(h.captured(),null);assert.equal(h.calls.some(c=>c[0]==='drag'),false);
}
function assertNoRebound(h){
 assert.equal(h.raf.size,1,'resume uses the existing single RAF');
 for(let i=0;i<20;i++){h.tick();assertLocalResetDrawn(h);assert.equal(h.raf.size,1);}
}
test('I1-L1 menu: normal release then shell cancel and idle hold paints a local reset before the last RAF stops',async()=>{
 const h=await releasedRebound(),before=parentMotion(h,true),frame=h.renderer.frameState().frameId;
 assert.ok(Math.abs(before.pose.headRoll)>0.001,'parent idle pose is nonzero');
 h.action('shell:cancel');h.action('idle:hold');
 assertLocalResetDrawn(h);assert.ok(h.renderer.frameState().frameId>frame,'a reset frame was really drawn without another tick');
 assert.equal(h.raf.size,0);assert.equal(h.runtime.status().running,false);
 assert.deepEqual(parentMotion(h),before,'do not reset parent idle/hair/time or face state');
 const paused=h.renderer.frameState().frameId;h.tick(2);assert.equal(h.renderer.frameState().frameId,paused);
 h.action('idle:release');assert.deepEqual(parentMotion(h),before);assertNoRebound(h);h.runtime.destroy();
});
test('I1-L1 stop: released recoil is drawn reset while an in-flight parent jump and manual face survive repeated stop/start',async()=>{
 const h=await releasedRebound(),control=idleControlAt(h.runtime.status().motion.time),jumpAt=control.snapshot().time;h.action('hop');control.send({type:'jump'});h.tick(18);
 for(let i=0;i<Math.round((h.runtime.status().motion.time-jumpAt)*120);i++)control.advance(1/120);
 assert.equal(h.runtime.status().motion.phase,'air');assert.ok(Math.hypot(...localArm(h))>0.1);
 const before=parentMotion(h),frame=h.renderer.frameState().frameId;before.pose=control.snapshot().pose;
 h.runtime.stop();assertLocalResetDrawn(h);assert.equal(h.raf.size,0);
 assert.ok(h.renderer.frameState().frameId>frame);assert.deepEqual(parentMotion(h),before);
 const stoppedFrame=h.renderer.frameState().frameId;
 h.runtime.stop();h.tick(2);assertLocalResetDrawn(h);assert.equal(h.renderer.frameState().frameId,stoppedFrame);
 h.runtime.start();assert.deepEqual(parentMotion(h),before);h.runtime.start();assertNoRebound(h);h.runtime.destroy();
});
test('I1-L1 hide: action and visible-false state both restore released recoil before hiding and keep it zero on show',async()=>{
 for(const viaState of [false,true]){
  const h=await releasedRebound(),before=parentMotion(h,true),frame=h.renderer.frameState().frameId;
  if(viaState)h.state({visible:false});else h.action('shell:hide');
  assertLocalResetDrawn(h);assert.ok(h.renderer.frameState().frameId>frame);
  assert.equal(h.runtime.status().shellHidden,true);assert.equal(h.raf.size,0);assert.deepEqual(parentMotion(h),before);
  if(viaState)h.state({visible:true});else h.action('shell:show');
  assert.deepEqual(parentMotion(h),before);assertNoRebound(h);h.runtime.destroy();
 }
});
test('I1-L1 destroy: released recoil is drawn reset before teardown and repeated destroy cannot restart or repaint',async()=>{
 const h=await releasedRebound(),before=parentMotion(h,true),frame=h.renderer.frameState().frameId;
 h.runtime.destroy();assertLocalResetDrawn(h);assert.ok(h.renderer.frameState().frameId>frame);
 assert.equal(h.runtime.status().destroyed,true);assert.equal(h.raf.size,0);assert.deepEqual(parentMotion(h),before);
 const ended=h.runtime.status(),lastFrame=h.renderer.frameState().frameId;
 h.runtime.destroy();h.runtime.start();h.action('idle:release');h.action('shell:show');
 h.emit(h.win,'pointermove');h.tick(20);
 assert.deepEqual(h.runtime.status(),ended);assert.equal(h.renderer.frameState().frameId,lastFrame);assert.equal(h.raf.size,0);
});
test('I1-L1 visibility: released recoil is painted reset on document hiding and cannot return after visibility resumes',async()=>{
 const h=await releasedRebound(),before=parentMotion(h,true),frame=h.renderer.frameState().frameId;
 h.doc.hidden=true;h.emit(h.doc,'visibilitychange');
 assertLocalResetDrawn(h);assert.ok(h.renderer.frameState().frameId>frame);
 assert.equal(h.runtime.status().visibilityPaused,true);assert.equal(h.raf.size,0);assert.deepEqual(parentMotion(h),before);
 h.doc.hidden=false;h.emit(h.doc,'visibilitychange');
 assert.deepEqual(parentMotion(h),before);assertNoRebound(h);h.runtime.destroy();
});
test('I1-L1 global exits: blur, click-through, toolbar and direct hold clear released recoil without an owner',async()=>{
 const cases={blur:h=>h.emit(h.win,'blur'),
  clickThrough:h=>h.state({clickThrough:true}),toolbar:h=>h.emit(h.buttons.menu,'click',{buttons:0}),hold:h=>h.action('idle:hold')};
 for(const [name,trigger]of Object.entries(cases)){
  const h=await releasedRebound(),before=parentMotion(h,true),frame=h.renderer.frameState().frameId;
  trigger(h);assertLocalResetDrawn(h);assert.ok(h.renderer.frameState().frameId>frame,name+' paints synchronously');
  assert.deepEqual(parentMotion(h),before,name+' preserves parent timeline');
  assert.equal(h.raf.size,name==='hold'?0:1,name+' adds no loop');
  if(name==='hold')h.action('idle:release');if(name==='clickThrough')h.state({clickThrough:false});
  assertNoRebound(h);h.runtime.destroy();
 }
});
test('I1-L1 ownership: expired and foreign pointer cancellation never gains the global cleanup authority',async()=>{
 const h=await releasedRebound(),released=h.runtime.status(),releasedFrame=h.renderer.frameState().frameId;
 for(const pointerId of [7,99])for(const type of ['pointercancel','lostpointercapture'])h.emit(h.win,type,{pointerId});
 assert.deepEqual(h.runtime.status(),released);assert.equal(h.renderer.frameState().frameId,releasedFrame);
 const p=h.css(rig.deformPoint(material(784,1814),released.motion.pose,binding.binding,binding.grabs['arm-screen-left'],[0,0,1]));
 assert.equal(h.renderer.hitPart(p.clientX,p.clientY)?.partId,'arm-screen-left');
 h.emit(h.canvas,'pointerdown',{...p,pointerId:8});h.emit(h.win,'pointermove',{...p,pointerId:8,clientX:p.clientX-10});h.tick();
 const owned=h.runtime.status(),ownedFrame=h.renderer.frameState().frameId;
 assert.equal(owned.activePointer,8);assert.equal(owned.pointerKind,'grab');
 for(const pointerId of [7,99])for(const type of ['pointercancel','lostpointercapture'])h.emit(h.win,type,{pointerId});
 assert.deepEqual(h.runtime.status(),owned);assert.equal(h.renderer.frameState().frameId,ownedFrame);assert.equal(h.captured().id,8);
 h.emit(h.win,'pointercancel',{pointerId:8});assertLocalResetDrawn(h);assertNoRebound(h);h.runtime.destroy();
});
test('I1-L1 render error: a failing real renderer GL boundary clears recoil without recursive drawing',async()=>{
 for(const duringStop of [false,true]){
  const h=await releasedRebound(),gl=h.canvas.getContext('webgl2'),draw=gl.drawElements,frames=h.runtime.status().renderedFrames;
  let attempts=0;gl.drawElements=()=>{attempts++;throw Error('I1-L1 injected GL draw failure');};
  if(duringStop)h.runtime.stop();else h.tick();
  assert.equal(attempts,1,'cleanup must not recursively retry a broken draw');
  assert.deepEqual(localArm(h),[0,0]);assert.equal(h.runtime.status().motion.grab,null);
  assert.equal(h.runtime.status().motion.pointerId,null);assert.equal(h.runtime.status().activePointer,null);
  assert.equal(h.runtime.status().running,false);assert.equal(h.raf.size,0);
  assert.equal(h.runtime.status().renderedFrames,frames,'failed draw is not a successful reset frame');
  assert.deepEqual([...h.runtime.status().errors],['I1-L1 injected GL draw failure']);
  if(!duringStop)assert.equal(h.runtime.status().cancelReasons.at(-1),'render-error');
  h.tick(2);assert.equal(attempts,1);
  gl.drawElements=draw;h.runtime.start();assertLocalResetDrawn(h);assertNoRebound(h);h.runtime.destroy();
 }
});
test('I1-L1 long frame: released recoil continues with bounded advancement on the existing RAF',async t=>{
 const h=await releasedRebound(),control=await releasedRebound();t.after(()=>{h.runtime.destroy();control.runtime.destroy();});
 const time=h.runtime.status().motion.time,frame=h.renderer.frameState().frameId;
 h.tick(1,500);control.tick(1,100);assert.ok(h.renderer.frameState().frameId>frame);
 assert.deepEqual(h.runtime.status().motion,control.runtime.status().motion);
 assert.deepEqual(h.draws.find(d=>d.texture===armName).positions,control.draws.find(d=>d.texture===armName).positions);
 assert.ok(h.runtime.status().motion.time>time);assert.ok(h.runtime.status().motion.time-time<=0.100001);
 assert.equal(h.raf.size,1);
});

test('I1-L1-R1 draw failure after bounded long-frame recovery stops without a second draw',async()=>{
 const h=await releasedRebound(),beforeTime=h.runtime.status().motion.time,frames=h.runtime.status().renderedFrames;
 const gl=h.canvas.getContext('webgl2'),draw=gl.drawElements;let attempts=0;
 gl.drawElements=()=>{attempts++;throw Error('R1 reset draw failed');};
 h.tick(1,500);
 const s=h.runtime.status();
 assert.equal(attempts,1,'failed drawing must not retry in the same RAF');
 assert.ok(s.motion.time>beforeTime&&s.motion.time-beforeTime<=0.100001,'released physics advances once before drawing');
 assert.deepEqual(localArm(h),[0,0]);assert.equal(s.activePointer,null);assert.equal(s.motion.pointerId,null);
 assert.equal(s.running,false);assert.equal(s.wantedRunning,false);assert.equal(h.raf.size,0);
 assert.equal(s.renderedFrames,frames,'failed reset must not be recorded as a successful frame');
 assert.equal(h.renderer.frameState(),null);assert.deepEqual([...h.errors],['R1 reset draw failed']);
 const failedSnapshot=h.runtime.status();h.tick(3);assert.equal(attempts,1);assert.deepEqual(h.runtime.status(),failedSnapshot);
 gl.drawElements=draw;h.runtime.start();assertLocalResetDrawn(h);assertNoRebound(h);h.runtime.destroy();
});
test('long-frame recovery preserves released recoil and a newly selected action',async t=>{
 const h=await releasedRebound();t.after(()=>h.runtime.destroy());
 h.action('motion:hum');h.tick(2);
 const before=h.runtime.status().motion;
 assert.equal(before.referenceMotion.active,'hum');assert.ok(before.feedback);
 assert.ok(Math.hypot(...localArm(h))>0.1);
 h.tick(1,600);
 const after=h.runtime.status().motion;
 assert.ok(Math.hypot(...localArm(h))>0.1,'the released arm is still returning');
 assert.equal(after.referenceMotion.active,'hum');assert.equal(after.feedback.text,before.feedback.text);
 assert.ok(after.time>before.time&&after.time-before.time<=0.100001);
 assert.deepEqual(h.errors,[]);
});
test('I1-L1-R1 real bootstrap fallback destroys synchronously and the failed long RAF cannot draw after destroy',async()=>{
 for(const persistent of [false,true]){
  const h=await releasedRebound({bootstrap:true}),before=parentMotion(h,true),frames=h.runtime.status().renderedFrames;
  assert.equal(h.win.__desktop.status().ready,true,'real bootstrap exposed its ready probe');
  const gl=h.canvas.getContext('webgl2'),clear=gl.clear;let attempts=0;
  gl.clear=(...args)=>{attempts++;if(persistent||attempts===1)throw Error('R1 bootstrap reset failure');return clear(...args);};
  h.tick(1,500);const s=h.runtime.status();
  assert.equal(s.destroyed,true,'actual report -> fallback -> runtime.destroy ran synchronously');
  assert.equal(attempts,1,'count renderer entry attempts, not just errors suppressed after destroy');
  assert.deepEqual(parentMotion(h),before);assert.deepEqual(localArm(h),[0,0]);
  assert.equal(s.running,false);assert.equal(s.wantedRunning,false);assert.equal(h.raf.size,0);
  assert.equal(s.renderedFrames,frames);assert.equal(h.renderer.frameState(),null);
  assert.equal(h.win.__desktop.status().ready,false);assert.equal(h.doc.body.dataset.failed,'true');
  assert.match(h.doc.querySelector('#notice').textContent,/候选未能运行/);assert.equal(h.errors.length,1);assert.match(h.errors[0],/R1 bootstrap reset failure/);
  h.emit(h.buttons.menu,'click',{buttons:0});h.emit(h.buttons.hide,'click',{buttons:0});
  assert.equal(h.calls.filter(c=>c[0]==='menu').length,1,'real fallback menu remains reachable');
  assert.deepEqual(h.calls.filter(c=>c[0]==='command'),[['command','quit']]);
  h.tick(3);h.runtime.start();assert.equal(attempts,1);assert.equal(h.raf.size,0);assert.deepEqual(parentMotion(h),before);
 }
});
async function heldForFailure(options={}){
 const h=await createHarness({idle:true,...options});h.runtime.start();h.tick(40,100);h.action('face:3831');
 const p=h.css(rig.deformPoint(material(784,1814),h.runtime.status().motion.pose,binding.binding));
 assert.equal(h.renderer.hitPart(p.clientX,p.clientY)?.partId,'arm-screen-left');
 h.emit(h.canvas,'pointerdown',p);h.emit(h.win,'pointermove',{...p,clientX:p.clientX-20});h.tick(8);
 assert.equal(h.runtime.status().pointerKind,'grab');assert.ok(Math.hypot(...localArm(h))>1);assert.equal(h.captured().id,7);
 return h;
}
function parentTimeline(h,expectedAfterCancel=false){const m=parentMotion(h,expectedAfterCancel);delete m.pointerId;delete m.phase;return m;}
function failingClear(h,persistent=true){
 const gl=h.canvas.getContext('webgl2'),clear=gl.clear;let attempts=0;
 gl.clear=(...args)=>{attempts++;if(persistent||attempts===1)throw Error('R1 boundary reset failure');return clear(...args);};
 return {attempts:()=>attempts,restore:()=>{gl.clear=clear;}};
}
function assertFailedStop(h,before,frames,failure){
 const s=h.runtime.status();assert.equal(failure.attempts(),1,'invalidated caller must not retry renderer');
 assert.deepEqual(parentTimeline(h),before,'invalidated caller must preserve parent timeline');
 assert.deepEqual(localArm(h),[0,0]);assert.equal(s.activePointer,null);assert.equal(s.motion.pointerId,null);assert.equal(h.captured(),null);
 assert.equal(s.running,false);assert.equal(s.wantedRunning,false);assert.equal(h.raf.size,0);assert.equal(s.renderedFrames,frames);
 h.tick(2);assert.equal(failure.attempts(),1);assert.deepEqual(parentTimeline(h),before);
}
test('I1-L1-R1 held viewport cancellation in RAF stops before advance when reset drawing fails',async()=>{
 const h=await heldForFailure(),before=parentTimeline(h,true),frames=h.runtime.status().renderedFrames,failure=failingClear(h);
 h.rect.width+=10;h.tick();assertFailedStop(h,before,frames,failure);
 failure.restore();h.runtime.start();assertLocalResetDrawn(h);assertNoRebound(h);h.runtime.destroy();
});
test('I1-L1-R1 face render aborts after viewport reset failure but ordinary paused face rendering stays available',async()=>{
 const h=await heldForFailure(),before=parentTimeline(h,true),frames=h.runtime.status().renderedFrames,failure=failingClear(h);
 h.rect.width+=10;h.action('face:3599');assertFailedStop(h,before,frames,failure);
 failure.restore();h.action('face:3831');assert.equal(h.runtime.status().renderedFrames,frames+1);
 assert.equal(h.runtime.status().running,false);assert.equal(h.raf.size,0);assertLocalResetDrawn(h);
 h.runtime.start();assertNoRebound(h);h.runtime.destroy();
});
test('I1-L1-R1 idle change must not rebuild the director or render after cancellation reset fails',async()=>{
 const h=await heldForFailure(),before=parentTimeline(h,true),frames=h.runtime.status().renderedFrames,failure=failingClear(h,false);
 h.action('idle:off');assertFailedStop(h,before,frames,failure);
 failure.restore();h.runtime.destroy();
});
test('I1-L1-R1 shell state transaction stops after failed resize or click-through cancellation',async()=>{
 for(const state of [{clickThrough:true,idleEnabled:false,visible:true},{bounds:{width:300,height:435},idleEnabled:false,visible:true}]){
  const h=await heldForFailure(),before=parentTimeline(h,true),frames=h.runtime.status().renderedFrames,failure=failingClear(h,false);
  h.state(state);assertFailedStop(h,before,frames,failure);
  failure.restore();h.runtime.destroy();
 }
});
test('I1-L1-R1 toolbar stops before native commands when released reset drawing fails',async()=>{
 for(const id of ['menu','hide','smaller','larger','hop']){
  const h=await heldForFailure();h.emit(h.win,'pointerup',{buttons:0});assert.equal(h.runtime.status().activePointer,null);assert.ok(Math.hypot(...localArm(h))>1);
  const before=parentTimeline(h,true),frames=h.runtime.status().renderedFrames,failure=failingClear(h,false),calls=h.calls.length;
  h.emit(h.buttons[id],'click',{buttons:0});
  assert.equal(h.calls.slice(calls).some(c=>['menu','command','resizeBy'].includes(c[0])),false,'failed toolbar cancellation must not send a command');
  assertFailedStop(h,before,frames,failure);failure.restore();h.runtime.destroy();
 }
});
test('I1-L1-R1 visibility cancellation cannot resume its old tail over an explicit error-callback lifecycle',async()=>{
 for(const next of ['stop','start']){
  let h,afterCallback;h=await heldForFailure({onError:()=>{h.runtime[next]();afterCallback=h.runtime.status();}});
  const before=parentTimeline(h,true),failure=failingClear(h,false);h.doc.hidden=true;h.emit(h.doc,'visibilitychange');
  assert.deepEqual(h.runtime.status(),afterCallback,'old visibility stack must not overwrite the callback lifecycle');
  assert.deepEqual(parentTimeline(h),before);assert.equal(h.raf.size,next==='start'?1:0);assert.equal(failure.attempts(),next==='start'?2:1);
  failure.restore();h.runtime.destroy();
 }
});
test('I1-L1-R1 stale material mapping in RAF cancels through the real renderer without advancing',async()=>{
 for(const bootstrap of [false,true])for(const persistent of [false,true]){
  const h=await heldForFailure({bootstrap}),before=parentTimeline(h,true),frames=h.runtime.status().renderedFrames,failure=failingClear(h,persistent);
  const rect=h.canvas.getBoundingClientRect;let reads=0;
  h.canvas.getBoundingClientRect=()=>{if(++reads===3)h.rect.x+=1;return rect();};
  h.tick();assert.equal(reads,4,'two valid frame reads, stale mapping read, then failed reset draw');
  assertFailedStop(h,before,frames,failure);assert.equal(h.runtime.status().destroyed,bootstrap);
  assert.equal(h.errors.length,1);failure.restore();h.runtime.destroy();
 }
});
test('I1-L1-R1 stale pointermove mapping does not remember input after failed cancellation',async()=>{
 const h=await heldForFailure(),before=parentTimeline(h,true),frames=h.runtime.status().renderedFrames,failure=failingClear(h,false);
 const p=h.css(rig.deformPoint(material(784,1814),h.runtime.status().motion.pose,binding.binding)),rect=h.canvas.getBoundingClientRect;let reads=0;
 h.canvas.getBoundingClientRect=()=>{if(++reads===5)h.rect.x+=1;return rect();};
 h.emit(h.win,'pointermove',{...p,clientX:p.clientX-22});assertFailedStop(h,before,frames,failure);
 assert.equal(h.runtime.status().pointerPosition,null,'invalidated pointermove must not restore cancelled input');
 failure.restore();h.runtime.destroy();
});
test('I1-L1-R1 capture-release error callback invalidates cancellation before its reset draw',async()=>{
 for(const next of ['stop','destroy']){
  let h,afterCallback;h=await heldForFailure({onError:()=>{h.runtime[next]();afterCallback=h.runtime.status();}});
  const before=parentTimeline(h,true),gl=h.canvas.getContext('webgl2'),clear=gl.clear,release=h.canvas.releasePointerCapture;let attempts=0;
  gl.clear=(...args)=>{attempts++;return clear(...args);};
  h.canvas.releasePointerCapture=id=>{release(id);throw Error('R1 release boundary failure');};
  h.action('shell:cancel');
  assert.equal(attempts,0,'obsolete cancellation must not draw after synchronous callback stop/destroy');
  assert.deepEqual(h.runtime.status(),afterCallback);assert.deepEqual(parentTimeline(h),before);assert.equal(h.raf.size,0);
  assert.equal(h.errors.length,1);h.runtime.destroy();
 }
});
test('I1-L1-R1 destruction remains terminal when its failed reset callback explicitly calls start',async()=>{
 let h;h=await heldForFailure({onError:()=>h.runtime.start()});
 const before=parentTimeline(h,true),frames=h.runtime.status().renderedFrames,failure=failingClear(h,false);
 h.runtime.destroy();assertFailedStop(h,before,frames,failure);assert.equal(h.runtime.status().destroyed,true);
 h.runtime.start();assert.equal(failure.attempts(),1);assert.equal(h.raf.size,0);
});
test('I1-L1-R1 viewport and face entry failures use one attempt for transient and persistent standalone/bootstrap errors',async()=>{
 for(const bootstrap of [false,true])for(const persistent of [false,true])for(const viaFace of [false,true]){
  const h=await heldForFailure({bootstrap}),before=parentTimeline(h,true),frames=h.runtime.status().renderedFrames,failure=failingClear(h,persistent);
  h.rect.width+=10;if(viaFace)h.action('face:3599');else h.tick();
  assertFailedStop(h,before,frames,failure);assert.equal(h.runtime.status().destroyed,bootstrap);assert.equal(h.errors.length,1);
  assert.equal(h.renderer.frameState(),null);failure.restore();h.runtime.destroy();
 }
});
test('I1-L1-R1 explicit callback stop or restart owns the new lifecycle and obsolete RAF callbacks cannot advance it',async()=>{
 for(const next of ['stop','start'])for(const trigger of ['long','viewport','stale']){
  let h,afterCallback;h=await heldForFailure({onError:()=>{h.runtime[next]();afterCallback=h.runtime.status();}});
  if(trigger==='long'){h.emit(h.win,'pointerup',{buttons:0});const held=localArm(h);h.tick();assert.ok(Math.hypot(...localArm(h))>1);assert.notDeepEqual(localArm(h),held);}
  const before=parentTimeline(h,true),frames=h.runtime.status().renderedFrames,oldRAF=[...h.raf.values()][0],failure=failingClear(h,false);
  if(trigger==='viewport')h.rect.width+=10;
  if(trigger==='stale'){const rect=h.canvas.getBoundingClientRect;let reads=0;h.canvas.getBoundingClientRect=()=>{if(++reads===3)h.rect.x+=1;return rect();};}
  h.tick(1,trigger==='long'?500:1000/60);
  assert.deepEqual(h.runtime.status(),afterCallback,'old frame must not advance/render over the explicit new lifecycle');
  assert.deepEqual(parentTimeline(h),before);assert.equal(h.runtime.status().renderedFrames,frames+(next==='start'?1:0));
  assert.equal(failure.attempts(),next==='start'?2:1);assert.equal(h.raf.size,next==='start'?1:0);assert.equal(h.errors.length,1);
  oldRAF(9000);assert.deepEqual(h.runtime.status(),afterCallback);assert.equal(h.raf.size,next==='start'?1:0);
  failure.restore();if(next==='start'){h.tick();assert.deepEqual(parentTimeline(h),before);h.tick();assert.ok(h.runtime.status().motion.time>before.time);assertLocalResetDrawn(h);assert.equal(h.raf.size,1);}
  h.runtime.destroy();
 }
});
test('I1-L1-R1 transient released long-frame failure remains stopped until a later explicit start',async()=>{
 const h=await releasedRebound(),before=parentTimeline(h,true),frames=h.runtime.status().renderedFrames,failure=failingClear(h,false);
 h.tick(1,500);assertFailedStop(h,before,frames,failure);
 h.action('idle:release');h.action('shell:show');h.state({visible:true});h.doc.hidden=false;h.emit(h.doc,'visibilitychange');
 assert.equal(h.raf.size,0);assert.equal(h.runtime.status().wantedRunning,false);assert.equal(failure.attempts(),1);
 failure.restore();h.runtime.start();assertLocalResetDrawn(h);assertNoRebound(h);h.runtime.destroy();
});
// Additional invariant verification of already-implemented slices. These are
// not claimed as new RED proofs; original RED/GREEN runs remain immutable.
test('I1 V1: real front hair occludes the arm and unknown/transparent space never acquires a grab',async()=>{
 const h=await createHarness({idle:false});h.runtime.start();const a=h.load(armName),f=h.load('baijie-front-left.png');let found=null;
 for(let y=900;y<1170&&!found;y+=2)for(let x=1040;x<1250&&!found;x+=2){const p=material(x,y),tx=Math.floor(p[0]/0.20299-1040),ty=Math.floor(p[1]/0.20299-760);if(tx>=0&&ty>=0&&tx<f.width&&ty<f.height&&a.data[(y*a.width+x)*4+3]>220&&f.data[(ty*f.width+tx)*4+3]>220)found=h.css(p);}
 assert.ok(found,'real overlapping hair/arm pixels exist');const hit=h.renderer.hitPart(found.clientX,found.clientY);assert.equal(hit.layer,'baijie-front-left.png');assert.notEqual(hit.partId,'arm-screen-left');h.emit(h.canvas,'pointerdown',found);assert.equal(h.runtime.status().activePointer,null);
 for(const p of [h.css([0,0]),{clientX:NaN,clientY:100},{clientX:-1,clientY:-1}]){h.emit(h.canvas,'pointerdown',p);assert.equal(h.runtime.status().activePointer,null);}
 h.runtime.destroy();
});
test('I1 V2: finite candidate envelope keeps every real triangle positive and parent/rest weights immutable',()=>{
 const source=JSON.parse(fs.readFileSync(path.join(root,'assets/baijie-arm-screen-left.mesh.json'))),m=rig.authoredMesh(source,binding.binding),weights=[...m.weights],rest=[...m.rest],part=binding.grabs['arm-screen-left'];
 const parents=[{}, {headRoll:0.065,bodyRoll:-0.0078,bodyY:0.0015},{headRoll:-0.065,bodyRoll:0.0078,bodyY:-0.0015}];let minAreaRatio=Infinity,checked=0,rootMax=0,palmLocalError=0;
 const area=(p,a,b,c)=>(p[b*2]-p[a*2])*(p[c*2+1]-p[a*2+1])-(p[b*2+1]-p[a*2+1])*(p[c*2]-p[a*2]);
 for(const parent of parents)for(const [u,v]of [[0,0],[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[-1,1],[1,-1],[1,1]]){
  const length=Math.max(1,Math.hypot(u,v)),delta=[24*u/length,18*v/length],pose={...parent,grab:{'arm-screen-left':delta}},p=rig.deformMesh(m,pose,binding.binding,part),base=rig.deformMesh(m,parent,binding.binding,part);
  for(let i=0;i<m.indices.length;i+=3){const [a,b,c]=m.indices.subarray(i,i+3),ratio=area(p,a,b,c)/area(m.rest,a,b,c);assert.ok(Number.isFinite(ratio)&&ratio>0);minAreaRatio=Math.min(minAreaRatio,ratio);checked++;}
  for(let i=0;i<source.vertices.length;i++){const v=source.vertices[i];if(v.weights[0]===1)rootMax=Math.max(rootMax,Math.hypot(p[i*2]-base[i*2],p[i*2+1]-base[i*2+1]));if(v.xy[1]>=1703){const local=rig.localPoint([m.rest[i*2],m.rest[i*2+1]],pose,part,m.weights.subarray(i*3,i*3+3));palmLocalError=Math.max(palmLocalError,Math.abs(local[0]-m.rest[i*2]-delta[0]),Math.abs(local[1]-m.rest[i*2+1]-delta[1]));}}
 }
 assert.deepEqual([...m.weights],weights);assert.deepEqual([...m.rest],rest);assert.equal(rootMax,0);assert.ok(palmLocalError<1e-10);
 console.log('I1_GEOMETRY '+JSON.stringify({poses:27,trianglesPerPose:2304,checked,minAreaRatio,rootMax,palmLocalError,notGPU:true}));
});
test('I1 A3: real 06 textures and 1308/2304 authored mesh reach the actual draw path',async()=>{
 const h=await createHarness({idle:false});h.runtime.start();
 const arm=h.draws.find(d=>d.texture===armName);
 assert.ok(arm,'renderer must draw the real independent arm, not the arm baked in the old body');
 assert.equal(arm.positions.length,1308*2);assert.equal(arm.count,2304*3);
 const before=JSON.parse(fs.readFileSync(path.join(E,'before.json'))),f=before.inputs.find(x=>x.path.endsWith('arm-triangle-mesh.json')),source=JSON.parse(fs.readFileSync(path.join(E,f.frozenPath)));
 for(let i=0;i<source.vertices.length;i++){
  const v=source.vertices[i];assert.ok(Math.abs(arm.positions[i*2]-v.xy[0]*530/2612)<0.00004);assert.ok(Math.abs(arm.positions[i*2+1]-v.xy[1]*800/3941)<0.00004);
  assert.ok(Math.abs(arm.uv[i*2]-v.uv[0])<1e-7);assert.ok(Math.abs(arm.uv[i*2+1]-v.uv[1])<1e-7);
 }
 assert.deepEqual([...arm.indices],source.triangles.flat());
 assert.ok(h.draws.find(d=>d.texture==='baijie-arm-screen-left-cloth.png'));
 assert.ok(h.draws.find(d=>d.texture===h.meta.interaction.rightArm.body),'integrated two-arm path uses the body cleaned for both arms');
 assert.equal(h.draws.some(d=>d.texture===h.meta.interaction.leftArm.body),false,'do not redraw the left-only body over the independent right arm');
 assert.equal(h.draws.some(d=>d.texture==='baijie-front-body.png'),false);
 const policy=require('../resource-policy.cjs');
 assert.equal(policy.resolveResource('baijie28://app/assets/baijie-arm-screen-left.mesh.json',root),path.join(root,'assets/baijie-arm-screen-left.mesh.json'));
 assert.equal(policy.resolveResource('baijie28://app/assets/unknown.mesh.json',root),null);
 h.runtime.destroy();
});
