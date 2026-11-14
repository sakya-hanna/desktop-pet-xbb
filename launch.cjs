'use strict';
// Explicit entry: Electron may own require.main, so do not guard this call.
const electron=require('electron');
let quitting=false;
const onQuit=()=>{quitting=true;};
electron.app.once('before-quit',onQuit);
module.exports=Promise.resolve().then(()=>require('./product-main.cjs').startProduct({electron})).then(async result=>{
  await result.ready;
  return result;
}).catch(()=>{
  if(!quitting){
    console.error('Baijie formal startup failed.');
    if(!process.argv.includes('--hidden')){
      try{electron.dialog?.showErrorBox('小伯白桌宠启动失败','正式版未能启动，请关闭后重试。原聊天和模型设置不会自动迁移或覆盖。');}catch{}
    }
    electron.app.quit();
  }
  return null;
}).finally(()=>electron.app.removeListener('before-quit',onQuit));
