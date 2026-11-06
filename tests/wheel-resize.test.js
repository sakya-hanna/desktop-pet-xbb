const test=require('node:test'),assert=require('node:assert/strict');
const {bootWheel}=require('./helpers/wheel-harness.cjs');

test('existing ordinary Ctrl+wheel reaches real preload/main/geometry without a prior click',async()=>{
 const r=await bootWheel(),b=r.win.getBounds();
 const up=r.wheel();assert.equal(up.prevented,true);assert.ok(r.win.bounds.height>b.height);
 const grown=r.win.getBounds();r.wheel({deltaY:100});assert.ok(r.win.bounds.height<grown.height);
 assert.equal(r.options.wheel.passive,false);
 r.nodes['pet-larger'].onclick();assert.equal(r.messages.at(-1)[1],1.05);
 r.nodes['pet-smaller'].onclick();assert.equal(r.messages.at(-1)[1],1/1.05);
});

test('tiny wheel deltas accumulate into actual resize without one-way integer drift',async()=>{
 const r=await bootWheel(),b=r.win.getBounds();
 for(let i=0;i<100;i++)r.wheel({deltaY:-.1});
 assert.ok(r.win.bounds.height>=b.height+3,`tiny up events stayed at ${r.win.bounds.height}`);
 for(let i=0;i<100;i++)r.wheel({deltaY:.1});
 assert.equal(r.win.bounds.height,b.height);assert.equal(r.win.bounds.width,b.width);
 r.flush();assert.equal(r.writes.at(-1).state.size,'custom');
 const zoomed=r.win.getBounds();r.pet.drag(2,3);
 assert.equal(r.win.bounds.width,zoomed.width);assert.equal(r.win.bounds.height,zoomed.height);
});

test('wheel keeps the same character point under a stationary cursor across small ticks',async()=>{
 const r=await bootWheel(),b=r.win.getBounds(),a={x:.35,y:.3};
 const cursor={x:b.x+b.width*a.x,y:b.y+b.height*a.y};
 for(let i=0;i<200;i++){
   const now=r.win.getBounds();
   const e=r.wheel({deltaY:-1,clientX:cursor.x-now.x,clientY:cursor.y-now.y});
   assert.equal(e.prevented,true);
   const next=r.win.getBounds();
   assert.ok(Math.abs(next.x+next.width*a.x-cursor.x)<=.51,'horizontal cursor anchor drift');
   assert.ok(Math.abs(next.y+next.height*a.y-cursor.y)<=.51,'vertical cursor anchor drift');
 }
 const before=r.win.getBounds();r.nodes['pet-larger'].onclick();const after=r.win.getBounds();
 assert.equal(before.x+before.width,after.x+after.width);
 assert.equal(before.y+before.height,after.y+after.height);
});

test('wheel input isolation rejects plain, dragging, blank and malformed events before IPC',async()=>{
 const r=await bootWheel();
 const invalid=[{ctrlKey:false},{ctrlKey:'true'},{buttons:1},{altKey:true},{metaKey:true},{shiftKey:true},
   {deltaY:0},{deltaY:NaN},{deltaY:Infinity},{deltaY:'-10'},{deltaMode:3},{deltaMode:-1},{deltaMode:'1'},
   {clientX:NaN,target:r.nodes['pet-larger']},{clientY:Infinity,target:r.nodes['pet-larger']},
   {clientX:-1,target:r.nodes['pet-larger']},{clientX:999,target:r.nodes['pet-larger']},
   {clientX:1,clientY:1}];
 for(const value of invalid){
   const n=r.messages.length,b=r.win.getBounds(),activity=r.activity();const e=r.wheel(value);
   assert.equal(r.messages.length,n,JSON.stringify(value));assert.deepEqual(r.win.getBounds(),b);
   assert.equal(e.prevented,undefined);assert.equal(r.activity(),activity);
 }
 r.ui.setHeld(true);const n=r.messages.length;assert.equal(r.wheel().prevented,undefined);assert.equal(r.messages.length,n);
 r.ui.setHeld(false);
 for(const deltaMode of [0,1,2]){
   const b=r.win.getBounds();const e=r.wheel({deltaMode,clientX:2,clientY:2,target:r.nodes['pet-larger']});
   assert.equal(e.prevented,true);assert.ok(r.win.bounds.height>b.height);
 }
});

test('explicit click-through ignores queued zoom IPC and is never disabled by wheel',async()=>{
 const r=await bootWheel();r.pet.menu();
 r.menus.at(-1).find(i=>i.label?.startsWith('鼠标穿透')).click({checked:true});
 const b=r.win.getBounds();r.wheel();r.pet.resizeBy(1.1);r.pet.setInteractive(true);
 assert.deepEqual(r.win.getBounds(),b);assert.equal(r.win.ignoring,true);
});

test('toolbar makes existing Ctrl+wheel shortcut discoverable without replacing buttons',async()=>{
 const r=await bootWheel();
 for(const id of ['pet-smaller','pet-larger'])assert.match(r.nodes[id].title,/Ctrl\+滚轮/);
});

test('preset, reset and display recovery discard fractional residue even if bounds stay identical',async()=>{
 for(const action of ['preset','reset','display']){
   const r=await bootWheel();r.pet.menu();const menu=r.menus.at(-1);
   const reset=()=>menu.find(i=>i.label==='重置位置与大小').click();reset();
   for(let i=0;i<10;i++)r.wheel({deltaY:-.1});
   assert.equal(r.win.bounds.height,348);
   if(action==='preset')menu.find(i=>i.label==='大小').submenu[1].click();
   else if(action==='reset')reset();else r.screen.emit('display-metrics-changed');
   for(let i=0;i<3;i++)r.wheel({deltaY:-.1});
   assert.equal(r.win.bounds.height,348,action+' kept obsolete fractional scale');
 }
});

test('main validates anchor IPC payload and still rejects foreign senders and subframes',async()=>{
 const r=await bootWheel(),b=r.win.getBounds();
 const invalid=[null,{},[],true,'1.1',{factor:1.1},{anchor:{x:.5,y:.5}},
   {factor:'1.1',anchor:{x:.5,y:.5}},...[
     null,undefined,{},[],{x:NaN,y:.5},{x:.5,y:Infinity},{x:-.001,y:.5},{x:1.001,y:.5},{x:.5,y:'0.5'},
   ].map(anchor=>({factor:1.1,anchor}))];
 for(const payload of invalid){r.ipcMain.emit('resize-by',r.event,payload);assert.deepEqual(r.win.getBounds(),b);}
 for(const event of [{},{sender:{}},{sender:r.win.webContents},{sender:r.win.webContents,senderFrame:{}}]){
   for(const payload of [1.1,{factor:1.1,anchor:{x:.5,y:.5}}])r.ipcMain.emit('resize-by',event,payload);
   assert.deepEqual(r.win.getBounds(),b);
 }
 r.pet.resizeBy(1.1,{x:0,y:0});assert.equal(r.win.bounds.x,b.x);assert.equal(r.win.bounds.y,b.y);
 assert.equal(typeof r.messages.at(-1)[1],'object');
 const next=r.win.getBounds();r.pet.resizeBy(1.1);assert.equal(typeof r.messages.at(-1)[1],'number');
 assert.equal(r.win.bounds.x+r.win.bounds.width,next.x+next.width);
});

test('wheel scale has no overscroll debt at minimum or work-area maximum',async()=>{
 const r=await bootWheel();
 for(let i=0;i<100;i++)r.wheel({deltaY:10000});
 const small=r.win.getBounds();assert.equal(small.height,139);assert.equal(small.width,96);
 r.wheel({deltaY:-10});assert.ok(r.win.bounds.height>small.height);
 for(let i=0;i<100;i++)r.wheel({deltaY:-10000});
 const large=r.win.getBounds();assert.equal(large.height,800);assert.ok(large.width<=1000);
 r.wheel({deltaY:10});assert.ok(r.win.bounds.height<large.height);
 const area=r.screen.getPrimaryDisplay().workArea;
 assert.ok(r.win.bounds.x>=area.x&&r.win.bounds.y>=area.y);
 assert.ok(r.win.bounds.x+r.win.bounds.width<=area.x+area.width);
 assert.ok(r.win.bounds.y+r.win.bounds.height<=area.y+area.height);
});

test('manual bounds changes retarget scale and moving cursor retargets anchor',async()=>{
 const r=await bootWheel();for(let i=0;i<10;i++)r.wheel({deltaY:-.1});
 r.win.setBounds({x:300,y:200,width:300,height:435});
 r.wheel({deltaY:-100,clientX:60,clientY:87});
 const b=r.win.getBounds();assert.equal(b.height,Math.round(435*Math.exp(.12)));
 const a={x:.7,y:.6},cursor={x:b.x+b.width*a.x,y:b.y+b.height*a.y};
 r.wheel({deltaY:100,clientX:b.width*a.x,clientY:b.height*a.y});
 assert.ok(Math.abs(r.win.bounds.x+r.win.bounds.width*a.x-cursor.x)<=.51);
 assert.ok(Math.abs(r.win.bounds.y+r.win.bounds.height*a.y-cursor.y)<=.51);
 const next=r.win.getBounds();r.pet.drag(4,5);
 assert.equal(r.win.bounds.width,next.width);assert.equal(r.win.bounds.height,next.height);
 r.flush();assert.deepEqual(r.writes.at(-1).state.bounds,r.win.getBounds());
});

test('toolbar wheel keeps its fixed-size top-centered controls under the cursor',async()=>{
 const r=await bootWheel(),b=r.win.getBounds(),center=b.x+b.width/2,top=b.y;
 for(let i=0;i<180;i++){
   // The actual toolbar is CSS top:5px; left:50%, with fixed-size controls.
   const now=r.win.getBounds();r.wheel({deltaY:-1,target:r.nodes['pet-larger'],clientX:center+25-now.x,clientY:top+15-now.y});
   assert.ok(Math.abs(r.win.bounds.x+r.win.bounds.width/2-center)<=.51,'toolbar center drift');
   assert.equal(r.win.bounds.y,top,'toolbar slid away vertically');
 }
});

test('drag away and back explicitly clears fractional zoom state',async()=>{
 const r=await bootWheel();for(let i=0;i<10;i++)r.wheel({deltaY:-.1});
 r.pet.drag(1,0);r.pet.drag(-1,0);
 for(let i=0;i<3;i++)r.wheel({deltaY:-.1});
 assert.equal(r.win.bounds.height,348);
});
