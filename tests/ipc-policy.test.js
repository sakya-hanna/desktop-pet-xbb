const test=require('node:test'),assert=require('node:assert/strict');
const {fromMainFrame}=require('../puppet/ipc-policy');
test('only live expected webContents and its mainFrame can dispatch pet actions',()=>{
 const frame={},wc={mainFrame:frame,isDestroyed:()=>false};const w={webContents:wc,isDestroyed:()=>false};
 assert.equal(fromMainFrame({sender:wc,senderFrame:frame},w),true);
 for(const event of [null,{}, {sender:wc},{sender:{},senderFrame:frame},{sender:wc,senderFrame:{}}])assert.equal(fromMainFrame(event,w),false);
 assert.equal(fromMainFrame({sender:wc,senderFrame:frame},{...w,isDestroyed:()=>true}),false);
 assert.equal(fromMainFrame({sender:wc,senderFrame:frame},null),false);
});
