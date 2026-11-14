'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createHarness,load}=require('./helpers/interaction-fixtures.cjs'),hit=require('../src/hit-test.js'),{createDirector}=require('../src/director.js');
function seamPoints(){const a=load('baijie-skirt-front.png'),b=load('baijie-skirt-back-visible-center.png'),points=[];const alpha=(im,x,y)=>im.data[(y*im.width+x)*4+3]||0;
 for(let y=2172;y<2531;y+=2)for(let x=1342;x<1568;x+=2)if(alpha(b,x,y)>240&&[[0,-3],[-3,0],[3,0],[0,3]].some(([dx,dy])=>alpha(a,x+dx,y+dy)>240))points.push([(x+.5)*530/a.width,(y+.5)*800/a.height]);return points;}
const mapped=(d,p)=>hit.pickMaterial({rest:d.positions,indices:d.indices},d.rest,p);
test('actual opaque front/lining cut stays sewn during natural idle, both pulls and release',async t=>{
 const h=await createHarness({idle:false});t.after(()=>h.runtime.destroy());h.runtime.start();h.tick(2);
 const seam=seamPoints();assert.ok(seam.length>100);
 const poses=[],d=createDirector({idleAction:'qianhuili',seed:17});let extreme=null;
 for(let i=0;i<7200;i++){const pose=d.advance(1/120).pose;if(!extreme||Math.abs(pose.cloth['skirt-front'][0])>Math.abs(extreme.cloth['skirt-front'][0]))extreme=pose;}
 poses.push(extreme);assert.ok(Math.abs(extreme.cloth['skirt-front'][0])>5,'real automatic idle exercises the gap');
 for(const id of ['skirt-front','skirt-right']){d.send({type:'grab-down',pointerId:7,partId:id,materialPoint:[290,440]});d.send({type:'grab-move',pointerId:7,x:12,y:-10});for(let i=0;i<120;i++)d.advance(1/120);poses.push(d.snapshot().pose);d.send({type:'grab-up',pointerId:7});for(let i=0;i<24;i++)d.advance(1/120);poses.push(d.snapshot().pose);}
 let maximum=0;for(const pose of poses){h.renderer.render(pose,'3942');const front=h.draws.find(x=>x.texture==='baijie-skirt-front.png'),lining=h.draws.find(x=>x.texture==='baijie-skirt-back-visible-center.png');for(const p of seam){const a=mapped(front,p),b=mapped(lining,p);assert.ok(a&&b,'actual source cut must be covered by both mesh domains');const gap=Math.hypot(a[0]-b[0],a[1]-b[1]);maximum=Math.max(maximum,gap);assert.ok(gap<.035,JSON.stringify({point:p,gap,cloth:pose.cloth,grab:pose.grab}));}}
 console.log('LINING_SEAM_MAX '+maximum);
 h.renderer.render({},'3942');const lining=h.draws.find(x=>x.texture==='baijie-skirt-back-visible-center.png');const p=h.css(mapped(lining,[295,495])),picked=h.renderer.hitPart(p.clientX,p.clientY);assert.equal(picked?.layer,'baijie-skirt-back-visible-center.png');assert.equal(picked.partId,null,'following cloth must not turn inner lining into a new grab target');
 assert.deepEqual(h.errors,[]);
});
