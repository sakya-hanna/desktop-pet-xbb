// Simulates only browser/GL boundaries; real images/WebGL are checked by Electron acceptance.
const fs=require('fs');const path=require('path');const vm=require('vm');const assert=require('assert/strict');
const dir=path.join(__dirname,'../../puppet/rig');
async function boot(query='',options={}){
 const queue=[],logs=[],errors=[],warnings=[],events={};let action,chatReply;
 const constants=new Map(),gpu={program:null,unit:0,framebuffer:null,textures:new Map(),attachments:new Map(),samplers:new Map(),draws:[]};let nextConstant=100,nextID=1;
 const gl=new Proxy({}, {get:(_,key)=>{
  if(key==='createShader'||key==='createProgram'||key.startsWith('create'))return ()=>({id:nextID++,kind:key});
  if(key==='shaderSource')return (shader,source)=>{shader.source=source;};
  if(key==='attachShader')return (program,shader)=>{(program.shaders??=[]).push(shader);};
  if(key==='getShaderParameter')return shader=>!(options.failFrontShader&&shader.source?.includes('u_caster'));
  if(key==='getShaderInfoLog')return ()=>'Injected front shader compile failure';
  if(key==='getProgramParameter')return ()=>true;
  if(key==='checkFramebufferStatus')return ()=>gl.FRAMEBUFFER_COMPLETE;
  if(key==='useProgram')return p=>{gpu.program=p;};
  if(key==='bindAttribLocation')return (p,index,name)=>{(p.attributes??={})[name]=index;};
  if(key==='getAttribLocation')return (p,name)=>p.attributes?.[name]??0;
  if(key==='getUniformLocation')return (program,name)=>({program,name});
  if(key.startsWith('uniform'))return (location,...values)=>{if(!location)return;assert.equal(gpu.program,location.program,'Uniform written through the wrong active program');if(['u_tex','u_caster','u_receiver','u_face'].includes(location.name)){if(!gpu.samplers.has(gpu.program))gpu.samplers.set(gpu.program,new Map());gpu.samplers.get(gpu.program).set(location.name,values[0]);}};
  if(key==='activeTexture')return unit=>{gpu.unit=unit-gl.TEXTURE0;};
  if(key==='bindTexture')return (_,tex)=>{gpu.textures.set(gpu.unit,tex);};
  if(key==='bindFramebuffer')return (target,fb)=>{if(target===gl.FRAMEBUFFER||target===gl.DRAW_FRAMEBUFFER)gpu.framebuffer=fb;};
  if(key==='framebufferTexture2D')return (_,__,___,tex)=>{gpu.attachments.set(gpu.framebuffer,tex);};
  if(key==='drawElements')return ()=>{const target=gpu.attachments.get(gpu.framebuffer);if(target)for(const unit of gpu.samplers.get(gpu.program)?.values()||[])assert.notEqual(gpu.textures.get(unit),target,'Framebuffer texture feedback loop');gpu.draws.push({front:!!gpu.program?.shaders?.some(s=>s.source?.includes('u_caster')),framebuffer:gpu.framebuffer?.id??null});};
  if(key==='getParameter')return ()=>1;
  if(typeof key==='string'&&key.toUpperCase()===key){if(!constants.has(key))constants.set(key,nextConstant++);return constants.get(key);}
  return ()=>{};
 }});
 const makeCanvas=()=>{const c={width:530,height:800};c.getContext=t=>t==='webgl2'?gl:{
  drawImage(){},getImageData(){
   const data=new Uint8ClampedArray(c.width*c.height*4);
   // Small deterministic alpha fixture keeps orchestration tests inexpensive.
   for(const [x0,x1,y0,y1] of [[264,336,24,112],[260,330,198,248]])
    for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++)data[(y*c.width+x)*4+3]=255;
   return {data};
  }
 };return c;};
 const canvas=makeCanvas();const epoch=options.epoch||0;let clock=epoch;
 const window={innerWidth:240,innerHeight:348,devicePixelRatio:1,addEventListener:(k,fn)=>{const prior=events[k];events[k]=prior?event=>{prior(event);fn(event);}:fn;}};
 // Execute the production preload; do not invent a bridge the shipped app lacks.
 vm.runInNewContext(fs.readFileSync(path.join(dir,'../preload.js'),'utf8'),{require:()=>({
  contextBridge:{exposeInMainWorld:(name,api)=>{window[name]=api;}},
  ipcRenderer:{on:(channel,handler)=>{if(channel==='action')action=value=>handler({},value);if(channel==='chat:reply')chatReply=value=>handler({},value);},send:channel=>{if(channel==='model:cancel')logs.push(['cancel-model']);}}
 })});
 const makeElement=()=>({dataset:{},setAttribute(){},appendChild(){},contains:()=>false});
 const env={window,document:{getElementById:()=>canvas,createElement:tag=>tag==='canvas'?makeCanvas():makeElement(),elementFromPoint:()=>null,body:makeElement()},console:{log:(...a)=>logs.push(a),warn:(...a)=>warnings.push(a),error:(...a)=>errors.push(a)},URLSearchParams,location:{search:query},performance:{now:()=>clock},requestAnimationFrame:fn=>queue.push(fn),Image:class{
  constructor(){this.naturalWidth=530;this.naturalHeight=800;}
  set src(v){this._src=v;
   // This is a logic fixture, not a PNG validator. Derive mock dimensions from
   // the declared asset contract so public clones never require private art.
   const part=window.FRONT_HAIR_ASSETS?.baijie?.parts?.find(p=>[p.texture,p.caster,p.receiver].some(name=>v==='assets/'+name));
   if(part?.textureSize)[this.naturalWidth,this.naturalHeight]=part.textureSize;
   const dimensions=options.dimensions?.(v);if(dimensions)[this.naturalWidth,this.naturalHeight]=dimensions;
   queueMicrotask(()=>options.fail?.(v)?this.onerror():this.onload());}
 }};
 const ctx=vm.createContext(env);const html=fs.readFileSync(path.join(dir,'index.html'),'utf8');
 for(const [,src] of html.matchAll(/<script src="([^"]+)"/g)){
  vm.runInContext(fs.readFileSync(path.join(dir,src),'utf8'),ctx,{filename:src});
  if(src.endsWith('front-hair-assets.js')&&options.frontConfig)window.FRONT_HAIR_ASSETS={baijie:options.frontConfig};
  Object.assign(ctx,window);
 }
 await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(errors,[],'renderer must boot without failure');assert.ok(window.__rig.ready,'renderer readiness must be explicit after assets load');
 let frame=0;
 const advance=(count=1)=>{for(let i=0;i<count;i++){assert.ok(queue.length,'animation loop must remain live');clock=epoch+(++frame)*1000/60;queue.shift()(clock);}};
 advance(options.frames??300);
 return {rig:window.__rig,glDraws:gpu.draws,advance,action:name=>action(name),chatReply:reply=>{assert.equal(typeof chatReply,"function","model reply bridge must be registered");return chatReply(reply);},events,logs,warnings};
}
module.exports={boot};
