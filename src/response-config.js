(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.ResponseConfig=api;})(globalThis,function(){
  'use strict';
  // Event identity, words and visual intent are independent. No text keyword
  // recognition: changing a sentence never silently changes its expression.
  const lines=Object.freeze({
    head:'怎么突然摸姐姐的头，是希望姐姐做什么呢。',
    cheek:'唔……别戳姐姐的脸颊呀，会变红的。',
    feet:'呀，好痒……弟弟别闹啦。',
    shoesOff:'还挠呀……姐姐先把鞋子脱掉。',
    barefoot:'好啦，让姐姐的脚休息一下。',
    shoesReady:'穿好啦，这下乖乖陪姐姐待一会儿吧。',
    shoesOn:'不看姐姐的脚了？那姐姐就把鞋子穿上了',
    headTap:'嗯？是在叫姐姐吗？',
    belly:'呀，有点痒……不许突然戳姐姐啦。',
    leg:'哎，别戳啦，姐姐会站不稳的。',
    body:'姐姐在呢，怎么啦？',
    chest:'姆，弟弟你这个色鬼。',
    hand:'想牵姐姐的手吗？那就轻轻握住吧。',
    hair:'是在帮姐姐整理头发吗？轻一点哦。',
    skirt:'慢一点，姐姐的裙子可经不起这样拽哦。'
  });
  const faces=Object.freeze({curious:'3831',gentle:'3942',smile:'3901',enjoy:'9003',tickle:'9005',surprised:'3563',pout:'3665',hairPout:'9004',awkward:'3496',shy:'9002'});
  const expressions=Object.freeze(Object.fromEntries(Object.entries({
    head:[['smile',450],['enjoy',1250]],
    cheek:[['surprised',280],['shy',2600]],
    feet:[['surprised',320],['tickle',3180]],
    shoesOff:[['awkward',700],['pout',4800]],
    barefoot:[['smile',3500]],
    shoesOn:[['gentle',5500]],
    shoesReady:[['smile',3500]],
    headTap:[['curious',650],['smile',2850]],
    belly:[['surprised',320],['tickle',1400],['smile',1780]],
    leg:[['awkward',450],['pout',3050]],
    body:[['gentle',3500]],
    chest:[['surprised',250],['shy',2100]],
    hand:[['shy',600],['smile',1200]],
    hair:[['hairPout',650],['smile',1350]],
    skirt:[['shy',500],['hairPout',1500]]
  }).map(([kind,steps])=>[kind,Object.freeze(steps.map(([semantic,durationMs])=>Object.freeze({semantic,durationMs})))])));
  const release=Object.freeze({semantic:'gentle',durationMs:650});
  const defaults=Object.freeze({lines,faces,expressions,release});
  function createConfig(overrides={}){
    const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
    if(!object(overrides)||Object.keys(overrides).some(key=>key!=='lines'))throw new TypeError('Invalid response config');
    if(overrides.lines===undefined)return defaults;
    if(!object(overrides.lines))throw new TypeError('Invalid response lines');
    const custom={...lines};
    for(const [kind,text]of Object.entries(overrides.lines)){
      if(!Object.hasOwn(lines,kind)||typeof text!=='string'||!text.trim()||Array.from(text).length>200)throw new TypeError('Invalid response line text');
      custom[kind]=text;
    }
    return Object.freeze({...defaults,lines:Object.freeze(custom)});
  }
  function durationMs(text){return Math.min(15000,Math.max(3400,1000+70*Array.from(text).length));}
  return {defaults,createConfig,durationMs};
});
