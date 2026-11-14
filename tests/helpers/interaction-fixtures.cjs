'use strict';
// Only DOM/GL/RAF and preload are fakes. PNG alpha, author JSON, renderer,
// director, runtime, rig and material picking are real; no GPU/native claims.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {resolveEvidenceRoot}=require('./interaction-evidence.cjs');
const root=path.resolve(__dirname,'../..'),E=resolveEvidenceRoot(root);
const {decode}=require(path.join(E,'implementation/png-adapter.cjs')),cache=new Map();
const load=name=>{if(!cache.has(name))cache.set(name,decode(fs.readFileSync(path.join(root,'assets',name))));return cache.get(name);};
async function createHarness(options={}){
 const meta=JSON.parse(fs.readFileSync(path.join(root,'assets/manifest.json'))),calls=[],draws=[],raf=new Map(),actions=[],states=[],errors=[];
 options.mutateManifest?.(meta);
 const rect={x:10,y:20,width:240,height:348,...options.rect};let dpr=options.dpr||1.25,now=0,next=0,capture=null,texture=null,vao=null,arrayBuffer=null;
 function hub(id,parent=null){return {id,parent,title:'',listeners:new Map(),addEventListener(t,f){const a=this.listeners.get(t)||[];a.push(f);this.listeners.set(t,a);},removeEventListener(t,f){this.listeners.set(t,(this.listeners.get(t)||[]).filter(x=>x!==f));},contains(el){for(;el;el=el.parent)if(el===this)return true;return false;}};}
 const win=hub('window'),doc=hub('document',win),canvas=hub('canvas',doc),toolbar=hub('toolbar',doc),buttons=Object.fromEntries(['grip','smaller','larger','menu','hop','hide'].map(n=>[n,hub(n,toolbar)]));
 win.devicePixelRatio=dpr;doc.hidden=false;toolbar.querySelector=s=>buttons[s.slice(1)];toolbar.getBoundingClientRect=()=>({x:rect.x,y:rect.y,width:rect.width,height:28});
 doc.elementFromPoint=(x,y)=>options.toolbarHit||y<rect.y+28?toolbar:canvas;
 const enums={NO_ERROR:0};let enumId=10,unit=0;const bound={},uniforms={};
 const gl=new Proxy({
  getShaderParameter:()=>true,getProgramParameter:()=>true,getAttribLocation:(_p,n)=>({a_position:0,a_uv:1,a_material:2}[n]),getError:()=>0,getExtension:()=>null,getParameter:()=> 'Node fake GL; no GPU',
  createShader:()=>({}),createProgram:()=>({}),createTexture:()=>({}),createVertexArray:()=>({buffers:{}}),createBuffer:()=>({}),getUniformLocation:(_p,n)=>n,
  activeTexture(u){unit=u-gl.TEXTURE0;},bindTexture(_t,x){texture=x;bound[unit]=x;},texImage2D(...args){if(args.length===9){texture.image={name:'expression-face'};texture.width=args[3];texture.height=args[4];texture.pixels=new Uint8Array(args[8]);}else texture.image=args.at(-1);},uniform1i(n,v){uniforms[n]=v;},uniform1f(n,v){uniforms[n]=v;},uniform4f(n,...v){uniforms[n]=v;},bindVertexArray(v){vao=v;},
  bindBuffer(t,b){arrayBuffer=b;if(t===gl.ELEMENT_ARRAY_BUFFER&&vao)vao.index=b;},bufferData(_t,d){arrayBuffer.data=new d.constructor(d);},bufferSubData(_t,_o,d){arrayBuffer.data=new d.constructor(d);},vertexAttribPointer(n){vao.buffers[n]=arrayBuffer;},
  clear(){draws.length=0;},drawElements(_mode,count){draws.push({texture:bound[0]?.image?.name,pixels:bound[0]?.pixels,width:bound[0]?.width,height:bound[0]?.height,uniforms:{...uniforms},bound:Object.fromEntries(Object.entries(bound).map(([k,v])=>[k,v?.image?.name])),count,positions:new Float32Array(vao.buffers[0].data),uv:new Float32Array(vao.buffers[1].data),rest:new Float32Array(vao.buffers[2].data),indices:new Uint32Array(vao.index.data)});},
  readPixels(_x,_y,_w,_h,_f,_t,out){for(let i=3;i<out.length;i+=4)out[i]=options.frameAlpha===undefined?255:options.frameAlpha;},
 },{get(o,k){if(k in o)return o[k];if(/^[A-Z_0-9]+$/.test(k))return enums[k]??(enums[k]=enumId++);return ()=>{};}});
 canvas.dataset={};canvas.width=240;canvas.height=348;canvas.getBoundingClientRect=()=>({...rect});canvas.getContext=t=>t==='webgl2'?gl:null;
 for(const el of [canvas,...Object.values(buttons)]){el.setPointerCapture=id=>{if(options.captureFailure)throw Error('capture failure');if(options.captureSilent)return;capture={el,id};};el.hasPointerCapture=id=>capture?.el===el&&capture.id===id;el.releasePointerCapture=id=>{if(el.hasPointerCapture(id)){capture=null;emit(el,'lostpointercapture',{pointerId:id});}};}
 doc.createElement=()=>{let image;return {width:0,height:0,getContext:()=>({drawImage(im){image=im;},getImageData(){return {data:load(image.name).data};}})};};
 class Image{set src(value){this.name=value.split('/').pop();const im=load(this.name);this.naturalWidth=im.width+(options.badImage===this.name?1:0);this.naturalHeight=im.height;}decode(){return options.failImage===this.name?Promise.reject(Error('image decode failed')):Promise.resolve();}}
 const pet={ready(){},getState:()=>({visible:true,idleEnabled:options.idle!==false,clickThrough:false}),onAction:f=>{actions.push(f);return ()=>{};},onState:f=>{states.push(f);return ()=>{};},...Object.fromEntries(['drag','resizeBy','setInteractive','menu','command','feedback'].map(n=>[n,(...a)=>calls.push([n,...a])]))};
 options.configurePet?.(pet);
 const context=vm.createContext({console:options.bootstrap?{...console,error:(...messages)=>errors.push(messages.join(' '))}:console,window:win,document:doc,Image,Uint8Array,Float32Array,Uint32Array,Map,Set,
  fetch:async url=>{if(url==='assets/manifest.json')return {ok:true,json:async()=>meta};if(url.endsWith('.mesh.json')&&(options.failMesh===true||options.failMesh===url.slice('assets/'.length)))return {ok:false,status:404};let json=JSON.parse(fs.readFileSync(path.join(root,url)));if(url.endsWith('.mesh.json')&&options.mutateMesh)options.mutateMesh(json);return {ok:true,json:async()=>json};},
  CharacterBinding:require('../../src/character.js'),MaterialRig:require('../../src/material-rig.js'),MaterialHit:require('../../src/hit-test.js'),PreviewView:require('../../src/view.js'),DesktopView:require('../../src/desktop-view.js'),MotionDirector:require('../../src/director.js'),
  requestAnimationFrame:f=>{const id=++next;raf.set(id,f);return id;},cancelAnimationFrame:id=>raf.delete(id),
 });
 vm.runInContext(fs.readFileSync(path.join(root,'src/character-renderer.js'),'utf8'),context);
 vm.runInContext(fs.readFileSync(path.join(root,'src/desktop-runtime.js'),'utf8'),context);
 let renderer,runtime;
 if(options.bootstrap){
  const notice={textContent:''};doc.body={dataset:{}};doc.querySelector=s=>({'#character':canvas,'#toolbar':toolbar,'#notice':notice,...Object.fromEntries(Object.entries(buttons).map(([k,v])=>['#'+k,v]))}[s]);win.pet=pet;
  // Observe construction, delegating unchanged to the real factories. The real
  // bootstrap supplies report/fallback/onState and owns start/destroy itself.
  const create=context.CharacterRenderer.create,attach=context.DesktopRuntime.attach;
  context.CharacterRenderer.create=async(...args)=>(renderer=await create(...args));
  context.DesktopRuntime.attach=(...args)=>(runtime=attach(...args));
  await vm.runInContext(fs.readFileSync(path.join(root,'src/desktop-bootstrap.js'),'utf8'),context,{filename:'src/desktop-bootstrap.js'});
  context.CharacterRenderer.create=create;context.DesktopRuntime.attach=attach;
 }else{
  renderer=await context.CharacterRenderer.create(canvas);
  runtime=context.DesktopRuntime.attach({canvas,toolbar,renderer,pet,responseConfig:options.responseConfig,onError:e=>{errors.push(e.message);options.onError?.(e);}});
 }
 function emit(target,type,data={}){const ev={target,type,pointerId:7,button:0,buttons:1,clientX:100,clientY:200,screenX:300,screenY:400,isTrusted:false,preventDefault(){this.defaultPrevented=true;},...data};for(let el=target;el;el=el.parent)for(const f of [...(el.listeners.get(type)||[])])f(ev);return ev;}
 function tick(n=1,ms=1000/60){for(let i=0;i<n;i++){now+=ms;const batch=[...raf.values()];raf.clear();for(const f of batch)f(now);}}
 function css(point){const c=context.PreviewView.cameraFor(rect.width,rect.height,false,context.CharacterBinding.binding);return {clientX:rect.x+(point[0]-c.x)/c.w*rect.width,clientY:rect.y+(point[1]-c.y)/c.h*rect.height};}
 return {pet,meta,renderer,runtime,canvas,toolbar,buttons,win,doc,rect,calls,draws,raf,errors,emit,tick,css,actions,states,load,captured:()=>capture,action:n=>actions.forEach(f=>f(n)),state:s=>states.forEach(f=>f(s)),setDpr:n=>{win.devicePixelRatio=n;}};
}
module.exports={createHarness,load,root,E};
