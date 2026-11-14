(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.PreviewView=api;})(globalThis,function(){
  'use strict';
  function cameraFor(width,height,detail,binding){
    if(detail)return {x:135,y:-90,w:340,h:340*height/width};
    const scale=height*0.8/binding.height,w=width/scale,h=height/scale;
    return {x:(binding.width-w)/2,y:(binding.height-h)/2,w,h};
  }
  return {cameraFor};
});
