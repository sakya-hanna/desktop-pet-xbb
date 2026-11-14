'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createDirector}=require('../src/director.js');
const config=require('../src/response-config.js');
function hand(options){const e=createDirector({idle:false,responseConfig:options});e.send({type:'grab-down',partId:'arm-screen-left',pointerId:1});e.send({type:'grab-move',pointerId:1,x:8,y:0});return e;}
test('I10 custom wording is detached from semantics and copied per director; long words get a bounded readable duration',()=>{
 const text='弟弟，'+ '姐姐在这里。'.repeat(20),input={lines:{hand:text}};
 const e=hand(input),normal=hand();
 assert.equal(e.snapshot().bubble,text);assert.deepEqual(e.snapshot().expression,normal.snapshot().expression);
 assert.ok(e.snapshot().feedback.durationMs>3400&&e.snapshot().feedback.durationMs<=15000);
 assert.equal(normal.snapshot().feedback.durationMs,3400);
 input.lines.hand='changed after construction';assert.equal(e.snapshot().bubble,text);
 e.send({type:'grab-up',pointerId:1}); // A held gesture owns its face; test text lifetime after release.
 for(let i=0;i<480;i++)e.advance(1/120);assert.ok(e.snapshot().bubble);assert.equal(e.snapshot().expression,null,'long text must not hold a face forever');
 for(let i=0;i<1800;i++)e.advance(1/120);assert.equal(e.snapshot().bubble,null);
 assert.equal(hand().snapshot().bubble,config.defaults.lines.hand,'no global mutation');
});
test('I10 config rejects unknown events, bad types, blank or over-limit text without modifying defaults',()=>{
 for(const invalid of [null,[],{x:1},{lines:[]},{lines:{unknown:'x'}},{lines:{hand:''}},{lines:{hand:'  '}},{lines:{hand:12}},{lines:{hand:'a'.repeat(201)}}])assert.throws(()=>hand(invalid),/config|line|text/i);
 assert.equal(hand({lines:{hand:'😀'.repeat(200)}}).snapshot().bubble,'😀'.repeat(200));
 assert.equal(hand({lines:{hand:'😀'.repeat(200)}}).snapshot().feedback.durationMs,15000);
 assert.equal(config.defaults.lines.head,'怎么突然模姐姐的头，是希望姐姐做什么呢。');
 assert.equal(config.defaults.lines.chest,'姆，弟弟你这个色鬼。');
});
test('I10 browser entry loads the response config before director through the exact resource whitelist',()=>{
 const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),root=path.resolve(__dirname,'..');
 const html=fs.readFileSync(path.join(root,'desktop.html'),'utf8');
 const scripts=[...html.matchAll(/<script src="([^"]+)"/g)].map(m=>m[1]);
 assert.ok(scripts.includes('src/response-config.js'),'response config must be loaded by the desktop entry');
 assert.ok(scripts.indexOf('src/response-config.js')<scripts.indexOf('src/director.js'));
 const policy=require('../resource-policy.cjs');assert.equal(policy.resolveResource('baijie28://app/src/response-config.js',root),path.join(root,'src/response-config.js'));
 const context=vm.createContext({});
 for(const name of scripts.filter(s=>['src/response-config.js','src/character.js','src/director.js'].includes(s)))vm.runInContext(fs.readFileSync(path.join(root,name),'utf8'),context);
 assert.equal(vm.runInContext("MotionDirector.createDirector({idle:false}).snapshot().face",context),'3942');
});
