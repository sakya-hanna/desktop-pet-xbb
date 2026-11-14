'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const character=require('../src/character.js'),rig=require('../src/material-rig.js');
const {createDirector}=require('../src/director.js');
const FRONT='skirt-front',RIGHT='skirt-right',LINING='skirt-back-visible-center';
const HANDS=['arm-screen-left','arm-screen-right'],SKIRTS=[FRONT,RIGHT];
const source=id=>JSON.parse(fs.readFileSync(path.join(__dirname,'../assets/baijie-'+id+'.mesh.json'),'utf8'));
const load=s=>rig.importSkirtMesh(s,character.binding,character.grabs);

test('I3 M1: real prepared skirts become independent typed material meshes without rescaling or texture IO',()=>{
  assert.equal(typeof rig.importSkirtMesh,'function');
  const counts={[FRONT]:[2500,4802],[RIGHT]:[3599,6960],[LINING]:[266,468]};
  for(const id of [...SKIRTS,LINING]){
    const s=source(id),before=JSON.stringify(s),p=load(s),m=p.mesh;
    assert.equal(p.id,id);assert.equal(p.target,id===LINING?null:id);assert.deepEqual(p.texture,s.texture);
    assert.equal(m.rest.length,counts[id][0]*2);assert.equal(m.indices.length,counts[id][1]*3);
    for(const [key,input] of Object.entries({rest:s.mesh.vertices.flatMap(v=>v.xy),uv:s.mesh.vertices.flatMap(v=>v.uv),weights:s.mesh.vertices.flatMap(v=>v.weights),indices:s.mesh.triangles.flat()})){
      const Type=key==='indices'?Uint32Array:Float32Array;
      assert.ok(m[key] instanceof Type);assert.deepEqual(m[key],new Type(input),id+' '+key);
    }
    assert.deepEqual(rig.deformMesh(m,{},character.binding),m.rest);
    for(const flag of ['dragEnabled','runtimeIntegrated','artApproved','safeRangeCertified'])assert.equal(s[flag],false);
    m.rest[0]=0;p.texture.source='not-a-resource';
    assert.equal(JSON.stringify(s),before,'the parsed source and its preparation status remain untouched');
  }
});

test('I3 M2: importer rejects wrong identity, domain, UV, weights and invalid/Float32-degenerate topology',()=>{
  assert.equal(typeof rig.importSkirtMesh,'function');
  const bad={
    kind:s=>s.kind='runtime-ready',part:s=>s.part='skirt-unknown',group:s=>s.interactionGroup=RIGHT,
    grabFlag:s=>s.futureGrabTarget=false,certification:s=>s.safeRangeCertified=true,
    canvas:s=>s.mesh.canvas[0]++,sourceCanvas:s=>s.mesh.sourceCanvas[1]++,space:s=>s.mesh.coordinateSpace='source pixels',
    joints:s=>s.mesh.joints.reverse(),root:s=>s.mesh.rootFixedY=0,texture:s=>s.texture.source='../private.png',
    resampled:s=>s.texture.resampled=true,vertices:s=>s.mesh.vertices.pop(),triangles:s=>s.mesh.triangles.pop(),
    finite:s=>s.mesh.vertices[0].xy[0]=Infinity,sparse:s=>delete s.mesh.vertices[0].xy[0],
    uv:s=>s.mesh.vertices[0].uv[0]=0,weightSum:s=>s.mesh.vertices[0].weights=[0.5,0,0],
    weightRange:s=>s.mesh.vertices[0].weights=[1.1,-0.1,0],movingRoot:s=>s.mesh.vertices[0].weights=[0,1,0],
    index:s=>s.mesh.triangles[0][0]=s.mesh.vertices.length,repeated:s=>s.mesh.triangles[0][1]=s.mesh.triangles[0][0],
    reversed:s=>s.mesh.triangles[0].reverse(),duplicate:s=>s.mesh.triangles[1]=s.mesh.triangles[0].slice(),
    floatCollapse:s=>{const [a,b]=s.mesh.triangles[0],v=s.mesh.vertices[b],at=s.mesh.vertices[a].xy;v.xy=[at[0]+1e-7,at[1]];v.uv=v.xy.map((x,i)=>x/s.mesh.canvas[i]);}
  };
  for(const [label,mutate] of Object.entries(bad)){const s=source(FRONT);mutate(s);assert.throws(()=>load(s),/Invalid skirt mesh/,label);}
  assert.throws(()=>load(null),/Invalid skirt mesh/);
  assert.throws(()=>rig.importSkirtMesh(source(FRONT),character.binding,{}),/Invalid skirt mesh/);
});

test('I3 M3: fixed roots are validated in Double and Float32 domains without rejecting old moving lining weights',()=>{
  assert.equal(typeof rig.importSkirtMesh,'function');
  for(const id of [...SKIRTS,LINING]){
    const s=source(id),root=s.mesh.rootFixedY,index=s.mesh.vertices.findIndex(v=>v.xy[1]===root);
    assert.ok(index>=0,'real author grid contains its fixed-root boundary');
    const before=new Float32Array(s.mesh.vertices.flatMap(v=>v.xy)),triangles=JSON.stringify(s.mesh.triangles);
    s.mesh.vertices[index].xy[1]=root+1e-6;
    s.mesh.vertices[index].uv[1]=s.mesh.vertices[index].xy[1]/s.mesh.canvas[1];
    s.mesh.vertices[index].weights=[0,1,0];
    assert.ok(s.mesh.vertices[index].xy[1]>root,'Double input escapes the original fixed boundary');
    assert.equal(Math.fround(s.mesh.vertices[index].xy[1]),Math.fround(root),'Float32 output is still on the fixed boundary');
    assert.deepEqual(new Float32Array(s.mesh.vertices.flatMap(v=>v.xy)),before);
    assert.equal(JSON.stringify(s.mesh.triangles),triangles,'no topology change hides the root counterexample');
    assert.throws(()=>load(s),/Invalid skirt mesh/);
    const real=source(id),out=load(real);
    assert.ok(real.mesh.vertices.some(v=>v.weights[1]+v.weights[2]>0),'historical moving weights remain present');
    if(id===LINING)assert.equal(out.target,null,'ownership, not rewritten weights, fixes the lining');
  }
});

test('I3 M4: shared influence drives each skirt and both hands with fixed roots and the unchanged parent transform',()=>{
  assert.equal(typeof rig.grabInfluence,'function');
  const rest=[280,420],deltas=[[11,-7],[-13,8],[18,-14],[-17,12]];
  const ids=[...HANDS,...SKIRTS],pose={grab:Object.fromEntries(ids.map((id,i)=>[id,deltas[i]])),bodyRoll:0.04,headRoll:0.02,bodyX:0.005,hop:0.03};
  for(const id of ids){
    const part=character.grabs[id],ratio=SKIRTS.includes(id)?part.foldRatio:part.elbowRatio;
    for(const w of [[1,0,0],[0,1,0],[0,0,1],[0.2,0.3,0.5]]){
      const k=w[1]*ratio+w[2],delta=pose.grab[id],expected=rest.map((x,i)=>x+delta[i]*k);
      assert.equal(rig.grabInfluence(part,w),k);assert.deepEqual(rig.localPoint(rest,pose,part,w),expected);
      const recovered=rig.unparentPoint(rig.deformPoint(rest,pose,character.binding,part,w),rest,pose,character.binding);
      assert.ok(Math.hypot(...recovered.map((x,i)=>x-expected[i]))<1e-10,'parent at locked rest point is still applied');
    }
  }
  for(const part of [null,{name:LINING,foldRatio:1},{name:'unknown',elbowRatio:1},{name:FRONT,elbowRatio:1}]){
    assert.equal(rig.grabInfluence(part,[0,0,1]),0,'fixed, unknown and malformed parts have no grab influence');
    assert.deepEqual(rig.localPoint(rest,pose,part,[0,0,1]),rest);
  }
  for(const id of SKIRTS){
    const m=load(source(id)).mesh,part=character.grabs[id],out=rig.deformMesh(m,pose,character.binding,part);
    for(const i of [0,m.rest.length/2-1]){
      const at=[...m.rest.subarray(i*2,i*2+2)],w=m.weights.subarray(i*3,i*3+3);
      assert.deepEqual([...out.subarray(i*2,i*2+2)],rig.deformPoint(at,pose,character.binding,part,w).map(Math.fround));
      if(i===0)assert.deepEqual(rig.localPoint(at,pose,part,w),at,'real waist-root weights stay fixed');
      else assert.notDeepEqual(rig.localPoint(at,pose,part,w),at,'real fold/hem receives its local delta');
    }
  }
});

test('I3 M5: fixed lining accepts no grab target and no local pose despite its original moving weights',()=>{
  const p=load(source(LINING)),parent={bodyRoll:0.04,bodyX:0.01,hop:0.02},base=rig.deformMesh(p.mesh,parent,character.binding);
  const all=[...HANDS,...SKIRTS,LINING],d=createDirector({idle:false});
  assert.equal(p.target,null);assert.equal(Object.hasOwn(character.grabs,LINING),false);
  assert.equal(d.send({type:'grab-down',pointerId:7,partId:LINING}),false);
  for(const id of all){
    const pose={...parent,grab:{[id]:[18,-14]}};
    assert.deepEqual(rig.deformMesh(p.mesh,pose,character.binding,character.grabs[p.target]),base,id+' cannot drive the lining');
    assert.deepEqual(rig.deformMesh(p.mesh,pose,character.binding,{name:LINING,foldRatio:0.5}),base);
  }
  assert.notDeepEqual(base,p.mesh.rest,'fixed lining still follows the existing parent');
});

const advance=(d,n=8)=>{for(let i=0;i<n;i++)d.advance(1/60);};
const down=(d,partId,pointerId=7)=>d.send({type:'grab-down',partId,pointerId});
const move=(d,x=12,y=-7,pointerId=7)=>d.send({type:'grab-move',pointerId,x,y});
test('I3 D1: only four bindings, each skirt owns one pointer, bounded release and cancellation without parent reset',()=>{
  assert.deepEqual(Object.keys(character.grabs),[...HANDS,...SKIRTS]);
  for(const id of SKIRTS)assert.deepEqual(character.grabs[id],{name:id,thresholdCss:5,limit:[18,14],foldRatio:0.5,sourceCanvas:[2612,3941]});
  assert.deepEqual(character.grabs[HANDS[0]],{name:HANDS[0],screenSide:'left',characterSide:'right',thresholdCss:5,limit:[24,18],elbowRatio:0.45,sourceCanvas:[2612,3941]});
  assert.deepEqual(character.grabs[HANDS[1]],{name:HANDS[1],screenSide:'right',characterSide:'left',thresholdCss:5,limit:[24,18],elbowRatio:0.4,sourceCanvas:[2612,3941]});
  for(const id of SKIRTS){
    const d=createDirector({idle:true});advance(d,240);
    for(const invalid of [LINING,'unknown','constructor','__proto__',null,[id],{toString:()=>id}])assert.equal(down(d,invalid),false,'only exact registered string identifiers are accepted');
    assert.equal('grab' in d.snapshot().pose,false);assert.equal(down(d,id),true);
    assert.deepEqual(d.snapshot().grab,{partId:id,state:'pending',target:[0,0]});assert.deepEqual(d.snapshot().pose.grab,{[id]:[0,0]});
    assert.equal(down(d,HANDS[0],8),false);assert.equal(d.send({type:'jump'}),false);
    assert.equal(move(d,12,-7,99),false);assert.equal(d.send({type:'grab-cancel',pointerId:99}),false);
    assert.equal(d.send({type:'grab-up',pointerId:7,partId:LINING}),false);
    assert.equal(move(d,180,-140),true);const target=d.snapshot().grab.target;
    assert.ok(Math.abs(Math.hypot(target[0]/18,target[1]/14)-1)<1e-12);advance(d);
    const held=d.snapshot().pose.grab[id].slice();assert.ok(Math.hypot(...held)>1);
    assert.equal(d.send({type:'grab-up',pointerId:7}),true);assert.equal(d.snapshot().pointerId,null);
    assert.deepEqual(d.snapshot().pose.grab[id],held,'normal release must not snap the spring');
    advance(d);assert.ok(Math.hypot(...d.snapshot().pose.grab[id])>0.1);advance(d,240);
    assert.ok(Math.hypot(...d.snapshot().pose.grab[id])<0.001);
    assert.equal(down(d,id,8),true);move(d,12,-7,8);advance(d);const before=d.snapshot();
    assert.equal(d.send({type:'grab-cancel',pointerId:8}),true);const after=d.snapshot();
    assert.equal(after.pointerId,null);assert.equal(after.grab,null);assert.deepEqual(after.pose.grab,{[id]:[0,0]});
    const parent=s=>{const {grab,...pose}=s.pose;return {time:s.time,pose,face:s.face,blink:s.blink,completedGestures:s.completedGestures};};
    assert.deepEqual(parent(after),parent(before));assert.equal(after.bubble,null);
    assert.equal(d.send({type:'jump'}),true);assert.equal(down(d,id,9),false);
  }
});

test('I3 D2: switching hands and skirts preserves every released spring without populating unused targets',()=>{
  for(const [first,second] of [...HANDS.flatMap(hand=>SKIRTS.map(skirt=>[hand,skirt])),[FRONT,RIGHT],[RIGHT,FRONT]]){
    const d=createDirector({idle:false}),control=createDirector({idle:false});
    for(const e of [d,control]){assert.equal(down(e,first),true);move(e);advance(e);e.send({type:'grab-up',pointerId:7});}
    const released=d.snapshot().pose.grab[first].slice();assert.ok(Math.hypot(...released)>1);
    assert.equal(down(d,second,8),true);assert.deepEqual(d.snapshot().pose.grab,{[first]:released,[second]:[0,0]});
    move(d,-10,6,8);
    for(let i=0;i<12;i++){
      advance(d,1);advance(control,1);assert.deepEqual(d.snapshot().pose.grab[first],control.snapshot().pose.grab[first],first+' recoil cannot be cleared or retargeted');
      assert.equal(d.snapshot().time,control.snapshot().time);assert.deepEqual(Object.keys(d.snapshot().pose.grab),[first,second]);
    }
    assert.ok(Math.hypot(...d.snapshot().pose.grab[second])>1);
    d.send({type:'grab-up',pointerId:8});const before=d.snapshot().pose.grab[second].slice();
    assert.equal(down(d,second,9),true);assert.deepEqual(d.snapshot().pose.grab[second],before,'same-target regrab remains continuous');
  }
});

// Core-only fake renderer/DOM; real picking/alpha/input-chain coverage is owned by
// the separate integration test. This never opens a window or sends native input.
function runtimeHarness(selected){
  const vm=require('node:vm'),copy=v=>JSON.parse(JSON.stringify(v));
  function hub(parent=null){return {parent,title:'',listeners:new Map(),addEventListener(t,f){this.listeners.set(t,[...(this.listeners.get(t)||[]),f]);},removeEventListener(t,f){this.listeners.set(t,(this.listeners.get(t)||[]).filter(x=>x!==f));},contains(el){for(;el;el=el.parent)if(el===this)return true;return false;}};}
  const win=hub(),doc=hub(win),canvas=hub(doc),toolbar=hub(doc),buttons=Object.fromEntries(['grip','smaller','larger','menu','hop','hide'].map(id=>[id,hub(toolbar)]));
  const raf=new Map(),actions=new Set(),errors=[],renders=[];let next=0,now=0,capture=null,frame=null,creations=0;
  canvas.getBoundingClientRect=()=>({x:0,y:0,width:530,height:800});toolbar.getBoundingClientRect=canvas.getBoundingClientRect;
  toolbar.querySelector=s=>buttons[s.slice(1)];doc.elementFromPoint=()=>canvas;doc.hidden=false;
  for(const target of [canvas,...Object.values(buttons)]){
    target.setPointerCapture=id=>{capture={target,id};};target.hasPointerCapture=id=>capture?.target===target&&capture.id===id;
    target.releasePointerCapture=id=>{if(target.hasPointerCapture(id)){capture=null;emit(target,'lostpointercapture',{pointerId:id});}};
  }
  const pet={ready(){},getState:()=>({visible:true,idleEnabled:true,clickThrough:false}),onAction:f=>{actions.add(f);return ()=>actions.delete(f);},onState:()=>()=>{},
    ...Object.fromEntries(['drag','resizeBy','setInteractive','menu','command'].map(n=>[n,()=>{}]))};
  const renderer={render(pose,face){frame={frameId:(frame?.frameId||0)+1,viewportId:1};renders.push({pose:copy(pose),face});},frameState:()=>frame,
    hitOpaque:()=>true,hitPart:()=>({...frame,partId:selected,materialPoint:[250,430],influence:0.5}),clientToMaterial:(x,y)=>({point:[x,y]})};
  const context=vm.createContext({window:win,document:doc,CharacterBinding:character,PreviewView:require('../src/view.js'),
    MotionDirector:{createDirector(o){creations++;return createDirector(o);}},requestAnimationFrame:f=>{const id=++next;raf.set(id,f);return id;},cancelAnimationFrame:id=>raf.delete(id)});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../src/desktop-runtime.js'),'utf8'),context);
  const runtime=context.DesktopRuntime.attach({canvas,toolbar,renderer,pet,onError:e=>errors.push(e.message)});
  function emit(target,type,data={}){const event={type,target,pointerId:7,button:0,buttons:1,clientX:250,clientY:430,isTrusted:false,preventDefault(){},...data};for(let el=target;el;el=el.parent)for(const f of [...(el.listeners.get(type)||[])])f(event);}
  function tick(n=1){for(let i=0;i<n;i++){now+=1000/60;const batch=[...raf.values()];raf.clear();for(const f of batch)f(now);}}
  return {runtime,win,canvas,raf,errors,renders,emit,tick,select:id=>{selected=id;},action:name=>{for(const f of actions)f(name);},captured:()=>capture,creations:()=>creations};
}

test('I3 R1: both runtime skirt routes share threshold/RAF, release recoil and blur reset while preserving face and jump',()=>{
  for(const id of SKIRTS){
    const h=runtimeHarness(id);h.runtime.start();h.tick(240);h.action('face:3831');
    h.select(LINING);h.emit(h.canvas,'pointerdown');assert.equal(h.runtime.status().activePointer,null);h.select(id);
    h.emit(h.canvas,'pointerdown');assert.equal(h.runtime.status().pointerKind,'grab-pending');assert.equal(h.runtime.status().motion.grab.partId,id);
    h.emit(h.win,'pointermove',{clientX:255});h.tick(2);assert.equal(h.runtime.status().pointerKind,'grab-pending');
    h.emit(h.win,'pointermove',{clientX:256});h.tick(8);assert.equal(h.runtime.status().pointerKind,'grab');
    const held=h.runtime.status().motion.pose.grab[id].slice();assert.ok(Math.hypot(...held)>1);
    h.emit(h.win,'pointercancel',{pointerId:99});h.action('hop');assert.equal(h.runtime.status().activePointer,7);
    assert.equal(h.raf.size,1);assert.equal(h.creations(),1);h.emit(h.win,'pointerup',{buttons:0});
    assert.equal(h.captured(),null);assert.equal(h.runtime.status().activePointer,null);assert.deepEqual(h.runtime.status().motion.pose.grab[id],held);
    h.tick();assert.notDeepEqual(h.runtime.status().motion.pose.grab[id],held);h.action('hop');h.tick(18);
    const before=h.runtime.status().motion;assert.equal(before.phase,'air');assert.ok(Math.hypot(...before.pose.grab[id])>0.01);
    h.emit(h.win,'blur');const after=h.runtime.status().motion;
    assert.deepEqual(after.pose.grab,{[id]:[0,0]});assert.equal(after.time,before.time);assert.equal(after.phase,before.phase);
    const {grab:a,...parentA}=after.pose,{grab:b,...parentB}=before.pose;assert.deepEqual(parentA,parentB);
    assert.equal(h.runtime.status().renderedFace,'3831');assert.equal(h.renders.at(-1).face,'3831');
    assert.deepEqual(h.renders.at(-1).pose.grab,{[id]:[0,0]});assert.equal(after.bubble,null);assert.equal(after.completedGestures,0);
    h.emit(h.canvas,'pointerdown');assert.equal(h.runtime.status().activePointer,null,'jump still excludes a new grab');
    h.tick(10);assert.deepEqual(h.runtime.status().motion.pose.grab,{[id]:[0,0]});assert.equal(h.raf.size,1);assert.equal(h.creations(),1);
    assert.deepEqual(h.errors,[]);h.runtime.destroy();
  }
});
