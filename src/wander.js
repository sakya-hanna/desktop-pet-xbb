(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.BaijieWander=api;
})(globalThis,function(){
  'use strict';
  // One clock, advanced by the existing renderer RAF. Root displacement is
  // sampled from the same gait phase as the picture, never a separate timer.
  function create({random=Math.random,send=()=>{},cycleSeconds=1.12,stride=120,gaits=null}={}){
    let time=0,next=90+random()*90,active=null,sequence=0,enabled=true;
    const defer=()=>{next=time+150+random()*150;};
    function cancel(){
      if(active){send({phase:'end',id:active.id});active=null;}
      defer();
    }
    function setEnabled(value){enabled=value===true;if(!enabled)cancel();}
    function start(bounds,area){
      if(active||!bounds||!area)return false;
      const scale=bounds.height*.8/800;
      const strideFor=side=>gaits?.[side]?.at(-1)||stride;
      const rooms={left:bounds.x-area.x,right:area.x+area.width-bounds.x-bounds.width};
      let direction=random()<.5?'left':'right';
      if(rooms[direction]<strideFor(direction)*scale+8)direction=direction==='left'?'right':'left';
      const strideLength=strideFor(direction),step=strideLength*scale;
      const cycles=Math.min(1+Math.floor(random()*2),Math.floor((rooms[direction]-8)/step));
      if(cycles<1){defer();return false;}
      active={id:++sequence,direction,age:0,cycles,scale,stride:strideLength,offset:0,phase:'turn',frame:0};
      send({phase:'begin',id:active.id});return true;
    }
    function advance(dt,{blocked=false,busy=false,bounds,area}={}){
      const delta=Math.max(0,Math.min(.1,Number.isFinite(dt)?dt:0));time+=delta;
      if(blocked){cancel();return null;}
      if(!active){
        if(enabled&&!busy&&time>=next)start(bounds,area);
        return snapshot();
      }
      active.age+=delta;
      const turn=.36,walk=active.cycles*cycleSeconds,stop=.42;
      if(active.age<turn){active.phase='turn';active.frame=Math.min(1,Math.floor(active.age/.18));}
      else if(active.age<turn+walk){
        active.phase='walk';
        const cycles=(active.age-turn)/cycleSeconds;
        active.frame=Math.floor(cycles%1*8)%8;
        // Authored support-foot positions determine travel between frames.
        // The analytic curve is used only without an authored gait.
        const curve=gaits?.[active.direction],f=cycles%1*8,index=Math.floor(f),u=f-index;
        const half=cycles*2,part=half%1;
        const distance=curve?Math.floor(cycles)*active.stride+curve[index]+(curve[index+1]-curve[index])*u:
          (Math.floor(half)+part-Math.sin(part*Math.PI*2)*.06)*active.stride/2;
        active.offset=distance*active.scale*(active.direction==='left'?-1:1);
        send({phase:'step',id:active.id,offset:active.offset});
      }else if(active.age<turn+walk+stop){
        if(active.phase==='walk'){
          active.offset=active.cycles*active.stride*active.scale*(active.direction==='left'?-1:1);
          send({phase:'step',id:active.id,offset:active.offset});
        }
        active.phase='stop';active.frame=Math.min(1,Math.floor((active.age-turn-walk)/.21));
      }else cancel();
      return snapshot();
    }
    function snapshot(){return active?{...active}:null;}
    return {advance,start,cancel,setEnabled,snapshot};
  }
  return {create};
});
