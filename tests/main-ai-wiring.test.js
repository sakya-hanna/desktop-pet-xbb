const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
test('main connects lazy configured service, settings menu and cancellation before model presentation',()=>{
 const main=fs.readFileSync(path.join(__dirname,'../puppet/main.js'),'utf8');
 assert.match(main,/function getChatService\(/);assert.match(main,/label: '模型设置'/);assert.match(main,/service: getChatService\(\)/);assert.match(main,/onPet\('model:cancel'/);assert.match(main,/'chat:reply'/);
});
