(async function(){
  'use strict';
  const errors=[];let runtime=null,renderer=null,failed=false,fallbackInstalled=false;
  const notice=document.querySelector('#notice');
  const shellMessages=Object.freeze({
    'No rescue channel available':'无可用救援通道，暂不能隐藏或开启穿透。',
    'Window state save failed':'窗口设置保存失败，本次操作仍然有效。',
    'Native menu unavailable':'菜单暂时不可用，请稍后重试。',
    'Native drag dimensions did not settle':'窗口移动未能稳定，请稍后重试。',
  });
  const stateMessages=Object.freeze({
    WINDOW_STATE_INVALID:'窗口设置损坏，已暂停保存；本次调整不会保留。请退出后处理原文件。',
    WINDOW_STATE_UNSUPPORTED:'窗口设置版本不支持，已暂停保存；请使用兼容版本处理原文件。',
    WINDOW_STATE_READ_ERROR:'窗口设置读取失败，已暂停保存；请排除读取问题后重启。',
  });
  function updateNotice(state){
    if(failed)return;
    const error=state.shell?.lastError,code=state.shell?.stateNoticeCode;
    const warning=error!=null&&error!=='',storageWarning=code!=null&&code!=='';
    const messages=[];
    if(warning)messages.push(typeof error==='string'&&Object.hasOwn(shellMessages,error)?shellMessages[error]:'操作未能完成，请稍后重试。');
    if(storageWarning)messages.push(typeof code==='string'&&Object.hasOwn(stateMessages,code)?stateMessages[code]:'窗口设置状态异常，已暂停保存；请退出后检查。');
    document.body.dataset.warning=String(messages.length>0);
    notice.textContent=messages.length?[...new Set(messages)].join(' '):'';
  }
  function fallback(){
    if(fallbackInstalled)return;
    fallbackInstalled=true;
    document.querySelector('#toolbar').hidden=false;
    runtime?.destroy();
    window.pet?.setInteractive(true);
    // A failed renderer must still leave the candidate's native exit menu reachable.
    document.querySelector('#menu').addEventListener('click',event=>{
      const c=document.querySelector('#character').getBoundingClientRect(),r=document.querySelector('#toolbar').getBoundingClientRect();
      const x=event.clientX-c.x,y=event.clientY-c.y;
      const inside=[c.x,c.y,c.width,c.height,event.clientX,event.clientY].every(Number.isFinite)
        &&c.width>0&&c.height>0&&x>=0&&y>=0&&x<=c.width&&y<=c.height;
      window.pet?.menu(inside?{x,y}:{x:r.x+r.width/2-c.x,y:r.y+r.height-c.y});
    });
    document.querySelector('#hide').addEventListener('click',()=>window.pet?.command('quit'));
  }
  function report(error){
    failed=true;
    const message=String(error?.stack||error);errors.push(message);window.__desktopFailure=message;
    document.body.dataset.failed='true';notice.textContent='小伯白未能运行，请用菜单退出。';console.error(message);
    if(runtime)fallback();
  }
  window.addEventListener('error',event=>report(event.error||event.message));
  window.addEventListener('unhandledrejection',event=>report(event.reason));
  try{
    if(!window.pet)throw Error('Isolated desktop preload is unavailable');
    const canvas=document.querySelector('#character');
    renderer=await CharacterRenderer.create(canvas);
    runtime=DesktopRuntime.attach({canvas,toolbar:document.querySelector('#toolbar'),pet:window.pet,renderer,onError:report,onState:updateNotice});
    if(!failed)runtime.start();
    // Runtime reports a caught render failure via onError; a normal pause does not.
    if(failed){fallback();return;}
    updateNotice(runtime.status());
    window.__desktop=Object.freeze({
      status:()=>({ready:!failed,runtime:runtime.status(),render:renderer.status(),errors:errors.slice()}),
      headInputPoint:renderer.headInputPoint,
      hitOpaque:renderer.hitOpaque,
      headHit:renderer.hitTest,
      viewport:()=>{const r=canvas.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};}
    });
    window.addEventListener('pagehide',()=>runtime.destroy(),{once:true});
  }catch(error){
    report(error);
    fallback();
  }
})();
