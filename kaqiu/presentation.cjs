'use strict';
const {validFeedback}=require('../feedback-window.cjs');
// One display ID allocator for renderer reactions and main-process reminders.
// Clearing a touch cannot clear a game reminder owned by a different source.
function createPresentation({window:surface,clock=globalThis}){
  const now=typeof clock.now==='function'?()=>clock.now():()=>performance.now();
  let sequence=0,rendererHigh=0,normal=null,urgent=null,timer=null,enabled=true,dead=false;
  function disarm(){if(timer!==null)clock.clearTimeout(timer);timer=null;}
  function render(){
    disarm();if(dead)return;
    if(urgent&&urgent.until<=now())urgent=null;
    if(normal&&normal.until<=now())normal=null;
    const next=urgent||normal;
    if(!enabled||!next){surface.clear();return;}
    surface.set({...next.value,id:++sequence,durationMs:Math.max(3400,Math.ceil(next.until-now()))});
    timer=clock.setTimeout(render,Math.max(1,next.until-now()));timer?.unref?.();
  }
  function fromRenderer(value){
    if(!validFeedback(value))return false;
    if(value===null){normal=null;if(!urgent)render();return true;}
    if(value.id<=rendererHigh)return false;rendererHigh=value.id;
    if(!enabled)return false;
    normal={value,until:now()+(value.durationMs||3400)};
    if(!urgent)render();return true;
  }
  function remind(events){
    if(dead||!enabled||!events.length)return;
    const prior=urgent&&urgent.until>now()?urgent.events:[];
    const merged=new Map(prior.map(e=>[e.card,e]));
    for(const e of events)merged.set(e.card,e);
    const list=[...merged.values()];
    urgent={events:list,value:{text:list.map(e=>e.text).join('\n').slice(0,200)},until:now()+4200};render();
  }
  return {fromRenderer,remind,
    clearNormal(){normal=null;if(!urgent)render();},
    clearReminders(){urgent=null;render();},
    retainOnBlur:()=>!!urgent&&urgent.until>now(),
    setEnabled(v){enabled=v===true;if(!enabled){normal=null;urgent=null;disarm();}surface.setEnabled(enabled);if(!enabled)surface.clear();},
    destroy(){dead=true;disarm();normal=null;urgent=null;},
  };
}
module.exports={createPresentation};
