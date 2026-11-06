'use strict';
const path=require('node:path');
const EXTENSIONS=new Set(['.html','.js','.css','.png','.json']);
function resolveResource(value,root){
 try{
  const url=new URL(value);
  if(url.protocol!=='baijie:'||url.hostname!=='app'||url.port||url.username||url.password||/%2f|%5c/i.test(url.pathname))return null;
  const name=decodeURIComponent(url.pathname).slice(1);
  if(!name.startsWith('rig/')||name.includes('\\')||name.includes('\0')||!EXTENSIONS.has(path.extname(name)))return null;
  const file=path.resolve(root,name),relative=path.relative(path.resolve(root,'rig'),file);
  return relative && !relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative)?file:null;
 }catch{return null;}
}
const CSP="default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'; object-src 'none'";
const MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.json':'application/json; charset=utf-8'};
function install({protocol,root}){
 const fs=require('node:fs/promises');
 protocol.handle('baijie',async request=>{
  if(request.method!=='GET')return new Response(null,{status:405});
  const file=resolveResource(request.url,root);if(!file)return new Response(null,{status:404});
  try{
   const [real,rig]=await Promise.all([fs.realpath(file),fs.realpath(path.join(root,'rig'))]);
   const relative=path.relative(rig,real);
   if(!relative||relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative))return new Response(null,{status:404});
   const bytes=await fs.readFile(real);
   return new Response(bytes,{headers:{'Content-Type':MIME[path.extname(file)],'Content-Security-Policy':CSP,'X-Content-Type-Options':'nosniff','Cache-Control':'no-store'}});
  }catch{return new Response(null,{status:404});}
 });
}
module.exports={resolveResource,install,CSP};
