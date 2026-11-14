(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.MaterialHit=api;})(globalThis,function(){
  'use strict';
  function pickMaterial(mesh,positions,point){
    const [x,y]=point,indices=mesh.indices;
    if(!Number.isFinite(x)||!Number.isFinite(y))return null;
    for(let n=0;n<indices.length;n+=3){
      const a=indices[n]*2,b=indices[n+1]*2,c=indices[n+2]*2;
      const ax=positions[a],ay=positions[a+1],bx=positions[b],by=positions[b+1],cx=positions[c],cy=positions[c+1];
      if(x<Math.min(ax,bx,cx)-1e-5||x>Math.max(ax,bx,cx)+1e-5||y<Math.min(ay,by,cy)-1e-5||y>Math.max(ay,by,cy)+1e-5)continue;
      const determinant=(by-cy)*(ax-cx)+(cx-bx)*(ay-cy);if(Math.abs(determinant)<1e-9)continue;
      const u=((by-cy)*(x-cx)+(cx-bx)*(y-cy))/determinant,v=((cy-ay)*(x-cx)+(ax-cx)*(y-cy))/determinant,w=1-u-v;
      if(u>=-1e-6&&v>=-1e-6&&w>=-1e-6)return [mesh.rest[a]*u+mesh.rest[b]*v+mesh.rest[c]*w,mesh.rest[a+1]*u+mesh.rest[b+1]*v+mesh.rest[c+1]*w];
    }
    return null;
  }
  return {pickMaterial};
});
