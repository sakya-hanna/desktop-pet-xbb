// Keep every cell containing alpha, including subpixel hair and partial edge cells.
(function(root){
 function buildAlphaMesh(rgba,w,h,step=8){
  if(!Number.isInteger(step)||step<1||!Number.isInteger(w)||w<1||!Number.isInteger(h)||h<1||rgba.length!==w*h*4)throw new Error('Invalid mesh input');
  const nx=Math.ceil(w/step),ny=Math.ceil(h/step);
  const vid=new Int32Array((nx+1)*(ny+1)).fill(-1),rest=[],uv=[],indices=[];
  const vertex=(i,j)=>{
   const k=j*(nx+1)+i;
   if(vid[k]<0){const x=Math.min(w,i*step),y=Math.min(h,j*step);vid[k]=rest.length/2;rest.push(x,y);uv.push(x/w,y/h);}
   return vid[k];
  };
  for(let j=0;j<ny;j++)for(let i=0;i<nx;i++){
   const x0=i*step,y0=j*step,x1=Math.min(w,x0+step),y1=Math.min(h,y0+step);
   let any=false;
   for(let y=y0;y<y1&&!any;y++)for(let x=x0;x<x1;x++)if(rgba[(y*w+x)*4+3]>0){any=true;break;}
   if(!any)continue;
   const a=vertex(i,j),b=vertex(i+1,j),c=vertex(i+1,j+1),d=vertex(i,j+1);
   indices.push(a,b,c,a,c,d);
  }
  if(rest.length/2>65535)throw new Error('Mesh exceeds Uint16 index budget');
  return {rest:new Float32Array(rest),idx:new Uint16Array(indices),uvs:new Float32Array(uv)};
 }
 function measureDeformation(mesh){
  const area=(points,a,b,c)=>(points[b*2]-points[a*2])*(points[c*2+1]-points[a*2+1])-(points[b*2+1]-points[a*2+1])*(points[c*2]-points[a*2]);
  let flippedTriangles=0,minAreaRatio=Infinity,minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
  for(let i=0;i<mesh.out.length;i+=2){minX=Math.min(minX,mesh.out[i]);maxX=Math.max(maxX,mesh.out[i]);minY=Math.min(minY,mesh.out[i+1]);maxY=Math.max(maxY,mesh.out[i+1]);}
  for(let i=0;i<mesh.idx.length;i+=3){
   const [a,b,c]=mesh.idx.subarray(i,i+3);
   const before=area(mesh.rest,a,b,c),after=area(mesh.out,a,b,c);
   const ratio=before!==0?after/before:0;
   if(!Number.isFinite(ratio)||ratio<=0)flippedTriangles++;
   minAreaRatio=Math.min(minAreaRatio,ratio);
  }
  return {flippedTriangles,minAreaRatio,bounds:{minX,minY,maxX,maxY}};
 }
 const api={buildAlphaMesh,measureDeformation};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.AlphaMesh=api;
})(typeof window!=='undefined'?window:globalThis);
