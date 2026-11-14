'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),{EventEmitter}=require('node:events');
const root=path.resolve(__dirname,'..');
test('I13 boot threads explicit main-only local request injection without invoking it',async()=>{
 let calls=0,received;const chatOptions={request:async()=>{calls++;throw Error('must be explicit');}},app=new EventEmitter();
 Object.assign(app,{isReady:()=>false,setPath(){},setAppLogsPath(){},setName(){},whenReady:async()=>{},quit(){},commandLine:{appendSwitch(){}}});
 const session=new EventEmitter();session.webRequest={onBeforeRequest(){}};for(const k of ['setPermissionRequestHandler','setPermissionCheckHandler','setDevicePermissionHandler','setDisplayMediaRequestHandler'])session[k]=()=>{};session.protocol={handle(){},unhandle(){}};
 const electron={app,protocol:{registerSchemesAsPrivileged(){}},session:{defaultSession:{},fromPartition:()=>session}};
 const appDataRoot=path.join(process.env.TMPDIR,'boot-fixture'),profileRoot=path.join(appDataRoot,'BaijieDesktopV1-Tests','local');
 const booted=await require('../desktop-main.cjs').boot({electron,root,mode:'hidden',storageLayout:'product',appDataRoot,profileRoot,env:{},chatOptions,createShellImpl:options=>{received=options;return {ready:Promise.resolve({}),destroy(){}};}});
 try{await booted.ready;assert.equal(received.chatOptions,chatOptions);assert.equal(calls,0);assert.equal(received.profileRoot,profileRoot);}finally{booted.destroy();}
});
