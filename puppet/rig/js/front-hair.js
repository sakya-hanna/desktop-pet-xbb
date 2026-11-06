// Independent source-pixel front-hair sampling; never bends the old body/outer locks.
(function(root){
 'use strict';
 const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
 function gain(y,part){const t=clamp((y-part.root)/(part.tip-part.root),0,1);return t*t*t*(t*(t*6-15)+10);}
 function sampleAlpha(part,alpha,u,v,sourceCanvas,offset){
  if(![u,v,offset].every(Number.isFinite))return 0;
  const [bx,by,bw,bh]=part.sourceBox,[w,h]=part.textureSize;const y=v*sourceCanvas[1];const x=u*sourceCanvas[0]-offset*gain(y,part);
  if(x<bx||x>=bx+bw||y<by||y>=by+bh)return 0;
  const tx=clamp((x-bx)/bw*w-0.5,0,w-1),ty=clamp((y-by)/bh*h-0.5,0,h-1);const x0=Math.floor(tx),y0=Math.floor(ty),x1=Math.min(w-1,x0+1),y1=Math.min(h-1,y0+1),fx=tx-x0,fy=ty-y0;
  return (alpha[y0*w+x0]*(1-fx)+alpha[y0*w+x1]*fx)*(1-fy)+(alpha[y1*w+x0]*(1-fx)+alpha[y1*w+x1]*fx)*fy;
 }
 function validMotion(m){return !!m&&Number.isFinite(m.windGain)&&m.windGain>0&&m.windGain<=1.5&&Number.isFinite(m.stiffness)&&m.stiffness>=40&&m.stiffness<=200&&Number.isFinite(m.damping)&&m.damping>=3.2&&m.damping<=18&&Number.isFinite(m.phaseIndex)&&m.phaseIndex>=0&&m.phaseIndex<=8;}
 function validFollow(m){return !!m&&['left','right'].includes(m.follow)&&Number.isFinite(m.stiffness)&&m.stiffness>=40&&m.stiffness<=200&&Number.isFinite(m.damping)&&m.damping>=3.2&&m.damping<=18;}
 function validate(cfg,canvas){
  const pair=a=>Array.isArray(a)&&a.length===2&&a.every(x=>Number.isInteger(x)&&x>0),file=s=>typeof s==='string'&&/^[a-z0-9-]+\.png$/.test(s);
  if(!cfg||![1,2,3,4].includes(cfg.version)||(cfg.version===4?cfg.motionModel!=='outer-follow-wide-v1':cfg.version===3?cfg.motionModel!=='outer-follow-v1':cfg.version===2?cfg.motionModel!=='reference-wind-v1':cfg.motionModel!=null)||!pair(cfg.canvas)||!pair(cfg.sourceCanvas)||cfg.canvas.some((n,i)=>n!==canvas[i])||!file(cfg.body)||!(cfg.periodSeconds>0&&Number.isFinite(cfg.periodSeconds))||!Array.isArray(cfg.parts)||cfg.parts.length!==3)throw Error('Invalid front hair bundle');
  const expected=['fringe','front-left','front-right'];
  cfg.parts.forEach((p,i)=>{const b=p.sourceBox;if(p.name!==expected[i]||!Array.isArray(b)||b.length!==4||!b.every(Number.isFinite)||b[0]<0||b[1]<0||b[2]<=0||b[3]<=0||b[0]+b[2]>cfg.sourceCanvas[0]||b[1]+b[3]>cfg.sourceCanvas[1]||!pair(p.textureSize)||![p.root,p.tip,p.amplitude,p.phase].every(Number.isFinite)||p.root<b[1]||p.tip<=p.root||p.tip>b[1]+b[3]||p.amplitude<0||p.amplitude>(cfg.version===1?12:cfg.version===4?Math.min(84,.28*(p.tip-p.root)):Math.min(48,.12*(p.tip-p.root)))||(cfg.version===2&&!validMotion(p.motion))||([3,4].includes(cfg.version)&&(!validFollow(p.motion)||p.motion.follow!==(i===2?'right':'left')))||!Array.isArray(p.shadowOffset)||p.shadowOffset.length!==2||!p.shadowOffset.every(Number.isFinite)||![p.texture,p.caster,p.receiver].every(file))throw Error('Invalid front hair part');});return true;
 }
 function target(part,time,period,enabled){return enabled&&Number.isFinite(time)&&Number.isFinite(period)&&period>0?part.amplitude*Math.sin(time*Math.PI*2/period+part.phase):0;}
 // v2 source-pixel driver. periodSeconds belongs exclusively to the legacy target.
 function motionTarget(part,time,enabled,motion={}){
  if(!enabled||!Number.isFinite(time)||!validMotion(part.motion))return 0;
  const m=part.motion,k=m.phaseIndex,p=part.phase,finite=x=>Number.isFinite(x)?x:0;
  const wind=m.windGain*(.035*Math.sin(1.3*time+1.7*k+p)+.020*Math.sin(2.9*time+.6*k+p)+.015*Math.sin(.47*time));
  const inertia=clamp(-.35*finite(motion.roll)-.06*finite(motion.rollVelocity)-.004*finite(motion.bodyVelocity),-.02,.02);
  return clamp((part.tip-part.root)*(wind+inertia),-part.amplitude,part.amplitude);
 }
 // time is the frame END time; sample each substep at its own absolute end.
 function advance(part,state,time,dt,enabled,motion={}){
  if(!validMotion(part.motion)||![part.root,part.tip,part.amplitude,part.phase,state.x,state.v].every(Number.isFinite)||part.tip<=part.root||part.amplitude<0||part.amplitude>Math.min(48,.12*(part.tip-part.root))){state.x=state.v=0;return 0;}
  state.x=clamp(state.x,-part.amplitude,part.amplitude);
  if(!Number.isFinite(time)||!Number.isFinite(dt)||dt<=0||dt>.05)return state.x;
  const m=part.motion,n=Math.max(1,Math.ceil(dt*120)),h=dt/n;
  for(let i=1;i<=n;i++){
   const goal=motionTarget(part,time-dt+i*h,enabled,motion);
   // Stronger neutral damping during holds/off avoids a long idle-off ringdown.
   state.v+=((goal-state.x)*m.stiffness-state.v*(enabled?m.damping:Math.max(18,m.damping)))*h;
   state.x+=state.v*h;
   state.x=clamp(state.x,-part.amplitude,part.amplitude);
   if(!Number.isFinite(state.x)||!Number.isFinite(state.v)){state.x=state.v=0;return 0;}
   if((state.x>=part.amplitude&&state.v>0)||(state.x<=-part.amplitude&&state.v<0))state.v=0;
   if(!enabled&&Math.abs(state.x)<1e-5&&Math.abs(state.v)<1e-5)state.x=state.v=0;
  }
  return state.x;
 }
 // v3 follows the already-integrated outer lock, not a second wind oscillator.
 // Positive outer rotation moves its tip LEFT; positive source displacement moves RIGHT.
 // Fringe shares the left carrier to avoid cancellation between phase-offset sides.
 function followTarget(part,outer,enabled){
  if(!enabled||!validFollow(part.motion)||!Number.isFinite(part.amplitude))return 0;
  const carrier=outer?.[part.motion.follow];
  if(!carrier||!Number.isFinite(carrier.x)||!Number.isFinite(carrier.amplitude)||carrier.amplitude<=0)return 0;
  return -part.amplitude*clamp(carrier.x/carrier.amplitude,-1,1);
 }
 function advanceFollow(part,state,dt,enabled,outer,model='outer-follow-v1'){
  // Widening is opt-in; omitted model preserves the v3 runtime guard.
  const maxAmplitude=model==='outer-follow-wide-v1'?Math.min(84,.28*(part.tip-part.root)):Math.min(48,.12*(part.tip-part.root));
  if(!['outer-follow-v1','outer-follow-wide-v1'].includes(model)||!validFollow(part.motion)||![part.root,part.tip,part.amplitude,state.x,state.v].every(Number.isFinite)||part.tip<=part.root||part.amplitude<0||part.amplitude>maxAmplitude){state.x=state.v=0;return 0;}
  const limit=part.amplitude,speed=limit*4;
  state.x=clamp(state.x,-limit,limit);state.v=clamp(state.v,-speed,speed);
  if(!Number.isFinite(dt)||dt<=0||dt>.05)return state.x;
  const goal=followTarget(part,outer,enabled),m=part.motion,n=Math.max(1,Math.ceil(dt*120)),h=dt/n;
  for(let i=0;i<n;i++){
   state.v=clamp(state.v+((goal-state.x)*m.stiffness-state.v*(enabled?m.damping:Math.max(18,m.damping)))*h,-speed,speed);
   state.x=clamp(state.x+state.v*h,-limit,limit);
   if((state.x>=limit&&state.v>0)||(state.x<=-limit&&state.v<0))state.v=0;
   if(!enabled&&Math.abs(state.x)<1e-5&&Math.abs(state.v)<1e-5)state.x=state.v=0;
  }
  return state.x;
 }
 function mesh(part,canvas,source,step=8){
  const b=part.sourceBox,sx=canvas[0]/source[0],sy=canvas[1]/source[1],pad=part.amplitude+4;
  const x0=clamp(Math.floor((b[0]-pad)*sx/step)*step,0,canvas[0]),x1=clamp(Math.ceil((b[0]+b[2]+pad)*sx/step)*step,0,canvas[0]),y0=clamp(Math.floor(b[1]*sy/step)*step,0,canvas[1]),y1=clamp(Math.ceil((b[1]+b[3])*sy/step)*step,0,canvas[1]);
  const cols=Math.ceil((x1-x0)/step),rows=Math.ceil((y1-y0)/step),rest=[],uvs=[],idx=[];
  for(let j=0;j<=rows;j++)for(let i=0;i<=cols;i++){const x=Math.min(x1,x0+i*step),y=Math.min(y1,y0+j*step);rest.push(x,y);uvs.push(x/canvas[0],y/canvas[1]);}
  for(let j=0;j<rows;j++)for(let i=0;i<cols;i++){const a=j*(cols+1)+i,b=a+1,c=a+cols+2,d=a+cols+1;idx.push(a,b,c,a,c,d);}
  if(rest.length/2>65535)throw Error('Front mesh exceeds index budget');return {rest:new Float32Array(rest),uvs:new Float32Array(uvs),idx:new Uint16Array(idx)};
 }
 const fragmentSource=`#version 300 es
 precision highp float;
 in vec2 v_uv;
 uniform sampler2D u_tex; uniform sampler2D u_caster; uniform sampler2D u_receiver; uniform sampler2D u_face;
 uniform vec2 u_source; uniform vec4 u_box; uniform vec2 u_root; uniform float u_motion;
 uniform vec2 u_shadowOffset; uniform int u_mode; uniform int u_isFringe; uniform vec2 u_viewPixels;
 out vec4 o;
 float pinnedGain(float y){float t=clamp((y-u_root.x)/(u_root.y-u_root.x),0.0,1.0);return t*t*t*(t*(t*6.0-15.0)+10.0);}
 vec4 localSample(sampler2D image,vec2 p){vec2 q=(p-u_box.xy)/u_box.zw;if(any(lessThan(q,vec2(0.0)))||any(greaterThanEqual(q,vec2(1.0))))return vec4(0.0);return texture(image,q);}
 vec2 inverseHair(vec2 p){return vec2(p.x-u_motion*pinnedGain(p.y),p.y);}
 void main(){
  vec2 p=v_uv*u_source;
  if(u_mode==0){o=localSample(u_tex,inverseHair(p));return;}
  float caster=localSample(u_caster,inverseHair(p-u_shadowOffset)).a;
  vec4 shadow=localSample(u_receiver,p)*caster;
  if(u_isFringe==1){
   shadow*=1.0-localSample(u_tex,inverseHair(p)).a;
   vec4 face=texture(u_face,gl_FragCoord.xy/u_viewPixels);
   if(face.a>0.0001){vec3 color=face.rgb/face.a;float skin=step(210.0/255.0,color.r)*step(145.0/255.0,color.g)*step(0.0,color.r-color.g)*step(7.0/255.0,color.g-color.b);shadow*=mix(1.0,skin,clamp(face.a,0.0,1.0));}
  }
  // Inputs are already premultiplied by WebGL; do not multiply RGB by alpha again.
  o=shadow;
 }`;
 const api={gain,sampleAlpha,validate,target,motionTarget,advance,followTarget,advanceFollow,mesh,fragmentSource};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.FrontHair=api;
})(typeof window!=='undefined'?window:globalThis);
