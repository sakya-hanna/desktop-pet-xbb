(function(root,factory){const cjs=typeof module==='object'&&module.exports;const api=factory(cjs?require('./character.js'):root.CharacterBinding,cjs?require('./response-config.js'):root.ResponseConfig,cjs?()=>require('./reference-motion.js'):()=>root.ReferenceMotion,cjs?()=>require('./material-rig.js'):()=>root.MaterialRig);if(cjs)module.exports=api;else root.MotionDirector=api;})(globalThis,function(character,responseConfig,getReference,getRig){
  'use strict';
  const STEP=1/120,clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  function createDirector(options={}){
    const reference=options.idleAction==='qianhuili'?getReference().createMotion({binding:character.binding,idle:options.idle!==false,seed:options.seed}):null;
    const longHair=reference?Object.fromEntries(Object.values(character.parts).filter(p=>p.longHair&&!p.flexible).map(p=>[p.name,getRig().createLongHairDynamics(p,character.binding)])):null;
    const flexHair=reference?Object.fromEntries(Object.values(character.parts).filter(p=>p.flexible).map(p=>[p.name,getRig().createFlexibleHair(p,character.binding)])):null;
    const hairBranches=reference?Object.fromEntries(Object.values(character.parts).flatMap(part=>(part.branches||[]).map(branch=>[branch.name,getRig().createLongHairDynamics(branch,character.binding,part)]))):null;
    let time=0,accumulator=0,pointer=null,lastX=0,contactStart=0,distance=0;
    let releasedAt=-Infinity,bubbleUntil=-Infinity,completedGestures=0;
    let feedbackId=0,feedbackKind=null,feedbackText='',feedbackDuration=3400,expressionId=0;
    let contactKind='head';
    let footSide='left';
    const SHOES_IDLE_SECONDS=60;
    const feet={bare:{left:false,right:false},clicks:{left:[],right:[]},action:null,lastContact:0};
    const footJoints=Object.fromEntries(['left','right'].map(side=>[side,Object.fromEntries(['hip','angle','ankle','lift'].map(k=>[k,{x:0,v:0}]))]));
    // Authored preparation -> two unequal swings -> toe release -> landing.
    // Chieri-style springs filter the targets; the ankle follows more slowly.
    const footKeys=[
      [0,0,0,0,0],[.18,-.012,0,0,0],[.50,.018,.065,-.025,9],
      [.82,.024,-.055,.055,11],[1.14,.020,.045,-.04,10],
      [1.40,.014,.018,.070,9],[1.85,.008,-.014,.035,6],
      [2.15,0,0,0,1],[2.30,0,0,0,0],[2.50,0,0,0,0]
    ];
    function footPhase(){
      if(!feet.action)return null;
      const a=feet.action,u=time-a.start,index=Math.floor(u/2.5);
      return {side:a.order[index],v:u-index*2.5,putOn:a.putOn};
    }
    function stepFeet(){
      const phase=footPhase();
      for(const [side,joints]of Object.entries(footJoints)){
        const target={hip:0,angle:0,ankle:0,lift:0};
        if(phase?.side===side){
          let i=0;while(i<footKeys.length-2&&phase.v>footKeys[i+1][0])i++;
          const a=footKeys[i],b=footKeys[i+1],t=turnEase((phase.v-a[0])/(b[0]-a[0])),sign=side==='left'?1:-1;
          ['hip','angle','ankle','lift'].forEach((k,j)=>{target[k]=(a[j+1]+(b[j+1]-a[j+1])*t)*(k==='lift'?1:sign);});
        }
        for(const [k,joint]of Object.entries(joints)){const config={hip:[90,20],angle:[125,16],ankle:[65,11],lift:[110,20]}[k];spring(joint,target[k],...config);}
      }
    }
    function footSupport(){
      const phase=footPhase();if(!phase?.side)return null;
      const sign=phase.side==='left'?1:-1,load=turnEase(phase.v/.16)*(1-turnEase((phase.v-1.85)/.55));
      return {lean:sign*load,swing:footJoints[phase.side].angle.v*load};
    }
    function feetPose(){
      const legs={},phase=footPhase();
      for(const [side,joints]of Object.entries(footJoints)){
        const f=Object.fromEntries(Object.entries(joints).map(([k,s])=>[k,s.x]));
        const v=phase?.v;
        f.drop=phase?.side===side?(phase.putOn?(v>=.7&&v<1.4?1-ease((v-.7)/.7):0):ease((v-1.4)/.65)):0;
        if(Object.values(f).some(v=>Math.abs(v)>1e-5))legs[side]=f;
      }
      return {bare:{...feet.bare},legs,active:!!feet.action};
    }
    function cancelFeet(){feet.action=null;feet.lastContact=time;feet.clicks={left:[],right:[]};for(const joints of Object.values(footJoints))for(const s of Object.values(joints)){s.x=0;s.v=0;}}
    function tickleFoot(){
      if(feet.action)return;
      const clicks=feet.clicks[footSide].filter(t=>time-t<=6);clicks.push(time);feet.clicks[footSide]=clicks;
      if(clicks.length>=5&&!feet.bare[footSide]){
        feet.action={start:time,putOn:false,order:[footSide,footSide==='left'?'right':'left'].filter(s=>!feet.bare[s])};feet.clicks={left:[],right:[]};showFeedback('shoesOff');
      }else{showFeedback('feet');reference?.react('feet');}
    }

    let headStroke=null,cheekPoint=null,cheekUntil=0;
    const cheekSpring={x:0,v:0};
    const response=responseConfig.createConfig(options.responseConfig);
    let expression=null,expressionUsed=false;
    function showFeedback(kind){
      // Repeat the interaction, not the notification. Keep the current bubble's
      // identity and deadline until it expires, unless the semantic action changes.
      if(feedbackKind!==kind||time>=bubbleUntil){
        feedbackKind=kind;feedbackText=response.lines[kind];feedbackDuration=responseConfig.durationMs(feedbackText);feedbackId++;bubbleUntil=time+feedbackDuration/1000;
      }
      expressionUsed=true;
      expression={id:++expressionId,kind,start:time,held:grab==='active'&&(['hand','skirt','hair'].includes(kind)),expires:time+response.expressions[kind].reduce((sum,s)=>sum+s.durationMs,0)/1000};
      if(kind==='feet'||kind==='shoesOff')expression.effectPoint=[footSide==='left'?235:335,690];
      if(kind==='cheek')expression.effectPoint=cheekPoint;
    }
    function expressionSnapshot(){
      if(!expression||(!expression.held&&time>=expression.expires))return null;
      if(expression.released)return {id:expression.id,kind:expression.kind,semantic:expression.releaseSemantic,face:response.faces[expression.releaseSemantic],phase:'recover'};
      let age=(time-expression.start)*1000;
      for(const step of response.expressions[expression.kind]){
        if(age<step.durationMs)return {id:expression.id,kind:expression.kind,semantic:step.semantic,face:response.faces[step.semantic],phase:'reply',
          ...(expression.effectPoint?{effectPoint:expression.effectPoint.slice()}: {})};
        age-=step.durationMs;
      }
      if(expression.held){const semantic=response.expressions[expression.kind].at(-1).semantic;return {id:expression.id,kind:expression.kind,semantic,face:response.faces[semantic],phase:'hold'};}
      return null;
    }
    function clearInteractionFeedback(){bubbleUntil=-Infinity;expression=null;}
    function clearFeedback(){
      clearInteractionFeedback();reference?.clearPresentation();
      cheekUntil=0;
    }
    function releaseExpression(){
      if(expression?.held){expression.releaseSemantic=['head','hand'].includes(expression.kind)?response.release.semantic:expressionSnapshot().semantic;expression.held=false;expression.released=true;expression.expires=time+response.release.durationMs/1000;}
    }
    let grabId='arm-screen-left';
    const grabSprings=Object.fromEntries(Object.keys(character.grabs).map(id=>[id,[{x:0,v:0},{x:0,v:0}]])),usedGrabs=new Set();
    let grab=null,grabTarget=[0,0],grabUsed=false;
    const skirtContacts={},skirtRecoil=[],hairContacts={},hairRecoil=[];
    function skirtPose(){return {
      hairContacts:Object.fromEntries(Object.entries(hairContacts).map(([id,p])=>[id,p.slice()])), hairRecoil:hairRecoil.map(s=>({partId:s.partId,point:s.point,offset:s.springs.map(j=>j.x)})),
      ...(Object.keys(skirtContacts).length?{skirtContacts:Object.fromEntries(Object.entries(skirtContacts).map(([id,p])=>[id,p.slice()]))}:{}),
      ...(skirtRecoil.length?{skirtRecoil:skirtRecoil.map(s=>({point:s.point.slice(),offset:s.springs.map(j=>j.x)}))}:{})
    };}
    let jumpStart=-Infinity,jumpCounted=true,completedJumps=0,previousVertical=0;
    const idle=options.idle!==false,headMotion=character.headMotion;
    const score=character.idleAction,singleAction=options.idleAction===score.name,living=singleAction;
    let actionStart=null,nextAction=score.first,actionPhase='quiet',actionAge=0,actionCues=0,completedActions=0;
    let idleBlocked=false;
    const passiveCloth=[{x:0,v:0},{x:0,v:0}];
    const turnEase=t=>{t=clamp(t,0,1);return t*t*t*(t*(t*6-15)+10);};
    let seed=(options.seed===undefined?17:options.seed)>>>0,idleStart=-Infinity,nextIdle=3.4,idleDirection=-1,idleValue=0,nextWind=0,windTarget=0,blinkStart=-Infinity,nextBlink=2.1;
    const wind={x:0,v:0};
    const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
    const ease=t=>{t=clamp(t,0,1);return t*t*(3-2*t);};
    function interruptIdle(){idleStart=-Infinity;idleValue=0;nextIdle=time+4+random()*2;}
    function cancelIdleAction(){
      if(reference)return reference.cancel({discardCare:true});
      if(!singleAction)return false;
      const active=actionStart!==null;actionStart=null;actionAge=0;actionCues=0;
      nextAction=time+score.rest;actionPhase=active?'interrupted':'quiet';
      // Retain body/hair/cloth x and v. Only targets and future cues are retired.
      return active;
    }
    function setIdleBlocked(value,recoverySeconds=0){
      const next=value===true;if(next===idleBlocked){if(next)reference?.setBlocked(true,recoverySeconds);return;}
      idleBlocked=next;if(reference){reference.setBlocked(next,recoverySeconds);return;}
      cancelIdleAction();
    }
    function blinkAmount(){const t=time-blinkStart;if(t<0||t>=0.23)return 0;if(t<0.07)return ease(t/0.07);if(t<0.12)return 1;return 1-ease((t-0.12)/0.11);}
    const channels={...(living?{lookX:{x:0,v:0},lookY:{x:0,v:0},breath:{x:0,v:0}}:{}),
      headRoll:{x:0,v:0},headX:{x:0,v:0},headY:{x:0,v:0},bodyRoll:{x:0,v:0},bodyX:{x:0,v:0},bodyY:{x:0,v:0}};
    const eyelid={x:0,v:0};
    const hair={};for(const id of ['outer-left','outer-right','fringe','front-left','front-right'])hair[id]=Array.from({length:3},()=>({x:0,v:0}));
    // Never feed interaction into the base channels/hair: cancellation must
    // reveal the exact same seeded idle/head/jump trajectory, including velocity.
    const coupling=character.coupling;
    // Held hand/garment forces are separate from local material recoil.
    const skirtIntent=[{x:0,v:0},{x:0,v:0}],handIntent=[{x:0,v:0},{x:0,v:0}];
    const reaction={body:Object.fromEntries(['bodyRoll','bodyX','bodyY'].map(id=>[id,{x:0,v:0}])),
      hair:Object.fromEntries(Object.keys(hair).map(id=>[id,Array.from({length:3},()=>({x:0,v:0}))])),
      cloth:Object.fromEntries(Object.keys(coupling.cloth).map(id=>[id,[{x:0,v:0},{x:0,v:0}]]))};
    const interactionSprings=[...Object.values(grabSprings).flat(),...skirtIntent,...handIntent,...Object.values(reaction.body),
      ...Object.values(reaction.hair).flat(),...Object.values(reaction.cloth).flat()];
    function spring(s,target,k,d){s.v+=(k*(target-s.x)-d*s.v)*STEP;s.x+=s.v*STEP;}
    function limitedSpring(s,target,k,d,limit){
      spring(s,clamp(target,-limit,limit),k,d);
      if(Math.abs(s.x)>limit){s.x=clamp(s.x,-limit,limit);if(s.x*s.v>0)s.v=0;}
    }
    function stepReaction(){
      const targets={bodyRoll:0,bodyX:0,bodyY:0};
      // Chieri onMove/leanT -> leanS -> body springs. Only a currently held
      // hand supplies force; release retires that force, not spring velocity.
      // One intent also prevents an old hand's recoil pulling a new contact.
      const handHeld=grab==='active'&&grabId.startsWith('arm-'),handConfig=coupling.body.handIntent;
      for(let axis=0;axis<2;axis++)limitedSpring(handIntent[axis],handHeld?grabTarget[axis]/character.grabs[grabId].limit[axis]:0,handConfig.stiffness,handConfig.damping,1);
      const handGain=coupling.body.hand;
      targets.bodyRoll=handGain.bodyRoll*handIntent[0].x;
      targets.bodyX=handGain.bodyX*handIntent[0].x;
      targets.bodyY=handGain.bodyY*handIntent[1].x;
      const intent=coupling.body.skirtIntent,held=grab==='active'&&grabId.startsWith('skirt-');
      for(let axis=0;axis<2;axis++){
        const normalized=held?grabTarget[axis]/character.grabs[grabId].limit[axis]:0;
        // Small movements stay in the cloth. The soft onset avoids a threshold
        // snap; one filtered intent prevents two skirt targets stacking a lean.
        const amount=ease((Math.abs(normalized)-intent.deadZone)/(1-intent.deadZone));
        limitedSpring(skirtIntent[axis],Math.sign(normalized)*amount,intent.stiffness,intent.damping,1);
      }
      const skirtGain=coupling.body.skirt;
      targets.bodyRoll+=skirtGain.bodyRoll*skirtIntent[0].x;
      targets.bodyX+=skirtGain.bodyX*skirtIntent[0].x;
      targets.bodyY+=skirtGain.bodyY*skirtIntent[1].x;
      for(const [key,s]of Object.entries(reaction.body))limitedSpring(s,targets[key],coupling.body.stiffness,coupling.body.damping,coupling.body.limit[key]);
      const {bodyRoll:roll,bodyX:x,bodyY:y}=reaction.body;
      for(const [id,chain]of Object.entries(reaction.hair)){
        const config=coupling.hair[id==='fringe'?'fringe':id.startsWith('outer-')?'outer':'front'];
        const side=id.includes('right')?0.88:1,verticalSign=id.includes('right')?1:-1;
        // Gravity correction and parent angular/linear velocity only: no
        // pointer injection, extra oscillator or interaction-driven head bend.
        const drive=clamp((-roll.x*config.gravity-roll.v*config.angular-x.v*config.linear)*side+y.v*config.vertical*verticalSign,-0.07,0.07);
        for(let i=0;i<3;i++)limitedSpring(chain[i],i===0?drive:chain[i-1].x+drive*0.35,config.stiffness[i],config.damping[i],0.12);
      }
      for(const [id,chain]of Object.entries(reaction.cloth)){
        const config=coupling.cloth[id],targets=[(-roll.v*14-x.v*90)*config.gain,(-y.v*100+roll.v*3)*config.gain];
        for(let i=0;i<2;i++)limitedSpring(chain[i],targets[i],config.stiffness,config.damping,coupling.clothLimit[i]);
      }
    }
    function jumpSample(){
      const t=time-jumpStart;
      if(t<0.24){const a=clamp(t<0.18?t/0.18:(0.24-t)/0.06,0,1);return {phase:'prepare',hop:0,compression:0.016*a*a*(3-2*a),headY:0.002};}
      if(t<0.72)return {phase:'air',hop:0.075*Math.sin(Math.PI*(t-0.24)/0.48),compression:0,headY:-0.002};
      if(t<1.04)return {phase:'land',hop:0,compression:0.018*Math.sin(Math.PI*(t-0.72)/0.32),headY:0.003};
      return {phase:t<1.3?'recover':null,hop:0,compression:0,headY:0};
    }
    // Runtime lifecycle control, not a pointer message: include released recoil
    // without changing another contact owner or the parent motion timeline.
    function cancelGrab(){
      const changed=!!grab||grabTarget.some(v=>v!==0)||interactionSprings.some(s=>s.x!==0||s.v!==0)||skirtRecoil.length>0;
      // Retiring a contact/recoil must not erase a separately playing action's
      // face and cues. Full lifecycle cancellation owns clearFeedback().
      if(changed)clearInteractionFeedback();
      if(grab){grab=null;pointer=null;}
      grabTarget=[0,0];for(const s of interactionSprings){s.x=0;s.v=0;}
      for(const id of Object.keys(skirtContacts))delete skirtContacts[id];
      skirtRecoil.length=0;hairRecoil.length=0;
      for(const id of Object.keys(hairContacts))delete hairContacts[id];
      return changed;
    }
    function send(event){
      if(!event||typeof event!=='object'||!['down','move','up','cancel','jump','blink','grab-down','grab-move','grab-up','grab-cancel'].includes(event.type))return false;
      if(event.type==='blink'){if(pointer!==null)return false;feet.lastContact=time;blinkStart=time;nextBlink=Math.max(nextBlink,time+0.5);return true;}
      if(event.type!=='jump'&&(!Number.isSafeInteger(event.pointerId)||event.pointerId<0))return false;
      if(event.type==='grab-down'){
        if(pointer!==null||typeof event.partId!=='string'||!Object.hasOwn(grabSprings,event.partId)||jumpSample().phase||(reference&&reference.snapshot().pose.hop>0.0001))return false;
        if(event.materialPoint!==undefined&&(!Array.isArray(event.materialPoint)||event.materialPoint.length!==2||!event.materialPoint.every(Number.isFinite)))return false;
        if(character.grabs[event.partId].hairGrab){
          if(!event.materialPoint)return false;
          const old=hairContacts[event.partId],springs=grabSprings[event.partId];
          if(old&&springs.some(s=>Math.abs(s.x)+Math.abs(s.v)>.0001)){
            hairRecoil.push({partId:event.partId,point:old.slice(),springs:springs.map(s=>({...s}))});
            for(const s of springs){s.x=0;s.v=0;}
          }
          hairContacts[event.partId]=event.materialPoint.slice();
        }
        if(event.partId.startsWith('skirt-')&&event.materialPoint){
          // A second pinch must not teleport an unfinished fold to the new
          // contact. Let the old local bulge finish at its original position.
          const old=skirtContacts[event.partId],springs=grabSprings[event.partId];
          if(old&&springs.some(s=>Math.abs(s.x)+Math.abs(s.v)>.0001)){
            skirtRecoil.push({point:old.slice(),springs:springs.map(s=>({...s}))});
            for(const s of springs){s.x=0;s.v=0;}
          }
          skirtContacts[event.partId]=event.materialPoint.slice();
        }
        feet.lastContact=time;cancelIdleAction();grabId=event.partId;usedGrabs.add(grabId);pointer=event.pointerId;grab='pending';grabUsed=true;expression=null;return true;
      }
      if(['grab-move','grab-up','grab-cancel'].includes(event.type)&&event.partId!==undefined&&event.partId!==grabId)return false;
      if(event.type==='grab-move'){
        if(!grab||pointer!==event.pointerId||![event.x,event.y].every(Number.isFinite))return false;
        const grabConfig=character.grabs[grabId],length=Math.hypot(event.x/grabConfig.limit[0],event.y/grabConfig.limit[1]),scale=1/Math.max(1,length);
        const soft=grabConfig.hairGrab?(length?Math.tanh(length)/length:1):scale;
        grabTarget=[event.x*soft,event.y*soft];
        if(grab==='pending'&&length>0){grab='active';showFeedback(character.grabs[grabId].hairGrab?'hair':grabId.startsWith('arm-')?'hand':'skirt');}
        return true;
      }
      if(event.type==='grab-up'||event.type==='grab-cancel'){
        if(!grab||pointer!==event.pointerId)return false;
        if(event.type==='grab-cancel')return cancelGrab();
        // A held reaction belongs to the gesture, not to the speech deadline.
        // Keep its visible emotion briefly after release, then let runtime fade
        // back to the base face. Cancelled responses must never be revived.
        if(grab==='pending'&&character.grabs[grabId].hairGrab)showFeedback('hair');
        if(grab==='active'&&grabId.startsWith('arm-'))reference?.recordCare('hand');
        releaseExpression();
        grabTarget=[0,0];grab=null;pointer=null;return true;
      }
      if(grab&&['down','move','up','cancel'].includes(event.type))return false;
      if((event.type==='down'||event.type==='move')&&(!Number.isFinite(event.x)||Math.abs(event.x)>2))return false;
      if((event.type==='down'||event.type==='move')&&event.y!==undefined&&(!Number.isFinite(event.y)||Math.abs(event.y)>2))return false;
      if(event.type==='jump'){if(feet.action||pointer!==null||time-jumpStart<1.3)return false;feet.lastContact=time;cancelIdleAction();jumpStart=time;jumpCounted=false;interruptIdle();return true;}
      if(event.type==='down'){
        if(pointer!==null||(event.partId!==undefined&&!['head','cheek','chest','belly','leg','body','feet'].includes(event.partId)))return false;
        if(feet.action)return false;
        if(event.partId==='feet')footSide=event.materialPoint?.[0]<285?'left':'right';
        if(event.partId==='cheek'){
          cheekPoint=event.materialPoint?.[0]<character.binding.neck[0]?character.cheeks.left:character.cheeks.right;
          cheekUntil=0;
        }
        feet.lastContact=time;cancelIdleAction();contactKind=event.partId||'head';pointer=event.pointerId;lastX=event.x;distance=0;contactStart=time;expression=null;
        headStroke=reference&&contactKind==='head'?{active:false,startX:event.x,startY:event.y??0,lastY:event.y??0,x:0,y:0}:null;
        return true;
      }
      if(event.type==='move'&&event.pointerId===pointer&&pointer!==null){
        const dx=event.x-lastX;lastX=event.x;
        if(headStroke){
          const y=event.y??headStroke.lastY;distance+=Math.hypot(dx,(y-headStroke.lastY)*1536/1024);
          headStroke.lastY=y;headStroke.x=(event.x-headStroke.startX)*1024;headStroke.y=(y-headStroke.startY)*1536;
        }else distance+=Math.abs(dx);
        return true;
      }
      if((event.type==='up'||event.type==='cancel')&&pointer!==null&&event.pointerId===pointer){
        if(event.type==='up'&&contactKind==='feet'&&time-contactStart<=.65&&distance<=.025)tickleFoot();
        else if(event.type==='up'&&contactKind==='chest'&&time-contactStart<=0.65&&distance<=0.025)showFeedback('chest');
        else if(event.type==='up'&&contactKind==='head'&&time-contactStart>=0.22&&distance>=0.025){completedGestures++;if(headStroke?.active)releaseExpression();else showFeedback('head');reference?.recordCare('head');}
        else if(event.type==='up'&&time-contactStart<=.65&&distance<=.025){
          const kind=contactKind==='head'?'headTap':contactKind;
          if(kind==='cheek')cheekUntil=time+.09;
          showFeedback(kind);reference?.react(kind);
        }
        else clearFeedback();
        headStroke=null;pointer=null;releasedAt=time;return true;
      }
      return false;
    }
    function step(){
      time+=STEP;stepFeet();
      // This is time without interacting with Baijie, not OS inactivity.
      // Holding a gesture or opening a menu must not start dressing mid-contact.
      if(pointer!==null||feet.action||idleBlocked)feet.lastContact=time;
      if(feet.action){const a=feet.action,u=time-a.start;
        a.order.forEach((side,i)=>{if(u>=i*2.5+1.4)feet.bare[side]=!a.putOn;});
        if(u>=a.order.length*2.5){feet.action=null;if(!a.putOn)showFeedback('barefoot');}}
      if(!feet.action&&pointer===null&&!idleBlocked&&!jumpSample().phase&&time-feet.lastContact>=SHOES_IDLE_SECONDS){
        const order=['left','right'].filter(side=>feet.bare[side]);
        if(order.length&&(!reference||reference.snapshot().pose.hop<=.0001)){
          cancelIdleAction();feet.clicks={left:[],right:[]};
          feet.action={start:time,putOn:true,order};showFeedback('shoesOn');
        }
      }

      // Held cloth follows the hand; released cloth uses Chieri's underdamped
      // skirtSpring (150/6), retaining velocity so it flutters back naturally.
      for(const [id,chain]of Object.entries(grabSprings))for(let i=0;i<2;i++){
        if(character.grabs[id].hairGrab){spring(chain[i],id===grabId?grabTarget[i]:0,160,grab&&grabId===id?24:8);}
        else if(id.startsWith('arm-')){
          const config=coupling.hand[grab&&grabId===id?'held':'released'];
          spring(chain[i],id===grabId?grabTarget[i]:0,config.stiffness,config.damping);
        }else spring(chain[i],id===grabId?grabTarget[i]:0,150,id.startsWith('skirt-')&&!(grab&&grabId===id)?6:25);
      }
      for(let i=skirtRecoil.length-1;i>=0;i--){
        const old=skirtRecoil[i];for(const s of old.springs)spring(s,0,150,6);
        if(old.springs.every(s=>Math.abs(s.x)+Math.abs(s.v)<.0001))skirtRecoil.splice(i,1);
      }
      for(let i=hairRecoil.length-1;i>=0;i--){
        const old=hairRecoil[i];for(const s of old.springs)spring(s,0,160,8);
        if(old.springs.every(s=>Math.abs(s.x)+Math.abs(s.v)<.0001))hairRecoil.splice(i,1);
      }
      const jump=jumpSample();
      if(!jumpCounted&&time-jumpStart>=1.3){completedJumps++;jumpCounted=true;}
      if(cheekPoint)spring(cheekSpring,(pointer!==null&&!grab&&contactKind==='cheek')||time<cheekUntil?1:0,200,24);
      if(reference){
        if(headStroke&&!headStroke.active&&time-contactStart>=.22&&distance>=.025){headStroke.active=true;showFeedback('head');expression.held=true;}
        spring(channels.headY,jump.headY,125,19);stepReaction();
        reference.step(STEP,!!feet.action||idleBlocked||pointer!==null||!!jump.phase||!!expressionSnapshot()||time<bubbleUntil,headStroke?.active?headStroke:null,footSupport());
        if(longHair){
          const p=reference.snapshot().pose,base={...p,headY:p.headY+channels.headY.x,hop:p.hop+jump.hop,compression:jump.compression};
          for(const chain of Object.values(longHair))chain.step(STEP,base);
          for(const chain of Object.values(flexHair))chain.step(STEP,base);
          base.flexHair=Object.fromEntries(Object.entries(flexHair).map(([id,chain])=>[id,chain.snapshot()]));
          base.longHair=Object.fromEntries(Object.entries(longHair).map(([id,chain])=>[id,chain.snapshot()]));
          // Secondary forks consume the moving common attachment. Only the
          // independent interaction overlay is cancelled on grab interruption.
          for(const chain of Object.values(hairBranches))chain.step(STEP,base);
        }
        return;
      }
      if(idle){
        if(time>=nextWind){windTarget=(random()*2-1)*0.028;nextWind=time+1.4+random()*1.6;}
        spring(wind,windTarget,7,4.5);
        if(!singleAction&&!jump.phase&&time>=nextIdle){idleStart=time;nextIdle=Infinity;idleDirection*=-1;}
        const age=time-idleStart;
        const turnEnd=headMotion.turn,holdEnd=turnEnd+headMotion.hold,returnEnd=holdEnd+headMotion.return;
        if(age<turnEnd)idleValue=idleDirection*turnEase(age/turnEnd);
        else if(age<holdEnd)idleValue=idleDirection;
        else if(age<returnEnd)idleValue=idleDirection*(1-turnEase((age-holdEnd)/headMotion.return));
        else{idleValue=0;if(Number.isFinite(idleStart)){idleStart=-Infinity;nextIdle=time+3.5+random()*3;}}
        if(time>=nextBlink&&jump.phase!=='air'){blinkStart=time;nextBlink=time+3.2+random()*2.4;}
      }
      // Head contact never bends the rig. The explicit single-action director
      // yields its authored moment; legacy callers keep their original timeline.
      const input=idleValue*0.65;
      const targets={headRoll:0.1*input*headMotion.rollGain,headX:0.01*input*headMotion.shiftGain,headY:jump.headY,bodyRoll:-0.012*input,bodyX:0,bodyY:idle?0.0015*Math.sin(time*Math.PI*2/4.8):0};
      if(living)Object.assign(targets,{lookX:idle?0.16*Math.sin(time*0.37):0,lookY:idle?0.11*Math.sin(time*0.23+1):0,
        breath:idle?0.5+0.5*Math.sin(time*Math.PI*2/3.4):0,headRoll:idle?0.012*Math.sin(time*0.5):0,
        bodyRoll:idle?0.006*Math.sin(time*0.8):0,bodyY:0,eyeClose:0});
      const blocked=idleBlocked||pointer!==null||!!jump.phase||!!expressionSnapshot()||time<bubbleUntil;
      if(singleAction&&blocked){cancelIdleAction();actionPhase='blocked';}
      else if(singleAction&&actionPhase==='blocked')actionPhase='quiet';
      if(singleAction&&idle){
        if(options.autoAction!==false&&!blocked&&actionStart===null&&time>=nextAction){actionStart=time;actionCues=0;}
        actionAge=actionStart===null?0:time-actionStart;
        if(actionStart!==null&&actionAge>=score.duration){actionStart=null;completedActions++;nextAction=time+score.rest;actionPhase='quiet';}
        if(actionStart!==null){
          const frames=score.poses;let i=0;
          while(i<frames.length-2&&actionAge>=frames[i+1].at)i++;
          const a=frames[i],b=frames[i+1],mix=turnEase((actionAge-a.at)/(b.at-a.at));actionPhase=a.phase;
          for(const key of Object.keys(targets))targets[key]+=(a.pose[key]||0)+((b.pose[key]||0)-(a.pose[key]||0))*mix;
          while(actionCues<score.blinks.length&&actionAge>=score.blinks[actionCues]){actionCues++;blinkStart=time;nextBlink=time+3.2+random()*2.4;}
        }
      }
      for(const [key,s]of Object.entries(channels)){
        if(living){
          // Consume actual upstream spring states, not independent parallel
          // animation curves. Gaze leads head; head/body motion drives the rest.
          if(key==='headRoll')targets[key]-=channels.lookX.x*0.045;
          if(key==='bodyX')targets[key]+=channels.lookX.x*0.003;
          if(key==='bodyRoll')targets[key]+=-channels.headRoll.x*0.25-channels.bodyX.x*1.5;
          if(key==='lookX'||key==='lookY'){spring(s,clamp(targets[key],-1,1),55,13);continue;}
          if(key==='breath'){spring(s,targets[key],80,18);continue;}
        }
        const turning=key==='headRoll'||key==='headX';
        spring(s,targets[key],turning?headMotion.stiffness:key==='headY'?125:58,turning?headMotion.damping:key==='headY'?19:14);
      }
      if(living)spring(eyelid,targets.eyeClose,30,10);
      const angularVelocity=channels.headRoll.v+channels.bodyRoll.v;
      const vertical=jump.compression-jump.hop,verticalVelocity=(vertical-previousVertical)/STEP+channels.headY.v;
      previousVertical=vertical;
      for(const [id,chain]of Object.entries(hair)){
        const short=id==='fringe',side=id.includes('right')?0.88:1;
        const verticalSign=id.includes('right')?1:-1;
        if(living){
          const spec=character.idleHair[id],config=coupling.hair[spec.group],p=spec.phase;
          const breeze=idle?spec.wind*(0.035*Math.sin(time*1.3+p)+0.02*Math.sin(time*2.9+p*0.4)+0.015*Math.sin(time*0.47)):0;
          const drive=clamp(-(channels.headRoll.x+channels.bodyRoll.x)*config.gravity-angularVelocity*config.angular
            -channels.lookX.v*0.012-channels.bodyX.v*config.linear+breeze+verticalSign*verticalVelocity*(short?0.015:0.065),-0.07,0.07);
          for(let i=0;i<3;i++)limitedSpring(chain[i],i===0?drive:chain[i-1].x+drive*0.35,config.stiffness[i],config.damping[i],0.12);
          continue;
        }
        const gravity=singleAction?(-channels.bodyRoll.x*(short?0.15:0.45)-channels.bodyX.v*(short?0.2:1.2))*side:0;
        const drive=clamp(-angularVelocity*0.19*side+verticalSign*verticalVelocity*(short?0.015:0.065)+wind.x*(short?0.3:side)+gravity,-0.07,0.07);
        for(let i=0;i<3;i++){
          const target=i===0?drive:chain[i-1].x+drive*0.35;
          spring(chain[i],target,short?[175,125,90][i]:[85,53,35][i],short?[20,17,14][i]:[12,9,7][i]);
          chain[i].x=clamp(chain[i].x,-0.12,0.12);
        }
      }
      stepReaction();
      if(singleAction){
        const c=score.cloth,drive=[-channels.bodyRoll.x*c.roll-channels.bodyRoll.v*c.angular-channels.bodyX.v*c.linear,-channels.bodyY.v*c.vertical];
        for(let i=0;i<2;i++)limitedSpring(passiveCloth[i],drive[i],c.stiffness,c.damping,coupling.clothLimit[i]);
      }
    }
    function advance(dt,{headCaptured=false,grabCaptured=false,touchCaptured=false}={}){
      if(!Number.isFinite(dt)||dt<0)throw new RangeError('Frame delta must be a finite non-negative number');
      if(dt>0.25&&pointer!==null&&!(touchCaptured&&!grab)&&!(headCaptured&&reference&&contactKind==='head'&&!grab)&&!(grabCaptured&&grab))send({type:grab?'grab-cancel':'cancel',pointerId:pointer,reason:'long-frame'});
      accumulator+=Math.min(0.1,dt);
      while(accumulator+1e-12>=STEP){step();accumulator=Math.max(0,accumulator-STEP);}
      return snapshot();
    }
    function snapshot(){
      const jump=jumpSample();
      if(reference){
        const r=reference.snapshot(),pose={...r.pose,headY:r.pose.headY+channels.headY.x,hop:r.pose.hop+jump.hop,compression:jump.compression};
        if(cheekPoint&&cheekSpring.x>.001)pose.cheekPress={point:cheekPoint,strength:cheekSpring.x};
        for(const [key,s]of Object.entries(reaction.body))pose[key]+=s.x;
        pose.hair=Object.fromEntries(Object.entries(r.pose.hair).map(([id,a])=>{const limit=getReference().tuning?.hairLimit[id]??0.12;return [id,a.map((v,i)=>clamp(v+reaction.hair[id][i].x,-limit,limit))];}));
        // Base chain has its own history. Interaction-only recoil stays in the
        // existing cancellable layer, so cancelling a grab cannot reset idle.
        if(longHair)pose.longHair=Object.fromEntries(Object.entries(longHair).map(([id,chain])=>[id,chain.snapshot().map((v,i)=>v+reaction.hair['outer-left'][Math.min(2,Math.floor(i*3/5))].x/5)]));
        if(flexHair){
          pose.flexHair=Object.fromEntries(Object.entries(flexHair).map(([id,chain])=>[id,{...chain.snapshot(),reaction:reaction.hair[character.parts[id].reactionPart||'outer-left'].map(s=>s.x)}]));
          // Angular diagnostics stay available to old snapshot consumers; the
          // renderer uses complete centreline nodes, not these angles alone.
          for(const [id,curve]of Object.entries(pose.flexHair))pose.longHair[id]=curve.angles.slice();
        }
        if(hairBranches)pose.hairBranches=Object.fromEntries(Object.entries(hairBranches).map(([id,chain])=>[id,chain.snapshot()]));
        pose.cloth=Object.fromEntries(Object.entries(r.pose.cloth).map(([id,a])=>[id,a.map((v,i)=>v+reaction.cloth[id][i].x)]));
        if(grabUsed)pose.grab=Object.fromEntries([...usedGrabs].map(id=>[id,grabSprings[id].map(s=>s.x)]));
        Object.assign(pose,skirtPose(),{feet:feetPose()});
        const ownFeedback=time<bubbleUntil?{id:feedbackId,text:feedbackText,durationMs:feedbackDuration}:null;
        const shownFeedback=ownFeedback||r.feedback;
        return {time,pointerId:pointer,...(grabUsed?{grab:grab?{partId:grabId,state:grab,target:grabTarget.slice()}:null}:{}),
          ...(headStroke?{headStroke:{active:headStroke.active,offset:[headStroke.x,headStroke.y]}}:{}),
          phase:grab?(grab==='pending'?'grab-pending':'grab'):pointer!==null?'contact':jump.phase||r.idleAction.phase,
          completedGestures,completedJumps:completedJumps+r.referenceMotion.jumps,motionSet:r.motionSet,idleAction:r.idleAction,referenceMotion:r.referenceMotion,
          face:jump.phase==='air'?'3901':r.face,blink:Math.max(r.blink,blinkAmount()),bubble:shownFeedback?.text||null,...(shownFeedback?{feedback:shownFeedback}:{}),
          ...(expressionUsed?{expression:expressionSnapshot()}:{}),pose};
      }
      return {time,pointerId:pointer,...(grabUsed?{grab:grab?{partId:grabId,state:grab,target:grabTarget.slice()}:null}:{}),
        phase:grab?(grab==='pending'?'grab-pending':'grab'):pointer!==null?'contact':jump.phase||(time-releasedAt<1.2?'recover':idleValue?'attend':'quiet'),
        completedGestures,completedJumps,face:(pointer!==null&&!grab&&time-contactStart<0.22)||jump.phase==='air'||(singleAction&&actionStart!==null&&actionAge>=score.smile[0]&&actionAge<score.smile[1])?'3901':'3942',
        ...(singleAction?{idleAction:{name:score.name,phase:actionPhase,elapsed:actionAge,completed:completedActions}}:{}),
        blink:Math.max(blinkAmount(),living?eyelid.x:0),bubble:time<bubbleUntil?feedbackText:null,
        ...(time<bubbleUntil?{feedback:{id:feedbackId,text:feedbackText,durationMs:feedbackDuration}}:{}),
        ...(expressionUsed?{expression:expressionSnapshot()}:{}),
        pose:{...skirtPose(),...(grabUsed?{grab:Object.fromEntries([...usedGrabs].map(id=>[id,grabSprings[id].map(s=>s.x)])),
          cloth:Object.fromEntries(Object.entries(reaction.cloth).map(([id,chain])=>[id,chain.map(s=>s.x)]))}:{}),
          ...(singleAction?{cloth:Object.fromEntries(Object.entries(reaction.cloth).map(([id,chain])=>[id,chain.map((s,i)=>s.x+passiveCloth[i].x)]))}:{}),
          ...Object.fromEntries(Object.entries(channels).map(([key,s])=>[key,s.x+(reaction.body[key]?.x||0)])),
          hair:Object.fromEntries(Object.entries(hair).map(([key,chain])=>[key,chain.map((s,i)=>clamp(s.x+reaction.hair[key][i].x,-0.12,0.12))])),
          hop:jump.hop,compression:jump.compression}};
    }
    // Explicit selection replaces a finished touch response. The owner checks
    // above this transition still reject held pointers/jumps/lifecycle blocks;
    // synchronize the reference gate now, not on the next RAF after play failed.
    function playAction(name){if(!reference||feet.action||pointer!==null||jumpSample().phase||idleBlocked||(name!=='care'&&!getReference().catalog.some(a=>a.id===name)))return false;feet.lastContact=time;clearFeedback();reference.setBlocked(false);return reference.play(name);}
    function playAll(){if(!reference||feet.action||pointer!==null||jumpSample().phase||idleBlocked)return false;feet.lastContact=time;clearFeedback();reference.setBlocked(false);return reference.playAll();}
    function setAutomatic(value){if(!reference)return false;reference.setAuto(value);return true;}
    function setSystemIdle(seconds){reference?.setSystemIdle(seconds);}
    return {send,advance,snapshot,cancelFeet,cancelGrab,clearFeedback,setIdleBlocked,cancelIdleAction,playAction,playAll,setAutomatic,setSystemIdle};
  }
  return {createDirector};
});
