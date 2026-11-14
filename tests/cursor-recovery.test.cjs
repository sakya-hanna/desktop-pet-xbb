'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createHarness}=require('./helpers/interaction-fixtures.cjs');
test('isolated preload forwards valid local cursor coordinates and removes its subscription',()=>{
 const fs=require('node:fs'),vm=require('node:vm'),{EventEmitter}=require('node:events'),ipc=new EventEmitter();let pet;
 vm.runInNewContext(fs.readFileSync(require.resolve('../desktop-preload.cjs'),'utf8'),{process:{isMainFrame:true},require:()=>({ipcRenderer:ipc,contextBridge:{exposeInMainWorld:(_name,value)=>{pet=value;}}})});
 const seen=[],stop=pet.onCursor(p=>seen.push(p));
 for(const value of [null,{x:NaN,y:0},{x:1,y:2,extra:true},{x:'1',y:2}])ipc.emit('desktop:cursor',{},value);
 assert.equal(seen.length,0);ipc.emit('desktop:cursor',{}, {x:-10,y:200});assert.deepEqual(seen,[{x:-10,y:200}]);
 stop();ipc.emit('desktop:cursor',{}, {x:1,y:2});assert.equal(seen.length,1);
});
test('system cursor restores alpha input without any forwarded DOM move, including after game blur',async t=>{
 let receive;const h=await createHarness({idle:false,configurePet:pet=>{pet.onCursor=fn=>{receive=fn;return()=>{receive=null;};};}});t.after(()=>h.runtime.destroy());h.toolbar.hidden=true;h.runtime.start();h.tick(2);
 const p=h.renderer.headInputPoint(),local={x:p.x,y:p.y};
 h.emit(h.win,'blur');assert.equal(h.runtime.status().interactive,false);
 // Deliberately deliver NO pointermove/mousemove: the native forwarder is absent.
 receive?.(local);assert.equal(h.runtime.status().interactive,true,'system cursor must break the permanent pass-through state');
 h.emit(h.win,'wheel',{clientX:p.x,clientY:p.y,buttons:0,ctrlKey:true,deltaY:-100});assert.equal(h.calls.filter(c=>c[0]==='resizeBy').length,1);
 h.emit(h.canvas,'pointerdown',{clientX:p.x,clientY:p.y,ctrlKey:true});assert.equal(h.runtime.status().pointerKind,'drag');
 receive({x:-100,y:-100});assert.equal(h.runtime.status().pointerKind,'drag','polling does not cancel a captured carry');
 h.emit(h.win,'pointermove',{clientX:p.x,clientY:p.y,ctrlKey:true,screenX:320,screenY:410});assert.equal(h.calls.filter(c=>c[0]==='drag').length,1);
 h.emit(h.win,'pointerup',{clientX:p.x,clientY:p.y,buttons:0});h.emit(h.win,'blur');receive(local);assert.equal(h.runtime.status().interactive,true);
 receive({x:-100,y:-100});assert.equal(h.runtime.status().interactive,false,'outside cursor still passes through');
 h.state({visible:true,clickThrough:true});receive(local);assert.equal(h.runtime.status().interactive,false,'explicit pass-through remains intentional');
 h.state({visible:true,clickThrough:false});receive(local);assert.equal(h.runtime.status().interactive,true);
 h.action('shell:hide');receive(local);assert.equal(h.runtime.status().interactive,false,'cursor cannot unhide the pet');
 h.action('shell:show');receive(local);assert.equal(h.runtime.status().interactive,true);assert.deepEqual(h.errors,[]);
 h.runtime.destroy();assert.equal(receive,null);
});
