// Adapted from the installed Qianhuili-Experience js/app.js ANIMS.
// Retained raw targets keep its units, durations and functions; lookAround is
// a separately authored Baijie adaptation of its left/right/return sequence.
// Cat-only targets are
// kept here for source comparison but are not consumed by this human character.
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.ReferenceMotion=api;})(globalThis,function(){
 'use strict';
 const smoothstep=(a,b,x)=>{const t=Math.min(1,Math.max(0,(x-a)/(b-a)));return t*t*(3-2*t);};
 const env=(u,a,b,c,d)=>smoothstep(a,b,u)*(1-smoothstep(c,d,u));
 const scores={
  hum:{dur:5,f:u=>{const b=Math.sin(u*Math.PI*1.6),e=env(u,0,0.4,4.4,5);return {roll:0.07*b*e,gx:0.25*Math.sin(u*Math.PI*0.8)*e,gy:-0.12*e,hdy:2.5*Math.abs(b)*e,tail:0.3*b*e,eye:0.6*e};},cues:[[0,'say','♪～','enjoy',4.6]]},
  stretch:{dur:3.6,f:u=>{const s=env(u,0.5,1.1,2.3,3.0);return {sq:u<0.5?-0.02*env(u,0,0.2,0.35,0.5):0.035*s,gy:-0.6*s,roll:0.05*Math.sin(u*3)*s,eye:s,flat:0.3*s,tail:0.4*s};},cues:[[0.45,'face','yawn',1.9],[2.4,'say','呼啊～…','gentle',1.6]]},
  sneeze:{dur:2.9,f:u=>{if(u<1.15){const b=smoothstep(0,1.1,u);return {gy:-0.4*b,hdy:-3*b,eye:0.55*b};}const after=u-1.15,k=Math.exp(-after*2.5);return {gy:0.45*k,eye:after<0.4?1:0,hdx:Math.sin(after*28)*3*smoothstep(0.5,0.7,after)*k*2};},cues:[[0.05,'say','哈…哈……','troubled',1.2],[1.15,'sneeze'],[1.9,'say','…失礼了。','shy',1.8]]},
  peek:{dur:3.2,f:u=>{const e=env(u,0,0.5,2.5,3.2);return {gx:0*e,gy:0.2*e,hdy:7*e,roll:-0.08*Math.sign(0||1)*e};},cues:[[0.3,'face','curious',2.4],[0.8,'say','嗯？','curious',1.8]]},
  doze:{dur:3.6,f:u=>{const d=smoothstep(0,2.4,u)*(u<2.5?1:Math.exp(-(u-2.5)*6));return {gy:0.55*d,hdy:7*d,roll:0.07*d,eye:u<2.5?0.3+0.7*d:0};},cues:[[0.2,'face','sleepy',2.3],[2.5,'startle'],[3.2,'say','…没睡！','troubled',1.5]]},
  bounce:{dur:1.6,f:()=>({}),cues:[[0,'face','happy',1.6],[0.05,'bounce'],[0.6,'bounce']]},
  wake:{dur:4,f:u=>{if(u<0.55)return {gy:0.5,roll:0.08,hdy:5,eye:0.75+0.25*Math.sin(u*34)};if(u<1.4)return {gx:0.6*Math.sin((u-0.55)*7.5),gy:-0.1};const s=env(u,1.4,1.9,2.8,3.4);return {sq:0.035*s,gy:-0.6*s,eye:s,flat:0.35*s,tail:0.5*s,roll:0.04*Math.sin(u*3)*s};},cues:[[0.55,'wake-startle'],[1.4,'face','yawn',1.6],[1.5,'say','哈啊～…',null,0],[3.2,'say','才、才没有在打瞌睡！','smile',2.4]]},
  rouse:{dur:1.2,f:u=>({eye:u<0.5?0.6*(1-u/0.5)+0.4*Math.max(0,Math.sin(u*25)):0}),cues:[[0.05,'rouse'],[0.5,'face','curious',0.8]]},
  // Keep Chieri's gaze -> head/body springs -> hair chain. Longer holds and
  // eased target changes suit the long human hair; no head translation cue.
  lookAround:{dur:5.6,f:u=>{
    const gx=-.8*smoothstep(0,.65,u)+1.55*smoothstep(1.7,2.65,u)-.75*smoothstep(3.8,4.8,u);
    return {gx,gy:.04*env(u,0,.65,3.8,4.8),roll:-.025*gx};
  },cues:[[.3,'face','curious',4.2],[4.75,'face','gentle',.85]]}
 };
 const labels={hum:'哼歌摆动（无语音）',stretch:'伸懒腰',sneeze:'打喷嚏',peek:'凑近偷看',doze:'打盹点头',bounce:'连续小跳',wake:'深睡醒来',rouse:'困倦回神',lookAround:'左右转头'};
 // Upstream wake()/rouse start with already-settled sleeping springs. Our
 // menu-only demos have no sleep state machine: establish that posture first.
 // These preparation durations are Baijie demo adaptation, NOT ANIMS changes.
 const preparations={wake:{duration:1.6,sleep:2},rouse:{duration:1.2,sleep:1}};
 const catalog=Object.entries(labels).map(([id,label])=>Object.freeze({id,label,duration:scores[id].dur,...(preparations[id]?{prepareDuration:preparations[id].duration}:{}),automatic:!['peek','wake','rouse'].includes(id)}));
 const faceIds={neutral:'3942',smile:'3901',gentle:'3942',happy:'3901',enjoy:'3625',closed:'3625',yawn:'9001',troubled:'3751',shy:'3496',curious:'3831',surprised:'3791',sleepy:'3599'};
 // Baijie presentation calibration, not upstream ANIMS constants. Preserve
 // source timing/phase/spring damping; amplify the weak channels at their
 // targets so downstream body, hair and cloth still react to real velocities.
 // Long outer locks and global squash/hop are already legible: no blanket gain.
 const tuning=Object.freeze({version:'i24-presence',gaze:1.5,roll:1.55,headShift:1.65,bodyFollow:1.5,bodySway:1.7,skirt:2.8,postureSquashGain:0.3,
  hairGain:Object.freeze({'outer-left':1,'outer-right':1,'front-left':1.65,'front-right':1.85,fringe:1.1}),
  hairLimit:Object.freeze({'outer-left':0.12,'outer-right':0.12,'front-left':0.20,'front-right':0.20,fringe:0.12})});
 function createMotion({binding,idle=true,seed=17}){
  const spring=()=>({x:0,v:0}),s={t:0,ax:spring(),ay:spring(),roll:spring(),bodyX:spring(),bodyRoll:spring(),headDX:spring(),headDY:spring(),skirt:spring(),squash:spring(),eyeClose:spring(),hair:Array.from({length:5},spring),hop:0,hopV:0};
  const stepSpring=(o,target,k,c,dt)=>{o.v+=(-(o.x-target)*k-o.v*c)*dt;o.x+=o.v*dt;};
  let rng=seed>>>0;const random=()=>{rng=(Math.imul(rng,1664525)+1013904223)>>>0;return rng/4294967296;},rand=(a,b)=>a+random()*(b-a);
  // Rest rhythm uses the same simulation clock, with its own seeded choices so
  // a breath does not consume the action/blink lottery's random sequence.
  let restRng=(seed^0x9e3779b9)>>>0;
  const restRand=(a,b)=>{restRng=(Math.imul(restRng,1664525)+1013904223)>>>0;return a+(b-a)*restRng/4294967296;};
  let breathPhase=.19,breathPeriod=4.2,inhale=.38,breathDepth=1,breath=.5;
  let action=null,lastAction=null,completed=0,blocked=false,auto=idle,nextAction=10,nextIdle=4,look=null,idleFace='neutral';
  let face=null,faceUntil=0,feedback=null,feedbackId=0,blinkStart=-1,nextBlink=2,doubleBlink=false,jumps=0;
  const impulses={};
  // Reference DEFAULT_SETTINGS.sleepAfter=180; mouse tracking is intentionally
  // absent here, so quiet time is reset by this character's own interactions.
  let lastContact=0;
  const drowsyEligible=()=>s.t-lastContact>180*0.4;
  let demo=[],demoNext=0;
  const headScale=binding.height/1536,widthScale=binding.width/1024;
  const hairSpecs=[['outer-left',70,true],['outer-right',80,true],['front-left',110,false],['front-right',120,false],['fringe',120,false]];
  // Chieri app.js simulate(): the same breeze drives short strands and long
  // chains. Export the load separately: hair already includes head inertia.
  const breeze=(t,k)=>0.035*Math.sin(t*1.3+k*1.7)+0.02*Math.sin(t*2.9+k*0.6)+0.015*Math.sin(t*0.47);
  function setFace(sem,duration){face=sem;faceUntil=s.t+duration;}
  function say(text,sem,duration){if(sem)setFace(sem,duration);feedback={id:'reference:'+ ++feedbackId,text,durationMs:3400,until:s.t+3.4};}
  function cue(c){
   const [,kind,a,b,d]=c;
   if(kind==='face')setFace(a,b);
   else if(kind==='say')say(a,b,d);
   else if(kind==='sneeze'){say('啾！','closed',0.6);s.squash.v-=1.3;s.headDY.v+=150;s.squash.v+=0.2;impulses.sneeze=(impulses.sneeze||0)+1;}
   else if(kind==='startle'){s.headDY.v-=120;setFace('surprised',0.9);}
   else if(kind==='wake-startle'){setFace('surprised',0.9);s.headDY.v-=120;s.squash.v+=0.45;}
   else if(kind==='rouse')s.headDY.v-=50;
   else if(kind==='bounce'){s.hopV=300;s.squash.v+=1.2;}
  }
  function play(name){
   if(blocked||!Object.hasOwn(scores,name))return false;
   demo=[];look=null;
   action={name,start:s.t+(preparations[name]?.duration||0),fired:0,preparation:preparations[name]||null};lastAction=name;face=null;feedback=null;return true;
  }
  function playAll(){if(blocked)return false;play(catalog[0].id);demo=catalog.slice(1).map(a=>a.id);return true;}
  function clearPresentation(){face=null;feedback=null;}
  function cancel(){const active=!!action;action=null;look=null;demo=[];clearPresentation();nextAction=s.t+rand(14,28);return active;}
  function setBlocked(value){value=!!value;if(value===blocked)return;blocked=value;if(value){lastContact=s.t;look=null;}cancel();}
  function setAuto(value){auto=!!value;if(!auto){look=null;cancel();}}
  function choose(){
   // Chieri idleAnim includes lookAround. Keep the accepted score intact but
   // use weight 1 (upstream 3): full turns punctuate the smaller idle moments.
   const affection=Math.max(0.1,0.3-s.t*0.002);
   const pool=[['lookAround',1],['hum',2],['stretch',2],['peek',0],['bounce',1+affection*2],['sneeze',0.6],['doze',drowsyEligible()?4:0]];
   let r=random()*pool.reduce((n,p)=>n+p[1],0);for(const [name,w]of pool)if((r-=w)<=0){play(name);break;}
  }
  function step(dt,isBlocked=false,pat=null){
   setBlocked(isBlocked);s.t+=dt;const t=s.t;
   // Same bounded breath channel as the reference; a longer exhale and small
   // cycle-to-cycle changes suit a standing human. Cycle changes happen at the
   // relaxed endpoint where both value and slope meet, never on menu actions.
   breathPhase+=dt/breathPeriod;
   if(breathPhase>=1){breathPhase-=1;breathPeriod=restRand(3.8,4.8);inhale=restRand(.36,.42);breathDepth=restRand(.9,1);}
   breath=breathDepth*(breathPhase<inhale?smoothstep(0,inhale,breathPhase):1-smoothstep(inhale,1,breathPhase));
   if(!blocked&&!action&&demo.length&&t>=demoNext){const remaining=demo.slice(1);play(demo[0]);demo=remaining;}
   if(auto&&!blocked&&!action&&t>=nextAction){choose();nextAction=t+rand(14,28);}
   if(t>=nextIdle){
    nextIdle=t+rand(4,8);
    if(auto&&!blocked&&!action){
     // Chieri idleTick: a short target, then back to the living base pose.
     // Ear/tail opportunities become a head tilt or a resting weight shift;
     // they are distinct gestures, not three offsets added to every glance.
     const r=random(),side=restRand(0,1)<.5?-1:1;
     look=null;
     if(r<.22)look={x:side*restRand(.45,.7),y:restRand(-.18,.24),lean:0,tilt:0};
     else if(r<.4)look={x:side*restRand(.16,.28),y:-.08,lean:0,tilt:side*restRand(.035,.055)};
     else if(r<.55)look={x:side*restRand(.2,.35),y:.06,lean:side*restRand(.018,.03),tilt:-side*.012};
     else if(r<.7)idleFace=['neutral','neutral','smile','gentle'][Math.floor(random()*4)];
     if(look)look.until=t+restRand(1.5,3);
    }
   }
   let gx=0.15*Math.sin(t*0.37),gy=0.1*Math.sin(t*0.23+1);
   let rollT=-gx*0.05+0.02*Math.sin(t*0.5),hdx=0,hdy=0,A=null;
   // Contact blocks spontaneous choices, not the baseline breath/stance. A
   // held response must not switch the base to the authored-action waveform.
   const quiet=!action;
   if(look&&t>=look.until)look=null;
   const resting=quiet&&auto&&!blocked?look:null;
   if(quiet){
    // Retain upstream's continuous gaze/roll underneath the occasional
    // moments. All target changes, including expiry, use the same springs.
    if(resting){gx=resting.x;gy=resting.y;}
    rollT=-gx*.05+(resting?.tilt||0)+.02*Math.sin(t*.5);
    // Chest breath is already in the material parent. A small delayed head
    // response goes through the original 120/14 spring, not a second bob.
    hdy=-(breath-.5)*1.6;
   }
   // As in the source, rollT is formed before the acted gaze override.
   if(action){const a=scores[action.name],u=t-action.start;
    if(u<0){
     // Upstream simulate(): deep sleep gaze=.1/.55, roll=.1+.02*sin(t*.6),
     // eye=1; shallow sleep adds .25 to gaze Y and closes eyes around .45.
     const deep=action.preparation.sleep===2;
     A=deep?{gx:.1,gy:.55,roll:.1+.02*Math.sin(t*.6)-rollT,eye:1}:{gy:gy+.25,eye:.45+.1*Math.sin(t*1.3)};
    }else{
     while(action.fired<a.cues.length&&a.cues[action.fired][0]<=u)cue(a.cues[action.fired++]);
     if(u>a.dur){action=null;completed++;demoNext=t+1.2;nextAction=t+rand(14,28);}else A=a.f(u);
    }
   }
   if(A){if(A.gx!=null)gx=A.gx;if(A.gy!=null)gy=A.gy;rollT+=A.roll||0;hdx+=A.hdx||0;hdy+=A.hdy||0;}
   // Chieri simulate(S.pat), adapted to Baijie's neck support and face size.
   // Its original 5..11px headDY dominates our dome and also lowers shoulders.
   // Express acceptance through downward attitude, with only a small settle;
   // finger travel is a stroke, not a force pushing the head into the torso.
   if(pat){
    hdy+=1.5;
    hdx=2.5*Math.tanh(pat.x*.025/2.5);
    rollT+=.025*Math.tanh(pat.x*.00045/.025);gy=.55;
   }
   stepSpring(s.ax,gx*tuning.gaze,55,13,dt);stepSpring(s.ay,gy*tuning.gaze,55,13,dt);stepSpring(s.roll,rollT*tuning.roll,45,11,dt);
   stepSpring(s.headDX,hdx*tuning.headShift,120,14,dt);stepSpring(s.headDY,hdy*tuning.headShift,120,14,dt);
   const weight=.012*Math.sin(t*.8)+(resting?.lean||0);
   stepSpring(s.bodyX,s.ax.x*0.45*tuning.bodyFollow,18,7,dt);stepSpring(s.bodyRoll,(-s.roll.x*0.25+weight-s.bodyX.x*0.015)*tuning.bodySway,18,7,dt);
   for(let k=0;k<s.hair.length;k++){
    const h=s.hair[k],spec=hairSpecs[k],w=breeze(t,k);
    const gain=tuning.hairGain[spec[0]];
    stepSpring(h,(-(s.roll.x+s.bodyRoll.x)*0.7-s.ax.v*0.012+w+(spec[2]?-s.ax.x*0.02:0))*gain,spec[1],3.2,dt);
    h.v+=-s.roll.v*0.6*dt*10*0.1*gain;
   }
   stepSpring(s.skirt,-s.bodyX.v*2.2-s.bodyRoll.x*120+1.2*Math.sin(t*1.7),40,3.5,dt);
   if(s.hop>0||s.hopV>0){s.hop+=s.hopV*dt;s.hopV-=2600*dt;if(s.hop<=0){s.squash.v-=Math.min(2.5,-s.hopV*0.003);s.hop=0;s.hopV=0;s.skirt.v+=40;jumps++;}}
   // Character-only adaptation: preserve the reference score and spring timing,
   // but avoid rubber-like full-body lengthening in this tall human figure.
   // Apply before integration so hair still follows the actual moving anchors.
   // A.sq is an authored posture target, including the stretch inside wake.
   // Cue/landing velocity impulses above remain distinct from sustained pose.
   const squashTarget=(A&&A.sq||0)*tuning.postureSquashGain;
   stepSpring(s.squash,squashTarget,260,11,dt);stepSpring(s.eyeClose,A&&A.eye!=null?A.eye:0,30,10,dt);
   if(t>=nextBlink){blinkStart=t;nextBlink=t+0.17+(doubleBlink?0.12:rand(2.2,5.5));doubleBlink=!doubleBlink&&random()<0.18;}
  }
  function snapshot(){
   const bt=s.t-blinkStart,cl=Math.max(bt>=0&&bt<=0.17?Math.sin(Math.PI*bt/0.17):0,s.eyeClose.x);
   const preparing=action&&s.t<action.start,deep=preparing&&action.preparation.sleep===2;
   const sem=preparing?(deep?'closed':'sleepy'):face&&s.t<faceUntil?face:idleFace;
   const hair=Object.fromEntries(hairSpecs.map(([id],k)=>{const a=s.hair[k].x;return [id,[a*Math.pow(1/3,1.4),a*Math.pow(2/3,1.4),a]];}));
   const hairWind=Object.fromEntries(hairSpecs.map(([id],k)=>[id,breeze(s.t,k)]));
   // Chieri simulate() also loads rear locks from gaze velocity and direction.
   // Export that unsprung load separately: the long chain supplies its own lag,
   // while its moving parent already supplies head roll and linear inertia.
   const hairTurn=-s.ax.v*0.012-s.ax.x*0.02;
   return {motionSet:'qianhuili',idleAction:{name:action?.name||lastAction||'qianhuili',phase:blocked?'blocked':preparing?'preparing':action?'playing':'quiet',elapsed:action?Math.max(0,s.t-action.start):0,completed},
    referenceMotion:{active:action?.name||null,...(action?.preparation?{phase:preparing?'preparing':'playing'}:{}),automatic:auto,drowsyEligible:drowsyEligible(),completed,jumps,demoRemaining:demo.length,impulses:{...impulses},tuning:tuning.version},face:faceIds[sem]||'3942',blink:Math.max(0,Math.min(1,cl)),
    feedback:feedback&&s.t<feedback.until?{id:feedback.id,text:feedback.text,durationMs:feedback.durationMs}:null,
    pose:{referenceMotion:true,lookX:s.ax.x,lookY:s.ay.x,headRoll:s.roll.x,headX:s.headDX.x*widthScale/binding.height,headY:s.headDY.x/1536,
     bodyRoll:s.bodyRoll.x,bodyX:s.bodyX.x*7*widthScale/binding.height,bodyY:0,breath,
     hair,hairWind,hairTurn,cloth:{'skirt-front':[s.skirt.x*widthScale*tuning.skirt,0],'skirt-right':[s.skirt.x*widthScale*tuning.skirt,0]},squash:s.squash.x,hop:s.hop*headScale/binding.height,compression:0}};
  }
  return {step,snapshot,play,playAll,cancel,setBlocked,setAuto,clearPresentation};
 }
 return {scores,catalog,createMotion,tuning};
});
