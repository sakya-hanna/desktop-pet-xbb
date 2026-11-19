(async function(){
 'use strict';
 const $=id=>document.getElementById(id),bridge=window.studio;
 const canvas=$('character'),stage=$('stage'),wrap=$('canvas-wrap'),notice=$('notice');
 const actions=new Set(),states=new Set(),chatListeners=new Set(),disposers=[],overrides={};
 let runtime,renderer,mainState,zoom=1,pan={x:0,y:0},walkOrigin=null,frames=0,bubbleTimer=null,themeTimer=null,disposed=false;
 let background='auto',showMesh=false,panelOpen=true,lastPhase='';
 const params=[
  {key:'lookX',label:'左右转头',min:-.7,max:.7,step:.01,unit:'',digits:2},
  {key:'lookY',label:'抬头 / 低头',min:-.45,max:.55,step:.01,unit:'',digits:2},
  {key:'headRoll',label:'轻轻歪头',min:-.055,max:.055,step:.001,unit:'°',degrees:true,digits:1},
  {key:'bodyRoll',label:'身体侧倾',min:-.065,max:.065,step:.001,unit:'°',degrees:true,digits:1},
  {key:'breath',label:'呼吸起伏',min:0,max:1,step:.01,unit:'',digits:2}
 ];
 function report(error){document.body.dataset.failed='true';notice.textContent='主窗口未能完成加载，请关闭窗口返回桌宠。';console.error(error);window.__studioFailure=String(error?.stack||error);if(!runtime)bridge?.ready();}
 function action(name){for(const fn of actions)fn(name);}
 function localState(){const r=canvas.getBoundingClientRect();return {mode:mainState.mode,visible:true,idleEnabled:mainState.idleEnabled,clickThrough:false,wanderEnabled:false,
  followEnabled:mainState.followEnabled,fxEnabled:mainState.fxEnabled,
  bounds:{x:0,y:0,width:r.width,height:r.height},workArea:{x:-r.width,y:0,width:r.width*3,height:r.height},reminderActive:false};}
 function stateChanged(){if(mainState)for(const fn of states)fn(localState());}
 const switches=[['idle','idle','idleEnabled'],['follow','follow','followEnabled'],['fx-enabled','effects','fxEnabled']];
 function syncSwitches(){for(const [id,,key]of switches)$(id).checked=mainState[key]!==false;}
 function camera(){wrap.style.transform=`translate(${pan.x}px,${pan.y}px) scale(${zoom})`;$('scale').value=Math.round(zoom*100);$('scale-value').textContent=Math.round(zoom*100)+'%';stateChanged();}
 function resetCamera(){action('shell:cancel');pan={x:0,y:0};zoom=1;camera();}
 function clearParameters(){for(const key of Object.keys(overrides))delete overrides[key];for(const p of params)$('param-'+p.key).closest('.parameter').dataset.manual='false';}
 function showPanel(value){panelOpen=value;$('panel').hidden=!value;document.body.classList.toggle('panel-closed',!value);$('toggle-panel').setAttribute('aria-expanded',String(value));$('toggle-panel').title=value?'收起控制面板':'打开控制面板';stateChanged();}
 function tab(name,focus=false){for(const button of document.querySelectorAll('[data-tab]')){const active=button.dataset.tab===name;button.setAttribute('aria-selected',String(active));button.tabIndex=active?0:-1;$('page-'+button.dataset.tab).hidden=!active;if(active&&focus)button.focus();}}
 function applyBackground(value=background){
  background=value;const hour=new Date().getHours();document.body.dataset.theme=value==='auto'?(hour>=7&&hour<19?'day':'night'):value;
  for(const button of document.querySelectorAll('[data-bg]'))button.setAttribute('aria-pressed',String(button.dataset.bg===value));
  try{localStorage.setItem('baijie-studio-background',value);}catch{}
 }
 function positionBubble(){
  if($('speech').hidden||!renderer)return;
  const p=renderer.headInputPoint(),r=stage.getBoundingClientRect(),b=$('speech');
  b.style.left=Math.max(12,Math.min(r.width-b.offsetWidth-12,p.x-r.x+45))+'px';
  b.style.top=Math.max(12,Math.min(r.height-b.offsetHeight-12,p.y-r.y-b.offsetHeight-22))+'px';
 }
 function feedback(value){
  clearTimeout(bubbleTimer);bubbleTimer=null;
  $('speech').hidden=!value;
  if(!value){$('speech-text').textContent='';return;}
  const text=[...value.text];$('speech-text').textContent=text.length>120?text.slice(0,120).join('')+'…（完整回复见聊天窗口）':value.text;
  positionBubble();bubbleTimer=setTimeout(()=>feedback(null),value.durationMs||3400);
 }
 function drawMesh(){
  if(showMesh)renderer.drawWireframe();
 }
 function updateReadouts(pose){
  for(const p of params){const value=pose[p.key]||0;if(!(p.key in overrides))$('param-'+p.key).value=value;$('value-'+p.key).textContent=(value*(p.degrees?180/Math.PI:1)).toFixed(p.digits)+p.unit;}
  const state=runtime?.status(),motion=state?.motion;
  const active=motion?.referenceMotion?.active;
  const phase=state?.activePointer!==null&&state?.activePointer!==undefined?'正在和你互动':state?.walk?'慢慢散步':motion?.referenceMotion?.micro?.id==='care'?'回头看看你':ReferenceMotion.catalog.find(a=>a.id===(active?.name||active?.id))?.label||'自在地陪着你';
  if(phase!==lastPhase){lastPhase=phase;$('presence-state').textContent=phase;}
 }
 try{
  if(!bridge)throw Error('Studio bridge missing');
  mainState=await bridge.read();
  const makeButton=(label,name)=>{const b=document.createElement('button');b.type='button';b.textContent=label;b.dataset.action=name;return b;};
  $('expressions').append(makeButton('自然切换','face:auto'),...mainState.faces.map(f=>makeButton(f.label,'face:'+f.id)));
  const motionList=[{id:'care',label:'主动回望'},...ReferenceMotion.catalog];
  $('motions').append(makeButton('眨眨眼','blink'),makeButton('小跳一下','hop'),...motionList.map(m=>makeButton(m.label,'motion:'+m.id)),makeButton('散步一小段','walk:now'));
  for(const p of params){
   const row=document.createElement('div');row.className='parameter';
   const label=document.createElement('label');label.htmlFor='param-'+p.key;label.append(document.createTextNode(p.label));
   const out=document.createElement('output');out.id='value-'+p.key;out.textContent='自动';label.append(out);
   const input=document.createElement('input');Object.assign(input,{type:'range',id:'param-'+p.key,min:p.min,max:p.max,step:p.step,value:0});
   input.addEventListener('input',()=>{overrides[p.key]=Number(input.value);row.dataset.manual='true';});row.append(label,input);$('parameters').append(row);
  }
  try{const saved=localStorage.getItem('baijie-studio-background');if(['auto','day','night','plain'].includes(saved))background=saved;}catch{}
  applyBackground();themeTimer=setInterval(()=>{if(background==='auto')applyBackground();},60000);
  syncSwitches();
  for(const [id,name]of switches)$(id).addEventListener('change',()=>bridge.command(name,$(id).checked).catch(report));
  $('show-mesh').addEventListener('change',()=>{showMesh=$('show-mesh').checked;drawMesh();});
  $('scale').addEventListener('input',()=>{zoom=Number($('scale').value)/100;camera();});
  $('reset-params').addEventListener('click',clearParameters);$('reset-view').addEventListener('click',resetCamera);$('reset-camera').addEventListener('click',resetCamera);
  for(const button of document.querySelectorAll('[data-tab]'))button.addEventListener('click',()=>tab(button.dataset.tab));
  document.querySelector('.tabs').addEventListener('keydown',event=>{const tabs=['play','params','view'];let i=tabs.indexOf(event.target.dataset.tab);if(i<0)return;if(event.key==='ArrowRight')i=(i+1)%3;else if(event.key==='ArrowLeft')i=(i+2)%3;else if(event.key==='Home')i=0;else if(event.key==='End')i=2;else return;event.preventDefault();tab(tabs[i],true);});
  for(const button of document.querySelectorAll('[data-bg]'))button.addEventListener('click',()=>applyBackground(button.dataset.bg));
  for(const [id,name]of [['open-chat','chat'],['open-settings','settings'],['open-tools','tools'],['return-desktop','desktop']])$(id).addEventListener('click',()=>bridge.command(name).catch(report));
  $('toggle-panel').addEventListener('click',()=>showPanel(!panelOpen));
  for(const button of document.querySelectorAll('[data-action]'))button.addEventListener('click',()=>{
   clearParameters();action(button.dataset.action);
   if(button.dataset.action.startsWith('face:'))for(const b of $('expressions').querySelectorAll('button'))b.setAttribute('aria-pressed',String(b===button));
  });
  renderer=await CharacterRenderer.create(canvas);
  const wrapped={...renderer,render(pose,...args){
   const state=runtime?.status();const output=state?.activePointer===null||!state?{...pose,...overrides}:pose;
   renderer.render(output,...args);
   drawMesh();
   if(++frames%4===0){positionBubble();updateReadouts(output);}
  }};
  const subscribe=(set,fn)=>{set.add(fn);return()=>set.delete(fn);};
  const pet={
   ready:()=>{},getState:()=>localState(),setInteractive:()=>{},feedback,
   onAction:fn=>subscribe(actions,fn),onState:fn=>subscribe(states,fn),onChatPresentation:fn=>subscribe(chatListeners,fn),
   command:name=>name==='hide'?bridge.command('desktop'):name==='chat-cancel'?bridge.command(name):Promise.resolve(false),
   menu:()=>showPanel(!panelOpen),
   drag:(dx,dy)=>{pan.x=Math.max(-stage.clientWidth/2,Math.min(stage.clientWidth/2,pan.x+dx));pan.y=Math.max(-stage.clientHeight/3,Math.min(stage.clientHeight/3,pan.y+dy));camera();},
   resizeBy:factor=>{zoom=Math.max(.7,Math.min(1.35,zoom*factor));camera();},
   walk:value=>{if(value.phase==='begin')walkOrigin={...pan};else if(value.phase==='step'&&walkOrigin){pan.x=walkOrigin.x+value.offset;wrap.style.transform=`translate(${pan.x}px,${pan.y}px) scale(${zoom})`;}else if(value.phase==='end')walkOrigin=null;}
  };
  runtime=DesktopRuntime.attach({canvas,toolbar:$('toolbar'),renderer:wrapped,pet,onError:report,onState:()=>{}});
  disposers.push(bridge.onState(value=>{mainState=value;syncSwitches();stateChanged();}));
  disposers.push(bridge.onChat(value=>{for(const fn of chatListeners)fn(value);}));
  window.addEventListener('resize',stateChanged);
  runtime.start();notice.textContent='';bridge.ready();
  window.__studio=Object.freeze({headInputPoint:renderer.headInputPoint,status:()=>({ready:!window.__studioFailure,runtime:runtime.status(),render:renderer.status(),background,zoom,overrides:{...overrides},showMesh,panelOpen,bubble:$('speech').hidden?null:$('speech-text').textContent})});
 }catch(error){report(error);}
 function dispose(){if(disposed)return;disposed=true;clearTimeout(bubbleTimer);clearInterval(themeTimer);for(const fn of disposers)fn();runtime?.destroy();window.removeEventListener('resize',stateChanged);}
 window.addEventListener('pagehide',dispose,{once:true});
})();
