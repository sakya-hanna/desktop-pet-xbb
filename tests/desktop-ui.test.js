const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const file=path.join(__dirname,'../puppet/rig/js/desktop-ui.js');
function fixture(){
 const events={},calls=[],nodes={};let under=null;
 function element(){return {children:[],dataset:{},setAttribute(){},appendChild(n){this.children.push(n);if(n.id)nodes[n.id]=n;},contains(n){return n===this||this.children.includes(n);}};}
 const document={createElement:element,body:element(),elementFromPoint:()=>under};
 const host={innerWidth:240,innerHeight:348,addEventListener:(k,fn)=>events[k]=fn};
 const pet={setInteractive:v=>calls.push(['interactive',v]),resizeBy:v=>calls.push(['resize',v]),menu:v=>calls.push(['menu',v])};
 return {document,host,pet,events,calls,nodes,under:v=>under=v};
}
test('UI arbitrates blank/character/control/held points and only emits state changes',()=>{
 assert.ok(fs.existsSync(file),'missing independent desktop UI');
 const f=fixture(),ui=require(file).create(f.host,f.document,f.pet,(x)=>x>=100,()=>{});
 ui.tick();ui.tick();assert.deepEqual(f.calls,[['interactive',false]]);
 f.events.mousemove({clientX:120,clientY:40});ui.tick();assert.deepEqual(f.calls.at(-1),['interactive',true]);
 f.events.mousemove({clientX:10,clientY:40});ui.tick();assert.deepEqual(f.calls.at(-1),['interactive',false]);
 f.under(f.nodes['pet-grip']);ui.tick();assert.deepEqual(f.calls.at(-1),['interactive',true]);
 f.events.mouseleave();ui.setHeld(true);ui.tick();assert.equal(ui.snapshot().interactive,true);
 ui.setHeld(false);ui.tick();assert.equal(ui.snapshot().interactive,false);
});

test('Ctrl+wheel zooms character only; controls do not become body clicks',()=>{
 const f=fixture();let count=0;
 const ui=require(file).create(f.host,f.document,f.pet,x=>x>=100,()=>count++);
 assert.equal(typeof f.events.wheel,'function');
 const e={ctrlKey:true,clientX:120,clientY:50,deltaY:-100,preventDefault(){this.prevented=true;}};
 f.events.wheel(e);assert.equal(e.prevented,true);assert.ok(f.calls.at(-1)[1]>1);
 assert.equal(ui.isUI({target:f.nodes['pet-larger']}),true);assert.equal(ui.isGrip({target:f.nodes['pet-larger']}),false);
 assert.equal(ui.isGrip({target:f.nodes['pet-grip']}),true);
 const before=f.calls.length;f.events.wheel({...e,clientX:10});assert.equal(f.calls.length,before);
 f.nodes['pet-larger'].onclick();assert.deepEqual(f.calls.at(-1),['resize',1.05]);assert.equal(count,2);
});
