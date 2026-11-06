// Finite, interruptible idle targets. Springs and breathing remain renderer-owned.
(function(root){
 const neutral=()=>({angleX:0,angleY:0,roll:0,bodyX:0});
 function create(random=Math.random){
  let enabled=true,active=null,nextAt=14+random()*14;
  const held=new Set();let quietUntil=0,busy=false;
  function interrupt(t){active=null;quietUntil=t+8;nextAt=t+14+random()*14;}
  function hold(key,on,t){
   if(on===held.has(key))return;
   if(on)held.add(key);else held.delete(key);
   interrupt(t);
  }
  function setEnabled(on,t){if(enabled===!!on)return;enabled=!!on;interrupt(t);}
  function update(t,isBusy=false){
   if(busy!==isBusy){busy=isBusy;interrupt(t);}
   if(!enabled||held.size||busy||t<quietUntil)return neutral();
   if(active && t-active.start>=active.duration){active=null;nextAt=t+14+random()*14;}
   if(enabled && !active && t>=nextAt){
    active={name:'lookAround',start:t,duration:4.4+random()*1.2,side:random()<0.5?-1:1,amplitude:0.30+random()*0.20};
   }
   const p=neutral();
   if(enabled){p.angleX=Math.sin(t*0.37)*0.035;p.angleY=Math.sin(t*0.23+1)*0.025;p.roll=Math.sin(t*0.42)*0.003;}
   if(active){
    const u=(t-active.start)/active.duration;
    const ease=x=>{x=Math.max(0,Math.min(1,x));return x*x*x*(x*(x*6-15)+10);};
    const x=active.side*active.amplitude*(u<.32?ease(u/.32):u<.70?1-1.75*ease((u-.32)/.38):-.75*(1-ease((u-.70)/.30)));
    const envelope=ease(u/.20)*ease((1-u)/.20);
    p.angleX+=x;p.angleY-=.04*envelope;p.roll-=x*.025;p.bodyX=x*.25;
   }
   return p;
  }
  return {update,interrupt,hold,setEnabled,snapshot:()=>({enabled,active:active?{...active}:null,nextAt,quietUntil,held:[...held],busy})};
 }
 const api={create};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.IdleMotion=api;
})(typeof window!=='undefined'?window:globalThis);
