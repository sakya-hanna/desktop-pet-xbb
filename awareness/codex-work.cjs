'use strict';
const path=require('node:path');
// The first interaction rule, not a restriction on what the capture service
// can observe. Other interactions can supply the same rule interface.
function accepts(window){
  return !!window&&Number.isSafeInteger(window.id)&&window.id>0&&
    ['codex.exe','chatgpt.exe'].includes(path.win32.basename(window.owner?.path||'').toLowerCase());
}
function matches(scene){return scene.codex===true&&scene.working===true&&['developing','reading','waiting'].includes(scene.activity);}
const lines=[
  '弟弟又在认真忙啦。慢慢来，姐姐陪着你。',
  '一点一点来就好，姐姐给你加油。',
  '你安心忙，姐姐就在旁边陪着你。',
  '慢慢把想法做出来吧，姐姐陪你一起期待。'
];
module.exports={accepts,matches,lines,watchingLabel:'等待持续使用 Codex'};
