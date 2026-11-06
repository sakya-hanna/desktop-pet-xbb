// Independent outer locks only. The original body never receives this motion.
(function(root){
  function bendLock(rest,part,angle,out){
    const a=Number.isFinite(angle)?Math.max(-0.08,Math.min(0.08,angle)):0;
    const [rx,ry]=part.root;
    const span=part.end-part.start;
    if(!(span>0)) throw new Error('Invalid lock motion span');
    for(let i=0;i<rest.length;i+=2){
      const x=rest[i],y=rest[i+1];
      const t=Math.max(0,Math.min(1,(y-part.start)/span));
      const theta=a*t*t*(3-2*t);
      if(theta===0){out[i]=x;out[i+1]=y;continue;}
      const c=Math.cos(theta),s=Math.sin(theta);
      out[i]=rx+(x-rx)*c-(y-ry)*s;
      out[i+1]=ry+(x-rx)*s+(y-ry)*c;
    }
    return out;
  }
  function isolateLockWeights(weights,rest,part){
    const skirt=weights.skirt.slice();
    for(let i=0;i<skirt.length;i++){
      // Keep parent motion exact through the opaque donor band, then leave the skirt.
      const t=Math.max(0,Math.min(1,(rest[i*2+1]-part.start-12)/28));
      skirt[i]*=1-t*t*(3-2*t);
    }
    return {...weights,skirt};
  }
  const api={bendLock,isolateLockWeights};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  else root.HairMotion=api;
})(typeof window!=='undefined'?window:globalThis);
