(function(root,factory){
 if(typeof module==='object'&&module.exports)module.exports=factory();
 else if(typeof define==='function'&&define.amd)define([],factory);
 else root.CharacterHit=factory();
})(typeof window!=='undefined'?window:globalThis,function(){
 'use strict';
 function makeLayer(mesh,rgba,width,height){
  const alpha=new Uint8Array(width*height);
  for(let i=0;i<alpha.length;i++)alpha[i]=rgba[i*4+3];
  return {mesh,alpha,width,height};
 }
 function sampleAlpha(layer,u,v){
  // Optional inverse-UV sampler for moving front textures; ordinary layers stay unchanged.
  if(typeof layer.sampleAlpha==='function')return layer.sampleAlpha(u,v);
  // GL LINEAR uses texel centers, with each neighboring index clamped at edges.
  const {width:w,height:h,alpha}=layer;
  const x=Math.max(0,Math.min(w-1,u*w-0.5));
  const y=Math.max(0,Math.min(h-1,v*h-0.5));
  const x0=Math.floor(x),y0=Math.floor(y),x1=Math.min(w-1,x0+1),y1=Math.min(h-1,y0+1);
  const tx=x-x0,ty=y-y0;
  const top=alpha[y0*w+x0]*(1-tx)+alpha[y0*w+x1]*tx;
  const bottom=alpha[y1*w+x0]*(1-tx)+alpha[y1*w+x1]*tx;
  return top*(1-ty)+bottom*ty;
 }
 function hit(layers,x,y,view){
  if(!Number.isFinite(x)||!Number.isFinite(y)||!Number.isFinite(view.s)||view.s<=0)return false;
  x=(x-view.ox)/view.s;y=(y-view.oy)/view.s;
  for(const layer of layers){
   const {out,idx,uvs}=layer.mesh;
   for(let i=0;i+2<idx.length;i+=3){
    const a=idx[i]*2,b=idx[i+1]*2,c=idx[i+2]*2;
    const abx=out[b]-out[a],aby=out[b+1]-out[a+1];
    const acx=out[c]-out[a],acy=out[c+1]-out[a+1];
    const det=abx*acy-aby*acx;
    // Zero-area triangles have no visible surface; either winding is otherwise valid.
    if(!Number.isFinite(det)||det===0)continue;
    const px=x-out[a],py=y-out[a+1];
    const wb=(px*acy-py*acx)/det,wc=(abx*py-aby*px)/det,wa=1-wb-wc;
    if(!(wa>=0&&wb>=0&&wc>=0))continue;
    const u=wa*uvs[a]+wb*uvs[b]+wc*uvs[c];
    const v=wa*uvs[a+1]+wb*uvs[b+1]+wc*uvs[c+1];
    if(sampleAlpha(layer,u,v)>=8)return true;
   }
  }
  return false;
 }
 function pick(layers,x,y,view){
  if(!Number.isFinite(x)||!Number.isFinite(y)||!Number.isFinite(view.s)||view.s<=0)return null;
  x=(x-view.ox)/view.s;y=(y-view.oy)/view.s;
  for(let j=layers.length-1;j>=0;j--){
   const layer=layers[j];
   const {out,idx,uvs,rest}=layer.mesh;
   if(!rest||rest.length!==out.length)continue;
   for(let i=0;i+2<idx.length;i+=3){
    const a=idx[i]*2,b=idx[i+1]*2,c=idx[i+2]*2;
    const abx=out[b]-out[a],aby=out[b+1]-out[a+1];
    const acx=out[c]-out[a],acy=out[c+1]-out[a+1];
    const det=abx*acy-aby*acx;
    if(!Number.isFinite(det)||det===0)continue;
    const px=x-out[a],py=y-out[a+1];
    const wb=(px*acy-py*acx)/det,wc=(abx*py-aby*px)/det,wa=1-wb-wc;
    if(!(wa>=0&&wb>=0&&wc>=0))continue;
    const u=wa*uvs[a]+wb*uvs[b]+wc*uvs[c];
    const v=wa*uvs[a+1]+wb*uvs[b+1]+wc*uvs[c+1];
    if(sampleAlpha(layer,u,v)>=8){
     const rx=wa*rest[a]+wb*rest[b]+wc*rest[c];
     const ry=wa*rest[a+1]+wb*rest[b+1]+wc*rest[c+1];
     if(Number.isFinite(rx)&&Number.isFinite(ry))return {x:rx,y:ry,layer,part:layer.part};
    }
   }
  }
  return null;
 }
 return {makeLayer,hit,pick,sampleAlpha};
});
