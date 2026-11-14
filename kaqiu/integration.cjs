'use strict';
const fs=require('node:fs'),path=require('node:path');
const {CARDS,createTimers}=require('./timers.cjs');
const {createBridge}=require('./bridge.cjs');
function createKaqiu({root,profileRoot,mode,clock=globalThis,presentation,onChange=()=>{},bridgeFactory=createBridge,onMiaoDispatched=()=>{}}){
  let enabled=false,miaoEnabled=true,selected=new Set(['miao','notes']),status='off',detail='未启用',dead=false;
  // Reserved callback; no text until the user chooses a sending reaction.
  const sentBubbleText=null;
  const settingsFile=path.join(profileRoot,'kaqiu-settings.json');
  try {const s=JSON.parse(fs.readFileSync(settingsFile,'utf8'));if(Array.isArray(s.cards))selected=new Set(s.cards.filter(c=>Object.hasOwn(CARDS,c)));miaoEnabled=s.miaoEnabled===true;}catch{}
  const timers=createTimers({clock,onEvents:events=>presentation.remind(events),onChange:()=>onChange(),onClear:()=>presentation.clearReminders()});
  const bridge=bridgeFactory({root,onEvent:receive,onStatus:(s,d)=>{if(dead)return;status=s;detail=d;onChange();if(['error','denied','missing'].includes(s))notice(d);}});
  function notice(text){presentation.remind([{card:'system',text}]);}
  function save(){try{fs.mkdirSync(profileRoot,{recursive:true});fs.writeFileSync(settingsFile,JSON.stringify({version:1,cards:[...selected],miaoEnabled},null,2)+'\n');}catch{notice('计时偏好未能保存，本次仍可使用。');}}
  function configure(){bridge.configure({cards:[...selected],miaoEnabled:enabled&&miaoEnabled});}
  function clear(){timers.clear();presentation.clearReminders();bridge.clear();}
  function setEnabled(value){
    if(dead)return;enabled=value===true;
    if(enabled){if(mode==='visible'){configure();bridge.start();}else {status='hidden-test';detail='隐藏验证，不启动游戏识别或按键';}}
    else{bridge.stop();clear();status='off';detail='未启用';}
    onChange();
  }
  function receive(event){
    if(dead||!enabled||!event||typeof event!=='object')return;
    if(event.type==='trigger'&&selected.has(event.card)){
      const ageMs=Number.isFinite(event.at)?Math.max(0,Date.now()-event.at):0;
      timers.start(event.card,{ageMs});
    }else if(event.type==='round-end')timers.roundEnd();
    else if(event.type==='clear')clear();
    else if(event.type==='status'&&typeof event.text==='string'){detail=event.text.slice(0,160);onChange();}
    else if(event.type==='input-dispatched'){
      onMiaoDispatched({requestId:event.requestId,at:event.at});
      if(sentBubbleText)notice(sentBubbleText);
    }else if(event.type==='input-error'&&typeof event.message==='string')notice(event.message.slice(0,160));
  }
  const snapshot=()=>({enabled,miaoEnabled,cards:[...selected],status,detail,timers:timers.snapshot()});
  function startManual(card){if(enabled&&selected.has(card)){presentation.clearReminders();timers.start(card,{manual:true});}}
  function menu(){return {id:'kaqiu',label:'卡丘计时模式',submenu:[
    {id:'kaqiu-enabled',label:'启用卡丘计时',type:'checkbox',checked:enabled,click:i=>setEnabled(i.checked)},
    {label:detail,enabled:false},
    {label:'卡牌提醒',submenu:Object.entries(CARDS).map(([id,c])=>({label:`${c.name}（${c.seconds}秒${id==='miao'?' · 仅提前提醒':''}）`,type:'checkbox',checked:selected.has(id),click:i=>{if(i.checked)selected.add(id);else{selected.delete(id);timers.remove(id);presentation.clearReminders();}save();configure();onChange();}}))},
    {label:'F8 一键发送“喵”',type:'checkbox',checked:miaoEnabled,click:i=>{miaoEnabled=i.checked;save();configure();onChange();}},
    {label:'授权 F8 辅助程序（管理员）',enabled:enabled&&miaoEnabled,click:()=>{if(mode==='visible'){configure();bridge.start({elevated:true});}}},
    {label:'重新连接识别',enabled,click:()=>{if(mode==='visible'){configure();bridge.start();}}},
    {label:'手动开始 / 重置',enabled,submenu:[...selected].map(id=>({label:CARDS[id].name,click:()=>startManual(id)}))},
    {label:'清空本局计时',enabled,click:clear},
  ]};}
  return {snapshot,menu,setEnabled,startManual,receive,clear,destroy(){dead=true;bridge.stop();timers.destroy();presentation.clearReminders();}};
}
module.exports={createKaqiu};
