(function(root){
  'use strict';
  const touchEffects={
    head:[['♥',336,56,2]],cheek:[['♥',336,70],['spark']],hand:[['♥',335,90]],
    chest:[['!',298,45],['sweat',344,72]],skirt:[['!',336,52]],
    feet:[['spark',null,null,2],['♪',338,68]],shoesOff:[['spark',null,null,2],['♪',338,68]],
    belly:[['♪',336,70]]
  };
  const motionEffects={
    hum:[[.45,'♪',340,68],[1.65,'♫',254,72],[2.85,'♪',344,64],[4.05,'♫',258,70]],
    doze:[[.65,'Z',338,66],[1.6,'Z',344,58],[2.5,'!',298,38]],
    wake:[[.55,'!',298,38]],
    sneeze:[[1.15,'spark',332,84,2],[1.15,'sweat',342,72]],
    rouse:[[.05,'spark',336,64]],bounce:[[.05,'♪',338,66],[.6,'♫',338,66]]
  };
  const colors={'♥':'#ff85ab','♪':'#7bb4df','♫':'#7bb4df',Z:'#8faed9','!':'#ffe27a'};

  function draw(ctx,type,size,age){
    if(type==='spark'){
      ctx.strokeStyle='#f5c966';
      ctx.lineWidth=1.6;
      ctx.rotate(age*1.1);
      ctx.beginPath();
      for(let i=0;i<4;i++){
        ctx.moveTo(0,size*.18);
        ctx.lineTo(0,size*(.43+age*.24));
        ctx.rotate(Math.PI/2);
      }
      ctx.stroke();
    }else if(type==='sweat'){
      ctx.fillStyle='#8fd0ff';
      ctx.strokeStyle='#fff';
      ctx.lineWidth=1.2;
      ctx.beginPath();
      ctx.moveTo(0,-size*.52);
      ctx.quadraticCurveTo(size*.42,size*.05,0,size*.36);
      ctx.quadraticCurveTo(-size*.42,size*.05,0,-size*.52);
      ctx.fill();ctx.stroke();
    }else{
      ctx.font=`700 ${size}px "Segoe UI Symbol", sans-serif`;
      ctx.textAlign='center';
      ctx.textBaseline='middle';
      ctx.strokeStyle=type==='!'?'#6c5328':'#fff';
      ctx.lineWidth=2;
      ctx.strokeText(type,0,0);
      ctx.fillStyle=colors[type];
      ctx.fillText(type,0,0);
    }
  }

  function create(canvas,renderer){
    const ctx=canvas?.getContext('2d');
    if(!ctx)return null;
    const particles=[];
    let expressionId,action,elapsed=-1,preparing=false,jumping=false,painted=false;
    function clear(){
      particles.length=0;
      if(!painted)return;
      ctx.setTransform(1,0,0,1,0,0);
      ctx.clearRect(0,0,canvas.width,canvas.height);
      painted=false;
    }
    function update(state,enabled){
      const next=state.referenceMotion?.active||null;
      const inPreparation=state.idleAction?.phase==='preparing';
      const time=inPreparation?-1:state.idleAction?.elapsed||0;
      const previous=next===action&&time>=elapsed?elapsed:-1;
      const expression=state.expression;
      const inJump=state.phase==='prepare';
      if(enabled){
        function emit(type,x,y,count=1){
          for(let i=0;i<count&&particles.length<24;i++){
            const spread=(Math.random()-.5)*16;
            particles.push({type,point:[x+spread,y+spread*.25],drift:(Math.random()-.5)*.95,
              start:state.time,duration:1.05+Math.random()*.5});
          }
        }
        if(inPreparation&&next==='wake'&&!preparing)emit('Z',338,64,2);
        for(const [at,...effect] of motionEffects[next]||[])if(previous<at&&time>=at)emit(...effect);
        if(inJump&&!jumping)emit('♪',338,66);
        if(expression&&expression.id!==expressionId){
          const [fx,fy]=expression.effectPoint||[338,70];
          for(const [type,x,y,count] of touchEffects[expression.kind]||[])emit(type,x??fx,y??fy,count);
        }
      }
      action=next;elapsed=time;preparing=inPreparation;jumping=inJump;expressionId=expression?.id;
      if(!enabled){clear();return;}
      if(!particles.length)return;

      const rect=canvas.getBoundingClientRect();
      if(!rect.width||!rect.height)return;
      const dpr=root.devicePixelRatio||1,w=Math.round(rect.width*dpr),h=Math.round(rect.height*dpr);
      if(canvas.width!==w)canvas.width=w;
      if(canvas.height!==h)canvas.height=h;
      ctx.setTransform(dpr,0,0,dpr,0,0);
      ctx.clearRect(0,0,rect.width,rect.height);
      const size=Math.max(13,Math.min(25,rect.height*.039));
      for(let i=particles.length-1;i>=0;i--){
        const p=particles[i],age=(state.time-p.start)/p.duration;
        if(age>=1){particles.splice(i,1);continue;}
        const point=renderer.projectHeadPoint(p.point);
        const x=point.x-rect.x+p.drift*size*age,y=Math.max(size,point.y-rect.y-size*age*1.8);
        ctx.save();
        ctx.globalAlpha=Math.min(1,.2+age*6,(1-age)*3);
        ctx.translate(x,y);
        draw(ctx,p.type,size,age);
        ctx.restore();
      }
      painted=particles.length>0;
    }
    return {update,clear};
  }
  root.BaijieFX={create};
})(globalThis);
