'use strict';
const path=require('node:path'),fs=require('node:fs');
function isTarget(target){
  return !!target&&Number.isSafeInteger(target.id)&&(target.kind==='screen'||(!target.kind||target.kind==='window')&&target.id>0);
}
function create({desktopCapturer,screen}){
  let api;
  async function load(){
    if(!api){
      const pkg=path.join(path.dirname(require.resolve('get-windows')),'package.json');
      const binding=require('@mapbox/node-pre-gyp').find(pkg);
      if(!fs.existsSync(binding))throw Error('window-provider-missing');
      api=await import('get-windows');
    }
    return api;
  }
  async function activeWindow(){return (await load()).activeWindow();}
  function screenTarget(){return {kind:'screen',id:screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).id};}
  async function capture(target,signal){
    if(!isTarget(target))throw Error('capture-unavailable');
    signal?.throwIfAborted();
    const display=target.kind==='screen';
    // Manual observation selects one display; automatic rules select a window.
    // Only that source is encoded and no screenshot file is produced.
    const sources=await desktopCapturer.getSources({types:[display?'screen':'window'],thumbnailSize:{width:1280,height:1280},fetchWindowIcons:false});
    signal?.throwIfAborted();
    const source=sources.find(s=>display?s.display_id===String(target.id):s.id.split(':')[0]==='window'&&s.id.split(':')[1]===String(target.id));
    if(!source||source.thumbnail.isEmpty())throw Error('capture-unavailable');
    const size=source.thumbnail.getSize();
    if(size.width<32||size.height<32)throw Error('capture-unavailable');
    return source.thumbnail.toJPEG(80);
  }
  return {activeWindow,screenTarget,capture};
}
module.exports={create,isTarget};
