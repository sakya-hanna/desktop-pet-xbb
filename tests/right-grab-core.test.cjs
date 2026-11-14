'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {createDirector} = require('../src/director.js');

test('I2 D1: the shared director accepts the registered screen-right arm', () => {
  const director = createDirector({idle: false});
  assert.equal(director.send({type: 'grab-down', pointerId: 7, partId: 'arm-screen-right'}), true,
    'I2 requires screen-right acceptance; protected I1 R7 still asserts false for this exact input');
});

const character = require('../src/character.js');
const LEFT = 'arm-screen-left', RIGHT = 'arm-screen-right';
test('I2 D2: preserve both hand bindings alongside the newly registered skirt targets', () => {
  assert.deepEqual(Object.keys(character.grabs).sort(), [LEFT, RIGHT, 'skirt-front', 'skirt-right']);
  assert.deepEqual(character.grabs[RIGHT], {name: RIGHT, screenSide: 'right', characterSide: 'left', thresholdCss: 5, limit: [24,18], elbowRatio: 0.4, sourceCanvas: [2612,3941]});
  assert.deepEqual(character.grabs[LEFT], {name: LEFT, screenSide: 'left', characterSide: 'right', thresholdCss: 5, limit: [24,18], elbowRatio: 0.45, sourceCanvas: [2612,3941]});
});
const advance = (d, n=30) => {for(let i=0;i<n;i++) d.advance(1/60);};
const down = (d, partId=RIGHT, pointerId=7) => d.send({type:'grab-down',partId,pointerId});
const move = (d, x=18, y=-9, pointerId=7) => d.send({type:'grab-move',x,y,pointerId});
test('I2 D3: right pending and active snapshots keep the left contract shape and route only right pose', () => {
  const d=createDirector({idle:false});
  assert.equal('grab' in d.snapshot(),false);assert.equal('grab' in d.snapshot().pose,false);
  down(d);assert.deepEqual(d.snapshot().grab,{partId:RIGHT,state:'pending',target:[0,0]});
  assert.equal(d.snapshot().phase,'grab-pending');assert.deepEqual(d.snapshot().pose.grab,{[RIGHT]:[0,0]});
  move(d);advance(d);const s=d.snapshot();
  assert.equal(s.grab.partId,RIGHT);assert.equal(s.grab.state,'active');assert.equal(s.phase,'grab');
  assert.deepEqual(s.grab.target,[18,-9]);assert.deepEqual(Object.keys(s.pose.grab),[RIGHT]);
  assert.ok(s.pose.grab[RIGHT][0]>10);assert.ok(s.pose.grab[RIGHT][1]<-5);
});
test('I2 D4: switching hands preserves independent released positions and velocities on the same timestep', () => {
  for(const [first,second] of [[LEFT,RIGHT],[RIGHT,LEFT]]) {
    const d=createDirector({idle:false}),control=createDirector({idle:false});
    for(const e of [d,control]){down(e,first);move(e);advance(e,8);e.send({type:'grab-up',pointerId:7});}
    const released=d.snapshot().pose.grab[first].slice();assert.ok(Math.hypot(...released)>1);
    assert.equal(down(d,second,8),true);
    assert.deepEqual(d.snapshot().pose.grab[second],[0,0],'new hand cannot inherit previous spring');
    assert.deepEqual(d.snapshot().pose.grab[first],released,'old hand cannot snap or disappear');
    move(d,-8,6,8);
    for(let i=0;i<12;i++) {advance(d,1);advance(control,1);assert.deepEqual(d.snapshot().pose.grab[first],control.snapshot().pose.grab[first]);assert.equal(d.snapshot().time,control.snapshot().time);}
    d.send({type:'grab-up',pointerId:8});const before=d.snapshot().pose.grab[second].slice();
    assert.ok(Math.hypot(...before)>1);down(d,second,9);assert.deepEqual(d.snapshot().pose.grab[second],before,'same-hand regrab stays continuous');
    d.send({type:'grab-up',pointerId:9});advance(d,240);
    assert.ok(Object.values(d.snapshot().pose.grab).every(a=>Math.hypot(...a)<0.001));
  }
});
test('I2 D6: one pointer and target reject foreign owners, wrong channels and illegal identifiers', () => {
  const d=createDirector({idle:false});
  for(const id of ['skirt-unknown','unknown','arm-screen-unknown','constructor','__proto__',null])assert.equal(down(d,id),false);
  for(const id of [-1,1.5,NaN,Infinity,'7'])assert.equal(down(d,RIGHT,id),false);
  down(d);const before=d.snapshot();
  for(const e of [
    {type:'grab-down',pointerId:8,partId:LEFT},{type:'grab-down',pointerId:7,partId:LEFT},
    ...['down','move','up','cancel'].map(type=>({type,pointerId:7,x:0.5})),
    ...['grab-move','grab-up','grab-cancel'].map(type=>({type,pointerId:99,x:8,y:9})),
    {type:'grab-move',pointerId:7,x:NaN,y:1},{type:'grab-move',pointerId:7,x:1,y:Infinity},
    ...['grab-move','grab-up','grab-cancel'].map(type=>({type,pointerId:7,partId:LEFT,x:8,y:9})),
    {type:'jump'}
  ]) {assert.equal(d.send(e),false,JSON.stringify(e));assert.deepEqual(d.snapshot(),before);}
  assert.equal(d.send({type:'grab-cancel',pointerId:7}),true);
  assert.equal(d.send({type:'down',pointerId:8,x:0.5}),true);
  assert.equal(down(d,RIGHT,8),false);assert.equal(d.send({type:'grab-up',pointerId:8}),false);
});
test('I2 D5: right targets use the existing elliptical material-pixel limit', () => {
  const d=createDirector({idle:false});down(d);
  for(const [x,y] of [[240,0],[0,-180],[240,180],[-240,-180],[6,3]]) {
    move(d,x,y);const k=1/Math.max(1,Math.hypot(x/24,y/18));
    assert.deepEqual(d.snapshot().grab.target,[x*k,y*k]);advance(d,90);
    assert.ok(Math.hypot(d.snapshot().pose.grab[RIGHT][0]/24,d.snapshot().pose.grab[RIGHT][1]/18)<=1.000001);
  }
});
const parentState = d => {const s=d.snapshot();delete s.grab;delete s.pose.grab;delete s.pose.cloth;return s;};
test('I2 D7: global cancellation clears both released springs without resetting parent motion or a head owner', () => {
  const d=createDirector({idle:true}),control=createDirector({idle:true});advance(d,240);advance(control,240);
  for(const id of [LEFT,RIGHT]) {down(d,id);move(d);advance(d,8);advance(control,8);const held=d.snapshot().pose.grab[id].slice();d.send({type:'grab-up',pointerId:7});assert.deepEqual(d.snapshot().pose.grab[id],held);}
  assert.ok(Object.values(d.snapshot().pose.grab).every(a=>Math.hypot(...a)>1));
  assert.equal(d.send({type:'jump'}),true);assert.equal(control.send({type:'jump'}),true);advance(d,18);advance(control,18);
  assert.equal(d.snapshot().phase,'air');assert.equal(d.cancelGrab(),true);
  assert.deepEqual(parentState(d),parentState(control),'cancel removes interaction offsets, not independent parent motion');assert.deepEqual(d.snapshot().pose.grab,{[LEFT]:[0,0],[RIGHT]:[0,0]});
  assert.equal(d.cancelGrab(),false);advance(d,120);advance(control,120);assert.deepEqual(d.snapshot().pose.grab,{[LEFT]:[0,0],[RIGHT]:[0,0]});assert.deepEqual(parentState(d),parentState(control));
  down(d);move(d);advance(d,8);advance(control,8);d.send({type:'grab-up',pointerId:7});
  assert.equal(d.send({type:'down',pointerId:9,x:0.5}),true);assert.equal(control.send({type:'down',pointerId:9,x:0.5}),true);assert.equal(d.cancelGrab(),true);assert.equal(d.snapshot().pointerId,9);assert.deepEqual(parentState(d),parentState(control));
});
const rig=require('../src/material-rig.js');
test('I2 M1: right local deformation shares the arm formula with fixed shoulder and rigid wrist', () => {
  const rest=[370,300],pose={grab:{[RIGHT]:[20,-10],[LEFT]:[-9,3]}};
  for(const [weights,k] of [[[1,0,0],0],[[0,1,0],0.4],[[0,0,1],1],[[0.2,0.3,0.5],0.62]]) {
    assert.deepEqual(rig.localPoint(rest,pose,character.grabs[RIGHT],weights),[370+20*k,300-10*k]);
  }
  assert.deepEqual(rig.localPoint(rest,{grab:{[LEFT]:[20,10]}},character.grabs[RIGHT],[0,0,1]),rest);
  assert.deepEqual(rig.localPoint(rest,pose,character.grabs[LEFT],[0,1,0]),[370-9*0.45,300+3*0.45]);
  assert.deepEqual(rig.localPoint(rest,pose,{name:'skirt-unknown',elbowRatio:1},[0,0,1]),rest);
});
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const intakePath=path.join(__dirname,'fixtures/right-hand-runtime-intake.json');
const intake=()=>JSON.parse(fs.readFileSync(intakePath,'utf8'));
const loadRight=source=>rig.importRightHandMeshes(source,character.binding,character.grabs);
test('I2 M2: import prepared right-hand data into independent typed meshes without rescaling or texture IO', () => {
  assert.equal(typeof rig.importRightHandMeshes,'function');
  const source=intake(),before=JSON.stringify(source),out=loadRight(source);
  assert.equal(out.group,RIGHT);assert.equal(out.targetCount,1);
  for(const key of ['dragEnabled','runtimeIntegrated','artApproved','safeRangeCertified'])assert.equal(out[key],false);
  assert.deepEqual(out.parts.map(p=>p.id),['right-arm','right-hand','right-wrist']);
  for(let i=0;i<3;i++) {
    const p=out.parts[i],s=source.parts[i];assert.equal(p.target,RIGHT);assert.deepEqual(p.texture,s.texture);
    assert.equal(p.positionCoordinateSpace,'material-pixels');assert.equal(p.offsetCoordinateSpace,'material-pixels');
    assert.deepEqual(p.jointOrder,['shoulder','elbow','wrist']);assert.equal(p.rigidJoint,s.rigidJoint);assert.equal(p.fixedRootY,s.fixedRootY);
    for(const key of ['rest','uv','weights','indices']){assert.ok(p.mesh[key] instanceof (key==='indices'?Uint32Array:Float32Array));assert.deepEqual([...p.mesh[key]],s.buffers[key]);}
    assert.deepEqual(rig.deformMesh(p.mesh,{},character.binding,character.grabs[RIGHT]),p.mesh.rest);
  }
  assert.equal(JSON.stringify(source),before);out.parts[0].mesh.rest[0]=0;out.parts[0].texture.source='not-a-resource';
  assert.equal(JSON.stringify(source),before,'imported output owns copies');
});
function rejectIntake(mutate,label) {const s=intake();mutate(s);assert.throws(()=>loadRight(s),/Invalid right-hand intake/,label);}
test('I2 M3: import fails closed on group registration, three-part identity, spaces and preparatory metadata', () => {
  for(const value of [null,{},[],{parts:[]}])assert.throws(()=>loadRight(value),/Invalid right-hand intake/);
  for(const [label,mutate] of Object.entries({
    kind:s=>s.kind='other',group:s=>s.group=LEFT,count:s=>s.targetCount=3,
    missing:s=>s.parts.pop(),extra:s=>s.parts.push(s.parts[0]),duplicate:s=>s.parts[1].id=s.parts[0].id,unknown:s=>s.parts[1].id='other',
    target:s=>s.parts[2].target=LEFT,position:s=>s.parts[0].positionCoordinateSpace='source-pixels',offset:s=>s.parts[1].offsetCoordinateSpace='source-pixels',
    joints:s=>s.parts[0].jointOrder.reverse(),sourceCanvas:s=>s.sourceCanvas[0]++,materialCanvas:s=>s.materialCanvas[1]++,
    textureSize:s=>s.parts[1].texture.width++,textureHash:s=>s.parts[0].texture.sha256='invalid',texturePath:s=>s.parts[2].texture.source='../private.png',resampled:s=>s.parts[1].texture.resampled=true
  }))rejectIntake(mutate,label);
  for(const key of ['dragEnabled','runtimeIntegrated','artApproved','safeRangeCertified'])rejectIntake(s=>s[key]=true,key);
  for(const grabs of [{},{[LEFT]:character.grabs[LEFT]},Object.create(character.grabs),{[RIGHT]:{name:LEFT}}])assert.throws(()=>rig.importRightHandMeshes(intake(),character.binding,grabs),/Invalid right-hand intake/);
  assert.throws(()=>rig.importRightHandMeshes(intake(),{...character.binding,width:531},character.grabs),/Invalid right-hand intake/);
  const reordered=intake();reordered.parts.reverse();assert.deepEqual(loadRight(reordered).parts.map(p=>p.id),['right-wrist','right-hand','right-arm']);
});
test('I2 M4: malformed material buffers, full-canvas UVs and normalized weights are rejected before conversion', () => {
  for(const key of ['rest','uv','weights','indices'])for(const value of [null,[],[NaN],[Infinity],['1']])rejectIntake(s=>s.parts[0].buffers[key]=value,key);
  for(const [label,mutate] of Object.entries({
    buffers:s=>delete s.parts[0].buffers,odd:s=>s.parts[0].buffers.rest.pop(),uvLength:s=>s.parts[1].buffers.uv.pop(),weightLength:s=>s.parts[2].buffers.weights.pop(),
    sparse:s=>delete s.parts[0].buffers.rest[0],nonfinite:s=>s.parts[0].buffers.rest[0]=NaN,overflow:s=>s.parts[0].buffers.rest[0]=1e40,
    negativePosition:s=>s.parts[0].buffers.rest[0]=-1,uv:s=>s.parts[0].buffers.uv[0]=1.1,uvLocal:s=>s.parts[0].buffers.uv[0]=0,
    weightSum:s=>s.parts[0].buffers.weights[0]=0.8,weightNegative:s=>s.parts[0].buffers.weights[1]=-0.2,weightNaN:s=>s.parts[0].buffers.weights[2]=NaN
  }))rejectIntake(mutate,label);
});
test('I2 M5: indices and triangulation must survive Float32 conversion without duplicates or lost vertices', () => {
  for(const value of [-1,0.5,4294967296,Number.MAX_SAFE_INTEGER,275])rejectIntake(s=>s.parts[0].buffers.indices[0]=value,'index '+value);
  for(const [label,mutate] of Object.entries({
    repeated:s=>s.parts[0].buffers.indices[1]=0,
    reversed:s=>{const b=s.parts[0].buffers.indices;[b[1],b[2]]=[b[2],b[1]];},
    duplicate:s=>s.parts[0].buffers.indices.splice(3,3,...s.parts[0].buffers.indices.slice(0,3)),
    missing:s=>s.parts[0].buffers.indices.splice(0,3),
    degenerate:s=>{const b=s.parts[0].buffers;b.rest[2]=b.rest[0];b.rest[3]=b.rest[1];b.uv[2]=b.uv[0];b.uv[3]=b.uv[1];},
    floatCollapse:s=>{const b=s.parts[0].buffers;b.rest[2]=b.rest[0]+1e-10;b.rest[3]=b.rest[1];b.uv[2]=b.rest[2]/530;b.uv[3]=b.rest[3]/800;}
  }))rejectIntake(mutate,label);
});
test('I2 M6: root locks and hand-wrist rigidity are enforced before all three meshes share one target', () => {
  rejectIntake(s=>s.parts[0].buffers.weights.splice(0,3,0.99,0.01,0),'moving root');
  for(const part of [1,2])rejectIntake(s=>s.parts[part].buffers.weights.splice(0,3,0,0.1,0.9),'nonrigid wrist');
  for(const [part,key,value] of [[0,'fixedRootY',0],[0,'fixedRootY',NaN],[0,'rigidJoint','wrist'],[1,'fixedRootY',100],[2,'rigidJoint','elbow']])rejectIntake(s=>s.parts[part][key]=value,key);
  const out=loadRight(intake()),pose={grab:{[RIGHT]:[16,-8]},headRoll:0.03,bodyRoll:0.04,bodyX:0.01,hop:0.02};
  let roots=0,wrist=0;
  for(const p of out.parts){
    const deformed=rig.deformMesh(p.mesh,pose,character.binding,character.grabs[p.target]);
    for(let i=0;i<p.mesh.rest.length;i+=2){
      const rest=[p.mesh.rest[i],p.mesh.rest[i+1]],w=[...p.mesh.weights.subarray(i/2*3,i/2*3+3)];
      const local=rig.localPoint(rest,pose,character.grabs[p.target],w),k=w[1]*0.4+w[2];
      assert.deepEqual(local,[rest[0]+16*k,rest[1]-8*k]);
      if(p.id==='right-arm'&&rest[1]<=p.fixedRootY){roots++;assert.deepEqual(local,rest);}
      if(p.id!=='right-arm'){wrist++;assert.deepEqual(w,[0,0,1]);}
      const expected=rig.deformPoint(rest,pose,character.binding,character.grabs[p.target],w);
      assert.deepEqual([...deformed.subarray(i,i+2)],expected.map(Math.fround));
    }
  }
  assert.ok(roots>0&&wrist>0);
});
// Renderer hit/frame IO is an explicit fake. Runtime, director and rig are real.
// No assertion below establishes real renderer picking, GPU or artwork approval.
const own=v=>JSON.parse(JSON.stringify(v));
async function runtimeHarness(options={}) {
  function hub(id,parent=null){return {id,parent,title:'',listeners:new Map(),addEventListener(t,f){this.listeners.set(t,[...(this.listeners.get(t)||[]),f]);},removeEventListener(t,f){this.listeners.set(t,(this.listeners.get(t)||[]).filter(x=>x!==f));},contains(el){for(;el;el=el.parent)if(el===this)return true;return false;}};}
  const win=hub('window'),doc=hub('document',win),canvas=hub('character',doc),toolbar=hub('toolbar',doc),notice=hub('notice',doc);
  const buttons=Object.fromEntries(['grip','smaller','larger','menu','hop','hide'].map(id=>[id,hub(id,toolbar)]));
  const rect={x:0,y:0,width:530,height:800},raf=new Map(),retired=[],calls=[],sent=[],renders=[],mappings=[],errors=[],actions=new Set(),states=new Set();
  let capture=null,next=0,now=0,creations=0,frame=null,viewportId=1,attempts=0,failures=0,stale=false,selected=RIGHT,runtime;
  const hitRest=[370,300],influence=options.influence??0.4,meshes=loadRight(intake()).parts;
  canvas.getBoundingClientRect=()=>({...rect});toolbar.getBoundingClientRect=()=>({...rect,height:30});
  toolbar.querySelector=s=>buttons[s.slice(1)];doc.hidden=false;doc.body={dataset:{}};
  doc.querySelector=s=>({'#character':canvas,'#toolbar':toolbar,'#notice':notice,...Object.fromEntries(Object.entries(buttons).map(([k,v])=>['#'+k,v]))}[s]);
  doc.elementFromPoint=(_x,y)=>y<30?toolbar:canvas;
  for(const target of [canvas,...Object.values(buttons)]){
    target.setPointerCapture=id=>{if(options.captureFailure==='throw')throw Error('capture failed');if(options.captureFailure!=='silent')capture={target,id};};
    target.hasPointerCapture=id=>capture?.target===target&&capture.id===id;
    target.releasePointerCapture=id=>{if(target.hasPointerCapture(id)){capture=null;emit(target,'lostpointercapture',{pointerId:id});}};
  }
  const pet={ready(){},getState:()=>({visible:true,idleEnabled:options.idle!==false,clickThrough:false}),
    onAction:f=>{actions.add(f);return ()=>actions.delete(f);},onState:f=>{states.add(f);return ()=>states.delete(f);},
    ...Object.fromEntries(['drag','resizeBy','setInteractive','menu','command'].map(n=>[n,(...args)=>calls.push([n,...args])]))};
  const renderer={
    render(pose,face){attempts++;if(failures>0){failures--;throw Error('injected renderer failure');}frame={frameId:(frame?.frameId||0)+1,viewportId,pose:own(pose)};renders.push({pose:own(pose),face,parts:meshes.map(p=>({id:p.id,positions:rig.deformMesh(p.mesh,pose,character.binding,character.grabs[p.target])}))});},
    frameState:()=>frame&&({...frame,viewportId}),status:()=>({ready:true,renderedFrames:renders.length}),hitOpaque:()=>true,hitTest:()=>false,
    hitPart:()=>frame&&({partId:selected,materialPoint:hitRest.slice(),influence,frameId:frame.frameId,viewportId}),
    clientToMaterial(x,y,token=frame,hit){
      mappings.push({x,y,token:own(token),hit:hit&&own(hit)});
      if(stale||!frame||token?.frameId!==frame.frameId||token?.viewportId!==viewportId)return null;
      return {point:hit?rig.unparentPoint([x,y],hit.materialPoint,frame.pose,character.binding):[x,y]};
    }
  };
  const context=vm.createContext({window:win,document:doc,console:{error:(...args)=>errors.push(args.join(' '))},CharacterBinding:character,PreviewView:require('../src/view.js'),
    MotionDirector:{createDirector(config){creations++;const d=createDirector(config);return {...d,send(e){sent.push({...e});return d.send(e);}};}},
    requestAnimationFrame:f=>{const id=++next;raf.set(id,f);return id;},cancelAnimationFrame:id=>{if(raf.has(id))retired.push(raf.get(id));raf.delete(id);}});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../src/desktop-runtime.js'),'utf8'),context,{filename:'src/desktop-runtime.js'});
  if(options.bootstrap){
    win.pet=pet;context.CharacterRenderer={create:async()=>renderer};const attach=context.DesktopRuntime.attach;
    context.DesktopRuntime.attach=o=>(runtime=attach(o));
    await vm.runInContext(fs.readFileSync(path.join(__dirname,'../src/desktop-bootstrap.js'),'utf8'),context,{filename:'src/desktop-bootstrap.js'});
  }else runtime=context.DesktopRuntime.attach({canvas,toolbar,renderer,pet,onError:e=>{errors.push(e.message);options.onError?.(e);}});
  // Deliver initial shell preference before start; changing idle after start is
  // intentionally an existing engine rebuild and is not a grab-side effect.
  if(!options.bootstrap&&options.idle===false)for(const f of states)f({idleEnabled:false});
  function emit(target,type,data={}) {const ev={type,target,pointerId:7,button:0,buttons:1,clientX:370,clientY:300,isTrusted:false,preventDefault(){this.defaultPrevented=true;},...data};for(let el=target;el;el=el.parent)for(const f of [...(el.listeners.get(type)||[])])f(ev);return ev;}
  function tick(n=1,ms=1000/60){for(let i=0;i<n;i++){now+=ms;const batch=[...raf.values()];raf.clear();for(const f of batch)f(now);}}
  return {win,doc,canvas,toolbar,buttons,notice,raf,retired,calls,sent,renders,mappings,errors,runtime,emit,tick,renderer,
    action:name=>{for(const f of [...actions])f(name);},state:s=>{for(const f of [...states])f(s);},captured:()=>capture,creations:()=>creations,attempts:()=>attempts,
    select:id=>{selected=id;},viewport:()=>viewportId++,stale:value=>{stale=value;},fail:n=>{failures=n;}};
}
test('I2 R1: registered right hit enters the real runtime pending grab with its actual part id', async () => {
  const h=await runtimeHarness({idle:false});h.runtime.start();h.emit(h.canvas,'pointerdown');
  const s=h.runtime.status();assert.equal(s.pointerKind,'grab-pending');assert.equal(s.activePointer,7);assert.equal(s.motion.grab.partId,RIGHT);
  assert.equal(h.captured().id,7);assert.equal(h.creations(),1);assert.equal(h.raf.size,1);assert.equal(s.motion.completedGestures,0);assert.equal(s.motion.bubble,null);
  assert.equal(h.sent[0].partId,RIGHT);h.runtime.destroy();
});
test('I2 R2: CSS threshold then current-parent inverse uses the locked right material point and influence', async () => {
  const h=await runtimeHarness();h.runtime.start();h.tick(240);h.action('face:3831');
  const pose=h.runtime.status().motion.pose,p=rig.deformPoint([370,300],pose,character.binding),start={clientX:p[0],clientY:p[1]};
  h.emit(h.canvas,'pointerdown',start);h.select(LEFT);
  h.emit(h.win,'pointermove',{...start,clientX:p[0]+5});h.tick(2);
  assert.equal(h.runtime.status().pointerKind,'grab-pending');assert.deepEqual(own(h.runtime.status().motion.pose.grab),{[RIGHT]:[0,0]});
  const destination={...start,clientX:p[0]+6};h.emit(h.win,'pointermove',destination);h.tick(30);h.emit(h.win,'pointermove',destination);
  const state=h.runtime.status(),base=rig.deformPoint([370,300],state.motion.pose,character.binding),angle=state.motion.pose.bodyRoll;
  const dx=destination.clientX-base[0],dy=destination.clientY-base[1],x=(dx*Math.cos(angle)+dy*Math.sin(angle))/0.4,y=(-dx*Math.sin(angle)+dy*Math.cos(angle))/0.4;
  const k=1/Math.max(1,Math.hypot(x/24,y/18)),actual=state.motion.grab.target;
  assert.ok(Math.hypot(actual[0]-x*k,actual[1]-y*k)<1e-9);assert.equal(state.motion.grab.partId,RIGHT);
  const maps=h.mappings.filter(m=>m.hit);assert.ok(maps.length>10);assert.ok(new Set(maps.map(m=>m.token.frameId)).size>10);
  for(const m of maps){assert.deepEqual(m.hit.materialPoint,[370,300]);assert.equal(m.hit.influence,0.4);assert.equal(m.hit.partId,RIGHT);}
  assert.equal(state.renderedFace,'3831');assert.equal(state.motion.bubble,null);assert.equal(state.motion.completedGestures,0);assert.equal(h.creations(),1);assert.equal(h.raf.size,1);
  h.emit(h.win,'pointermove',{clientX:500,clientY:100});h.tick(120);const delta=h.runtime.status().motion.pose.grab[RIGHT];
  assert.ok(Math.hypot(delta[0]/24,delta[1]/18)<=1.000001);assert.equal(h.calls.some(c=>c[0]==='drag'),false);h.runtime.destroy();
});
test('I2 R3: runtime rejects illegal hits and foreign pointer cancellation without changing the right owner', async () => {
  const h=await runtimeHarness({idle:false});h.runtime.start();
  for(const id of ['skirt-unknown','arm-screen-unknown','constructor','__proto__',null]){h.select(id);h.emit(h.canvas,'pointerdown');assert.equal(h.runtime.status().activePointer,null);}
  h.select(RIGHT);h.emit(h.canvas,'pointerdown');h.emit(h.win,'pointermove',{clientX:390});h.tick(8);
  const before=own(h.runtime.status()),frame=h.attempts();h.select(LEFT);
  for(const type of ['pointerdown','pointermove','pointerup','pointercancel','lostpointercapture'])h.emit(type==='pointerdown'?h.canvas:h.win,type,{pointerId:99,clientX:400,buttons:0});
  h.emit(h.canvas,'pointerdown');h.action('hop');h.emit(h.buttons.hop,'click');
  assert.deepEqual(own(h.runtime.status()),before);assert.equal(h.attempts(),frame);assert.equal(h.captured().id,7);
  h.emit(h.win,'pointercancel');assert.equal(h.runtime.status().activePointer,null);assert.deepEqual(own(h.runtime.status().motion.pose.grab[RIGHT]),[0,0]);
  h.select(RIGHT);h.emit(h.canvas,'pointerdown',{pointerId:8});assert.equal(h.runtime.status().activePointer,8);
  h.emit(h.win,'lostpointercapture',{pointerId:7});assert.equal(h.runtime.status().activePointer,8);h.runtime.destroy();
});
const rightDelta=h=>own(h.runtime.status().motion.pose.grab[RIGHT]);
const runtimeParent=h=>parentState({snapshot:()=>own(h.runtime.status().motion)});
async function releasedRight(options={}) {
  const h=await runtimeHarness(options);h.runtime.start();h.tick(240);h.action('face:3831');
  h.emit(h.canvas,'pointerdown');h.emit(h.win,'pointermove',{clientX:390,clientY:288});h.tick(8);
  const previous=rightDelta(h);h.tick();const held=rightDelta(h);assert.ok(Math.hypot(...held)>1);assert.notDeepEqual(held,previous);
  h.emit(h.win,'pointerup',{buttons:0});assert.deepEqual(rightDelta(h),held);assert.equal(h.captured(),null);
  assert.equal(h.runtime.status().motion.grab,null);assert.equal(h.runtime.status().activePointer,null);
  h.tick();assert.ok(Math.hypot(...rightDelta(h))>1);assert.notDeepEqual(rightDelta(h),held);return h;
}
test('I2 R4: ordinary right release retains moving recoil and converges without head feedback', async () => {
  const h=await releasedRight(),released=own(h.runtime.status()),frames=h.attempts();
  for(const type of ['pointercancel','lostpointercapture'])for(const pointerId of [7,99])h.emit(h.win,type,{pointerId});
  assert.deepEqual(own(h.runtime.status()),released);assert.equal(h.attempts(),frames);
  h.tick(240);assert.ok(Math.hypot(...rightDelta(h))<0.001);assert.equal(h.runtime.status().motion.completedGestures,0);
  assert.equal(h.runtime.status().motion.bubble,null);assert.equal(h.runtime.status().renderedFace,'3831');assert.equal(h.creations(),1);assert.equal(h.raf.size,1);
  h.runtime.destroy();
});
function assertRightReset(h) {
  assert.deepEqual(rightDelta(h),[0,0]);const s=h.runtime.status();assert.equal(s.activePointer,null);assert.equal(s.motion.pointerId,null);assert.equal(s.motion.grab,null);assert.equal(h.captured(),null);
  const drawn=h.renders.at(-1);assert.equal(drawn.face,'3831');assert.deepEqual(drawn.pose,s.motion.pose);
  for(const p of loadRight(intake()).parts)assert.deepEqual(drawn.parts.find(x=>x.id===p.id).positions,rig.deformMesh(p.mesh,s.motion.pose,character.binding));
}
test('I2 R5: released recoil is synchronously reset on stop hold hide visibility destroy and global exits', async () => {
  const cases={stop:[h=>h.runtime.stop(),h=>h.runtime.start()],hold:[h=>h.action('idle:hold'),h=>h.action('idle:release')],
    hide:[h=>h.action('shell:hide'),h=>h.action('shell:show')],stateHide:[h=>h.state({visible:false}),h=>h.state({visible:true})],
    visibility:[h=>{h.doc.hidden=true;h.emit(h.doc,'visibilitychange');},h=>{h.doc.hidden=false;h.emit(h.doc,'visibilitychange');}],
    destroy:[h=>h.runtime.destroy()],blur:[h=>h.emit(h.win,'blur')],menu:[h=>{h.action('shell:cancel');h.action('idle:hold');},h=>h.action('idle:release')]};
  for(const [name,[cancel,resume]] of Object.entries(cases)) {
    const h=await releasedRight();h.action('hop');h.tick(18);assert.equal(h.runtime.status().motion.phase,'air');
    assert.ok(Math.hypot(...rightDelta(h))>0.1);const before=runtimeParent(h),frames=h.attempts();cancel(h);
    assertRightReset(h);assert.equal(h.attempts(),frames+1,name+' synchronous reset');assert.deepEqual(runtimeParent(h),before);assert.equal(h.creations(),1);
    if(name==='destroy') {const ended=own(h.runtime.status());h.runtime.start();h.runtime.destroy();h.tick(4);assert.deepEqual(own(h.runtime.status()),ended);assert.equal(h.raf.size,0);}
    else {resume?.(h);assert.deepEqual(runtimeParent(h),before);for(let i=0;i<20;i++){h.tick();assertRightReset(h);}assert.equal(h.raf.size,1);}
    h.runtime.destroy();
  }
});
test('I2 R6: right capture and frame failure gates cancel before stale motion can continue', async () => {
  const cases={viewport:h=>{h.viewport();h.tick();},stale:h=>{h.stale(true);h.tick();},longFrame:h=>h.tick(1,500),
    pointercancel:h=>h.emit(h.win,'pointercancel'),lostcapture:h=>h.emit(h.win,'lostpointercapture'),
    buttons:h=>h.emit(h.win,'pointermove',{buttons:0}),invalidPoint:h=>h.emit(h.win,'pointermove',{clientX:NaN}),
    shellResize:h=>h.state({bounds:{width:540,height:800}}),captureThrow:()=>{},captureSilent:()=>{},
    inputError:h=>{h.renderer.clientToMaterial=()=>{throw Error('map failed');};h.emit(h.win,'pointermove',{clientX:395});},
    frameError:h=>{h.renderer.clientToMaterial=()=>{throw Error('map failed');};h.tick();}};
  for(const [name,trigger] of Object.entries(cases)) {
    const captureFailure=name==='captureThrow'?'throw':name==='captureSilent'?'silent':null;
    const h=await runtimeHarness({idle:false,captureFailure});h.runtime.start();h.action('face:3831');h.emit(h.canvas,'pointerdown');
    if(!captureFailure){h.emit(h.win,'pointermove',{clientX:390});h.tick(8);assert.ok(Math.hypot(...rightDelta(h))>1);}
    trigger(h);assertRightReset(h);assert.equal(h.runtime.status().motion.completedGestures,0);assert.equal(h.creations(),1);
    assert.equal(h.raf.size,name==='frameError'?0:1);h.runtime.destroy();
  }
  const h=await runtimeHarness();h.runtime.start();h.stale(true);h.emit(h.canvas,'pointerdown');
  assert.equal(h.runtime.status().activePointer,null);assert.equal(h.captured(),null);h.runtime.destroy();
});
test('I2 R7: real bootstrap fallback retires the right-grab stack when cancellation reset rendering fails', async () => {
  const triggers={longFrame:h=>h.tick(1,500),viewport:h=>{h.viewport();h.tick();},stale:h=>{h.stale(true);h.tick();},
    releasedStop:h=>h.runtime.stop(),releasedHold:h=>h.action('idle:hold'),releasedHide:h=>h.action('shell:hide'),releasedDestroy:h=>h.runtime.destroy()};
  for(const [name,trigger] of Object.entries(triggers))for(const failureCount of [1,Infinity]) {
    const released=name.startsWith('released');const h=released?await releasedRight({bootstrap:true}):await runtimeHarness({bootstrap:true});
    if(!released){h.action('face:3831');h.emit(h.canvas,'pointerdown');h.emit(h.win,'pointermove',{clientX:390});h.tick(8);}
    assert.ok(Math.hypot(...rightDelta(h))>1);const before=runtimeParent(h),attempts=h.attempts();h.fail(failureCount);trigger(h);
    assert.deepEqual(rightDelta(h),[0,0]);assert.equal(h.captured(),null);assert.equal(h.runtime.status().activePointer,null);
    assert.equal(h.attempts(),attempts+1,name+' does not recursively render');
    const after=runtimeParent(h);
    if(!released){assert.equal(after.pointerId,null);assert.notEqual(after.phase,'grab');delete before.pointerId;delete before.phase;delete after.pointerId;delete after.phase;}
    assert.deepEqual(after,before,name+' no stale advance (ownership is intentionally cleared)');
    assert.equal(h.runtime.status().destroyed,true);assert.equal(h.raf.size,0);assert.equal(h.doc.body.dataset.failed,'true');
    assert.match(h.notice.textContent,/未能运行/);assert.equal(h.errors.length,1);assert.equal(h.win.__desktop.status().ready,false);
    for(const f of h.retired)f(900000);h.tick(3);h.runtime.start();assert.equal(h.attempts(),attempts+1);assert.equal(h.raf.size,0);
  }
});
test('I2 R8: right recoil errors respect explicit restart epochs and cannot revive a destroying runtime', async () => {
  for(const mode of ['stop-restart','frame-restart','stop-destroy','destroy-restart']){
    let h,called=0;h=await releasedRight({onError:()=>{if(called++)return;if(mode==='stop-destroy')h.runtime.destroy();else h.runtime.start();}});
    const before=runtimeParent(h),attempts=h.attempts();h.fail(1);
    if(mode==='frame-restart')h.tick(1,500);else if(mode==='destroy-restart')h.runtime.destroy();else h.runtime.stop();
    assert.deepEqual(runtimeParent(h),before);assert.deepEqual(rightDelta(h),[0,0]);assert.equal(called,1);
    const restarted=mode==='stop-restart'||mode==='frame-restart';assert.equal(h.raf.size,restarted?1:0);assert.equal(h.runtime.status().destroyed,!restarted);
    assert.equal(h.attempts(),attempts+(restarted?2:1));const at=h.attempts();for(const f of h.retired)f(900000);
    assert.equal(h.attempts(),at);assert.equal(h.creations(),1);
    if(restarted){h.tick(3);assertRightReset(h);assert.equal(h.raf.size,1);}else{h.runtime.start();h.tick();assert.equal(h.attempts(),at);}
    h.runtime.destroy();
  }
});
test('I2 R9: right grabbing neither perturbs idle nor bypasses any jump phase', async () => {
  const h=await runtimeHarness(),control=await runtimeHarness();h.runtime.start();control.runtime.start();h.tick(240);control.tick(240);
  h.emit(h.canvas,'pointerdown');h.emit(h.win,'pointermove',{clientX:390});
  for(let i=0;i<30;i++) {h.tick();control.tick();const a=runtimeParent(h),b=runtimeParent(control);assert.deepEqual(a.pose,b.pose);assert.equal(a.time,b.time);assert.equal(a.face,b.face);assert.equal(a.blink,b.blink);}
  h.emit(h.win,'pointerup',{buttons:0});assert.deepEqual(runtimeParent(h),runtimeParent(control));h.runtime.destroy();control.runtime.destroy();
  for(const phase of ['prepare','air','land','recover']){
    const f=await runtimeHarness({idle:false});f.runtime.start();f.action('hop');for(let i=0;i<100&&f.runtime.status().motion.phase!==phase;i++)f.tick();
    assert.equal(f.runtime.status().motion.phase,phase);const before=own(f.runtime.status().motion);f.emit(f.canvas,'pointerdown');
    assert.equal(f.runtime.status().activePointer,null);assert.deepEqual(own(f.runtime.status().motion),before);f.runtime.destroy();
  }
});
test('I2 M7: a registered group must provide a usable right-side material deformation binding', () => {
  for(const patch of [{elbowRatio:NaN},{elbowRatio:-1},{elbowRatio:1.1},{screenSide:'left'},{characterSide:'right'},{sourceCanvas:[530,800]}]){
    const grabs={...character.grabs,[RIGHT]:{...character.grabs[RIGHT],...patch}};
    assert.throws(()=>rig.importRightHandMeshes(intake(),character.binding,grabs),/Invalid right-hand intake/);
  }
});
test('I2 M8: the arm cannot evade fixed-root validation by removing all root-domain vertices', () => {
  rejectIntake(s=>{const b=s.parts[0].buffers;for(let i=1;i<b.rest.length;i+=2){b.rest[i]+=30;b.uv[i]=b.rest[i]/800;}},'root domain absent');
});
test('I2 M9: positive triangles with broken edge incidence are not a valid prepared topology', () => {
  rejectIntake(s=>s.parts[0].buffers.indices[1]=2,'overlapping broken boundary');
  rejectIntake(s=>s.parts[0].buffers.indices[2]=13,'nonmanifold edge');
  const s=intake(),b=s.parts[0].buffers,tri=[];for(let i=0;i<b.indices.length;i+=3)tri.push(b.indices.slice(i,i+3));
  b.indices=tri.reverse().flat();assert.deepEqual([...loadRight(s).parts[0].mesh.indices],b.indices,'triangle order is not topology');
});
test('I2 Q1: parse all four production files and this test with the fixed running Node parser', () => {
  for(const file of ['src/character.js','src/director.js','src/material-rig.js','src/desktop-runtime.js','tests/right-grab-core.test.cjs'])
    assert.doesNotThrow(()=>new vm.Script(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),{filename:file}),file);
});

test('I2 M10: Float32 rounding into the fixed shoulder domain cannot retain moving weights', () => {
  const source=intake(),part=source.parts.find(p=>p.id==='right-arm'),b=part.buffers;
  const originalRest=new Float32Array(b.rest),originalIndices=b.indices.slice(),vertex=33;
  b.rest[67]=162.39533213422988;
  b.uv[67]=0.20299416516778734;
  b.weights.splice(vertex*3,3,0,1,0);
  assert.ok(b.rest[67]>part.fixedRootY,'the Double input lies outside the fixed root');
  assert.ok(Math.fround(b.rest[67])<=part.fixedRootY,'the actual output coordinate lies inside the fixed root');
  assert.deepEqual(new Float32Array(b.rest),originalRest,'all output positions remain exactly the valid fixture positions');
  assert.deepEqual(b.indices,originalIndices,'the counterexample does not alter topology');
  assert.throws(()=>loadRight(source),/Invalid right-hand intake/,'moving root weights must be rejected in the output coordinate domain');
});
