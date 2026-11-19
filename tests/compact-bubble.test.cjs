'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {layoutSpeech,speechSize}=require('../shared/speech-layout.js');
test('short reminders shrink to content; multiline and chat reserve their text height',()=>{
 const short=speechSize('喵喵冷却快好啦。'),multi=speechSize('笔记还剩10秒哦。\n喵喵冷却快好啦。');
 assert.ok(short.width<=160);assert.ok(short.height<=60);assert.ok(short.width*short.height<300*130*.25);
 assert.ok(multi.height>short.height);assert.ok(speechSize('字'.repeat(78)).width<=236);
});
test('enlarging the pet does not enlarge the bubble; display edges never clip or overlap the pet',()=>{
 const text='喵喵冷却快好啦。',area={x:-1000,y:-200,width:1000,height:800};
 for(const parent of [{x:-500,y:100,width:240,height:348},{x:-999,y:-199,width:240,height:348},{x:-241,y:-199,width:240,height:348}]){
  const a=layoutSpeech(parent,area,{text,scale:.75}),b=layoutSpeech(parent,area,{text,scale:1.5});assert.deepEqual(a,b);assert.ok(a);
  assert.ok(a.x>=area.x&&a.y>=area.y&&a.x+a.width<=area.x+area.width&&a.y+a.height<=area.y+area.height);
  assert.ok(a.x+a.width<=parent.x||a.x>=parent.x+parent.width||a.y+a.height<=parent.y||a.y>=parent.y+parent.height);
 }
});

test('feedback follows the rendered crown instead of the transparent window margin',()=>{
 const {layoutFeedback,speechHeadBounds}=require('../shared/speech-layout.js');
 const area={x:0,y:0,width:1920,height:1080};
 for(const height of [200,348,600]){
  const parent={x:500,y:300,width:height*240/348,height},head=speechHeadBounds(parent);
  const b=layoutFeedback(parent,area,{text:'喵喵冷却快好啦。'});
  assert.ok(head.y-(b.y+b.height)>=6&&head.y-(b.y+b.height)<7);
  assert.ok(Math.abs(b.x+b.width/2-(head.x+head.width/2))<=1);
  assert.ok(b.y+b.height>parent.y,'use the transparent top margin');
 }
 const parent={x:0,y:-20,width:240,height:348},head=speechHeadBounds(parent),b=layoutFeedback(parent,area,{text:'姐姐在这里。'});
 assert.ok(b);assert.ok(b.x>=head.x+head.width||b.x+b.width<=head.x);
 assert.ok(b.y>=0&&b.x>=0&&b.x+b.width<=area.width);
});
