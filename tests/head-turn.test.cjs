'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {binding,materials}=require('../src/character.js'),rig=require('../src/material-rig.js');
const {createDirector}=require('../src/director.js');
const dist=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);

test('yaw carries the skull and jaw with the face without stretching the painted eyes',()=>{
 const points={crown:[298,20],nose:[298,114],chin:[297.4,144.8],left:[245,78],right:[354,78]};
 const report=[];
 for(const lookX of [-1.2,1.2]){
  const pose={referenceMotion:true,lookX},moved=Object.fromEntries(Object.entries(points).map(([id,p])=>[id,rig.deformPoint(p,pose,binding,materials.head)]));
  const dx=Object.fromEntries(Object.entries(moved).map(([id,p])=>[id,p[0]-points[id][0]]));
  for(const id of ['crown','chin','left','right']){
   assert.ok(dx[id]*dx.nose>0,'the whole head must participate in yaw');
   assert.ok(Math.abs(dx[id])>Math.abs(dx.nose)*.5,'facial motion must not leave the skull/jaw behind: '+id);
  }
  assert.ok(Math.abs(dx.nose-(dx.left+dx.right)/2)>.5,'retain depth difference, not only translate the head');
  for(const [a,b] of [[[259,97],[284,97]],[[313,97],[338,97]]]){
   const width=dist(rig.deformPoint(a,pose,binding,materials.head),rig.deformPoint(b,pose,binding,materials.head))/dist(a,b);
   assert.ok(width>.92&&width<1.08,'small yaw must not inflate one eye and pinch the other');
  }
  for(const p of [[240,180],[295,200],[350,180],[265,798]])assert.deepEqual(rig.deformPoint(p,pose,binding,materials.torso),p,'yaw must not drag shoulders or feet');
  report.push({lookX,dx});
 }
 console.log('HEAD_TURN_RELATIONS '+JSON.stringify(report));
});

test('redesigned turn visits both sides, returns, and keeps hair dynamics continuous on cancellation',()=>{
 const d=createDirector({idleAction:'qianhuili',idle:false});
 for(let i=0;i<360;i++)d.advance(1/120);
 assert.equal(d.playAction('lookAround'),true);
 let min=Infinity,max=-Infinity,step=0,last=d.snapshot(),leftHold=0,rightHold=0;
 for(let i=0;i<840;i++){
  const s=d.advance(1/120);min=Math.min(min,s.pose.lookX);max=Math.max(max,s.pose.lookX);
  if(s.referenceMotion.active==='lookAround'&&s.pose.lookX<-.9)leftHold++;
  if(s.referenceMotion.active==='lookAround'&&s.pose.lookX>.9)rightHold++;
  step=Math.max(step,Math.abs(s.pose.lookX-last.pose.lookX));last=s;
 }
 assert.ok(min<-1&&max>1,'both authored directions must be reached');
 assert.ok(leftHold>60&&rightHold>60,'both directions need a readable hold');
 assert.ok(step<.04,'direction changes must pass through continuous motion');
 assert.equal(last.referenceMotion.active,null);assert.equal(last.referenceMotion.completed,1);
 assert.ok(Math.abs(last.pose.lookX)<.3);
 d.playAction('lookAround');for(let i=0;i<180;i++)d.advance(1/120);
 const before=d.snapshot().pose;d.cancelIdleAction();assert.deepEqual(d.snapshot().pose,before,'cancel must preserve pose and hair history');
 for(let i=0;i<480;i++)d.advance(1/120);
 assert.ok(Math.abs(d.snapshot().pose.lookX)<.3);
});

test('the real head and neck layers cover their connection throughout both turn directions',async()=>{
 const {createHarness}=require('./helpers/interaction-fixtures.cjs'),{pickMaterial}=require('../src/hit-test.js');
 const h=await createHarness({idle:false});
 try{
  let minimum=255;
  for(const lookX of [-1.2,-.6,0,.6,1.2]){
   const pose={referenceMotion:true,lookX,headRoll:-lookX*.025};
   h.renderer.render(pose,'3942',false,0,true);
   const names=[h.meta.head.skin,h.meta.head.neck,h.meta.head.torso];
   const draws=names.map(name=>h.draws.find(d=>d.texture===name));
   const sample=(name,uv)=>{
    const im=h.load(name),x=uv[0]*im.width-.5,y=uv[1]*im.height-.5,ix=Math.floor(x),iy=Math.floor(y),fx=x-ix,fy=y-iy;
    let a=0;for(let j=0;j<2;j++)for(let i=0;i<2;i++)a+=im.data[(Math.max(0,Math.min(im.height-1,iy+j))*im.width+Math.max(0,Math.min(im.width-1,ix+i)))*4+3]*(i?fx:1-fx)*(j?fy:1-fy);
    return a;
   };
   for(const lateral of [-3,0,3]){
    const jaw=rig.deformPoint([297.4+lateral,141],pose,binding,materials.head);
    const neck=rig.deformPoint([298.2+lateral,157],pose,binding,materials.neck);
    for(let i=0;i<=32;i++){
     const point=jaw.map((v,k)=>v+(neck[k]-v)*i/32);let alpha=0;
     for(const draw of draws){
      const uv=pickMaterial({rest:draw.uv,indices:draw.indices},draw.positions,point);if(!uv)continue;
      let a=sample(draw.texture,uv);if(draw.texture===h.meta.head.skin)a=Math.min(255,a+sample(h.meta.head.cover,uv));
      alpha=a+alpha*(1-a/255);
     }
     // Three complementary filtered layers can have alpha=.704 even at rest
     // under alpha-over. Detect extra separation, not nearest-texel rounding.
     minimum=Math.min(minimum,alpha);assert.ok(alpha>178,'head/neck connection separates '+JSON.stringify({lookX,point,alpha}));
    }
   }
  }
  console.log('HEAD_NECK_CONNECTION '+JSON.stringify({directions:5,pathsPerDirection:3,samplesPerPath:33,minimumAlpha:minimum}));
 }finally{h.runtime.destroy();}
});

test('skin and collar share the same neck connection while the shoulders stay on the body',()=>{
 for(const lookX of [-1.2,1.2])for(const y of [140,145,150,155,160,166])for(const x of [282,291,301,311]){
  const p=[x,y],pose={referenceMotion:true,lookX,lookY:.5,headRoll:.035,headY:.003,bodyRoll:.015,breath:.5};
  assert.deepEqual(rig.deformPoint(p,pose,binding,materials.neck),rig.deformPoint(p,pose,binding,materials.torso),'a material cut must not split one anatomical join');
 }
});
