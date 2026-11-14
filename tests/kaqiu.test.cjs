'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createTimers}=require('../kaqiu/timers.cjs');
function fakeClock(){let time=0,id=0;const tasks=new Map();return {now:()=>time,setTimeout(fn,delay){tasks.set(++id,{fn,due:time+delay});return id;},clearTimeout(i){tasks.delete(i);},advance(ms){time+=ms;for(const [i,t]of [...tasks])if(t.due<=time){tasks.delete(i);t.fn();}},tasks};}
test('miao reminds once at elapsed 5s; notes uses 0/30/40; effects are not timers',()=>{
 const clock=fakeClock(),events=[],t=createTimers({clock,onEvents:e=>events.push(...e)});
 t.start('miao');assert.equal(events.length,0);assert.equal(t.start('miao_fx'),false);
 clock.advance(4999);assert.equal(events.length,0);clock.advance(1);
 assert.deepEqual(events.map(e=>[e.card,e.stage]),[['miao','soon']]);
 clock.advance(10000);assert.equal(events.length,1);assert.deepEqual(t.snapshot(),[]);
 t.start('notes');assert.equal(events.at(-1).stage,'start');clock.advance(30000);assert.equal(events.at(-1).stage,'soon');
 clock.advance(10000);assert.equal(events.at(-1).stage,'end');t.destroy();assert.equal(clock.tasks.size,0);
});
test('duplicate detection cannot rewind; manual reset cancels old deadlines; delay skips obsolete warning',()=>{
 const clock=fakeClock(),events=[],t=createTimers({clock,onEvents:e=>events.push(...e)});
 t.start('miao');clock.advance(4000);assert.equal(t.start('miao'),false);
 t.start('miao',{manual:true});clock.advance(1000);assert.equal(events.length,0);
 clock.advance(4000);assert.equal(events.length,1);
 t.clear();events.length=0;t.start('miao');clock.advance(17000);assert.equal(events.length,0);
 t.start('notes');clock.advance(41000);assert.deepEqual(events.map(e=>e.stage),['start','end']);
 t.destroy();
});
test('round end cancels timers at 7s; multi-instance analyzer is capped at 6',()=>{
 const clock=fakeClock(),t=createTimers({clock});for(let i=0;i<8;i++)t.start('analyzer');assert.equal(t.snapshot().length,6);
 t.roundEnd();clock.advance(6999);assert.equal(t.snapshot().length,6);clock.advance(1);assert.equal(t.snapshot().length,0);t.destroy();assert.equal(clock.tasks.size,0);
});
test('real shell menu and feedback ownership preserve game reminders across blur and renderer null',async()=>{
 const {harness,settle}=require('./feedback-shell.test.cjs'),h=harness({taskbarTopmost:false});
 try{
  await h.shell.ready;
  const menu=h.shell.menuTemplate().find(m=>m.id==='kaqiu');assert.ok(menu);
  menu.submenu.find(m=>m.id==='kaqiu-enabled').click({checked:true});
  assert.equal(h.shell.snapshot().kaqiu.status,'hidden-test');
  h.shell.kaqiu.startManual('miao');await settle();assert.equal(h.bubble(),undefined);
  h.advance(5000);await settle();assert.match(h.bubble().messages.at(-1)[1].text,/喵喵冷却快好/);
  h.send({id:1,text:'摸头反馈'});h.send(null);h.shell.window.emit('blur');
  assert.match(h.bubble().messages.at(-1)[1].text,/喵喵冷却快好/);
  assert.equal(h.shell.window.isAlwaysOnTop(),true);
  h.advance(4200);assert.equal(h.bubble().messages.at(-1)[1],null);
  h.advance(5800);assert.equal(h.bubble().messages.at(-1)[1],null);
  h.shell.kaqiu.startManual('notes');await settle();assert.match(h.bubble().messages.at(-1)[1].text,/笔记开始/);
  h.shell.kaqiu.setEnabled(false);assert.equal(h.bubble().messages.at(-1)[1],null);
  assert.equal(h.shell.snapshot().kaqiu.timers.length,0);
 }finally{h.dispose();}assert.equal(h.timers.size,0);
});
test('sending callback is independent from successful card recognition; no default sending bubble',()=>{
 const {createKaqiu}=require('../kaqiu/integration.cjs');const clock=fakeClock(),events=[],sent=[];
 const service=createKaqiu({root:__dirname,profileRoot:__dirname+'/nonexistent-kaqiu-test-profile',mode:'hidden',clock,
  bridgeFactory:()=>({start(){throw Error('hidden mode must not start native helper');},stop(){},configure(){},clear(){}}),
  presentation:{remind:e=>events.push(...e),clearReminders(){}},onMiaoDispatched:e=>sent.push(e)});
 service.setEnabled(true);service.receive({type:'input-dispatched',requestId:'1'});
 assert.equal(sent.length,1);assert.equal(events.length,0);assert.equal(service.snapshot().timers.length,0);
 service.receive({type:'trigger',card:'miao'});clock.advance(5000);assert.equal(events.length,1);
 service.destroy();assert.equal(clock.tasks.size,0);
});

test('reminder broker merges concurrent cards, restores live chat, and hides without replay',()=>{
 const {createPresentation}=require('../kaqiu/presentation.cjs');const clock=fakeClock(),calls=[];
 const p=createPresentation({clock,window:{set:v=>calls.push(v),clear:()=>calls.push(null),setEnabled(){}}});
 p.fromRenderer({id:1,kind:'chat',text:'聊天内容',durationMs:15000});
 p.remind([{card:'miao',text:'喵喵快好啦'}]);p.remind([{card:'notes',text:'笔记快好啦'}]);
 assert.match(calls.at(-1).text,/喵喵快好啦\n笔记快好啦/);
 clock.advance(4200);assert.equal(calls.at(-1).text,'聊天内容');
 p.setEnabled(false);p.remind([{card:'miao',text:'不应补播'}]);p.setEnabled(true);
 assert.equal(calls.at(-1),null);p.destroy();assert.equal(clock.tasks.size,0);
});
