(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.CharacterBinding=api;})(globalThis,function(){
  'use strict';
  // Qianhuili's rest-space head/dome/back ownership, adapted to separate
  // Baijie materials. These are spatial bindings, not a second action engine.
  const materials={head:{name:'head-surface',material:'head'},
    torso:{name:'torso',material:'torso'},neck:{name:'neck-skin',material:'neck'}};
  const binding={width:530,height:800,feetY:798,neck:[298.2,154],hips:[265,448],headFade:[140,175],bodyFade:[360,795],referenceBodyFade:[360,540],
    // Retain this character's jaw/skin ownership and vertical nod support.
    // Only the local neck/collar connection shares the head field; shoulders
    // follow ReferenceMotion's independent body springs.
    // Widen only the side-jaw blend upwards; keep the full central chin and
    // the lower skin boundary. This avoids concentrating roll in a short strip.
    neckTransition:{version:'reference-side-jaw',top:120,base:160,skinHalf:36,outerHalf:64,hairFade:[135,200],verticalSupport:0.65,
      jaw:{top:144,base:166,inner:16,outer:40}},
    // One Chieri-style dome over the actual face, ending at the jaw. The old
    // 180px-tall dome carried the chin almost as far as the nose; eye islands
    // then flattened the remaining turn. No separate eye/scalp correction.
    headTurn:{version:'reference-turn-v4',model:'layered-reference-dome',controlGain:1.5,
      center:[298.2,99],radius:[64,56],shift:[2.2,3*800/1536],depth:[10.5,10*800/1536],
      // Skin and collar are separate textures but one anatomical connection.
      // Share this field across their cut; shoulders remain outside it.
      neckFade:[139,166],neckWidth:[17,30]},
    // Hair remaining in the torso texture shares the head's spatial field.
    // The longer fade avoids pinching side locks during wake/roll, reaches
    // zero before the shoulders, and does not change arm/skirt ownership.
    headSupport:{fade:[139,178]},
    breathing:{upper:[175,365],expand:[125,175,270,390],centerX:295,lift:3.2,width:0.012}};
  // These four separated long locks are the back/side layer. Reuse the
  // reference reverse-parallax term, fading at the already-authored fixed cuts.
  // Long-lock wind response is calibrated at desktop scale: the middle must
  // bend as well as the tip. Outer locks catch more breeze; rear locks remain
  // sheltered. Keep the reference's per-side wind, spring lag and yaw response.
  const parts={
    'outer-left':{name:'outer-left',backParallax:true,root:[235,65],rootLockY:80,rootBlendY:100,longHair:true,
      flexible:{stiffness:[160,85,42,22,12],damping:[22,15,10,7,5],inertia:1.8,gravity:.12,wind:2.1,windSource:'outer-left'},
      centerline:[[235,65],[220,128],[180,213],[114,302],[98,402],[80,488]],
      branches:[
        {name:'left-sweep',root:[105,270],centerline:[[105,270],[52,309],[24,351],[36,390]],radius:27,dynamics:{stiffness:[58,32,21],damping:[11,8,6],wind:.7}},
        {name:'left-drop',root:[105,270],centerline:[[105,270],[105,337],[109,415],[87,486]],radius:30,dynamics:{stiffness:[41,24,15],damping:[10,7,5.5],wind:.35}}
      ]},
    // Independent rear layer, behind torso/arms/skirt. The visible upper cut
    // blends to the body; lower hair is free, not pinned to the dress boundary.
    'rear-left':{name:'rear-left',backParallax:true,root:[237,100],rootLockY:170,rootBlendY:260,longHair:true,
      flexible:{stiffness:[170,85,40,20,11],damping:[23,15,10,7,5],inertia:1.8,gravity:.15,wind:1.45,windSource:'outer-left'},
      centerline:[[237,100],[225,165],[203,240],[178,310],[151,379],[135,450]],
      dynamics:{stiffness:[65,43,29,21,17],damping:[15,11,8,7,6],wind:.2}},
    'outer-right':{name:'outer-right',backParallax:true,root:[363,65],rootLockY:80,rootBlendY:115,longHair:true,reactionPart:'outer-right',
      flexible:{stiffness:[165,85,43,23,13],damping:[22,15,10,7,5],inertia:1.8,gravity:.12,wind:2.1,windSource:'outer-right'},
      centerline:[[363,65],[374,137],[419,213],[477,290],[506,363],[486,438]],
      branches:[
        {name:'right-return',root:[482,300],centerline:[[482,300],[509,350],[511,398],[486,438]],radius:24,dynamics:{stiffness:[56,31,21],damping:[11,8,6],wind:.65,windSource:'outer-right'}},
        {name:'right-loop',root:[482,300],centerline:[[482,300],[522,334],[526,371],[515,392]],radius:20,dynamics:{stiffness:[68,39,25],damping:[12,9,7],wind:.35,windSource:'outer-right'}}
      ]},
    'rear-right':{name:'rear-right',backParallax:true,root:[353,110],rootLockY:145,rootBlendY:205,longHair:true,reactionPart:'outer-right',
      flexible:{stiffness:[170,86,42,22,12],damping:[23,15,10,7,5],inertia:1.8,gravity:.15,wind:1.45,windSource:'outer-right'},
      centerline:[[353,110],[358,175],[385,245],[421,310],[442,370],[470,438]]},
    'fringe':{name:'fringe',material:'head',root:[1484.3170484844702*0.20299,330*0.20299],rootLockY:332*0.20299,rootBlendY:385*0.20299,centerline:[[1484.3170484844702*0.20299,330*0.20299],[303,89],[302,114]]},
    'front-left':{name:'front-left',material:'head',root:[1247.9780148505995*0.20299,825*0.20299],rootLockY:827*0.20299,rootBlendY:910*0.20299,centerline:[[1247.9780148505995*0.20299,825*0.20299],[246,188],[228,210],[238,230]]},
    'front-right':{name:'front-right',root:[1847.2169053580371*0.20299,1120*0.20299],rootLockY:1122*0.20299,rootBlendY:1170*0.20299,centerline:[[1847.2169053580371*0.20299,1120*0.20299],[380,247],[372,267]]}
  };
  // This short painted curl belongs to the right main lock, not the torso.
  // Keep its existing local tip motion and receiving-shadow assets.
  parts['front-right'].followPart=parts['rear-right'];
  const hair=(a,b,c)=>({'outer-left':[a,b,c],'outer-right':[a*0.85,b*0.9,c*0.85],fringe:[a*0.7,b*0.65,c*0.6],'front-left':[a,b*1.2,c*1.1],'front-right':[a*0.8,b,c]});
  // Tune the action before deformation. The head still inherits the full torso
  // transform; no y-dependent counter-motion through shoulder/chest skin.
  const headMotion={rollGain:0.45,shiftGain:0.25,turn:1.05,hold:0.35,return:1.55,stiffness:90,damping:19};
  const keyframes=[
    {id:'neutral',label:'自然站立',face:'3942',pose:{}},
    {id:'notice',label:'感知触碰',face:'3901',pose:{headRoll:-0.025,headX:-0.003,bodyRoll:0.003,hair:hair(0.006,0.012,0.02)}},
    {id:'left',label:'向画面左侧回应',face:'3942',pose:{headRoll:-0.10,headX:-0.010,bodyRoll:0.012,hair:hair(0.018,0.040,0.065)}},
    {id:'right',label:'向画面右侧回应',face:'3942',pose:{headRoll:0.10,headX:0.010,bodyRoll:-0.012,hair:hair(-0.018,-0.040,-0.065)}},
    {id:'release',label:'释放后的回落',face:'3942',pose:{headRoll:0.02,headX:0.002,bodyRoll:-0.003,hair:hair(-0.015,-0.035,-0.045)}},
    {id:'prepare',label:'小跳预备',face:'3942',pose:{compression:0.016,headY:0.002,headRoll:0.015,hair:hair(-0.01,-0.02,-0.035)}},
    {id:'air',label:'小跳离地',face:'3901',pose:{hop:0.075,headY:-0.002,hair:hair(0.015,0.04,0.06)}},
    {id:'land',label:'落地缓冲',face:'3942',pose:{compression:0.018,headY:0.003,headRoll:-0.018,hair:hair(-0.018,-0.045,-0.07)}}
  ].map(frame=>({...frame,pose:{...frame.pose,
    ...(frame.pose.headRoll===undefined?{}:{headRoll:frame.pose.headRoll*headMotion.rollGain}),
    ...(frame.pose.headX===undefined?{}:{headX:frame.pose.headX*headMotion.shiftGain})}}));
  // Material-pixel candidate envelopes, not GPU/art-approved; lining is not a target.
  const grabs={'arm-screen-left':{name:'arm-screen-left',screenSide:'left',characterSide:'right',thresholdCss:5,limit:[24,18],elbowRatio:0.45,sourceCanvas:[2612,3941]},
    'arm-screen-right':{name:'arm-screen-right',screenSide:'right',characterSide:'left',thresholdCss:5,limit:[24,18],elbowRatio:0.4,sourceCanvas:[2612,3941]},
    'skirt-front':{name:'skirt-front',thresholdCss:5,limit:[18,14],foldRatio:0.5,sourceCanvas:[2612,3941]},
    'skirt-right':{name:'skirt-right',thresholdCss:5,limit:[18,14],foldRatio:0.5,sourceCanvas:[2612,3941]}};
  // Interaction-only tuning. Existing grab envelopes and authored poses stay intact.
  // With the real hips transform, positive roll moves the upper torso RIGHT.
  // These are initial visible envelopes, not GPU or artwork certification.
  const coupling={
    // Hand contact follows promptly; release keeps velocity with a small soft
    // return. The slower body intent follows Chieri's leanS, independently of
    // arm recoil, so letting go cannot keep pulling the torso after the hand.
    hand:{held:{stiffness:240,damping:32},released:{stiffness:180,damping:20}},
    body:{hand:{bodyRoll:0.038,bodyX:0.003,bodyY:0.003},skirt:{bodyRoll:-0.008,bodyX:-0.000375,bodyY:-0.0005},
      handIntent:{stiffness:26,damping:8.8},
      skirtIntent:{deadZone:0.2,stiffness:26,damping:10},
      stiffness:72,damping:11,limit:{bodyRoll:0.045,bodyX:0.004,bodyY:0.0035}},
    hair:{
      outer:{gravity:0.65,angular:0.19,linear:1.6,vertical:0.4,stiffness:[75,44,28],damping:[11,8,6]},
      front:{gravity:0.5,angular:0.16,linear:1.3,vertical:0.3,stiffness:[108,70,46],damping:[14,11,8.5]},
      fringe:{gravity:0.25,angular:0.08,linear:0.6,vertical:0.1,stiffness:[195,145,105],damping:[22,18,15]}
    },
    cloth:{'skirt-front':{gain:1,stiffness:38,damping:8},'skirt-right':{gain:0.72,stiffness:47,damping:9}},
    clothLimit:[2.5,1.2]
  };
  // Continuous motion remains beneath ONE acted moment: lift the gaze, look
  // aside, return attention first, then let head/body settle with a soft smile.
  // No mouse tracking, new arm action or fixed-head counter-motion.
  const idleHair={
    'outer-left':{group:'outer',phase:0,wind:0.8},
    'outer-right':{group:'outer',phase:1.7,wind:0.8},
    'front-left':{group:'front',phase:3.4,wind:0.65},
    'front-right':{group:'front',phase:5.1,wind:0.65},
    fringe:{group:'fringe',phase:2.3,wind:0.5}
  };
  const idleAction={name:'soft-look',first:2.5,duration:6.8,rest:8,
    poses:[
      {at:0,phase:'prepare',pose:{}},
      {at:0.6,phase:'enter',pose:{lookX:-0.12,lookY:-0.18,headY:-0.001}},
      {at:1.7,phase:'hold',pose:{lookX:-0.82,lookY:-0.18,headRoll:0.012,bodyRoll:-0.003,bodyX:-0.0005}},
      {at:2.6,phase:'return',pose:{lookX:-0.82,lookY:-0.12,headRoll:0.014,bodyRoll:-0.004,eyeClose:0.08}},
      {at:3.4,phase:'smile',pose:{lookX:0.12,lookY:0.08,headRoll:-0.014,bodyRoll:0.002}},
      {at:4.4,phase:'settle',pose:{lookX:0.08,lookY:0.04,headRoll:-0.02,headY:0.0015,eyeClose:0.12}},
      {at:6.0,phase:'settle',pose:{}},
      {at:6.8,phase:'quiet',pose:{}}
    ],
    smile:[3.05,5.65],blinks:[0.4,3.05],
    cloth:{stiffness:38,damping:8,roll:55,angular:20,linear:140,vertical:45}
  };
  return {binding,parts,materials,keyframes,grabs,coupling,headMotion,idleAction,idleHair};
});
