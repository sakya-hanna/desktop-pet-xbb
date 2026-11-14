'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..');
function harness({badImage=false}={}){
  const meta=JSON.parse(fs.readFileSync(path.join(root,'assets/manifest.json'),'utf8'));
  const calls=[],readPixels=[];let alpha=255,rect={x:0,y:0,width:240,height:348};
  let next=20;const enums={NO_ERROR:0};
  const gl=new Proxy({
    getShaderParameter:()=>true,getProgramParameter:()=>true,getAttribLocation:()=>0,getError:()=>0,getExtension:()=>null,getParameter:()=> 'Node mock GL (not real GPU)',
    createShader:()=>({}),createProgram:()=>({}),createTexture:()=>({}),createVertexArray:()=>({}),createBuffer:()=>({}),getUniformLocation:()=>({}),
    readPixels(x,y,w,h,_format,_type,out){readPixels.push({x,y,w,h});for(let i=3;i<out.length;i+=4)out[i]=alpha;},
  },{get(o,k){if(k in o)return o[k];if(/^[A-Z_0-9]+$/.test(k))return enums[k]??(enums[k]=next++);return (...args)=>{calls.push([k,...args]);};}});
  const canvas={dataset:{},width:240,height:348,getContext:name=>name==='webgl2'?gl:null,getBoundingClientRect:()=>({...rect})};
  let alphaCanvases=0;
  const document={createElement(name){assert.equal(name,'canvas');alphaCanvases++;return {width:0,height:0,getContext:()=>({drawImage(){},getImageData:()=>({data:new Uint8Array(530*800*4).fill(255)})})};}};
  class Image{set src(v){this.name=v.split('/').pop();const [w,h]=meta.images[this.name].size;this.naturalWidth=badImage?w+1:w;this.naturalHeight=h;}decode(){return Promise.resolve();}}
  const context=vm.createContext({console,document,Image,Uint8Array,Float32Array,Uint32Array,Map,Set,window:{devicePixelRatio:1.25},fetch:async url=>{return {ok:true,json:async()=>url==='assets/manifest.json'?meta:JSON.parse(fs.readFileSync(path.join(root,url),'utf8'))};},
    CharacterBinding:require('../src/character.js'),MaterialRig:require('../src/material-rig.js'),MaterialHit:require('../src/hit-test.js'),PreviewView:require('../src/view.js'),DesktopView:require('../src/desktop-view.js')});
  vm.runInContext(fs.readFileSync(path.join(root,'src/character-renderer.js'),'utf8'),context);
  return {create:()=>context.CharacterRenderer.create(canvas),canvas,calls,readPixels,expectedTextures:Object.keys(meta.images).length,setAlpha:a=>alpha=a,setRect:r=>rect=r,alphaCanvases:()=>alphaCanvases};
}
test('single-canvas renderer adapts actual CSS size and DPR, no preview UI or RAF required',async()=>{
  const h=harness(),r=await h.create();r.render({},'3942',false,0,false);
  assert.equal(h.canvas.width,Math.round(240*1.25));assert.equal(h.canvas.height,Math.round(348*1.25));assert.equal(h.alphaCanvases(),1);
  const s=r.status();assert.equal(s.webgl2,true);assert.equal(s.loadedTextures,h.expectedTextures);assert.equal(s.drawCalls>0,true);assert.deepEqual(Array.from(s.glErrors),[]);
  h.setRect({x:0,y:0,width:300,height:435});r.render({},'3942',false,0,false);
  assert.equal(h.canvas.width,Math.round(300*1.25));assert.equal(h.canvas.height,Math.round(435*1.25));
});
test('current framebuffer alpha owns transparent-area hit testing and exact DPR mapping',async()=>{
  const h=harness(),r=await h.create();r.render({},'3942',false,0,false);
  h.setAlpha(255);assert.equal(r.hitOpaque(120,174),true);
  assert.deepEqual(h.readPixels.at(-1),{x:Math.floor(h.canvas.width/2),y:h.canvas.height-1-Math.floor(h.canvas.height/2),w:1,h:1});
  h.setAlpha(0);assert.equal(r.hitOpaque(120,174),false);const before=h.readPixels.length;
  assert.equal(r.hitOpaque(-1,174),false);assert.equal(r.hitOpaque(120,348),false);assert.equal(h.readPixels.length,before);
  h.setRect({x:0,y:0,width:300,height:435});h.setAlpha(255);assert.equal(r.hitOpaque(120,174),false,'no stale framebuffer after a pending resize');
  r.render({},'3942',false,0,false);assert.equal(r.hitOpaque(120,174),true);
});
test('head material pick remains available after motion and invalid textures fail closed',async()=>{
  const h=harness(),r=await h.create();r.render({headRoll:0.08,headX:0.01},'3942',false,0,false);
  const p=r.headInputPoint();assert.ok(r.hitTest(p.x,p.y));assert.equal(r.hitTest(-1,3),null);
  await assert.rejects(harness({badImage:true}).create(),/Unexpected texture size/);
});
