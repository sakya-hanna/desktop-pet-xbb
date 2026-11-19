(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MaterialRig = api;
})(globalThis, function () {
  'use strict';
  const smooth = (a, b, value) => {
    const t = Math.max(0, Math.min(1, (value - a) / (b - a)));
    return t * t * t * (t * (t * 6 - 15) + 10);
  };
  function pathProjection(point, line) {
    let distance = Infinity, best = 0, before = 0;
    const lengths = line.slice(1).map((p,i) => Math.hypot(p[0]-line[i][0], p[1]-line[i][1]));
    const total = lengths.reduce((a,b) => a+b, 0);
    for (let i=0; i<lengths.length; i++) {
      const a=line[i], b=line[i+1], dx=b[0]-a[0], dy=b[1]-a[1], length=lengths[i];
      if (!length) continue;
      const t=Math.max(0,Math.min(1,((point[0]-a[0])*dx+(point[1]-a[1])*dy)/(length*length)));
      const d=(point[0]-a[0]-dx*t)**2+(point[1]-a[1]-dy*t)**2;
      if (d<distance) { distance=d; best=before+t*length; }
      before+=length;
    }
    return {s:total ? best/total : 0,distance:Math.sqrt(distance)};
  }
  function arcPosition(point,line){
    return pathProjection(point,line).s;
  }
  // The same influence must be used by picking and local deformation.
  function grabInfluence(part,weights) {
    if(!part||!weights||weights.length!==3)return 0;
    const ratio=['arm-screen-left','arm-screen-right'].includes(part.name)?part.elbowRatio:
      ['skirt-front','skirt-right'].includes(part.name)?part.foldRatio:undefined;
    if(!Number.isFinite(ratio)||ratio<0||ratio>1||!Number.isFinite(weights[1])||!Number.isFinite(weights[2]))return 0;
    return weights[1]*ratio+weights[2];
  }
  function grabOffset(pose,part,rest=null) {
    const grab=pose.grab?.[part?.name]||[0,0];
    if(part?.name?.startsWith('arm-'))return grab.map((v,i)=>v+(pose.idleArms?.[part.name]?.[i]||0));
    if(!part||!['skirt-front','skirt-right'].includes(part.name))return grab.slice();
    // Two picking targets, one continuous garment. Both author meshes use the
    // same waist/fold/hem profile, so their shared edge must sample the SAME
    // displacement, including the other target's unfinished release recoil.
    // Independent per-layer flutter would reopen the cut even after release.
    const radius=65,falloff=at=>rest&&at?Math.exp(-((rest[0]-at[0])**2+(rest[1]-at[1])**2)/(2*radius*radius)):1;
    const ids=['skirt-front','skirt-right'],delta=[0,1].map(axis=>ids.reduce((sum,id)=>{
      // Chieri's skirtPull: a soft bulge centred on the material point that
      // was actually caught. Both panels evaluate the same continuous field.
      return sum+(pose.grab?.[id]?.[axis]||0)*falloff(pose.skirtContacts?.[id])+(pose.cloth?.[id]?.[axis]||0)*0.5;
    },0)+(pose.skirtRecoil||[]).reduce((sum,old)=>sum+old.offset[axis]*falloff(old.point),0));
    // Clip once after combining all garment inputs; no extra exposed-art budget.
    const scale=Math.max(1,Math.hypot(delta[0]/part.limit[0],delta[1]/part.limit[1]));
    return delta.map(v=>v/scale);
  }
  function localPoint(rest, pose, part, weights=null, fixed=null) {
    const baked=fixed?.local&&fixed.local.part===part?fixed.local:null,weight=baked?baked.weight:grabInfluence(part,weights);
    if(weight){
      const localized=(pose.skirtContacts||pose.skirtRecoil)&&part.name.startsWith('skirt-');
      let delta=localized?null:fixed?.frame?.grabs.get(part);
      if(!delta){delta=grabOffset(pose,part,rest);if(!localized)fixed?.frame?.grabs.set(part,delta);}
      return [rest[0]+delta[0]*weight,rest[1]+delta[1]*weight];
    }
    if (!part || !pose.hair || !pose.hair[part.name]) return rest.slice();
    const a=pose.hair[part.name], s=baked?baked.s:arcPosition(rest,part.centerline);
    const locked=part.rootLockY===undefined?part.root[1]:part.rootLockY;
    const blend=part.rootBlendY===undefined?locked+12:part.rootBlendY;
    const rootWeight=baked?baked.rootWeight:smooth(locked,blend,rest[1]);
    const angle=(pose.referenceMotion?a[2]*Math.pow(s,1.4):a[0]*smooth(0,0.33,s)+(a[1]-a[0])*smooth(0.33,0.66,s)+(a[2]-a[1])*smooth(0.66,1,s))*rootWeight;
    if (!angle) return rest.slice();
    const dx=rest[0]-part.root[0], dy=rest[1]-part.root[1];
    return [part.root[0]+dx*Math.cos(angle)-dy*Math.sin(angle),part.root[1]+dx*Math.sin(angle)+dy*Math.cos(angle)];
  }
  // Geometry weights are attached to REST material coordinates. Local cloth
  // offsets never change ownership or move the breathing/face influence zones.
  function headSkinWeight(rest,binding){
    const n=binding.neckTransition;
    if(!n)return 1-smooth(...binding.headFade,rest[1]);
    const dx=Math.abs(rest[0]-binding.neck[0]);
    // A broad horizontal cutoff twists clavicles with the head. End the skin
    // field at its anatomical attachment, without sharply folding side hair.
    const jaw=n.jaw,side=jaw?smooth(jaw.inner,jaw.outer,dx):1;
    const top=jaw?jaw.top+(n.top-jaw.top)*side:n.top;
    const base=jaw?jaw.base+(n.base-jaw.base)*side:n.base;
    return 1-smooth(top,base,rest[1]);
  }
  function headWeight(rest,binding){
    const skin=headSkinWeight(rest,binding),n=binding.neckTransition;
    if(!n)return skin;
    const dx=Math.abs(rest[0]-binding.neck[0]),hair=1-smooth(...n.hairFade,rest[1]);
    const outside=smooth(n.skinHalf,n.outerHalf,dx);
    return skin+(hair-skin)*outside;
  }
  // Source: chieri-live2d 1e7a0b1 / js/rig.js:128-133,276-283.
  // The field is evaluated at rest; local cloth/hair offsets never move it.
  function domeAt(point,t){
    const dx=(point[0]-t.center[0])/t.radius[0],dy=(point[1]-t.center[1])/t.radius[1],r2=dx*dx+dy*dy;
    return r2<1?(1-r2)*(1-r2):0;
  }
  function headDepth(rest,t){
    if(!t)return 0;
    const dome=domeAt(rest,t);let total=0,weighted=0;
    // Baijie's large painted eyes need local shape protection. Sample the SAME
    // upstream depth at each feature centre and smoothly carry that depth over
    // its footprint. Forehead, cheeks, nose and chin retain different depths;
    // this never rotates/scales a common face plane. All layers share the field.
    for(const feature of t.features||[]){
      const r=Math.hypot((rest[0]-feature.center[0])/feature.radius[0],(rest[1]-feature.center[1])/feature.radius[1]);
      const w=1-smooth(1,2,r);total+=w;weighted+=w*domeAt(feature.center,t);
    }
    const strength=Math.min(1,total);
    return total?dome*(1-strength)+weighted/total*strength:dome;
  }
  function materialKind(part){
    if(part?.material)return part.material;
    if(part?.name?.startsWith('arm-')||part?.name?.startsWith('skirt-'))return 'torso';
    return 'head';
  }
  function layeredWeight(rest,binding,part){
    const kind=materialKind(part),t=binding.headTurn;
    if(kind==='neck'||kind==='torso')return (1-smooth(...t.neckFade,rest[1]))*(1-smooth(...t.neckWidth,Math.abs(rest[0]-binding.neck[0])));
    if(rest[0]<196||rest[0]>416||rest[1]>208)return 0;
    // Material extraction owns the jaw/cloth boundary. Do not multiply that
    // traced cut into head rotation again: its steep side slopes shear hair.
    // Only the lower attached side-lock ends blend toward their fixed join.
    return 1-smooth(148,208,rest[1]);
  }
  function yawDepth(rest,t){
    // A shared cross-section surface carries scalp, jaw, cover and expression.
    // No per-eye islands: the large painted features sit on its gently curved
    // front, while the temples and jaw recede. Only depth is baked; rotation
    // is evaluated per pose. Existing nod depth remains unchanged.
    const rows=t.yaw.sections;let i=0;
    while(i<rows.length-2&&rest[1]>rows[i+1][0])i++;
    const a=rows[i],b=rows[i+1],u=smooth(a[0],b[0],rest[1]);
    const width=a[1]+(b[1]-a[1])*u,depth=a[2]+(b[2]-a[2])*u;
    return depth*Math.exp(-t.yaw.roundness*((rest[0]-t.center[0])/width)**2);
  }
  // Like the reference Rig.weights: immutable mesh ownership is baked once.
  // Standalone point/inverse callers keep the original uncached calculation.
  function fixedFields(rest,binding,part=null){
    const t=binding.headTurn,b=binding.breathing;
    const depth=headDepth(rest,t);
    const layered=t?.model==='layered-head-volume',kind=materialKind(part);
    const shared=layered&&binding.headSupport&&(kind==='head'||['torso','neck'].includes(part?.material));
    // Chieri uses the same head/neck fade on both pieces of a split lock.
    // Keep the full face above the jaw; carry the attached hair and upper
    // neck through one continuous fade ending before the shoulders.
    const head=shared?(rest[0]>=196&&rest[0]<=416?1-smooth(...binding.headSupport.fade,rest[1]):0)
      :layered?layeredWeight(rest,binding,part):headWeight(rest,binding);
    // The support weight already fades this complete head transform. Do not
    // apply a second fade to the dome: that would squeeze the lower face twice.
    const domeOwned=shared||kind==='head';
    return {kind,head,support:binding.neckTransition?.verticalSupport||0,faceDepth:domeOwned?depth:0,
      yaw:layered?yawDepth(rest,t):0,
      body:1-smooth(...binding.bodyFade,rest[1]),referenceBody:1-smooth(...binding.referenceBodyFade,rest[1]),turn:t,depth,
      upper:b?1-smooth(...b.upper,rest[1]):0,expand:b?smooth(b.expand[0],b.expand[1],rest[1])*(1-smooth(b.expand[2],b.expand[3],rest[1])):0};
  }
  function localFields(rest,part,weights){
    const weight=grabInfluence(part,weights),s=part?.centerline?arcPosition(rest,part.centerline):0;
    const locked=part?.rootLockY??part?.root?.[1]??0,blend=part?.rootBlendY??locked+12;
    return {part,weight,s,rootWeight:smooth(locked,blend,rest[1])};
  }
  const poseFrames=new WeakMap();
  function frameFields(pose,binding){
    let bindings=poseFrames.get(pose);if(!bindings){bindings=new WeakMap();poseFrames.set(pose,bindings);}
    if(bindings.has(binding))return bindings.get(binding);
    const t=binding.headTurn,angle=(pose.lookX||0)/(t?.controlGain||1)*(t?.yaw?.angle||0);
    const frame={shift:pose.referenceMotion?[4*binding.width/1024,3*binding.height/1536]:t?.shift,
      amplitude:pose.referenceMotion?[13*binding.width/1024,10*binding.height/1536]:t?.depth,
      yawCos:Math.cos(angle),yawSin:Math.sin(angle),
      headCos:Math.cos(pose.headRoll||0),headSin:Math.sin(pose.headRoll||0),
      bodyCos:Math.cos(pose.bodyRoll||0),bodySin:Math.sin(pose.bodyRoll||0),grabs:new Map()};
    bindings.set(binding,frame);return frame;
  }
  function parentPoint(local, rest, pose, binding, fixed=null,part=null) {
    let [x, y] = local;
    if(part?.material==='head'&&pose.cheekPress){
      const {point:[cx,cy],strength}=pose.cheekPress;
      const distance=((rest[0]-cx)/17)**2+((rest[1]-cy)/13)**2;
      const weight=(1-smooth(0,1,distance))*strength;
      x+=(binding.neck[0]>cx?1:-1)*1.8*weight;
      y+=weight;
    }
    const height = binding.height,frame=fixed?.frame||frameFields(pose,binding);
    const layered=binding.headTurn?.model==='layered-head-volume';
    // Both cached mesh vertices and inverse/picking callers use this same
    // material field, including the side hair retained in the torso texture.
    if(layered&&!fixed)fixed=fixedFields(rest,binding,part);
    const verticalSupport=(pose.headY||0)*height*(fixed?fixed.support:(binding.neckTransition?.verticalSupport||0));
    const head = fixed?fixed.head:layered?layeredWeight(rest,binding,part):headWeight(rest,binding);
    const body = fixed?(pose.referenceMotion?fixed.referenceBody:fixed.body):1 - smooth(...(pose.referenceMotion?binding.referenceBodyFade:binding.bodyFade), rest[1]);
    if(head&&binding.headTurn&&(pose.lookX||pose.lookY)){
      const t=binding.headTurn,f=frame||frameFields(pose,binding),depth=fixed?fixed.depth:headDepth(rest,t);
      if(layered){
        // Project the SAME rest-space volume about its vertical axis. Freeze
        // this surface offset at rest, as for ownership: local 2D cloth/hair
        // spring offsets retain their lengths and the picking inverse stays
        // affine. Skin/face/cover and attached roots share the projection.
        x+=((rest[0]-t.center[0])*(f.yawCos-1)+fixed.yaw*f.yawSin)*head;
        // Keep the existing vertical nod shared across split source pixels.
        y+=(pose.lookY||0)*(f.shift[1]+f.amplitude[1]*fixed.faceDepth)*head;
      }else{
        x+=(pose.lookX||0)*(f.shift[0]+f.amplitude[0]*depth)*head;
        y+=(pose.lookY||0)*(f.shift[1]+f.amplitude[1]*depth)*head;
      }
    }
    const headAngle = (pose.headRoll || 0) * head;
    if (headAngle) {
      const dx = x - binding.neck[0], dy = y - binding.neck[1];
      const c=head===1?frame.headCos:Math.cos(headAngle),s=head===1?frame.headSin:Math.sin(headAngle);
      x = binding.neck[0] + dx * c - dy * s;
      y = binding.neck[1] + dx * s + dy * c;
    }
    x += (pose.headX || 0) * height * head;
    y += ((pose.headY || 0) * height-verticalSupport) * head;
    if(binding.breathing&&pose.breath){
      const b=binding.breathing,upper=fixed?fixed.upper:1-smooth(...b.upper,rest[1]);
      const expand=fixed?fixed.expand:smooth(b.expand[0],b.expand[1],rest[1])*(1-smooth(b.expand[2],b.expand[3],rest[1]));
      y-=pose.breath*b.lift*upper;
      x+=(x-b.centerX)*pose.breath*b.width*expand;
    }
    const bodyAngle = (pose.bodyRoll || 0) * body;
    if (bodyAngle) {
      const dx = x - binding.hips[0], dy = y - binding.hips[1];
      const ca=pose.referenceMotion?1+((frame?frame.bodyCos:Math.cos(pose.bodyRoll))-1)*body:Math.cos(bodyAngle);
      const sa=pose.referenceMotion?(frame?frame.bodySin:Math.sin(pose.bodyRoll))*body:Math.sin(bodyAngle);
      x = binding.hips[0] + dx * ca - dy * sa;
      y = binding.hips[1] + dx * sa + dy * ca;
    }
    x += (pose.bodyX || 0) * height * body;
    y += (((pose.bodyY || 0) + (pose.compression || 0)) * height+verticalSupport) * body;
    if(pose.squash){const feet=binding.feetY??height;x=binding.width/2+(x-binding.width/2)*(1-pose.squash*0.5);y=feet-(feet-y)*(1+pose.squash);}
    y -= (pose.hop || 0) * height;
    return [x, y];
  }
  // Isolated long-hair study: independent damped joints driven by the ACTUAL
  // head-side attachment motion. Rest curvature is preserved; this is not a
  // collision solver or a claim of physically reconstructed hidden hair.
  function createLongHairDynamics(part,binding,attachment=null){
    const joints=part.centerline.slice(1).map(()=>({x:0,v:0})),config=part.dynamics||{};
    let previous=null,velocity=[0,0],acceleration=[0,0];
    return {step(dt,pose){
      if(!Number.isFinite(dt)||dt<=0||dt>1/30)throw Error('Long hair requires fixed small steps');
      const root=attachment?deformPoint(part.root,pose,binding,attachment):parentPoint(part.root,part.root,pose,binding);
      if(!previous){previous=root;return;}
      const v=root.map((x,i)=>(x-previous[i])/dt);
      for(let i=0;i<2;i++){const a=Math.max(-1200,Math.min(1200,(v[i]-velocity[i])/dt));acceleration[i]+=(a-acceleration[i])*(1-Math.exp(-dt*22));}
      previous=root;velocity=v;
      const before=joints.map(s=>s.x),tilt=(pose.headRoll||0)+(pose.bodyRoll||0);
      for(let i=0;i<joints.length;i++){
        const p=part.centerline[i],q=part.centerline[i+1],theta=Math.atan2(q[0]-p[0],q[1]-p[1]);
        const inertia=-acceleration[0]*Math.cos(theta)*.00055+acceleration[1]*Math.sin(theta)*.00055;
        const target=inertia*(i?0.35:1)-(tilt*.65/joints.length)+(i?before[i-1]*.7:0)+(pose.hair?.[config.windSource||'outer-left']?.[2]||0)*(config.wind||0)/joints.length;
        const s=joints[i],k=(config.stiffness||[85,55,38,26,19])[i]||19,d=(config.damping||[17,13,10,8,7])[i]||7,limit=[.04,.06,.085,.11,.13][i]||.13;
        s.v+=(k*(target-s.x)-d*s.v)*dt;s.x+=s.v*dt;
        if(Math.abs(s.x)>limit){s.x=Math.sign(s.x)*limit;if(s.v*s.x>0)s.v=0;}
      }
    },snapshot(){return joints.map(s=>s.x);}};
  }

  // World-space elastic chain. A segment keeps its own orientation/velocity;
  // moving its anchor generates inertia instead of instantly rotating the whole
  // drawing. Original segment lengths and rest curvature remain identifiable.
  function createFlexibleHair(part,binding){
    const line=part.centerline,config=part.flexible,n=line.length-1;
    const joints=Array.from({length:n},()=>({x:0,v:0,anchor:null,velocity:[0,0],acceleration:[0,0]}));
    let localNodes=line.map(p=>p.slice()),parentAngle=0,initialized=false;
    function step(dt,pose){
      if(!Number.isFinite(dt)||dt<=0||dt>1/30)throw Error('Flexible hair requires fixed small steps');
      const origin=parentPoint(part.root,part.root,pose,binding),ex=parentPoint([part.root[0]+1,part.root[1]],part.root,pose,binding),ey=parentPoint([part.root[0],part.root[1]+1],part.root,pose,binding);
      const a=ex[0]-origin[0],b=ex[1]-origin[1],c=ey[0]-origin[0],d=ey[1]-origin[1],det=a*d-b*c;
      parentAngle=Math.atan2(b,a);const before=joints.map(j=>j.x),world=[origin];
      // Distribute the reference breeze through the existing joints. Each
      // downstream spring follows its predecessor, retaining tip lag and rest
      // lengths; the pinned root receives no extra drawing-time rotation.
      const wind=(pose.hairWind?.[config.windSource]||0)*(config.wind||0)/n;
      // A 2D face dome barely translates the tie: anchor acceleration alone
      // cannot express yaw. Reuse the reference's rear-hair direction/velocity
      // load, distributed through the same joints as wind, with no extra clock
      // or drawing-time rotation. Do not feed the already-sprung short hair.
      const turn=part.backParallax?(pose.hairTurn||0)/n:0;
      for(let i=0;i<n;i++){
        const j=joints[i],anchor=world[i],dx=line[i+1][0]-line[i][0],dy=line[i+1][1]-line[i][1],length=Math.hypot(a*dx+c*dy,b*dx+d*dy),restAngle=Math.atan2(dy,dx);
        if(!initialized){j.x=parentAngle;j.anchor=anchor.slice();}
        const velocity=anchor.map((v,k)=>(v-j.anchor[k])/dt);
        for(let k=0;k<2;k++){const accel=Math.max(-1800,Math.min(1800,(velocity[k]-j.velocity[k])/dt));j.acceleration[k]+=(accel-j.acceleration[k])*(1-Math.exp(-dt*18));}
        j.anchor=anchor.slice();j.velocity=velocity;
        const heading=restAngle+j.x,torque=(j.acceleration[0]*Math.sin(heading)-j.acceleration[1]*Math.cos(heading))*config.inertia/length;
        const target=(i?before[i-1]*(1-config.gravity):parentAngle)+wind+turn,k=config.stiffness[i],damping=config.damping[i];
        j.v+=(k*(target-j.x)+torque-damping*j.v)*dt;j.x+=j.v*dt;
        const relative=j.x-parentAngle;if(Math.abs(relative)>.8){j.x=parentAngle+Math.sign(relative)*.8;if(j.v*relative>0)j.v=0;}
        world.push([anchor[0]+length*Math.cos(restAngle+j.x),anchor[1]+length*Math.sin(restAngle+j.x)]);
      }
      initialized=true;
      localNodes=world.map(p=>{const x=p[0]-origin[0],y=p[1]-origin[1];return [part.root[0]+(d*x-c*y)/det,part.root[1]+(-b*x+a*y)/det];});
    }
    return {step,snapshot(){return {nodes:localNodes.map(p=>p.slice()),angles:joints.map(j=>j.x-parentAngle)};}};
  }
  const curveFields=new WeakMap(),flexParents=new WeakMap();
  function carriedFlexPoint(local,pose,binding,part){
    let bindings=flexParents.get(pose);if(!bindings){bindings=new WeakMap();flexParents.set(pose,bindings);}
    let parts=bindings.get(binding);if(!parts){parts=new WeakMap();bindings.set(binding,parts);}
    let frame=parts.get(part);if(!frame){const o=parentPoint(part.root,part.root,pose,binding),x=parentPoint([part.root[0]+1,part.root[1]],part.root,pose,binding),y=parentPoint([part.root[0],part.root[1]+1],part.root,pose,binding);frame={o,x:x.map((v,i)=>v-o[i]),y:y.map((v,i)=>v-o[i])};parts.set(part,frame);}
    const x=local[0]-part.root[0],y=local[1]-part.root[1];return [0,1].map(i=>frame.o[i]+frame.x[i]*x+frame.y[i]*y);
  }
  function curvePoint(rest,curve,part){
    const line=part.centerline,y=rest[1];let fields=curveFields.get(curve);
    if(!fields){const values=curve.nodes.map((p,i)=>p.map((v,k)=>v-line[i][k]));const tangent=values.map((_p,j)=>{const lo=Math.max(0,j-1),hi=Math.min(line.length-1,j+1);return [0,1].map(k=>(values[hi][k]-values[lo][k])/(line[hi][1]-line[lo][1]));});fields={values,tangent};curveFields.set(curve,fields);}
    const {values,tangent}=fields;let i=0;while(i<line.length-2&&y>line[i+1][1])i++;
    const length=line[i+1][1]-line[i][1],t=Math.max(0,Math.min(1,(y-line[i][1])/length)),t2=t*t,t3=t2*t;
    return [0,1].map(k=>rest[k]+(2*t3-3*t2+1)*values[i][k]+(t3-2*t2+t)*length*tangent[i][k]+(-2*t3+3*t2)*values[i+1][k]+(t3-t2)*length*tangent[i+1][k]);
  }
  // Rest-space ownership is immutable for the lifetime of a binding. Cache
  // path projection once, not multiple nearest-path searches per GPU frame.
  const branchFields=new WeakMap();
  function fieldsForPoint(rest,part){
    let cache=branchFields.get(part);if(!cache){cache=new Map();cache.points=new WeakMap();branchFields.set(part,cache);}
    if(cache.points.has(rest))return cache.points.get(rest);
    const key=rest.join(',');if(cache.has(key)){const fields=cache.get(key);cache.points.set(rest,fields);return fields;}
    const fields=part.branches.map(branch=>{
      const projected=pathProjection(rest,branch.centerline);
      return {branch,weight:Math.exp(-((projected.distance/branch.radius)**2)),
        factors:branch.centerline.slice(1).map((p,i)=>smooth(arcPosition(branch.centerline[i],branch.centerline),arcPosition(p,branch.centerline),projected.s))};
    });
    const sum=fields.reduce((s,f)=>s+f.weight,0);for(const f of fields)f.weight=sum<1e-8?0:f.weight/sum;
    cache.set(key,fields);cache.points.set(rest,fields);return fields;
  }
  function branchPoint(rest,pose,part){
    if(!part.branches||!pose.hairBranches)return rest.slice();
    const out=rest.slice();
    for(const {branch,weight,factors}of fieldsForPoint(rest,part)){
      const angles=pose.hairBranches[branch.name];if(!angles||!weight)continue;
      let [x,y]=rest;
      for(let i=angles.length-1;i>=0;i--){
        const angle=angles[i]*factors[i],p=branch.centerline[i],dx=x-p[0],dy=y-p[1],c=Math.cos(angle),s=Math.sin(angle);
        x=p[0]+dx*c-dy*s;y=p[1]+dx*s+dy*c;
      }
      out[0]+=(x-rest[0])*weight;out[1]+=(y-rest[1])*weight;
    }
    return out;
  }
  // Upstream rig.js:270. Split-layer ownership replaces colour segmentation;
  // the existing root blend is the cut seam mask. Do not shift fixed skin or
  // recalculate ownership from displaced coordinates. Call after local motion,
  // before the same neck/body parent, just as the reference does.
  function backHairPoint(local,pose,binding,part,weight=1){
    return part?.backParallax&&pose.lookX
      ?[local[0]-pose.lookX*5*binding.width/1024*weight,local[1]]:local;
  }
  // Chieri's loose-strand smooth(0.1, max(0.3, caughtS), s).
  // Keep the authored attachment fade as well, including the rear locks.
  function hairPullWeight(part,rest,contact){
    return smooth(part.rootLockY,part.rootBlendY,rest[1])*smooth(.1,Math.max(.3,arcPosition(contact,part.centerline)),arcPosition(rest,part.centerline));
  }
  function deformPoint(rest, pose, binding, part, weights=null, fixed=null) {
    const base=baseDeformPoint(rest,pose,binding,part,weights,fixed);
    if(!part?.longHair)return base;
    const offset=[0,0],contact=pose.hairContacts?.[part.name];
    const add=(at,delta)=>{const w=hairPullWeight(part,rest,at);for(let i=0;i<2;i++)offset[i]+=w*(delta?.[i]||0);};
    if(contact)add(contact,pose.grab?.[part.name]);
    for(const old of pose.hairRecoil||[])if(old.partId===part.name)add(old.point,old.offset);
    if(!offset.some(Boolean))return base;
    const anchor=parentPoint(part.root,part.root,pose,binding,null,part);
    const shifted=parentPoint(part.root.map((v,i)=>v+offset[i]),part.root,pose,binding,null,part);
    return base.map((v,i)=>v+shifted[i]-anchor[i]);
  }
  function baseDeformPoint(rest, pose, binding, part, weights=null, fixed=null) {
    if(part?.legSide){
      const f=pose.feet?.legs?.[part.legSide]||{};
      const rotate=(p,pivot,angle)=>{const c=Math.cos(angle),s=Math.sin(angle),dx=p[0]-pivot[0],dy=p[1]-pivot[1];return [pivot[0]+dx*c-dy*s,pivot[1]+dx*s+dy*c];};
      // Distal-to-proximal articulation carries the ankle with the knee and
      // the knee with the hip. Weights stay in rest space, including footwear.
      let local=rest.slice();
      local=rotate(local,part.ankle,(f.ankle||0)*smooth(part.ankle[1]-15,part.ankle[1]+25,rest[1]));
      local=rotate(local,part.knee,(f.angle||0)*smooth(480,570,rest[1]));
      local=rotate(local,part.hip,(f.hip||0)*smooth(480,525,rest[1]));
      local[1]-=(f.lift||0)*smooth(480,570,rest[1]);
      if(part.footwear&&f.drop){local[0]+=(part.legSide==='left'?-10:10)*f.drop;local[1]+=24*f.drop;}
      return parentPoint(local,rest,pose,binding,fixed,part);
    }

    if(part?.followPart&&pose.flexHair?.[part.followPart.name]){
      const normal=parentPoint(localPoint(rest,pose,part,weights,fixed),rest,pose,binding,fixed),base=parentPoint(rest,rest,pose,binding,fixed),follow=deformPoint(rest,pose,binding,part.followPart,null,fixed);
      return normal.map((v,i)=>v+follow[i]-base[i]);
    }
    const flexible=part?.flexible&&pose.flexHair?.[part.name];
    if(flexible){
      const mix=smooth(part.rootLockY,part.rootBlendY,rest[1]);if(!mix)return parentPoint(rest,rest,pose,binding,fixed);
      let local=curvePoint(rest,flexible,part),fork=branchPoint(rest,pose,part);local=local.map((v,i)=>v+fork[i]-rest[i]);
      const reaction=flexible.reaction?.[2]||0;
      if(reaction){const angle=reaction*Math.pow(arcPosition(rest,part.centerline),1.4),dx=local[0]-part.root[0],dy=local[1]-part.root[1];local=[part.root[0]+dx*Math.cos(angle)-dy*Math.sin(angle),part.root[1]+dx*Math.sin(angle)+dy*Math.cos(angle)];}
      const carried=carriedFlexPoint(backHairPoint(local,pose,binding,part),pose,binding,part);if(mix===1)return carried;
      const plain=parentPoint(rest,rest,pose,binding,fixed);return plain.map((v,i)=>v+(carried[i]-v)*mix);
    }
    const chain=part?.longHair&&pose.longHair?.[part.name];
    if(chain){
      const plain=parentPoint(rest,rest,pose,binding,fixed),mix=smooth(part.rootLockY,part.rootBlendY,rest[1]);
      if(!mix)return plain;
      let [x,y]=branchPoint(rest,pose,part);
      for(let i=chain.length-1;i>=0;i--){const p=part.centerline[i],next=part.centerline[i+1];
        const angle=chain[i]*smooth(p[1],next[1],rest[1]),dx=x-p[0],dy=y-p[1],c=Math.cos(angle),s=Math.sin(angle);
        x=p[0]+dx*c-dy*s;y=p[1]+dx*s+dy*c;
      }
      // Use the head-attached parent, not the torso's weight at the tip's y.
      const carried=parentPoint(backHairPoint([x,y],pose,binding,part),part.root,pose,binding);
      return plain.map((v,i)=>v+(carried[i]-v)*mix);
    }
    const local=localPoint(rest,pose,part,weights,fixed);
    const backWeight=part?.backParallax?(fixed?.local?.part===part?fixed.local.rootWeight:smooth(part.rootLockY,part.rootBlendY,rest[1])):0;
    return parentPoint(backHairPoint(local,pose,binding,part,backWeight),rest,pose,binding,fixed,part);
  }
  function makeMesh(rect, step, textureRect=rect) {
    const cols=Math.ceil(rect.w/step), rows=Math.ceil(rect.h/step), rest=[], uv=[], indices=[];
    for (let j=0;j<=rows;j++) for (let i=0;i<=cols;i++) {
      const x=rect.x+rect.w*i/cols, y=rect.y+rect.h*j/rows;
      rest.push(x,y); uv.push((x-textureRect.x)/textureRect.w,(y-textureRect.y)/textureRect.h);
    }
    for (let j=0;j<rows;j++) for (let i=0;i<cols;i++) {
      const a=j*(cols+1)+i,b=a+1,c=a+cols+2,d=a+cols+1;
      indices.push(a,b,c,a,c,d);
    }
    return {rest:new Float32Array(rest),uv:new Float32Array(uv),indices:new Uint32Array(indices)};
  }
  const preparedMeshes=new WeakMap();
  function deformMesh(mesh, pose, binding, part) {
    let fixed=preparedMeshes.get(mesh);
    if(!fixed||fixed.binding!==binding||fixed.part!==part||fixed.rest!==mesh.rest||fixed.weights!==mesh.weights){
      fixed={binding,part,rest:mesh.rest,weights:mesh.weights,points:[]};
      for(let i=0;i<mesh.rest.length;i+=2){const rest=[mesh.rest[i],mesh.rest[i+1]],weights=mesh.weights?.subarray(i/2*3,i/2*3+3);fixed.points.push({rest,fields:{...fixedFields(rest,binding,part),local:localFields(rest,part,weights),frame:null},weights});}
      preparedMeshes.set(mesh,fixed);
    }
    const output=new Float32Array(mesh.rest.length),frame=frameFields(pose,binding),surface=part?.material&&!part.centerline&&!part.legSide;
    for(let i=0;i<fixed.points.length;i++){const p=fixed.points[i];p.fields.frame=frame;
      output.set(surface?parentPoint(p.rest,p.rest,pose,binding,p.fields,part):deformPoint(p.rest,pose,binding,part,p.weights,p.fields),i*2);
    }
    return output;
  }
  function authoredMesh(source,binding) {
    const reject=()=>{throw Error('Invalid left-arm mesh');},numbers=(a,n)=>Array.isArray(a)&&a.length===n&&a.every(Number.isFinite);
    if(!source||!numbers(source.canvas,2)||source.canvas[0]!==2612||source.canvas[1]!==3941||binding.width!==530||binding.height!==800||!Array.isArray(source.vertices)||source.vertices.length!==1308||!Array.isArray(source.triangles)||source.triangles.length!==2304||JSON.stringify(source.weight_order)!=='["shoulder","elbow","wrist"]')reject();
    for(const v of source.vertices){
      if(!v||!numbers(v.xy,2)||!numbers(v.uv,2)||!numbers(v.weights,3))reject();
      if(v.xy.some((n,i)=>n<0||n>source.canvas[i])||v.uv.some((n,i)=>n<0||n>1||Math.abs(n-v.xy[i]/source.canvas[i])>1e-9)||v.weights.some(n=>n<0||n>1)||Math.abs(v.weights.reduce((a,b)=>a+b,0)-1)>1e-6)reject();
      if(v.xy[1]>=1703&&(v.weights[0]!==0||v.weights[1]!==0||v.weights[2]!==1))reject();
    }
    for(const t of source.triangles){
      if(!Array.isArray(t)||t.length!==3||t.some(n=>!Number.isSafeInteger(n)||n<0||n>=source.vertices.length)||new Set(t).size!==3)reject();
      const [a,b,c]=t.map(i=>source.vertices[i].xy);if((b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0])<=1e-8)reject();
    }
    const rest=[],uv=[],weights=[];
    for(const v of source.vertices){rest.push(v.xy[0]*binding.width/source.canvas[0],v.xy[1]*binding.height/source.canvas[1]);uv.push(...v.uv);weights.push(...v.weights);}
    return {rest:new Float32Array(rest),uv:new Float32Array(uv),weights:new Float32Array(weights),indices:new Uint32Array(source.triangles.flat())};
  }
  // Invert the same affine parent at the LOCKED material point. Never derive
  // parent weights from the moved y coordinate (that stretches the wrist group).
  function unparentPoint(point,rest,pose,binding,part=null){
    const base=parentPoint(rest,rest,pose,binding,null,part);
    // Sample the parent affine transform with ownership frozen at the locked
    // rest point. Calling deformPoint(rest+1) would incorrectly move weights.
    const ex=parentPoint([rest[0]+1,rest[1]],rest,pose,binding,null,part),ey=parentPoint([rest[0],rest[1]+1],rest,pose,binding,null,part);
    const a=ex[0]-base[0],b=ex[1]-base[1],c=ey[0]-base[0],d=ey[1]-base[1],det=a*d-b*c;
    if(!Number.isFinite(det)||Math.abs(det)<1e-8)throw Error('Singular material parent');
    const x=point[0]-base[0],y=point[1]-base[1];
    return [rest[0]+(d*x-c*y)/det,rest[1]+(-b*x+a*y)/det];
  }
  // Prepared material-domain payload only. Texture metadata is never opened here.
  function importRightHandMeshes(source,binding,grabs) {
    const reject=()=>{throw Error('Invalid right-hand intake');},equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
    const group='arm-screen-right',ids=['right-arm','right-hand','right-wrist'];
    if(!source||source.kind!=='right-hand-runtime-intake-v1'||source.group!==group||source.targetCount!==1||
      !grabs||!Object.hasOwn(grabs,group)||grabs[group]?.name!==group||!binding||binding.width!==530||binding.height!==800||
      !equal(source.sourceCanvas,[2612,3941])||!equal(source.materialCanvas,[binding.width,binding.height])||
      ['dragEnabled','runtimeIntegrated','artApproved','safeRangeCertified'].some(k=>source[k]!==false)||
      !Array.isArray(source.parts)||source.parts.length!==3||new Set(source.parts.map(p=>p?.id)).size!==3)reject();
    const config=grabs[group];
    if(config.screenSide!=='right'||config.characterSide!=='left'||!Number.isFinite(config.elbowRatio)||config.elbowRatio<0||config.elbowRatio>1||!equal(config.sourceCanvas,source.sourceCanvas))reject();
    for(const p of source.parts){
      if(!p||!ids.includes(p.id)||p.target!==group||p.positionCoordinateSpace!=='material-pixels'||p.offsetCoordinateSpace!=='material-pixels'||
        !equal(p.jointOrder,['shoulder','elbow','wrist']))reject();
      const isArm=p.id==='right-arm';
      if(isArm?(p.fixedRootY!==162.39533113422988||p.rigidJoint!==null):(p.fixedRootY!==null||p.rigidJoint!=='wrist'))reject();
      const t=p.texture;
      if(!t||t.width!==2612||t.height!==3941||t.resampled!==false||typeof t.sha256!=='string'||!(/^[a-f0-9]{64}$/).test(t.sha256)||
        typeof t.source!=='string'||!(/^arm-screen-right\/assets\/[a-zA-Z0-9_-]+\.png$/).test(t.source))reject();
      const b=p.buffers,n=b?.rest?.length/2;
      if(!b||!Number.isSafeInteger(n)||n<3||!['rest','uv','weights','indices'].every(k=>Array.isArray(b[k])&&b[k].length>0&&Array.from(b[k]).every(Number.isFinite))||
        b.uv.length!==n*2||b.weights.length!==n*3||b.indices.length%3!==0)reject();
      for(let i=0;i<n;i++){
        for(let axis=0;axis<2;axis++){
          const value=b.rest[i*2+axis],uv=b.uv[i*2+axis],size=source.materialCanvas[axis];
          if(value<0||value>size||uv<0||uv>1||Math.abs(uv-value/size)>1e-7)reject();
        }
        const w=b.weights.slice(i*3,i*3+3);
        if(w.some(v=>v<0||v>1)||Math.abs(w.reduce((a,v)=>a+v,0)-1)>1e-6)reject();
        if(!isArm&&!equal(w,[0,0,1]))reject();
        // Lock roots in both the input and Float32 output coordinate domains.
        if(isArm&&(b.rest[i*2+1]<=p.fixedRootY||Math.fround(b.rest[i*2+1])<=p.fixedRootY)&&!equal(w,[1,0,0]))reject();
      }
      if(isArm&&!b.rest.some((value,i)=>i%2===1&&value<=p.fixedRootY))reject();
      // v1 is the prepared three-part topology, not a generic mesh loader.
      const counts={'right-arm':[275,1440],'right-hand':[132,660],'right-wrist':[729,4056]}[p.id];
      if(n!==counts[0]||b.indices.length!==counts[1])reject();
      const triangles=new Set(),used=new Set(),edges=new Map(),rest=new Float32Array(b.rest);
      for(let i=0;i<b.indices.length;i+=3){
        const tri=b.indices.slice(i,i+3);
        if(tri.some(v=>!Number.isSafeInteger(v)||v<0||v>=n)||new Set(tri).size!==3)reject();
        const key=tri.slice().sort((a,b)=>a-b).join(',');if(triangles.has(key))reject();triangles.add(key);
        for(const v of tri)used.add(v);
        for(let j=0;j<3;j++){
          const from=tri[j],to=tri[(j+1)%3],key=[Math.min(from,to),Math.max(from,to)].join(','),edge=edges.get(key);
          if(!edge)edges.set(key,{from,to,count:1});
          else{if(edge.count!==1||edge.from!==to||edge.to!==from)reject();edge.count++;}
        }
        const [a,c,d]=tri.map(v=>v*2);
        if((rest[c]-rest[a])*(rest[d+1]-rest[a+1])-(rest[c+1]-rest[a+1])*(rest[d]-rest[a])<=1e-8)reject();
      }
      if(used.size!==n)reject();
      const boundary=new Map(),incoming=new Set();
      for(const edge of edges.values())if(edge.count===1){
        if(boundary.has(edge.from)||incoming.has(edge.to))reject();boundary.set(edge.from,edge.to);incoming.add(edge.to);
      }
      if(!boundary.size||n-edges.size+triangles.size!==1)reject();
      const start=boundary.keys().next().value,visited=new Set();let vertex=start;
      while(!visited.has(vertex)){if(!boundary.has(vertex))reject();visited.add(vertex);vertex=boundary.get(vertex);}
      if(vertex!==start||visited.size!==boundary.size)reject();
    }
    return {group:source.group,targetCount:source.targetCount,dragEnabled:false,runtimeIntegrated:false,artApproved:false,safeRangeCertified:false,
      parts:source.parts.map(p=>({id:p.id,target:p.target,positionCoordinateSpace:p.positionCoordinateSpace,offsetCoordinateSpace:p.offsetCoordinateSpace,
        jointOrder:p.jointOrder.slice(),fixedRootY:p.fixedRootY,rigidJoint:p.rigidJoint,texture:{...p.texture},
        mesh:{rest:new Float32Array(p.buffers.rest),uv:new Float32Array(p.buffers.uv),weights:new Float32Array(p.buffers.weights),indices:new Uint32Array(p.buffers.indices)}}))};
  }
  // Consume the existing prepared author JSON, not another intermediate format.
  // Coordinates already use material pixels; metadata paths are never opened.
  function importSkirtMesh(source,binding,grabs) {
    const reject=()=>{throw Error('Invalid skirt mesh');},equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
    const numbers=(a,n)=>Array.isArray(a)&&a.length===n&&Array.from(a).every(Number.isFinite);
    const specs={'skirt-front':[2500,4802,302.05531590966757],'skirt-right':[3599,6960,302.05531590966757],
      'skirt-back-visible-center':[266,468,487.18599340268963]};
    if(!source||!Object.hasOwn(specs,source.part)||source.kind!=='prepared-material-geometry-not-runtime-loader-format'||
      source.interactionGroup!==source.part||!binding||binding.width!==530||binding.height!==800||
      ['dragEnabled','runtimeIntegrated','artApproved','safeRangeCertified'].some(k=>source[k]!==false))reject();
    const target=source.part==='skirt-back-visible-center'?null:source.part,m=source.mesh,t=source.texture;
    const [count,triangles,rootY]=specs[source.part];
    if(source.futureGrabTarget!==(target!==null)||!m||!equal(m.canvas,[530,800])||!equal(m.sourceCanvas,[2612,3941])||
      m.coordinateSpace!=='material pixels; original full-canvas UV retained'||m.rootFixedY!==rootY||
      !equal(m.joints,['fixed-waist-parent','middle-fold','hem'])||!Array.isArray(m.vertices)||m.vertices.length!==count||
      !Array.isArray(m.triangles)||m.triangles.length!==triangles||!t||t.width!==2612||t.height!==3941||t.resampled!==false||
      t.source!=='skirt-kit/assembly-v2/layers/'+source.part+'.png')reject();
    if(target){
      const config=grabs&&Object.hasOwn(grabs,target)&&grabs[target];
      if(!config||config.name!==target||!Number.isFinite(config.foldRatio)||config.foldRatio<0||config.foldRatio>1||
        !equal(config.sourceCanvas,m.sourceCanvas))reject();
    }
    const rest=new Float32Array(count*2),uv=new Float32Array(count*2),weights=new Float32Array(count*3);
    let roots=0;
    for(let i=0;i<count;i++){
      const v=m.vertices[i];
      if(!v||!numbers(v.xy,2)||!numbers(v.uv,2)||!numbers(v.weights,3)||
        v.xy.some((x,axis)=>x<0||x>m.canvas[axis])||v.uv.some((x,axis)=>x<0||x>1||Math.abs(x-v.xy[axis]/m.canvas[axis])>1e-7)||
        v.weights.some(x=>x<0||x>1)||Math.abs(v.weights.reduce((a,x)=>a+x,0)-1)>1e-6)reject();
      // Preserve the fixed boundary after Float32 rounding of both point and root.
      if(v.xy[1]<=rootY||Math.fround(v.xy[1])<=Math.fround(rootY)){
        roots++;if(!equal(v.weights,[1,0,0]))reject();
      }
      rest.set(v.xy,i*2);uv.set(v.uv,i*2);weights.set(v.weights,i*3);
      if(Math.abs(weights[i*3]+weights[i*3+1]+weights[i*3+2]-1)>1e-6)reject();
    }
    if(!roots)reject();
    const indices=new Uint32Array(triangles*3),seen=new Set(),used=new Set();
    for(let i=0;i<triangles;i++){
      const tri=m.triangles[i];
      if(!numbers(tri,3)||tri.some(x=>!Number.isSafeInteger(x)||x<0||x>=count)||new Set(tri).size!==3)reject();
      const key=tri.slice().sort((a,b)=>a-b).join(',');if(seen.has(key))reject();seen.add(key);
      for(const vertex of tri)used.add(vertex);
      const [a,b,c]=tri.map(x=>m.vertices[x].xy),[ia,ib,ic]=tri.map(x=>x*2);
      if((b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0])<=0||
        (rest[ib]-rest[ia])*(rest[ic+1]-rest[ia+1])-(rest[ib+1]-rest[ia+1])*(rest[ic]-rest[ia])<=0)reject();
      indices.set(tri,i*3);
    }
    if(used.size!==count)reject();
    // Old lining weights are retained for provenance, but no local grab owns it.
    return {id:source.part,target,texture:{...t},mesh:{rest,uv,weights,indices}};
  }
  return { hairPullWeight, createFlexibleHair, createLongHairDynamics, deformPoint, makeMesh, deformMesh, localPoint, grabInfluence, grabOffset, authoredMesh, unparentPoint, importRightHandMeshes, importSkirtMesh };
});
