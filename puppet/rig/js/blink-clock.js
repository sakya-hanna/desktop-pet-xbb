// Every automatic and manual blink uses S.t, never the navigation/performance epoch.
(function(root){
 function trigger(s,skip=false,random=Math.random){
  if(skip){s.blinking=false;return;}
  s.blinking=true;s.blinkUntil=s.t+0.13;
  const sample=random();
  const r=Number.isFinite(sample)?Math.max(0,Math.min(1,sample)):0.5;
  s.nextBlink=s.blinkUntil+2.6+r*3.6;
 }
 function tick(s,automatic,skip,random=Math.random){
  if(skip){s.blinking=false;return;}
  if(s.blinking&&s.t>=s.blinkUntil)s.blinking=false;
  if(!s.blinking&&automatic&&s.t>=s.nextBlink)trigger(s,false,random);
 }
 function defer(s,delay=1.2){s.blinking=false;s.nextBlink=s.t+delay;}
 const api={trigger,tick,defer};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.BlinkClock=api;
})(typeof window!=='undefined'?window:globalThis);
