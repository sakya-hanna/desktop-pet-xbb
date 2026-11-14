(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.DesktopView=api;})(globalThis,function(){
  'use strict';
  function framebufferPoint(rect,width,height,clientX,clientY){
    if(!rect||!['x','y','width','height'].every(k=>Number.isFinite(rect[k]))||rect.width<=0||rect.height<=0
      ||!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<=0||height<=0||!Number.isFinite(clientX)||!Number.isFinite(clientY))return null;
    const x=clientX-rect.x,y=clientY-rect.y;
    if(x<0||y<0||x>=rect.width||y>=rect.height)return null;
    return {x:Math.floor(x/rect.width*width),y:height-1-Math.floor(y/rect.height*height)};
  }
  return {framebufferPoint};
});
