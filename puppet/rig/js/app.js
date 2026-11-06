// 渲染 + 交互：WebGL2 画两个网格（身体 + 表情脸），同一套形变。
(() => {
  const A = window.RIG_ASSETS;
  const CHAR_KEY = new URLSearchParams(location.search).get('c') || 'baijie';
  const CFG = A[CHAR_KEY];
  const CW = CFG.canvas[0], CH = CFG.canvas[1];
  const layered = new URLSearchParams(location.search).get('layers') !== '0'
    ? window.HAIR_ASSETS?.[CHAR_KEY] : null;
  const locks = [];
  const frontConfig = layered && new URLSearchParams(location.search).get('front') !== '0'
    ? window.FRONT_HAIR_ASSETS?.[CHAR_KEY] : null;
  const fronts = [];
  let frontProgram = null, frontUniforms = null, frontFallback = null, drawOrder = [];
  const BLINK = window.BLINK_ASSETS?.[CHAR_KEY] || {noBlink: [], textures: {}};
  const blinkTex = {};
  let bodySource = CHAR_KEY + '-body.png', assetFallback = null;
  let blinkApplied = false, renderedFace = null;

  const canvas = document.getElementById('stage');
  const gl = canvas.getContext('webgl2', { premultipliedAlpha: true, alpha: true, antialias: true });
  if (!gl) { document.body.innerHTML = '<p style="color:#c00">WebGL2 不可用</p>'; return; }

  const VS = `#version 300 es
  in vec2 a_pos; in vec2 a_uv;
  uniform vec2 u_canvas; uniform vec2 u_view; uniform vec2 u_origin; uniform float u_scale;
  out vec2 v_uv;
  void main(){
    v_uv = a_uv;
    vec2 p = a_pos * u_scale + u_origin;          // 画布像素 → 屏幕像素
    vec2 c = p / u_view * 2.0 - 1.0;              // → NDC
    gl_Position = vec4(c.x, -c.y, 0.0, 1.0);
  }`;

  const FS = `#version 300 es
  precision highp float;
  in vec2 v_uv; uniform sampler2D u_tex; uniform float u_alpha;
  out vec4 o;
  void main(){
    vec4 t = texture(u_tex, v_uv);
    // 上传时已经 UNPACK_PREMULTIPLY_ALPHA_WEBGL，rgb 已是预乘值，不能再乘一次 a
    o = vec4(t.rgb * u_alpha, t.a * u_alpha);
  }`;

  function sh(type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  }
  const prog = gl.createProgram();
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS));
  gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
  gl.bindAttribLocation(prog, 0, 'a_pos');
  gl.bindAttribLocation(prog, 1, 'a_uv');
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
  gl.useProgram(prog);
  let activeProgram = prog;
  const U = {};
  for (const n of ['u_canvas', 'u_view', 'u_origin', 'u_scale', 'u_tex', 'u_alpha']) U[n] = gl.getUniformLocation(prog, n);

  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);

  /* ---------------- 纹理 ---------------- */
  function loadImage(src) {
    return new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => rej(new Error('load ' + src));
      i.src = src;
    });
  }
  function makeTex(img) {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  /* ---------------- 网格 ---------------- */
  const STEP = 8;

  function alphaMask(img, w, h) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const x = c.getContext('2d', { willReadFrequently: true });
    x.drawImage(img, 0, 0, w, h);
    return x.getImageData(0, 0, w, h).data;
  }

  function buildBodyMesh(img) {
    const rgba = alphaMask(img, CW, CH);
    const mesh = AlphaMesh.buildAlphaMesh(rgba, CW, CH, STEP);
    mesh.hit = CharacterHit.makeLayer(mesh, rgba, CW, CH);
    mesh.hit.part = 'body';
    return mesh;
  }

  function buildFaceMesh(face) {
    const rest = [], uv = [], idx = [];
    const cols = Math.max(2, Math.ceil(face.w / STEP)), rows = Math.max(2, Math.ceil(face.h / STEP));
    const W = face.w, H = face.h;
    for (let j = 0; j <= rows; j++) {
      for (let i = 0; i <= cols; i++) {
        const u = i / cols, v = j / rows;
        rest.push(face.x + u * W, face.y + v * H);
        uv.push(u, v);
      }
    }
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const a = j * (cols + 1) + i, b = a + 1, c = a + cols + 2, d = a + cols + 1;
        idx.push(a, b, c, a, c, d);
      }
    }
    return { rest: new Float32Array(rest), idx: new Uint16Array(idx), uvs: new Float32Array(uv) };
  }

  /* ---------------- 参数与弹簧 ---------------- */
  const spr = (x = 0) => ({ x, v: 0 });
  function step(o, target, k, c, dt) {
    o.v += (-(o.x - target) * k - o.v * c) * dt;
    o.x += o.v * dt;
    return o.x;
  }

  const S = {
    t: 0,
    breath: spr(0),
    roll: spr(0),
    angleX: spr(0),
    angleY: spr(0),
    bodyX: spr(0),
    hair: (CFG.strands || []).map(() => spr(0)),
    skirt: spr(0),
    faceId: (CFG.faceOrder.filter(id => !(CFG.skip || []).includes(id))[0]) || CFG.faceOrder[0],
    faceNext: null,
    faceFade: 1,
    blinkUntil: 0, blinking: false, nextBlink: 2.5,
    hop: 0, squash: 0, hopV: 0,
  };

  let rig = null, bodyMesh = null, faceMesh = null, bodyTex = null, faceTex = {}, curTex = null;

  async function boot() {
    let bodyImg, layerImages = [];
    if (layered) {
      try {
        const images = await Promise.all([loadImage('assets/' + layered.body),
          ...layered.layers.map(part => loadImage('assets/' + part.texture))]);
        if (images.some(image => image.naturalWidth !== CW || image.naturalHeight !== CH))
          throw new Error('Independent layer dimensions do not match the rig');
        [bodyImg, ...layerImages] = images;
        bodySource = layered.body;
      } catch (error) {
        assetFallback = error.message;
        console.warn('独立头发资源不可用，整套回退原始身体：', error.message);
      }
    }
    if (!bodyImg) bodyImg = await loadImage('assets/' + bodySource);
    // Commit the repaired body only after every new front image, sampler and shader is ready.
    // A failed front bundle keeps the original two independent outer locks and their old body.
    if (frontConfig && bodySource === layered?.body) {
      const allocated = []; let pendingProgram = null;
      try {
        FrontHair.validate(frontConfig, [CW, CH]);
        const images = await Promise.all([loadImage('assets/' + frontConfig.body),
          ...frontConfig.parts.flatMap(p => [p.texture, p.caster, p.receiver].map(f => loadImage('assets/' + f)))]);
        if (images[0].naturalWidth !== CW || images[0].naturalHeight !== CH) throw Error('Front body dimensions mismatch');
        frontConfig.parts.forEach((p, i) => {
          for (let k = 0; k < 3; k++) if (images[1+i*3+k].naturalWidth !== p.textureSize[0] || images[1+i*3+k].naturalHeight !== p.textureSize[1]) throw Error('Front texture dimensions mismatch: ' + p.name);
        });
        pendingProgram = gl.createProgram();
        gl.attachShader(pendingProgram, sh(gl.VERTEX_SHADER, VS));
        gl.attachShader(pendingProgram, sh(gl.FRAGMENT_SHADER, FrontHair.fragmentSource));
        gl.bindAttribLocation(pendingProgram, 0, 'a_pos'); gl.bindAttribLocation(pendingProgram, 1, 'a_uv');
        gl.linkProgram(pendingProgram);
        if (!gl.getProgramParameter(pendingProgram, gl.LINK_STATUS)) throw Error('Front shader link failed');
        const uniforms = {};
        for (const n of ['u_canvas','u_view','u_origin','u_scale','u_tex','u_caster','u_receiver','u_face','u_source','u_box','u_root','u_motion','u_shadowOffset','u_mode','u_isFringe','u_viewPixels']) uniforms[n] = gl.getUniformLocation(pendingProgram, n);
        const pending = frontConfig.parts.map((part, i) => {
          const image = images[1+i*3], mesh = FrontHair.mesh(part, [CW, CH], frontConfig.sourceCanvas, STEP);
          mesh.out = new Float32Array(mesh.rest.length);
          const rgba = alphaMask(image, image.naturalWidth, image.naturalHeight), alpha = new Uint8Array(image.naturalWidth * image.naturalHeight);
          for (let j = 0; j < alpha.length; j++) alpha[j] = rgba[j*4+3];
          const textures = [0,1,2].map(k => { const tex = makeTex(images[1+i*3+k]); allocated.push(tex); gl.generateMipmap(gl.TEXTURE_2D); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); return tex; });
          const front = {part, mesh, textures, spring: spr(0), targetSource: 0};
          mesh.hit = {mesh, alpha, width: part.textureSize[0], height: part.textureSize[1], part:'hair',
            sampleAlpha: (u,v) => FrontHair.sampleAlpha(part, alpha, u, v, frontConfig.sourceCanvas, front.spring.x)};
          return front;
        });
        // Head shadow samples the already blended face once, so eye/eyelash pixels of other expressions stay protected.
        resize(); ensureFaceSurface();
        frontProgram = pendingProgram; frontUniforms = uniforms; fronts.push(...pending);
        bodyImg = images[0]; bodySource = frontConfig.body;
      } catch (error) {
        allocated.forEach(tex => gl.deleteTexture(tex)); if (pendingProgram) gl.deleteProgram(pendingProgram);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        frontFallback = error.message; console.warn('贴身发资源不可用，保留原身体和外发：', error.message);
      }
    }
    // 头发权重图（没有就退化为 0）
    let hairW = null;
    try {
      const hwImg = await loadImage(`assets/${CHAR_KEY}-hairweight.png`);
      const hc = document.createElement('canvas');
      hc.width = CW; hc.height = CH;
      const hx = hc.getContext('2d', { willReadFrequently: true });
      hx.drawImage(hwImg, 0, 0, CW, CH);
      hairW = hx.getImageData(0, 0, CW, CH).data;
    } catch (e) { console.warn('没有头发权重图'); }
    const hairAt = (x, y) => {
      if (!hairW) return 0;
      const px = Math.min(CW - 1, Math.max(0, x | 0));
      const py = Math.min(CH - 1, Math.max(0, y | 0));
      const v = hairW[(py * CW + px) * 4];
      return Number.isFinite(v) ? v / 255 : 0;
    };
    bodyTex = makeTex(bodyImg);
    bodyMesh = buildBodyMesh(bodyImg);
    rig = new Rig(CFG, hairAt);
    bodyMesh.W = rig.weights(bodyMesh.rest);
    bodyMesh.out = new Float32Array(bodyMesh.rest.length);
    for (const front of fronts) front.mesh.W = rig.weights(front.mesh.rest);
    for (let k = 0; k < layerImages.length; k++) {
      const part = layered.layers[k], image = layerImages[k];
      const mesh = buildBodyMesh(image);
      mesh.hit.part = 'hair';
      mesh.W = HairMotion.isolateLockWeights(rig.weights(mesh.rest), mesh.rest, part);
      mesh.out = new Float32Array(mesh.rest.length);
      locks.push({part, mesh, tex: makeTex(image), spring: spr(0),
        bent: new Float32Array(mesh.rest.length)});
    }

    for (const id of CFG.faceOrder) {
      const f = CFG.faces[id];
      const img = await loadImage(`assets/${CHAR_KEY}-face-${id}.png`);
      faceTex[id] = makeTex(img);
      if (BLINK.textures[id]) {
        try {
          const closed = await loadImage('assets/' + BLINK.textures[id]);
          blinkTex[id] = makeTex(closed);
        } catch (error) {
          console.warn('眼部眨眼资源不可用，保留当前表情：', id, error.message);
        }
      }
      const m = buildFaceMesh(f);
      m.W = rig.weights(m.rest);
      m.out = new Float32Array(m.rest.length);
      m.hit = CharacterHit.makeLayer(m, alphaMask(img, img.naturalWidth, img.naturalHeight), img.naturalWidth, img.naturalHeight);
      m.hit.part = 'face';
      CFG.faces[id]._mesh = m;
    }
    faceMesh = CFG.faces[S.faceId]._mesh;
    curTex = faceTex[S.faceId];

    resize();
    window.__rig.ready = true;
    requestAnimationFrame(loop);
    console.log('RIG_READY', CHAR_KEY, CW, CH, 'verts', bodyMesh.rest.length / 2);
  }

  /* ---------------- 视图 ---------------- */
  let view = { s: 1, ox: 0, oy: 0 };
  function resize() {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(window.innerWidth * dpr);
    canvas.height = Math.round(window.innerHeight * dpr);
    gl.viewport(0, 0, canvas.width, canvas.height);
    // 角色高度 ≈ 窗口的 80%（和原来 17 层手偶的 278px 对齐）
    const targetH = window.innerHeight * 0.80;
    view.s = targetH / CH;
    view.ox = (window.innerWidth - CW * view.s) / 2;
    view.oy = window.innerHeight - CH * view.s - window.innerHeight * 0.01;
  }
  window.addEventListener('resize', resize);

  /* ---------------- 主循环 ---------------- */
  // 调试：?face=3711&ax=0.8&ay=-0.4 固定姿势，方便截图检查
  const Q = new URLSearchParams(location.search);
  const TEST = { face: Q.get('face'), ax: Q.get('ax'), ay: Q.get('ay'), roll: Q.get('roll'),
                 noIdle: Q.get('still') === '1', hairFixed: Q.get('hair'),
                 blinkFixed: Q.has('blink') ? Q.get('blink') === '1' : null };
  if (TEST.face && CFG.faces[Number(TEST.face)]) S.faceId = Number(TEST.face);

  const idle = IdleMotion.create();
  const dialogue = DialogueController.create({now: () => performance.now()});
  const feedback = InteractionFeedback.create({now:()=>performance.now()});
  const faceBlend = ExpressionBlend.create(S.faceId);
  let feedbackState = feedback.update(), faceLayers = faceBlend.update(performance.now()), feedbackHeld = false;
  let appliedPose = null;
  let dialogueKey = '';
  let chatFace=null;
  function interruptChat(){chatFace=null;window.pet?.cancelReply?.();}
  function syncDialogue() {
    const state = dialogue.snapshot();
    const key = `${state.id}:${state.visible}`;
    if (key === dialogueKey) return;
    dialogueKey = key;
    idle.hold('dialogue', state.visible, S.t);
    window.pet?.speechState?.(state);
  }
  function say(message) { const accepted = dialogue.show(message); syncDialogue(); return accepted; }
  function dismissDialogue(id) { dialogue.dismiss(id); syncDialogue(); }
  const touch = TouchInteraction.create({now:()=>performance.now(),onTrigger:event=>{ feedback.release(event,S.faceId); say({...event,source:'touch'}); }});
  let desktop = null;
  function hitLayers() {
    return [bodyMesh?.hit, ...locks.map(lock => lock.mesh.hit),
      fronts.find(f => f.part.name === 'fringe')?.mesh.hit,
      CFG.faces[renderedFace ?? S.faceId]?._mesh?.hit,
      ...fronts.filter(f => f.part.name !== 'fringe').map(f => f.mesh.hit)].filter(Boolean);
  }
  function hitTest(x, y) {
    if (!bodyMesh) return false;
    const layers = hitLayers();
    return CharacterHit.hit(layers, x, y, view);
  }
  function pickTest(x,y) {
    if (!bodyMesh) return null;
    return CharacterHit.pick(hitLayers(),x,y,view);
  }
  function touchPoint(e) { return e && !desktop?.isUI(e) ? pickTest(e.clientX,e.clientY) : null; }
  function touchRegion(x,y) { return TouchInteraction.regionAt(pickTest(x,y)); }
  let last = performance.now();
  function loop(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    S.t += dt;
    dialogue.update(); syncDialogue();
    if(!dialogue.snapshot().visible||dialogue.snapshot().source!=='model')chatFace=null;
    feedbackState = feedback.update();
    if(feedbackState.active !== feedbackHeld){feedbackHeld=feedbackState.active;idle.hold('feedback',feedbackHeld,S.t);}
    const targetFace = feedbackState.face ?? chatFace ?? S.faceId;
    const visualNow=performance.now();faceBlend.set(targetFace, visualNow); faceLayers = faceBlend.update(visualNow);

    // 待机：呼吸 + 极慢摆动（调试模式下可固定）
    const breath = 0.5 + 0.5 * Math.sin(S.t * 2 * Math.PI / 3.6);
    if (TEST.noIdle) { S.breath.x = 0.5; } else step(S.breath, breath, 60, 12, dt);
    if (TEST.ax != null) {
      step(S.angleX, Number(TEST.ax), 30, 10, dt);
      step(S.angleY, Number(TEST.ay || 0), 30, 10, dt);
      step(S.roll, Number(TEST.roll || 0), 40, 12, dt);
      step(S.bodyX, 0, 25, 10, dt);
    } else if (TEST.noIdle) {
      S.roll.x = S.angleX.x = S.angleY.x = S.bodyX.x = S.skirt.x = 0;
    } else {
      const target = idle.update(S.t, hopStarted != null);
      step(S.roll, target.roll, 40, 12, dt);
      step(S.angleX, target.angleX, 30, 10, dt);
      step(S.angleY, target.angleY, 30, 10, dt);
      step(S.bodyX, target.bodyX, 25, 10, dt);
    // 每条发束：跟头/身体滞后摆 + 各自的相位风（越往后的发束摆得越多）
      if (TEST.hairFixed != null) {
        (CFG.strands || []).forEach((_, k) => { S.hair[k].x = Number(TEST.hairFixed); });
      } else (CFG.strands || []).forEach((st, k) => {
        const w = (st.back ? 1.0 : 0.45) * (0.7 + 0.12 * k);
        const wind = 0;   // 单层图不再摆发束：会拉丝
        const target = 0 + wind;
        step(S.hair[k], target, 22 + k * 2, 5.5, dt);
      });
      step(S.skirt, S.bodyX.x * 1.6 + S.angleX.x * 1.2, 18, 7, dt);
    }

    if (hopStarted != null) {
      const hop = HopMotion.sampleHop(S.t - hopStarted);
      S.hop = hop.hop; S.squash = hop.squash;
      if (hop.done) hopStarted = null;
    }

    // Eyelids change on the selected expression's own mesh and alignment.
    const shown = targetFace;
    const noBlink = BLINK.noBlink.includes(shown) || !blinkTex[shown];
    BlinkClock.tick(S, !TEST.noIdle, noBlink);
    // Target expression is owned by the manual base or current interaction.
    blinkApplied = !noBlink && (TEST.blinkFixed ?? S.blinking);
    renderedFace = shown;
    const mesh = CFG.faces[shown]._mesh;
    const tex = blinkApplied ? blinkTex[shown] : faceTex[shown];

    const P = {
      angleX: S.angleX.x + feedbackState.pose.angleX, angleY: S.angleY.x + feedbackState.pose.angleY, roll: S.roll.x + feedbackState.pose.roll,
      breath: S.breath.x, bodyX: S.bodyX.x + feedbackState.pose.bodyX, bodyRoll: 0,
      headDX: 0, headDY: 0, hop: S.hop, squash: S.squash,
      // Never stretch the original single body texture. Motion belongs to locks only.
      hair: (CFG.strands || []).map(() => 0), skirt: S.skirt.x,
    };
    rig.deform(bodyMesh.rest, bodyMesh.W, P, bodyMesh.out);
    rig.deform(mesh.rest,mesh.W,P,mesh.out);
    appliedPose = {...P};
    for(const layer of faceLayers){const m=CFG.faces[layer.id]._mesh;rig.deform(m.rest,m.W,P,m.out);}
    const idleState = idle.snapshot();
    const coherentHair = fronts.length > 0 && [3,4].includes(frontConfig.version);
    const hairEnabled = !TEST.noIdle && idleState.enabled && idleState.held.length === 0 && !idleState.busy && hopStarted == null && S.t >= idleState.quietUntil;
    locks.forEach((lock, i) => {
      const forced = TEST.hairFixed == null ? null : Number(TEST.hairFixed);
      const wind = Math.sin(S.t * 1.65 + i * 1.9) * lock.part.amplitude;
      const inertia = -S.roll.v * 0.3 - S.bodyX.v * 0.007;
      if (forced != null) { lock.spring.x = Number.isFinite(forced) ? Math.max(-0.08, Math.min(0.08, forced)) : 0; lock.spring.v = 0; }
      else if (coherentHair && !hairEnabled) {
        // v3 pauses both wind and inertia; preserve the established active outer waveform.
        const k=19+i*4,n=Math.max(1,Math.ceil(dt*120)),h=dt/n;
        for(let j=0;j<n;j++)step(lock.spring,0,k,2*Math.sqrt(k),h);
        if(Math.abs(lock.spring.x)<1e-5&&Math.abs(lock.spring.v)<1e-5)lock.spring.x=lock.spring.v=0;
      }
      else if (TEST.noIdle) { lock.spring.x = lock.spring.v = 0; }
      else step(lock.spring, Math.max(-0.075, Math.min(0.075, wind + inertia)), 19 + i * 4, 5.5, dt);
      HairMotion.bendLock(lock.mesh.rest, lock.part, lock.spring.x, lock.bent);
      rig.deform(lock.bent, lock.mesh.W, P, lock.mesh.out);
    });
    const outerMotion = Object.fromEntries(locks.map(lock=>[lock.part.name,{x:lock.spring.x,amplitude:lock.part.amplitude}]));
    const frontMotion = {roll:S.roll.x,rollVelocity:S.roll.v,bodyVelocity:S.bodyX.v};
    for (const front of fronts) {
      const enabled = coherentHair ? hairEnabled : !TEST.noIdle && idleState.enabled && idleState.held.length === 0 && S.t >= idleState.quietUntil;
      const target = [3,4].includes(frontConfig.version) ? FrontHair.followTarget(front.part, outerMotion, enabled)
        : frontConfig.version === 2 ? FrontHair.motionTarget(front.part, S.t, enabled, frontMotion)
        : FrontHair.target(front.part, S.t, frontConfig.periodSeconds, enabled);
      front.targetSource = target;
      if (TEST.noIdle && !coherentHair) front.spring.x = front.spring.v = 0;
      else if ([3,4].includes(frontConfig.version)) FrontHair.advanceFollow(front.part, front.spring, dt, enabled, outerMotion, frontConfig.motionModel);
      else if (frontConfig.version === 2) FrontHair.advance(front.part, front.spring, S.t, dt, enabled, frontMotion);
      else { step(front.spring, target, 70, 18, dt); front.spring.x = Math.max(-front.part.amplitude, Math.min(front.part.amplitude, front.spring.x));
        if (!enabled && Math.abs(front.spring.x) < 1e-5 && Math.abs(front.spring.v) < 1e-5) front.spring.x = front.spring.v = 0;
      }
      // Only UVs move locally: this grid has the exact same parent transform as the receiving body.
      rig.deform(front.mesh.rest, front.mesh.W, P, front.mesh.out);
    }

    // 画
    activate(prog); drawOrder = [];
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform2f(U.u_canvas, CW, CH);
    gl.uniform2f(U.u_view, window.innerWidth, window.innerHeight);
    gl.uniform2f(U.u_origin, view.ox, view.oy);
    gl.uniform1f(U.u_scale, view.s);

    draw(bodyMesh, bodyTex, 1); drawOrder.push('body');
    for (const lock of locks) { draw(lock.mesh, lock.tex, 1); drawOrder.push('outer:' + lock.part.name); }
    const fringe = fronts.find(f => f.part.name === 'fringe');
    if (fringe) drawFront(fringe, 0);
    drawExpressions(faceLayers, TEST.blinkFixed ?? S.blinking); drawOrder.push('faces');
    if (fringe) drawFront(fringe, 1);
    for (const front of fronts) if (front !== fringe) { drawFront(front, 1); drawFront(front, 0); }
    desktop?.tick();

    requestAnimationFrame(loop);
  }

  const bufPos = gl.createBuffer(), bufUv = gl.createBuffer(), bufIdx = gl.createBuffer();
  let boundMesh = null;
  function activate(program) { if (activeProgram !== program) { gl.useProgram(program); activeProgram = program; boundMesh = null; } }
  function bindMesh(m) {
    if (boundMesh === m) return;
    boundMesh = m;
    gl.bindBuffer(gl.ARRAY_BUFFER, bufPos);
    gl.bufferData(gl.ARRAY_BUFFER, m.out, gl.DYNAMIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'a_pos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, bufUv);
    gl.bufferData(gl.ARRAY_BUFFER, m.uvs, gl.STATIC_DRAW);
    const loc2 = gl.getAttribLocation(prog, 'a_uv');
    gl.enableVertexAttribArray(loc2);
    gl.vertexAttribPointer(loc2, 2, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, bufIdx);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, m.idx, gl.STATIC_DRAW);
  }
  function draw(m, tex, alpha) {
    activate(prog);
    bindMesh(m);
    // 位置每次重传（顶点在动）
    gl.bindBuffer(gl.ARRAY_BUFFER, bufPos);
    gl.bufferData(gl.ARRAY_BUFFER, m.out, gl.DYNAMIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'a_pos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(U.u_tex, 0);
    gl.uniform1f(U.u_alpha, alpha);
    gl.drawElements(gl.TRIANGLES, m.idx.length, gl.UNSIGNED_SHORT, 0);
  }

  function drawFront(front, mode) {
    const F = frontUniforms, p = front.part, m = front.mesh;
    activate(frontProgram); bindMesh(m);
    gl.uniform2f(F.u_canvas, CW, CH); gl.uniform2f(F.u_view, window.innerWidth, window.innerHeight);
    gl.uniform2f(F.u_origin, view.ox, view.oy); gl.uniform1f(F.u_scale, view.s);
    gl.uniform2f(F.u_source, ...frontConfig.sourceCanvas); gl.uniform4f(F.u_box, ...p.sourceBox);
    gl.uniform2f(F.u_root, p.root, p.tip); gl.uniform1f(F.u_motion, front.spring.x);
    gl.uniform2f(F.u_shadowOffset, ...p.shadowOffset); gl.uniform1i(F.u_mode, mode); gl.uniform1i(F.u_isFringe, p.name === 'fringe' ? 1 : 0);
    gl.uniform2f(F.u_viewPixels, canvas.width, canvas.height);
    front.textures.forEach((tex, i) => { gl.activeTexture(gl.TEXTURE0+i); gl.bindTexture(gl.TEXTURE_2D, tex); });
    gl.uniform1i(F.u_tex, 0); gl.uniform1i(F.u_caster, 1); gl.uniform1i(F.u_receiver, 2);
    gl.activeTexture(gl.TEXTURE0+3); gl.bindTexture(gl.TEXTURE_2D, faceSurface?.tex || front.textures[0]); gl.uniform1i(F.u_face, 3);
    gl.drawElements(gl.TRIANGLES, m.idx.length, gl.UNSIGNED_SHORT, 0);
    drawOrder.push(p.name + (mode ? ':shadow' : ':hair'));
    activate(prog);
  }

  /* ---------------- Face mixture compositor ---------------- */
  let faceSurface = null;
  function ensureFaceSurface() {
    const w=canvas.width,h=canvas.height;
    if(faceSurface?.w===w && faceSurface?.h===h)return faceSurface;
    if(faceSurface){gl.deleteFramebuffer(faceSurface.fbo);gl.deleteTexture(faceSurface.tex);if(faceSurface.msaa){gl.deleteFramebuffer(faceSurface.msaa);gl.deleteRenderbuffer(faceSurface.color);}}
    const tex=gl.createTexture(),fbo=gl.createFramebuffer();
    const samples=gl.getParameter(gl.SAMPLES)||0;let msaa=null,color=null;
    gl.bindTexture(gl.TEXTURE_2D,tex);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,w,h,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    gl.bindFramebuffer(gl.FRAMEBUFFER,fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,tex,0);
    if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw Error('Face mixture framebuffer unavailable');
    if(samples>0){
      msaa=gl.createFramebuffer();color=gl.createRenderbuffer();
      gl.bindRenderbuffer(gl.RENDERBUFFER,color);
      gl.renderbufferStorageMultisample(gl.RENDERBUFFER,samples,gl.RGBA8,w,h);
      gl.bindFramebuffer(gl.FRAMEBUFFER,msaa);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.RENDERBUFFER,color);
      if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw Error('Multisample face framebuffer unavailable');
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER,null);
    faceSurface={w,h,tex,fbo,msaa,color,samples,quad:{out:new Float32Array(8),uvs:new Float32Array([0,1,1,1,1,0,0,0]),idx:new Uint16Array([0,1,2,0,2,3])}};
    return faceSurface;
  }
  function drawExpressions(layers,closed) {
    const drawFace=layer=>{
      const id=layer.id,tex=closed&&!BLINK.noBlink.includes(id)&&blinkTex[id]?blinkTex[id]:faceTex[id];
      draw(CFG.faces[id]._mesh,tex,layer.weight);
    };
    if(layers.length===1 && !fronts.length){drawFace(layers[0]);return;}
    // Accumulate premultiplied weighted faces once, then composite once over body.
    // Ordinary alpha-over for each weighted face would darken/change the mid-fade result.
    const surface=ensureFaceSurface();
    gl.bindFramebuffer(gl.FRAMEBUFFER,surface.msaa||surface.fbo);
    gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);gl.blendFunc(gl.ONE,gl.ONE);
    for(const layer of layers)drawFace(layer);
    if(surface.msaa){
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER,surface.msaa);gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER,surface.fbo);
      gl.blitFramebuffer(0,0,surface.w,surface.h,0,0,surface.w,surface.h,gl.COLOR_BUFFER_BIT,gl.NEAREST);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.blendFunc(gl.ONE,gl.ONE_MINUS_SRC_ALPHA);
    surface.quad.out.set([0,0,window.innerWidth,0,window.innerWidth,window.innerHeight,0,window.innerHeight]);
    gl.uniform2f(U.u_origin,0,0);gl.uniform1f(U.u_scale,1);
    draw(surface.quad,surface.tex,1);
    gl.uniform2f(U.u_origin,view.ox,view.oy);gl.uniform1f(U.u_scale,view.s);
  }

  /* ---------------- 交互 ---------------- */
  function setFace(id) {
    if (!CFG.faces[id]) return;
    interruptChat();input.cancel(); touch.cancel(); feedback.manual();
    idle.interrupt(S.t);
    S.faceId = id;
    BlinkClock.defer(S);
  }
  window.__rig = { S, setFace, CFG, idle, dialogue, say, dismissDialogue, touch, feedback, faceBlend, pickTest, touchRegion, hitTest, ready: false,
    diagnostics: () => ({
      feedback: feedback.update(), faceBlend: faceBlend.snapshot(performance.now()), appliedPose, touch: touch.snapshot(), dialogue: dialogue.snapshot(), idle: idle.snapshot(), desktop: desktop?.snapshot() || null,
      faceSamples: gl.getParameter(gl.SAMPLES)||0, faceSurfaceSamples: faceSurface?.samples??null, bodyHairAmplitude: 0,
      bodySource, assetFallback, blinkApplied, renderedFace,
      frontFallback, drawOrder: [...drawOrder], frontMotionModel: fronts.length ? (frontConfig.motionModel || 'legacy-sine-v1') : null,
      frontHair: fronts.map(f => ({name:f.part.name,model:frontConfig.motionModel || 'legacy-sine-v1',targetSource:f.targetSource,actualSource:f.spring.x,offsetSource:f.spring.x,amplitude:f.part.amplitude,
        rootSource:f.part.root,vertices:f.mesh.out.length/2,finite:f.mesh.out.every(Number.isFinite)})),
      hop: S.hop, squash: S.squash, hopActive: hopStarted != null,
      blinkAvailable: Object.keys(blinkTex).map(Number),
      bodyFinite: bodyMesh ? bodyMesh.out.every(Number.isFinite) : false,
      hairLayers: locks.map(lock => ({name: lock.part.name, angle: lock.spring.x,
        vertices: lock.mesh.out.length / 2, finite: lock.mesh.out.every(Number.isFinite),
        ...AlphaMesh.measureDeformation(lock.mesh)})),
      view: {...view}, viewport: [window.innerWidth, window.innerHeight]
    })
  };

  const CURATED = CFG.faceOrder.filter(id => !(CFG.skip || []).includes(id));
  let faceIdx = Math.max(0, CURATED.indexOf(S.faceId));
  function cycleFace(step = 1) {
    faceIdx = (faceIdx + step + CURATED.length) % CURATED.length;
    setFace(CURATED[faceIdx]);
    console.log('FACE', S.faceId, (CFG.labels || {})[String(S.faceId)] || '');
  }
  window.__rig.cycleFace = cycleFace;

  if (window.pet?.setInteractive) desktop = DesktopUI.create(window, document, window.pet, hitTest, () => idle.interrupt(S.t));
  const input = DesktopInput.bindDesktopInput(window, window.pet, () => cycleFace(1), {
    pointerBegin: (e,m) => { if(m.grip)touch.cancel();else if(touch.begin(e,touchPoint(e)))feedback.begin(touch.snapshot().region,S.faceId,e.pointerId); },
    pointerMove: (e,m) => { if(!m.grip){touch.move(e,touchPoint(e));feedback.move(touch.snapshot());} },
    pointerEnd: (e,m) => {const consumed=m.reason==='release'&&!m.grip ? touch.end(e,touchPoint(e)) : touch.cancel();feedback.end(m.reason);return consumed;},
    begin: () => { interruptChat();feedback.cancel(); idle.hold('input', true, S.t); desktop?.setHeld(true); },
    end: () => { idle.hold('input', false, S.t); desktop?.setHeld(false); },
    canStart: e => !desktop || desktop.isGrip(e) || (!desktop.isUI(e) && hitTest(e.clientX, e.clientY)),
    canMenu: e => !desktop || desktop.isUI(e) || hitTest(e.clientX, e.clientY),
    isDragHandle: e => !!desktop?.isGrip(e),
  });

  window.addEventListener('keydown', (e) => {
      interruptChat();idle.interrupt(S.t);
    if (desktop?.isUI(e)) return;
    const n = parseInt(e.key, 10);
    if (!isNaN(n)) {
      const order = CFG.faceOrder;
      const list = n === 0 ? order.slice(9) : order.slice(n - 1, n);
      if (list.length) setFace(list[0]);
    }
    if (e.key === ' ') { input.cancel(); touch.cancel(); feedback.manual(); BlinkClock.trigger(S, !blinkTex[S.faceId]); }
  });

  window.addEventListener('pagehide', () => { input.cancel(); touch.cancel(); feedback.cancel(); dismissDialogue(); });
  window.pet?.onChatReply?.(reply=>{
    if(!reply||typeof reply.reply!=='string'||!reply.reply.trim()||[...reply.reply].length>4000)return;
    input.cancel();touch.cancel();feedback.cancel();
    chatFace=Number.isSafeInteger(reply.face)&&CFG.faces[reply.face]?reply.face:null;
    say({text:reply.reply,source:'model'});
    if(reply.action==='blink')BlinkClock.trigger(S,!blinkTex[chatFace??S.faceId]);
    if(reply.action==='hop')doHop();
  });
  window.pet?.onAction((name) => {
    if (name === 'dialogue:preview-head') { interruptChat();say({text:TouchInteraction.LINES.head_pat,source:'preview'}); return; }
    if (name === 'dialogue:preview-chest') { interruptChat();say({text:TouchInteraction.LINES.chest_touch,source:'preview'}); return; }
    if (name === 'dialogue:clear') { input.cancel(); touch.cancel(); feedback.cancel(); dismissDialogue(); return; }
    if (name?.startsWith('dialogue:dismiss:')) { dismissDialogue(Number(name.slice('dialogue:dismiss:'.length))); return; }
    if (name === 'idle:on' || name === 'idle:off') { idle.setEnabled(name === 'idle:on', S.t); return; }
    if (name === 'idle:hold' || name === 'idle:release') { if(name==='idle:hold'){interruptChat();input.cancel();touch.cancel();feedback.cancel();} idle.hold('menu', name === 'idle:hold', S.t); return; }
    input.cancel(); touch.cancel(); feedback.manual();
    idle.interrupt(S.t);
    if (name === 'blink') { BlinkClock.trigger(S, !blinkTex[S.faceId]); return; }
    if (name === 'face-next') { cycleFace(1); return; }
    if (name && name.startsWith('face:')) {
      const id = Number(name.slice(5));
      if (CFG.faces[id]) { setFace(id); faceIdx = Math.max(0, CURATED.indexOf(id)); }
      return;
    }
    if (name === 'hop' || name === 'nod' || name === 'wiggle') { doHop(); return; }
  });

  window.pet?.ready?.();
  let hopStarted = null;
  function doHop() {
    // Do not stack jumps or reset the landing when a menu action is repeated.
    idle.interrupt(S.t);
    if (hopStarted == null) hopStarted = S.t;
  }

  boot().catch(e => {
    console.error('BOOT_FAIL', e);
    document.body.innerHTML = `<pre style="color:#900">${e.message}</pre>`;
  });
})();
