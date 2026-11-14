'use strict';
// Independent of the animation clock. Like Meihua's scheduler, events own their
// identity; unlike its planner, these short deadlines cannot use a 15s tick.
const CARDS = Object.freeze({
  miao: {name:'喵喵赐福', seconds:15, start:false, end:false},
  notes: {name:'笔记', seconds:40, start:true, end:true},
  endeye: {name:'终焉', seconds:60, start:true, end:true},
  beacon: {name:'信标', seconds:49, start:true, end:true},
  analyzer: {name:'分析仪', seconds:50, start:true, end:true, multi:true},
});
function createTimers({clock=globalThis, onEvents=()=>{}, onChange=()=>{}, onClear=()=>{}}={}) {
  const now=typeof clock.now==='function'?()=>clock.now():()=>performance.now();
  const active=new Map(); let seq=0, timer=null, roundTimer=null, destroyed=false;
  function stopTick(){if(timer!==null)clock.clearTimeout(timer);timer=null;}
  function snapshot(){return [...active.values()].map(t=>({...t, remainingMs:Math.max(0,t.deadline-now())}));}
  function publish(events){if(events.length)onEvents(events);onChange(snapshot());}
  function schedule(){
    stopTick(); if(destroyed||!active.size)return;
    let next=Infinity;
    for(const t of active.values())next=Math.min(next,t.warned?t.deadline:t.deadline-10000);
    timer=clock.setTimeout(tick,Math.max(1,next-now()));timer?.unref?.();
  }
  function tick(){
    timer=null;const at=now(),events=[];
    for(const [key,t] of active){
      const card=CARDS[t.card];
      if(at>=t.deadline){active.delete(key);if(card.end)events.push(event(t,'end'));}
      else if(!t.warned&&at>=t.deadline-10000){t.warned=true;events.push(event(t,'soon'));}
    }
    publish(events);schedule();
  }
  function event(t,stage){
    const card=CARDS[t.card],name=card.name;
    const text=stage==='soon'?(t.card==='miao'?'喵喵冷却快好啦。':`${name}还剩10秒哦。`)
      :stage==='start'?`${name}开始计时，${card.seconds}秒。`
      :`${name}${t.card==='notes'?'冷却':'计时'}结束啦。`;
    return {id:t.id,card:t.card,stage,text,deadline:t.deadline};
  }
  function start(cardId,{manual=false,ageMs=0}={}){
    const card=CARDS[cardId];if(destroyed||!card)return false;
    // Automatic detections cannot rewind a still-running cooldown. Explicit
    // menu reset can; analyzer instances intentionally remain independent.
    if(!manual&&!card.multi&&active.has(cardId)&&active.get(cardId).deadline>now())return false;
    const deadline=now()+card.seconds*1000-Math.max(0,ageMs);
    if(deadline<=now())return false;
    const id=++seq,key=card.multi?`${cardId}:${id}`:cardId;
    if(card.multi){const same=[...active].filter(([,t])=>t.card===cardId);if(same.length>=6)active.delete(same[0][0]);}
    const t={id,card:cardId,deadline,warned:false};active.set(key,t);
    // Late detection skips obsolete start/soon messages.
    if(ageMs>=card.seconds*1000-10000){t.warned=true;publish([event(t,'soon')]);}
    else publish(card.start?[event(t,'start')]:[]);
    schedule();return true;
  }
  function clear(){stopTick();if(roundTimer!==null)clock.clearTimeout(roundTimer);roundTimer=null;active.clear();onClear();onChange(snapshot());}
  function roundEnd(){if(roundTimer!==null||destroyed)return;roundTimer=clock.setTimeout(()=>{roundTimer=null;clear();},7000);roundTimer?.unref?.();}
  function remove(card){for(const [key,t]of active)if(t.card===card)active.delete(key);onChange(snapshot());schedule();}
  return {start,clear,roundEnd,remove,snapshot,destroy(){destroyed=true;clear();}};
}
module.exports={CARDS,createTimers};
