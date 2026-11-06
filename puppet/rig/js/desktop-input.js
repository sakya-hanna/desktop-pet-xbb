// Keep native window dragging separate from an expression click.
(function(root){
 function bindDesktopInput(host,pet,onClick,hooks={}){
  let down=null;
  function end(e,reason='cancel'){
   if(!down)return false;
   const active=down;down=null;
   try{return hooks.pointerEnd?.(e,{reason,grip:active.grip})===true;}
   finally{hooks.end?.();}
  }
  host.addEventListener('contextmenu',e=>{
   e.preventDefault();if(hooks.canMenu && !hooks.canMenu(e))return;end(e,'menu');hooks.begin?.();
   pet?.menu?.({x:e.screenX,y:e.screenY});
   // Native menu suspension is owned by main; this local interruption only starts cooldown.
   hooks.end?.();
  });
  host.addEventListener('pointerdown',e=>{
   if(e.button!==0 || (hooks.canStart && !hooks.canStart(e)))return;
   end(e,'replaced');
   down={id:e.pointerId,x:e.screenX,y:e.screenY,startX:e.screenX,startY:e.screenY,moved:false,windowDrag:hooks.isDragHandle?!!hooks.isDragHandle(e):true,grip:!!hooks.isDragHandle?.(e)};
   hooks.begin?.();
   hooks.pointerBegin?.(e,{grip:down.grip});
   try{e.target?.setPointerCapture?.(e.pointerId);}catch(_){/* Release/blur still balance the hold when capture is unavailable. */}
  });
  host.addEventListener('pointermove',e=>{
   if(!down||e.pointerId!==down.id)return;
   hooks.pointerMove?.(e,{grip:down.grip});
   if(!down.moved&&Math.hypot(e.screenX-down.startX,e.screenY-down.startY)<4)return;
   down.moved=true;
   const dx=e.screenX-down.x,dy=e.screenY-down.y;
   down.x=e.screenX;down.y=e.screenY;
   if(down.windowDrag&&Number.isFinite(dx)&&Number.isFinite(dy))pet?.drag?.(dx,dy);
  });
  host.addEventListener('pointerup',e=>{
   if(!down||e.pointerId!==down.id)return;
   const click=e.button===0&&!down.grip&&!down.moved&&Math.hypot(e.screenX-down.startX,e.screenY-down.startY)<4;
   const consumed=end(e,'release');if(click&&!consumed)onClick(e);
  });
  host.addEventListener('pointercancel',e=>{if(down&&(e.pointerId==null||e.pointerId===down.id))end(e,'pointercancel');});
  host.addEventListener('lostpointercapture',e=>{if(down&&e.pointerId===down.id)end(e,'lostpointercapture');});
  host.addEventListener('blur',e=>end(e,'blur'));
  return {cancel:()=>end(undefined,'cancel')};
 }
 const api={bindDesktopInput};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.DesktopInput=api;
})(typeof window!=='undefined'?window:globalThis);
