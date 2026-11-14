(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.ResponseConfig=api;})(globalThis,function(){
  'use strict';
  // Event identity, words and visual intent are independent. No text keyword
  // recognition: changing a sentence never silently changes its expression.
  const lines=Object.freeze({
    head:'怎么突然模姐姐的头，是希望姐姐做什么呢。',
    chest:'姆，弟弟你这个色鬼。',
    hand:'想牵姐姐的手吗？那就轻轻握住吧。',
    skirt:'慢一点，姐姐的裙子可经不起这样拽哦。'
  });
  const faces=Object.freeze({gentle:'3942',smile:'3901',enjoy:'9003',surprised:'3563',pout:'3665',awkward:'3496',shy:'9002'});
  const expressions=Object.freeze(Object.fromEntries(Object.entries({
    head:[['smile',450],['enjoy',1250]],
    chest:[['surprised',250],['shy',2100]],
    hand:[['shy',600],['smile',1200]],
    skirt:[['awkward',450],['pout',1550]]
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
