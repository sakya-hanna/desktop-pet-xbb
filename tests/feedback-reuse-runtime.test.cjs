'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createHarness}=require('./helpers/interaction-fixtures.cjs');
test('recatching visible hair does not hide or republish its bubble; a different action and hide still propagate',async t=>{
 const h=await createHarness({idle:false});t.after(()=>h.runtime.destroy());h.runtime.start();
 const messages=()=>h.calls.filter(c=>c[0]==='feedback').map(c=>c[1]);
 const point=h.css([114,302]);assert.equal(h.renderer.hitPart(point.clientX,point.clientY)?.partId,'outer-left');
 const pull=()=>{h.emit(h.canvas,'pointerdown',point);h.emit(h.win,'pointermove',{...point,clientX:point.clientX+12});h.emit(h.win,'pointerup',{...point,buttons:0});};
 pull();const first=messages().at(-1);assert.ok(first?.text);const count=messages().length;
 for(let i=0;i<3;i++){pull();assert.equal(messages().length,count,'no clear/reopen IPC on the same action');}
 const head=h.css([298.2,80]);assert.equal(h.renderer.hitPart(head.clientX,head.clientY)?.partId,'head');
 h.emit(h.canvas,'pointerdown',head);assert.equal(messages().length,count);
 h.emit(h.win,'pointerup',{...head,buttons:0});
 assert.equal(messages().length,count+1);assert.notEqual(messages().at(-1).text,first.text);assert.ok(messages().at(-1).id>first.id);
 h.action('shell:hide');assert.equal(messages().at(-1),null);assert.deepEqual(h.errors,[]);
});
