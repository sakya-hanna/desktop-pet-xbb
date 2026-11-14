// Material drawing and binding preserved from batch 26; only desktop sizing/hit adapter changes.
(function(root){
  'use strict';
  async function create(canvas){
  const meta=await (await fetch('assets/manifest.json')).json();
  const {binding,parts,materials}=CharacterBinding;
  const headSpec=meta.head;
  if(!headSpec?.enabled||!materials?.head||!['skin','cover','neck','torso'].every(k=>meta.images[headSpec[k]]))throw Error('Head material assembly missing');
  const requiredRear=Object.keys(parts).filter(id=>id.startsWith('rear-')&&parts[id].longHair);
  if(requiredRear.length&&(!Array.isArray(meta.rearHair)||meta.rearHair.length!==requiredRear.length||new Set(meta.rearHair.map(p=>p?.part)).size!==requiredRear.length||meta.rearHair.some(p=>!requiredRear.includes(p?.part))))throw Error('Required rear hair layer is missing or duplicated');
  const leftArm=meta.interaction?.leftArm;
  const rightArm=meta.interaction?.rightArm;
  const skirts=meta.interaction?.skirts,skirtData=new Map();
  let armData=null,rightData=null;
  const rightTextures=new Map();
  if(leftArm?.enabled){
    const response=await fetch('assets/'+leftArm.mesh);if(response.ok===false)throw Error('Failed to load left-arm mesh');
    let source;try{source=await response.json();}catch{throw Error('Invalid left-arm mesh JSON');}
    armData=MaterialRig.authoredMesh(source,binding);
  }
  if(rightArm?.enabled){
    // This body removes BOTH baked arms. Never show its holes or silently use
    // the old body if one of the enabled independent layers cannot be loaded.
    if(!armData)throw Error('Right-arm body requires left-arm layers');
    const response=await fetch('assets/'+rightArm.mesh);if(response.ok===false)throw Error('Failed to load right-arm mesh');
    let source;try{source=await response.json();}catch{throw Error('Invalid right-arm mesh JSON');}
    rightData=MaterialRig.importRightHandMeshes(source,binding,CharacterBinding.grabs);
    const ids=rightData.parts.map(p=>p.id),order=rightArm.localLayerOrder;
    if(!Array.isArray(rightArm.parts)||rightArm.parts.length!==ids.length||new Set(rightArm.parts.map(p=>p?.id)).size!==ids.length||
      !Array.isArray(order)||order.length!==ids.length+1||new Set(order).size!==order.length||order.some(id=>id!=='fixed-skirt'&&!ids.includes(id)))throw Error('Invalid right-arm layer mapping');
    for(const p of rightData.parts){
      const entry=rightArm.parts.find(e=>e?.id===p.id),size=meta.images[entry?.texture]?.size;
      // Source is identity metadata, NOT a URL. Only the manifest's explicit
      // local texture may be opened; never guess from basename/source paths.
      if(!entry||entry.source!==p.texture.source||typeof entry.texture!=='string'||!size||size[0]!==p.texture.width||size[1]!==p.texture.height)throw Error('Invalid right-arm texture mapping: '+p.id);
      rightTextures.set(p.id,entry.texture);
    }
    if(new Set(rightTextures.values()).size!==ids.length||![rightArm.body,rightArm.cloth].every(name=>typeof name==='string'&&meta.images[name]))throw Error('Invalid right-arm body or cloth');
  }
  if(skirts?.enabled){
    if(!armData||!rightData)throw Error('Skirt body requires both independent arms');
    const ids=['skirt-front','skirt-right','skirt-back-visible-center'];
    if(!Array.isArray(skirts.parts)||skirts.parts.length!==3||new Set(skirts.parts.map(p=>p?.id)).size!==3||
      skirts.parts.some(p=>!ids.includes(p?.id))||!Array.isArray(skirts.layerOrder)||skirts.layerOrder.length!==3||new Set(skirts.layerOrder).size!==3||skirts.layerOrder.some(id=>!ids.includes(id))||
      ![skirts.body,skirts.leftCloth,skirts.rightCloth].every(name=>typeof name==='string'&&meta.images[name]))throw Error('Invalid skirt layer mapping');
    for(const entry of skirts.parts){
      if(typeof entry.mesh!=='string'||entry.grab!==(entry.id!=='skirt-back-visible-center'))throw Error('Invalid skirt target mapping');
      const response=await fetch('assets/'+entry.mesh);if(response.ok===false)throw Error('Failed to load skirt mesh: '+entry.id);
      let source;try{source=await response.json();}catch{throw Error('Invalid skirt mesh JSON');}
      const imported=MaterialRig.importSkirtMesh(source,binding,CharacterBinding.grabs),size=meta.images[entry.texture]?.size;
      if(imported.id!==entry.id||imported.target!==(entry.grab?entry.id:null)||entry.source!==imported.texture.source||!size||
        size[0]!==imported.texture.width||size[1]!==imported.texture.height)throw Error('Invalid skirt texture mapping: '+entry.id);
      skirtData.set(entry.id,{...imported,textureName:entry.texture});
    }
    if(new Set(skirts.parts.map(p=>p.texture)).size!==3)throw Error('Duplicate skirt textures');
  }
  const images=new Map();
  await Promise.all(Object.keys(meta.images).map(async name=>{
    const image=new Image();image.src='assets/'+name;await image.decode();
    if(image.naturalWidth!==meta.images[name].size[0]||image.naturalHeight!==meta.images[name].size[1]) throw Error('Unexpected texture size: '+name);
    images.set(name,image);
  }));
  const alphaCanvas=document.createElement('canvas'),alphaMaps=new Map();
  const alphaContext=alphaCanvas.getContext('2d',{willReadFrequently:true});
  for(const [name,image]of images){alphaCanvas.width=image.naturalWidth;alphaCanvas.height=image.naturalHeight;alphaContext.drawImage(image,0,0);alphaMaps.set(name,alphaContext.getImageData(0,0,alphaCanvas.width,alphaCanvas.height).data);}
  const VS=`#version 300 es
  in vec2 a_position;in vec2 a_uv;in vec2 a_material;uniform vec4 u_camera;out vec2 v_uv;out vec2 v_material;
  void main(){vec2 p=(a_position-u_camera.xy)/u_camera.zw;gl_Position=vec4(p.x*2.-1.,1.-p.y*2.,0.,1.);v_uv=a_uv;v_material=a_material;}`;
  const FS=`#version 300 es
  precision highp float;in vec2 v_uv;in vec2 v_material;uniform sampler2D u_texture;uniform sampler2D u_receiver;uniform sampler2D u_face;uniform sampler2D u_hair;
  uniform sampler2D u_headCover;uniform int u_headPair;uniform int u_shadow;uniform vec4 u_rect;uniform vec4 u_faceRect;uniform vec2 u_offset;uniform float u_opacity;out vec4 color;
  void main(){if(any(lessThan(v_uv,vec2(0.)))||any(greaterThan(v_uv,vec2(1.)))){color=vec4(0.);return;}
    vec4 c=texture(u_texture,v_uv);if(u_headPair==1)c+=texture(u_headCover,v_uv);if(u_shadow==0){color=c*u_opacity;return;}
    vec2 uv=(v_material-u_rect.xy)/u_rect.zw;
    if(any(lessThan(uv,vec2(0.)))||any(greaterThan(uv,vec2(1.)))){color=vec4(0.);return;}
    float alpha=c.a*texture(u_receiver,uv).a*0.20;
    alpha*=1.-texture(u_hair,v_uv+u_offset/u_rect.zw).a;
    vec2 fuv=(v_material-u_faceRect.xy)/u_faceRect.zw;
    if(all(greaterThanEqual(fuv,vec2(0.)))&&all(lessThanEqual(fuv,vec2(1.)))){
      vec4 f=texture(u_face,fuv);vec3 rgb=f.rgb/max(f.a,0.0001);
      float skin=step(0.60,rgb.r)*step(rgb.g*1.015,rgb.r)*step(rgb.b*1.035,rgb.r);
      alpha*=mix(1.,skin,step(0.1,f.a));
    }
    color=vec4(0.,0.,0.,alpha*u_opacity);
  }`;
  function shader(gl,type,source){const s=gl.createShader(type);gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));return s;}
  function renderer(canvas,detail=false){
    const gl=canvas.getContext('webgl2',{alpha:true,premultipliedAlpha:true,antialias:true,preserveDrawingBuffer:true});
    if(!gl)throw Error('WebGL2 is unavailable');
    const program=gl.createProgram();gl.attachShader(program,shader(gl,gl.VERTEX_SHADER,VS));gl.attachShader(program,shader(gl,gl.FRAGMENT_SHADER,FS));gl.linkProgram(program);
    if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(program));
    gl.useProgram(program);gl.enable(gl.BLEND);gl.blendFunc(gl.ONE,gl.ONE_MINUS_SRC_ALPHA);
    const uniforms={};for(const name of ['camera','texture','receiver','face','hair','shadow','rect','faceRect','offset','opacity','headPair','headCover'])uniforms[name]=gl.getUniformLocation(program,'u_'+name);
    const attributes={};for(const name of ['position','uv','material'])attributes[name]=gl.getAttribLocation(program,'a_'+name);
    const textures=new Map();
    for(const [name,image] of images){
      const t=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,t);gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,true);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,image);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR_MIPMAP_LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.generateMipmap(gl.TEXTURE_2D);textures.set(name,t);
    }
    function mesh(texture,rect,part=null,step=5,authored=null,grabbable=true){
      let bounds=rect;
      if(rect.x===0&&rect.y===0&&rect.w===binding.width&&rect.h===binding.height){
        const size=meta.images[texture].size;
        const [x,y,r,b]=(meta.images[texture].mesh_bbox||meta.images[texture].alpha_bbox).map((v,i)=>v*(i%2?binding.height/size[1]:binding.width/size[0]));bounds={x:Math.max(0,x-2),y:Math.max(0,y-2),w:Math.min(rect.w,r+2)-Math.max(0,x-2),h:Math.min(rect.h,b+2)-Math.max(0,y-2)};
      }
      const data=authored||MaterialRig.makeMesh(bounds,step,rect),vao=gl.createVertexArray();gl.bindVertexArray(vao);
      const buffers={};for(const name of ['position','uv','material']){
        const b=gl.createBuffer();buffers[name]=b;gl.bindBuffer(gl.ARRAY_BUFFER,b);gl.bufferData(gl.ARRAY_BUFFER,name==='uv'?data.uv:data.rest,gl.DYNAMIC_DRAW);
        gl.enableVertexAttribArray(attributes[name]);gl.vertexAttribPointer(attributes[name],2,gl.FLOAT,false,0,0);
      }
      const index=gl.createBuffer();gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,index);gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,data.indices,gl.STATIC_DRAW);
      let grabInfluence=null;
      if(grabbable&&data.weights&&part&&Object.hasOwn(CharacterBinding.grabs,part.name)){
        grabInfluence=new Float32Array(data.rest.length);
        for(let i=0;i<grabInfluence.length;i+=2)grabInfluence[i]=MaterialRig.grabInfluence(part,data.weights.subarray(i/2*3,i/2*3+3));
      }
      return {texture,rect,part,data,vao,buffers,grabInfluence};
    }
    const full={x:0,y:0,w:binding.width,h:binding.height};
    const headMaster=MaterialRig.makeMesh(headSpec.rect,headSpec.step,full),headPositions=new WeakMap(),frameMeshes=new WeakMap();
    function headData(rect){
      const uv=new Float32Array(headMaster.rest.length);
      for(let i=0;i<uv.length;i+=2){uv[i]=(headMaster.rest[i]-rect.x)/rect.w;uv[i+1]=(headMaster.rest[i+1]-rect.y)/rect.h;}
      return {rest:headMaster.rest,indices:headMaster.indices,uv};
    }
    const headSkin=mesh(headSpec.skin,full,materials.head,2,headData(full));
    // Complementary original pixels share one filtered premultiplied draw.
    const headCover={texture:headSpec.cover};
    const neck=mesh(headSpec.neck,full,materials.neck,2);
    // A shared field also needs matching triangles at the painted head cut.
    // Reuse the head lattice in that rectangle; keep the rest at body detail.
    function torsoData(){
      const r=headSpec.rect,tiles=[headData(full),
        MaterialRig.makeMesh({x:0,y:0,w:r.x,h:full.h},5,full),
        MaterialRig.makeMesh({x:r.x+r.w,y:0,w:full.w-r.x-r.w,h:full.h},5,full),
        MaterialRig.makeMesh({x:r.x,y:r.y+r.h,w:r.w,h:full.h-r.y-r.h},5,full)];
      const rest=[],uv=[],indices=[];
      for(const tile of tiles){const offset=rest.length/2;for(const v of tile.rest)rest.push(v);for(const v of tile.uv)uv.push(v);for(const i of tile.indices)indices.push(i+offset);}
      return {rest:new Float32Array(rest),uv:new Float32Array(uv),indices:new Uint32Array(indices)};
    }
    const original=mesh('baijie-body.png',full,null,8),body=mesh(headSpec.torso,full,materials.torso,5,torsoData());
    const rearHair=(meta.rearHair||[]).map(p=>{
      if(!requiredRear.includes(p.part)||p.texture!=='baijie-'+p.part+'.png')throw Error('Invalid rear hair binding');
      return mesh(p.texture,full,parts[p.part],5);
    });
    const arm=armData?mesh(leftArm.texture,full,CharacterBinding.grabs['arm-screen-left'],5,armData):null;
    const cloth=armData?mesh(skirtData.size?skirts.leftCloth:leftArm.cloth,full,materials.torso,5):null;
    const rightClothName=skirtData.size?skirts.rightCloth:rightArm?.cloth;
    const rightLayers=[];
    if(rightData){
      const layers=new Map(rightData.parts.map(p=>[p.id,mesh(rightTextures.get(p.id),full,CharacterBinding.grabs[rightData.group],5,p.mesh)]));
      layers.set('fixed-skirt',mesh(rightClothName,full,materials.torso,5));
      // Real alpha leaves the neutral palm visible in this order. Cloth stays
      // fixed, wrist stays in front; dynamic outer/front hair is still later.
      for(const id of rightArm.localLayerOrder)rightLayers.push(layers.get(id));
    }
    const skirtLayers=skirtData.size?skirts.layerOrder.map(id=>{
      const p=skirtData.get(id);
      // The visible lining starts at a painted cut against the moving front
      // panel; it is not a complete hidden underlay. Chieri likewise carries
      // exposed cut roots with the hem (rig.js:231-239). Share the front's
      // triangles/weights as well as its motion so interpolation cannot split
      // this cut. Its full alpha lies inside that mesh; UV/art stay unchanged.
      const driver=p.target?p:skirtData.get('skirt-front');
      return mesh(p.textureName,full,CharacterBinding.grabs[driver.target],5,driver.mesh,!!p.target);
    }):[];
    const outer=meta.outer.layers.map(p=>mesh(p.texture,full,parts['outer-'+p.name],5));
    const front=meta.front.parts.map(p=>{
      const [x,y,w,h]=p.sourceBox,s=meta.character.scale,rect={x:x*s,y:y*s,w:w*s,h:h*s};
      const main=mesh(p.texture,rect,parts[p.name],2);
      return {main,shadow:mesh(p.caster,rect,parts[p.name],2,main.data),source:p};
    });
    const faces=new Map(Object.entries(meta.character.faces).map(([id,rect])=>[id,mesh('baijie-face-'+id+'.png',rect,materials.head,2,headData(rect))]));

    let face='3942',lastPose={},drawCalls=0,frameId=0,frameCamera=null,frameViewport=null,viewportId=0,viewportKey='';
    const drawnLayers=[];
    // Composite in a shared material-space rectangle, not in either face's
    // UVs. Sum premultiplied colors BEFORE one alpha-over draw: overlapping
    // semi-transparent faces must not darken the underlying skin.
    let mixedFace=null,mixedKey='',faceLayer=null,faceBlend=[];
    const normalizedFaces=new Map();
    const closedFaces=new Set((meta.blink.closedFaces||[3625]).map(String));
    let eyePixels=null;
    function prepareMixedFace(){
      if(mixedFace)return;
      const rs=Object.values(meta.character.faces),x=Math.floor(Math.min(...rs.map(r=>r.x))),y=Math.floor(Math.min(...rs.map(r=>r.y)));
      const rect={x,y,w:Math.ceil(Math.max(...rs.map(r=>r.x+r.w)))-x,h:Math.ceil(Math.max(...rs.map(r=>r.y+r.h)))-y};
      mixedFace=mesh('expression-face',rect,materials.head,2,headData(rect));mixedFace.pixelSize=[rect.w,rect.h];
      eyePixels=new Uint8Array(rect.w*rect.h);
      const texture=gl.createTexture();textures.set(mixedFace.texture,texture);bindTexture(0,mixedFace.texture);
      for(const axis of [gl.TEXTURE_WRAP_S,gl.TEXTURE_WRAP_T])gl.texParameteri(gl.TEXTURE_2D,axis,gl.CLAMP_TO_EDGE);
      for(const filter of [gl.TEXTURE_MIN_FILTER,gl.TEXTURE_MAG_FILTER])gl.texParameteri(gl.TEXTURE_2D,filter,gl.LINEAR);
    }
    function normalizedFace(id){
      if(normalizedFaces.has(id))return normalizedFaces.get(id);
      const rect=mixedFace.rect,fr=meta.character.faces[id];
      function sample(name){
        const out=new Float32Array(rect.w*rect.h*4);if(!name)return out;
        const [w,h]=meta.images[name].size,data=alphaMaps.get(name);
        for(let y=0;y<rect.h;y++)for(let x=0;x<rect.w;x++){
          const u=(rect.x+x+0.5-fr.x)/fr.w,v=(rect.y+y+0.5-fr.y)/fr.h;
          if(u<0||v<0||u>1||v>1)continue;
          const px=u*w-0.5,py=v*h-0.5,ix=Math.floor(px),iy=Math.floor(py),fx=px-ix,fy=py-iy,k=(y*rect.w+x)*4;
          for(let j=0;j<2;j++)for(let i=0;i<2;i++){
            const q=(Math.max(0,Math.min(h-1,iy+j))*w+Math.max(0,Math.min(w-1,ix+i)))*4,a=data[q+3]/255,weight=(i?fx:1-fx)*(j?fy:1-fy);
            for(let c=0;c<4;c++)out[k+c]+=weight*(c===3?a:data[q+c]/255*a);
          }
        }return out;
      }
      const base=sample('baijie-face-'+id+'.png');
      const pair=[base,meta.blink.textures[id]?sample(meta.blink.textures[id]):base];
      // Derive the protected eye footprint from the actual baked replacements.
      // Brows, cheeks and mouth remain on the ordinary expression blend path.
      if(pair[0]!==pair[1])for(let k=0;k<base.length;k+=4){
        if([0,1,2,3].some(c=>Math.abs(pair[0][k+c]-pair[1][k+c])>1e-6))eyePixels[k/4]=1;
      }
      normalizedFaces.set(id,pair);return pair;
    }
    function expressionLayer(weights,amount){
      if(!Array.isArray(weights)||!weights.length)throw Error('Invalid face blend');
      const total=weights.reduce((n,p)=>n+p.weight,0);
      if(weights.some(p=>!faces.has(p.face)||!Number.isFinite(p.weight)||p.weight<0)||!Number.isFinite(total)||total<=0)throw Error('Invalid face blend');
      faceBlend=weights.filter(p=>p.weight>0).map(p=>({face:p.face,weight:p.weight/total}));
      if(faceBlend.length===1&&(amount===0||!meta.blink.textures[faceBlend[0].face]))return faces.get(faceBlend[0].face);
      prepareMixedFace();
      const key=JSON.stringify([faceBlend,amount]);if(key===mixedKey)return mixedFace;
      const sum=new Float32Array(mixedFace.rect.w*mixedFace.rect.h*4);
      // Two authored eye poses are cel-switched, never dissolved together.
      // A .6 held closure must not retain 40% of the open iris behind lashes.
      // Closed-expression fades follow the same rule, including yawn-03.
      const closed=amount>=0.5||faceBlend.reduce((n,p)=>n+(closedFaces.has(p.face)?p.weight:0),0)>=0.5;
      const eyeTotal=faceBlend.reduce((n,p)=>n+((closed||!closedFaces.has(p.face))?p.weight:0),0);
      for(const p of faceBlend){const [base,eye]=normalizedFace(p.face);
        const chosen=closed?eye:base,eyeWeight=(closed||!closedFaces.has(p.face))?p.weight/eyeTotal:0;
        for(let k=0;k<sum.length;k+=4)for(let c=0;c<4;c++){
          sum[k+c]+=eyePixels[k/4]?eyeWeight*chosen[k+c]
            :p.weight*(base[k+c]*(1-amount)+eye[k+c]*amount);
        }
      }
      const pixels=Uint8Array.from(sum,v=>Math.round(Math.max(0,Math.min(1,v))*255));
      alphaMaps.set(mixedFace.texture,pixels);bindTexture(0,mixedFace.texture);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,false);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,mixedFace.rect.w,mixedFace.rect.h,0,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,true);mixedKey=key;return mixedFace;
    }

    function inverseHeadSurface(world,seed,pose){
      const out=headPositions.get(pose),r=headSpec.rect,nx=Math.ceil(r.w/headSpec.step),ny=Math.ceil(r.h/headSpec.step),sx=r.w/nx,sy=r.h/ny;
      let p=seed.slice();
      // Invert the actual piecewise-affine GPU triangles, not another evaluation
      // of the continuous field or the frozen-rest affine used by arm dragging.
      for(let iteration=0;iteration<8;iteration++){
        const gx=(p[0]-r.x)/sx,gy=(p[1]-r.y)/sy,ix=Math.max(0,Math.min(nx-1,Math.floor(gx))),iy=Math.max(0,Math.min(ny-1,Math.floor(gy)));
        const u=gx-ix,v=gy-iy,a=2*(iy*(nx+1)+ix),b=a+2,c=a+2*(nx+2),d=a+2*(nx+1);
        const dx=[0,1].map(k=>(u>=v?out[b+k]-out[a+k]:out[c+k]-out[d+k])/sx);
        const dy=[0,1].map(k=>(u>=v?out[c+k]-out[b+k]:out[d+k]-out[a+k])/sy);
        const e=[0,1].map(k=>out[a+k]+dx[k]*u*sx+dy[k]*v*sy-world[k]);
        if(Math.hypot(...e)<1e-5)return p;
        const det=dx[0]*dy[1]-dx[1]*dy[0];if(Math.abs(det)<1e-8)throw Error('Singular head receiver');
        p[0]-=(dy[1]*e[0]-dy[0]*e[1])/det;p[1]-=(-dx[1]*e[0]+dx[0]*e[1])/det;
      }
      throw Error('Head shadow receiver inverse did not converge');
    }
    function bindTexture(unit,name){gl.activeTexture(gl.TEXTURE0+unit);gl.bindTexture(gl.TEXTURE_2D,textures.get(name));}
    function draw(m,pose,shadow=null,opacity=1){
      let positions;
      if(m.part===materials.head){
        positions=headPositions.get(pose);if(!positions){positions=MaterialRig.deformMesh(headMaster,pose,binding,materials.head);headPositions.set(pose,positions);}
      }else{
        let meshes=frameMeshes.get(pose);if(!meshes){meshes=new Map();frameMeshes.set(pose,meshes);}
        positions=meshes.get(m.data);if(!positions){positions=MaterialRig.deformMesh(m.data,pose,binding,m.part);meshes.set(m.data,positions);}
      }
      // Shadow offset must never mutate the visible geometry used for picking.
      if(shadow)positions=new Float32Array(positions);
      const material=shadow?new Float32Array(m.data.rest.length):null;
      const offset=shadow?shadow.source.shadowOffset.map(v=>v*meta.character.scale):[0,0];
      // The non-shadow shader returns before reading v_material. Its static
      // attribute stays in the VAO; only receiving shadows need this second
      // local deformation and upload. Position/UV/picking remain unchanged.
      for(let i=0;shadow&&i<material.length;i+=2){
        const rest=[m.data.rest[i],m.data.rest[i+1]];
        const world=[positions[i]+offset[0],positions[i+1]+offset[1]];
        const local=m.part.name==='fringe'?inverseHeadSurface(world,rest,pose)
          :MaterialRig.unparentPoint(world,rest,pose,binding,materials.torso);
        material[i]=local[0];material[i+1]=local[1];positions[i]=world[0];positions[i+1]=world[1];
      }
      m.currentPositions=positions;
      if(!shadow&&opacity>0)drawnLayers.push({m,opacity});
      gl.bindVertexArray(m.vao);
      gl.bindBuffer(gl.ARRAY_BUFFER,m.buffers.position);gl.bufferSubData(gl.ARRAY_BUFFER,0,positions);
      if(shadow){gl.bindBuffer(gl.ARRAY_BUFFER,m.buffers.material);gl.bufferSubData(gl.ARRAY_BUFFER,0,material);}
      bindTexture(0,m.texture);gl.uniform1i(uniforms.texture,0);gl.uniform1i(uniforms.shadow,shadow?1:0);gl.uniform1f(uniforms.opacity,opacity);
      gl.uniform1i(uniforms.headPair,m===headSkin?1:0);
      if(m===headSkin){bindTexture(4,headCover.texture);gl.uniform1i(uniforms.headCover,4);}
      if(shadow){
        bindTexture(1,shadow.source.receiver);bindTexture(2,faceLayer.texture);bindTexture(3,shadow.source.texture);
        gl.uniform1i(uniforms.receiver,1);gl.uniform1i(uniforms.face,2);gl.uniform1i(uniforms.hair,3);
        const f=faceLayer.rect;gl.uniform4f(uniforms.faceRect,f.x,f.y,f.w,f.h);gl.uniform4f(uniforms.rect,m.rect.x,m.rect.y,m.rect.w,m.rect.h);gl.uniform2fv(uniforms.offset,offset);
      }
      gl.drawElements(gl.TRIANGLES,m.data.indices.length,gl.UNSIGNED_INT,0);drawCalls++;
    }
    function render(pose,faceId,reference=false,blinkAmount=0,sync=true,weights=null){
      face=faceId;lastPose=pose;drawCalls=0;drawnLayers.length=0;frameCamera=null;
      faceBlend=[{face,weight:1}];
      faceLayer=!reference&&(weights!==null||blinkAmount>0)?expressionLayer(weights||faceBlend,Math.max(0,Math.min(1,blinkAmount))):faces.get(face);
      const viewport=canvas.getBoundingClientRect(),cw=viewport.width,ch=viewport.height,dpr=window.devicePixelRatio||1;
      if(!Number.isFinite(cw)||!Number.isFinite(ch)||cw<=0||ch<=0)throw Error('Invalid desktop canvas viewport');
      canvas.dataset.cssWidth=String(cw);canvas.dataset.cssHeight=String(ch);
      const w=Math.max(1,Math.round(cw*dpr)),h=Math.max(1,Math.round(ch*dpr));if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;}
      gl.viewport(0,0,w,h);gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);gl.useProgram(program);
      const camera=PreviewView.cameraFor(cw,ch,detail,binding);
      gl.uniform4f(uniforms.camera,camera.x,camera.y,camera.w,camera.h);
      if(reference){draw(original,{});draw(faces.get(face),{});}
      else{
        for(const m of rearHair)draw(m,pose);
        draw(neck,pose);draw(body,pose);draw(headSkin,pose);
        if(arm){draw(arm,pose);draw(cloth,pose);}
        for(const m of rightLayers){
          // Skirts replace the old fixed garment pixels, below wrist ornaments
          // and all existing dynamic hair. Lining follows cloth but is not grabbable.
          if(m.texture===rightClothName)for(const skirt of skirtLayers)draw(skirt,pose);
          draw(m,pose);
        }
        for(const m of outer)draw(m,pose);draw(front[0].main,pose);draw(faceLayer,pose);

        draw(front[0].shadow,pose,front[0]);
        for(const f of front.slice(1)){draw(f.shadow,pose,f);draw(f.main,pose);}
      }
      if(sync)gl.finish();
      const key=[viewport.x,viewport.y,cw,ch,dpr,w,h].join(',');if(key!==viewportKey){viewportId++;viewportKey=key;}
      frameViewport={x:viewport.x,y:viewport.y,width:cw,height:ch,dpr,w,h};
      frameCamera=camera;frameId++;
    }
    function status(){
      const glErrors=[];for(let e=gl.getError();e!==gl.NO_ERROR;e=gl.getError())glErrors.push(e);
      const pixels=new Uint8Array(canvas.width*canvas.height*4);gl.readPixels(0,0,canvas.width,canvas.height,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
      let nonTransparentSamples=0;for(let i=3;i<pixels.length;i+=64)if(pixels[i]>16)nonTransparentSamples++;
      const ext=gl.getExtension('WEBGL_debug_renderer_info');
      return {webgl2:true,loadedTextures:images.size,glErrors,nonTransparentSamples,drawCalls,cssSize:[Number(canvas.dataset.cssWidth),Number(canvas.dataset.cssHeight)],bufferSize:[canvas.width,canvas.height],dpr:window.devicePixelRatio,renderer:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),face,faceBlend:faceBlend.map(p=>({...p})),pose:lastPose,headMaterials:{version:headSpec.version,masterVertices:headMaster.rest.length/2,sharedExpressionMesh:faceLayer.data.rest===headMaster.rest},drawnTextures:drawnLayers.flatMap(l=>l.m===headSkin?[headSkin.texture,headCover.texture]:[l.m.texture])};
    }
    function validViewport(r){return !!frameCamera&&!!frameViewport&&['x','y','width','height'].every(k=>Number.isFinite(r[k])&&r[k]===frameViewport[k])&&(window.devicePixelRatio||1)===frameViewport.dpr&&canvas.width===frameViewport.w&&canvas.height===frameViewport.h;}
    function frameState(){return validViewport(canvas.getBoundingClientRect())?{frameId,viewportId}:null;}
    function hitOpaque(clientX,clientY){
      const r=canvas.getBoundingClientRect();if(!validViewport(r))return false;
      const point=DesktopView.framebufferPoint(r,canvas.width,canvas.height,clientX,clientY);if(!point)return false;
      const pixel=new Uint8Array(4);gl.readPixels(point.x,point.y,1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixel);
      return pixel[3]>16;
    }
    function clientToMaterial(clientX,clientY,token=null,contact=null){
      const r=canvas.getBoundingClientRect();
      if(!frameCamera||!validViewport(r)||(token&&(token.frameId!==frameId||token.viewportId!==viewportId))||!DesktopView.framebufferPoint(r,canvas.width,canvas.height,clientX,clientY))return null;
      let point=[frameCamera.x+(clientX-r.x)/r.width*frameCamera.w,frameCamera.y+(clientY-r.y)/r.height*frameCamera.h];
      if(contact){
        const part=CharacterBinding.grabs[contact.partId];
        point=MaterialRig.unparentPoint(point,contact.materialPoint,lastPose,binding,part);
        if(part&&Number.isFinite(contact.influence)){
          // Remove the effective passive cloth AND the other connected panel's
          // recoil. Use the same clipped sum as drawing, including at the limit.
          const local=MaterialRig.grabOffset(lastPose,part,contact.materialPoint),grab=lastPose.grab?.[part.name]||[0,0];
          point=point.map((v,i)=>v-(local[i]-grab[i])*contact.influence);
        }
      }
      return {point,frameId,viewportId};
    }
    function sampleAlpha(m,uv){
      if(!uv||uv.some(v=>!Number.isFinite(v)||v<0||v>1))return 0;
      const [w,h]=m.pixelSize||meta.images[m.texture].size,data=alphaMaps.get(m.texture),x=uv[0]*w-0.5,y=uv[1]*h-0.5,ix=Math.floor(x),iy=Math.floor(y),fx=x-ix,fy=y-iy;
      const at=(xx,yy)=>data[(Math.max(0,Math.min(h-1,yy))*w+Math.max(0,Math.min(w-1,xx)))*4+3]||0;
      const alpha=at(ix,iy)*(1-fx)*(1-fy)+at(ix+1,iy)*fx*(1-fy)+at(ix,iy+1)*(1-fx)*fy+at(ix+1,iy+1)*fx*fy;
      return m===headSkin?Math.min(255,alpha+sampleAlpha(headCover,uv)):alpha;
    }
    function hitPart(clientX,clientY){
      const mapped=clientToMaterial(clientX,clientY);if(!mapped)return null;
      for(let n=drawnLayers.length-1;n>=0;n--){const {m,opacity}=drawnLayers[n];
        const uv=MaterialHit.pickMaterial({rest:m.data.uv,indices:m.data.indices},m.currentPositions,mapped.point);
        if(sampleAlpha(m,uv)*opacity<=16)continue;
        const rest=MaterialHit.pickMaterial(m.data,m.currentPositions,mapped.point);
        const influence=m.grabInfluence?MaterialHit.pickMaterial({rest:m.grabInfluence,indices:m.data.indices},m.currentPositions,mapped.point)[0]:0;
        // Keep topmost alpha ownership: covered hair/limbs never become a
        // chest click through the layer beneath them. Regions are rest-space.
        const partId=m.grabInfluence?(influence>0.05?m.part.name:null)
          :((rest[0]-298.2)/82)**2+((rest[1]-95)/82)**2<=1?'head'
          :(!m.part||m.part===materials.torso)&&((rest[0]-295)/45)**2+((rest[1]-222)/25)**2<=1?'chest':null;
        return {partId,layer:m.texture,materialPoint:rest,influence,frameId,viewportId};
      }
      return null;
    }
    function hitTest(clientX,clientY){
      const hit=hitPart(clientX,clientY);return hit?.partId==='head'?hit.materialPoint:null;
    }
    function headInputPoint(){
      const r=canvas.getBoundingClientRect(),camera=PreviewView.cameraFor(r.width,r.height,detail,binding),point=MaterialRig.deformPoint([298.2,80],lastPose,binding);
      return {x:r.x+(point[0]-camera.x)/camera.w*r.width,y:r.y+(point[1]-camera.y)/camera.h*r.height};
    }
    // Normalize immutable expression pixels during loading, not at the first
    // smile/sleep cue inside a live action. The same premultiplied arrays are
    // reused; this does not approximate eyes or alter transition timing.
    prepareMixedFace();for(const id of faces.keys())normalizedFace(id);
    return {render,status,hitTest,hitPart,clientToMaterial,frameState,hitOpaque,headInputPoint};
  }
  return renderer(canvas,false);
  }
  root.CharacterRenderer={create};
})(globalThis);
