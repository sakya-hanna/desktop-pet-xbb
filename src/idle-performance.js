(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.IdlePerformance=api;})(globalThis,function(){
 'use strict';
 const smooth=(a,b,t)=>{const x=Math.max(0,Math.min(1,(t-a)/(b-a)));return x*x*(3-2*x);};
 const envelope=(t,a,b,c,d)=>smooth(a,b,t)*(1-smooth(c,d,t));
 const catalog=[
  {id:'glance',family:'attention',duration:3.6,weight:3,cooldown:18},
  {id:'settle',family:'stance',duration:5.2,weight:3,cooldown:25},
  {id:'content',family:'expression',duration:4.2,weight:2,cooldown:35},
  {id:'relax',family:'arms',duration:4.6,weight:2,cooldown:35},
  {id:'consider',family:'attention',duration:4,weight:1.5,cooldown:40}
 ].map(Object.freeze);
 function targets(id,t,side=1){
  const p={x:0,y:0,tilt:0,lean:0,arms:[0,0,0,0],eye:0,face:null};
  if(id==='glance'){const e=envelope(t,0,.55,1.35,2.25);p.x=side*.38*e;p.y=-.045*e;p.eye=envelope(t,1.52,1.60,1.65,1.74);}
  if(id==='settle'){const e=envelope(t,0,.75,2.5,4.1);p.lean=side*e;p.tilt=-side*.009*e;const h=envelope(t,.2,1,2.65,4.35);p.arms=side>0?[3*h,4*h,-h,2*h]:[h,2*h,-3*h,4*h];}
  if(id==='content'){const e=envelope(t,0,.65,2.6,3.35);p.y=.12*e;p.face=t>=.15&&t<3.6?'smile':null;p.eye=envelope(t,.65,.80,1.15,1.35);}
  if(id==='relax'){const a=envelope(t,0,.8,1.6,3.2),b=envelope(t,.15,.95,1.75,3.35);p.lean=.2*side*a;p.y=-.055*a;p.arms=[-7*a,-5*a,7*b,-5*b];}
  if(id==='consider'){const e=envelope(t,0,.65,1.4,2.1);p.tilt=side*.024*e;p.x=side*.14*e;p.face=t>=1.4?'smile':null;}
  if(id==='care'){
   // Look aside, return attention to the viewer, then acknowledge with a smile
   // and one nod. Give this moment gaze ownership instead of burying it in sway.
   p.focus=envelope(t,0,.45,3.65,4.4);
   p.x=side*.65*envelope(t,0,.7,.9,1.75);
   p.y=-.08*envelope(t,0,.65,1.1,1.7)+.32*envelope(t,1.65,1.95,2.15,2.65);
   p.tilt=-side*.01*envelope(t,0,.7,1.15,1.9);
   p.lean=side*.75*envelope(t,.12,1.05,1.3,2.5);
   p.eye=envelope(t,1.7,1.85,2,2.2);
   p.face=t>=1.45&&t<4.1?'smile':null;
  }
  return p;
 }
 function create({seed=17}={}){
  let rng=(seed^0x51ed270b)>>>0;const random=()=>{rng=(Math.imul(rng,1664525)+1013904223)>>>0;return rng/4294967296;};
  let next=4+random()*2,active=null,side=1,recent=[],lastFamily=null,lastEnded=null,care=null,nextCare=0;const ends={};
  function finish(t){if(active){ends[active.id]=t;lastEnded={id:active.id,family:active.family,time:t};active=null;}}
  function cancel(t){finish(t);if(care)care.quietSince=null;next=t+2.5+random()*2;}
  function recordCare(kind,t){if(!['head','hand'].includes(kind))return false;care={kind,at:t,quietSince:null,delay:8+random()*8};return true;}
  function clearCare(){care=null;}
  function startCare(t,source,manual=false){active={id:'care',family:'affection',duration:4.4,start:t,side,source,manual};care=null;nextCare=t+120;}
  function playCare(t){cancel(t);startCare(t,'preview',true);}
  function step(t,allowed,manualAllowed=allowed){
   if(care&&t-care.at>=90)care=null;
   if(care){if(!allowed)care.quietSince=null;else if(care.quietSince===null)care.quietSince=t;}
   if(active?.manual?!manualAllowed:!allowed){if(active)cancel(t);next=Math.max(next,t+2.5);return targets(null,0);}
   if(active&&t-active.start>=active.duration){finish(t);next=t+2.5+random()*2;}
   if(!active&&!allowed)return targets(null,0);
   if(!active&&care&&t>=nextCare&&t-care.quietSince>=care.delay)startCare(t,care.kind);
   if(!active&&t>=next){
    const pool=catalog.filter(a=>!recent.includes(a.id)&&!(a.family==='attention'&&lastFamily==='attention')&&t-(ends[a.id]??-Infinity)>=a.cooldown);
    if(pool.length){let draw=random()*pool.reduce((s,a)=>s+a.weight,0);const chosen=pool.find(a=>(draw-=a.weight)<=0)||pool.at(-1);side=-side;active={...chosen,start:t,side};recent=[...recent,chosen.id].slice(-2);lastFamily=chosen.family;}else next=t+2;
   }
   return active?targets(active.id,t-active.start,active.side):targets(null,0);
  }
  function snapshot(t){if(!active)return null;const elapsed=t-active.start;return {id:active.id,family:active.family,duration:active.duration,elapsed,automatic:!active.manual,...(active.source?{source:active.source}:{}),phase:elapsed<.75?'enter':elapsed<active.duration*.55?'hold':elapsed<active.duration-.7?'return':'settle'};}
  return {step,cancel,snapshot,recordCare,clearCare,playCare,lastEnded:()=>lastEnded,context:()=>care?{...care}:null};
 }
 return {catalog,targets,create};
});
