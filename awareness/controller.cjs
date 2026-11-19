'use strict';
const {isTarget}=require('./native.cjs');
const labels={
  disabled:'已关闭',watching:'等待合适的陪伴时机',armed:'5 秒后观察鼠标所在屏幕',
  observing:'正在观察画面',cooldown:'已经鼓励过，先安静陪着你',busy:'先等当前互动结束',
  'no-rule':'当前场景暂无已启用的自动互动','no-match':'已看过，暂无适合的互动','context-changed':'当前画面已切换，本次自动回应取消',idle:'暂时没有电脑操作',
  'model-missing':'请先填写模型设置','model-error':'模型设置不可读取','window-provider-missing':'前台识别组件未安装',
  'capture-unavailable':'暂时无法取得 Codex 窗口画面','vision-response-invalid':'识图回复格式不正确',
  'request-error':'识图请求失败，请检查模型与网络','auth-error':'模型密钥或权限不可用',
  'quota-error':'模型余额或请求额度不足','model-unsupported':'接口或模型不接受识图请求',
  captured:'已取得窗口图像',requesting:'正在请求识图',classified:'已收到识图结果',interrupted:'观察被新的互动中断',
  hidden:'白姐隐藏或系统暂停，停止观察',unavailable:'暂时无法读取前台窗口'
};
function errorCode(error){
  if(labels[error?.message])return error.message;
  const status=Number(error?.message?.match(/HTTP (\d{3})/)?.[1]);
  return [401,403].includes(status)?'auth-error':[402,429].includes(status)?'quota-error':[400,404,422].includes(status)?'model-unsupported':'request-error';
}
function create({activeWindow,manualTarget=activeWindow,capture,classify,getConfig,rule=require('./codex-work.cjs'),available=()=>true,busy=()=>false,paused=()=>false,idleSeconds=()=>0,deliver,
  clock=globalThis,random=Math.random,onChange=()=>{},onDiagnostic=()=>{},enabled=false,dwellMs=90000,pollMs=5000}){
  const now=()=>clock.now?clock.now():performance.now();
  let dead=false,timer=null,polling=false,flight=null,generation=0,tracked=null,since=0,lastSample=null;
  let nextAllowed=0,retryAt=0,armedAt=null,lastLine=-1,code=enabled?'watching':'disabled',lastActivity=null,lastManual=null;
  function state(){return {enabled,code,label:(code==='watching'?rule.watchingLabel:labels[code])||labels['request-error'],pending:!!flight,
    cooldownSeconds:Math.max(0,Math.ceil((nextAllowed-now())/1000)),lastActivity,lastManual:lastManual?{...lastManual}:null};}
  function report(phase,manual,details={}){
    if(manual)lastManual={code:phase,label:labels[phase]||labels['request-error'],at:new Date().toISOString()};
    try{onDiagnostic({phase,manual,...details});}catch{}
    if(manual)onChange(state());
  }
  function status(value){if(code!==value){code=value;report(value,false);onChange(state());}}
  function cancel(resetTracking=true){generation++;if(flight)report('interrupted',flight.manual);flight?.controller.abort();flight=null;if(resetTracking){tracked=null;since=0;lastSample=null;}}
  // Reactions defer observation, but do not erase time spent in the same app.
  function interrupt(){const interrupted=!!flight;cancel(false);if(enabled&&interrupted)status('interrupted');}
  function schedule(){if(dead||timer!==null||(!enabled&&armedAt===null&&!flight))return;
    timer=clock.setTimeout(()=>{timer=null;void tick().catch(()=>status('unavailable'));schedule();},pollMs);timer?.unref?.();}
  async function observe(target,manual){
    let config;try{config=getConfig();}catch{report('model-error',manual);status('model-error');retryAt=now()+60000;return false;}
    if(!config?.baseUrl||!(config.visionModel||config.model)){report('model-missing',manual);status('model-missing');retryAt=now()+60000;return false;}
    const token=++generation,controller=new AbortController(),started=now();flight={controller,target,manual};report('observing',manual);status('observing');schedule();
    try{
      let image=await capture(target,controller.signal);controller.signal.throwIfAborted();
      report('captured',manual,{bytes:image.length});report('requesting',manual);
      const result=await classify({config,image,signal:controller.signal});image=null;
      if(token!==generation||controller.signal.aborted)return false;
      report('classified',manual,{codex:result.codex,working:result.working,activity:result.activity,durationMs:now()-started});
      const current=manual?target:await activeWindow();
      if(dead||token!==generation||controller.signal.aborted||(!enabled&&!manual))return false;
      if(!available()){report('hidden',manual);status('hidden');return false;}
      if(!manual&&(!rule.accepts(current)||current.id!==target.id||current.owner?.processId!==target.owner?.processId)){tracked=null;report('context-changed',manual);status('context-changed');return false;}
      if(busy()||idleSeconds()>180){report('busy',manual);status('busy');return false;}
      lastActivity=result.activity;
      if(!rule.matches(result)){report('no-match',manual);status('no-match');retryAt=now()+180000;return false;}
      const lines=rule.lines;
      const index=(lastLine+1+Math.floor(random()*(lines.length-1)))%lines.length;
      const accepted=await deliver({text:lines[index]});
      if(token===generation)report(accepted?'cooldown':'busy',manual,{accepted});
      if(dead||token!==generation||!accepted){if(!dead&&token===generation)status('busy');return false;}
      lastLine=index;nextAllowed=now()+900000+random()*600000;status('cooldown');return true;
    }catch(error){
      if(!dead&&token===generation&&!controller.signal.aborted){report(errorCode(error),manual);status(errorCode(error));retryAt=now()+60000;}
      return false;
    }finally{if(flight?.controller===controller)flight=null;onChange(state());}
  }
  async function tick(force=false){
    if(dead||polling||(!enabled&&armedAt===null&&!flight&&!force))return false;
    // A native menu is a UI pause, not a character interaction. Keep both the
    // status being inspected and a manual countdown until that menu closes.
    if(paused())return false;
    // An explicit snapshot is not tied to foreground changes after capture.
    // Automatic polling must not revoke it; real interactions still interrupt.
    if(flight?.manual)return false;
    const manual=force||(armedAt!==null&&now()>=armedAt);
    if(armedAt!==null&&!manual)return false;
    if(!available()){cancel();if(manual){armedAt=null;report('hidden',true);}status('hidden');return false;}
    polling=true;let target;
    try{target=await (manual?manualTarget():activeWindow());}catch(error){const reason=error?.message==='window-provider-missing'?'window-provider-missing':'unavailable';if(manual){armedAt=null;report(reason,true);}status(reason);return false;}finally{polling=false;}
    if(dead||(!enabled&&!manual&&!flight))return false;
    if(paused())return false;
    if(manual)armedAt=null;
    if(!available()){cancel();if(manual){armedAt=null;report('hidden',true);}status('hidden');return false;}
    if(!isTarget(target)){cancel();if(manual)report('capture-unavailable',true);status('capture-unavailable');return false;}
    if(!manual&&!rule.accepts(target)){cancel();status('no-rule');return false;}
    const identity=(target.kind||'window')+':'+target.id+':'+target.owner?.processId;
    if(tracked!==identity){cancel();tracked=identity;since=now();}
    if(lastSample!==null&&now()-lastSample>pollMs*3)since=now();
    lastSample=now();
    if(idleSeconds()>180){cancel();if(manual)report('idle',true);status('idle');return false;}
    if(busy()){cancel(false);if(manual)report('busy',true);status('busy');return false;}
    if(flight)return false;
    if(!manual&&now()<nextAllowed){status('cooldown');return false;}
    if(!manual&&now()<retryAt)return false;
    if(!manual&&now()-since<dwellMs){status('watching');return false;}
    return observe(target,manual);
  }
  function setEnabled(value){enabled=value===true;armedAt=null;cancel();status(enabled?'watching':'disabled');if(!enabled&&timer!==null){clock.clearTimeout(timer);timer=null;}schedule();onChange(state());}
  function arm(){if(dead)return;cancel();if(timer!==null){clock.clearTimeout(timer);timer=null;}armedAt=now()+5000;report('armed',true);status('armed');schedule();}
  function destroy(){dead=true;armedAt=null;cancel();if(timer!==null)clock.clearTimeout(timer);timer=null;}
  schedule();
  return {tick,arm,setEnabled,interrupt,state,destroy};
}
module.exports={create,errorCode};
