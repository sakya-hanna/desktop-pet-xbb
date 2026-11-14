'use strict';
const net=require('node:net'),path=require('node:path'),fs=require('node:fs');
const {spawn}=require('node:child_process'),{randomUUID}=require('node:crypto');
function createBridge({root,onEvent,onStatus,diagnostic=false}){
  let server=null,socket=null,child=null,deadline=null,epoch=0,config={cards:['miao','notes'],miaoEnabled:false};
  function send(value){if(socket&&!socket.destroyed)socket.write(JSON.stringify(value)+'\n');}
  function stop(){
    epoch++;clearTimeout(deadline);deadline=null;
    send({type:'stop'});socket?.destroy();socket=null;
    server?.close();server=null;
    // Elevated helpers are owned through pipe lifetime, not force-killed.
    child=null;
  }
  function start({elevated=false}={}){
    stop();const run=epoch;
    const exe=path.join(root,'kaqiu','bin','baijie-kaqiu','baijie-kaqiu.exe');
    if(!fs.existsSync(exe)){onStatus('missing','计时辅助程序缺失，请重新构建。');return;}
    const pipe='\\\\.\\pipe\\baijie-kaqiu-'+randomUUID();
    onStatus('starting',elevated?'等待 F8 辅助程序授权…':'正在启动识别…');
    server=net.createServer(peer=>{
      if(run!==epoch||socket){peer.destroy();return;}
      socket=peer;let buffer='';peer.setEncoding('utf8');
      peer.on('data',data=>{
        buffer+=data;if(buffer.length>65536){peer.destroy();return;}
        let end;while((end=buffer.indexOf('\n'))>=0){
          const line=buffer.slice(0,end);buffer=buffer.slice(end+1);
          let event;try{event=JSON.parse(line);}catch{continue;}
          if(run!==epoch||!event||typeof event!=='object')continue;
          if(event.type==='ready'){clearTimeout(deadline);deadline=null;onStatus('ready',event.admin?'识别就绪 · F8 辅助已授权':'识别就绪 · 普通权限');send({type:'configure',...config});}
          else onEvent(event);
        }
      });
      peer.on('error',()=>{});
      peer.on('close',()=>{if(run===epoch){socket=null;onStatus('stopped','识别辅助程序已停止，可在菜单重新连接。');}});
    });
    server.on('error',()=>{if(run===epoch){stop();onStatus('error','无法建立计时辅助连接。');}});
    server.listen(pipe,()=>{
      if(run!==epoch)return;
      const args=['--pipe',pipe,...(diagnostic?['--probe']:[])];
      try{
        child=elevated?spawn('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(root,'kaqiu','elevate.ps1'),'-Helper',exe,'-Pipe',pipe],{windowsHide:true,stdio:'ignore'})
          :spawn(exe,args,{windowsHide:true,stdio:['ignore','ignore','pipe']});
        let stderr='';child.stderr?.on('data',data=>{stderr=(stderr+data.toString()).slice(-8000);});
        child.on('error',()=>{if(run===epoch){stop();onStatus('error','计时辅助程序启动失败。');}});
        child.on('exit',code=>{if(run===epoch&&code){onEvent({type:'helper-error',exitCode:code,stderr});stop();onStatus(elevated?'denied':'error',elevated?'未取得 F8 授权，重新连接可继续普通识别。':'识别辅助程序启动或运行失败，请重新连接。');}});
        deadline=setTimeout(()=>{if(run===epoch&&!socket){stop();onStatus('error','辅助程序未连接；请重试，或检查授权是否取消。');}},30000);
        deadline.unref?.();
      }catch{stop();onStatus('error','计时辅助程序启动失败。');}
    });
  }
  return {start,stop,configure(value){config={...value};send({type:'configure',...config});},clear(){send({type:'clear'});}};
}
module.exports={createBridge};
