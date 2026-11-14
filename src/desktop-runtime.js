(function(root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DesktopRuntime = api;
})(globalThis, function(root) {
  'use strict';
  const faces = new Set(['3901', '3942', '3599', '3831', '3711', '3751', '3791', '3496', '3665', '3563', '3625', '9001', '9002', '9003']);
  const motions = new Set(['hum','stretch','sneeze','peek','doze','bounce','wake','rouse','lookAround','all','stop']);

  function attach(options) {
    const {canvas, toolbar, renderer, pet, onError, onState} = options;
    const win = root.window, doc = root.document;
    const buttons = Object.fromEntries(['grip', 'smaller', 'larger', 'menu', 'hop', 'hide'].map(id => [id, toolbar.querySelector('#' + id)]));
    let engine = null, running = false, destroyed = false, destroying = false;
    let raf = null, epoch = 0, last = null, renderedFrames = 0, renderedFace = null;
    let activePointer = null, lastInputTrusted = null;
    let grabContact = null;
    let touchContact = null, pointerTap = null;
    let pointerKind = null, captureTarget = null, pointerType = null, dragPoint = null, pointerPosition = null, interactive = null;
    let wanted = false, held = false, shellHidden = false, visibilityPaused = false;
    let pendingHop = false, pendingBlink = false;
    let pendingMotion = null;
    let lastFeedback = null, feedbackSequence = 0;
    let chatPresentation = null, chatHighWater = 0;
    function currentChat() {
      if (chatPresentation && engine && engine.snapshot().time >= chatPresentation.until) chatPresentation = null;
      return chatPresentation;
    }
    function presentChat(value) {
      if (!value || typeof value !== 'object' || Array.isArray(value) || !Number.isSafeInteger(value.id) || value.id <= chatHighWater) return;
      const clear = value.clear === true;
      if (clear ? Object.keys(value).some(k => !['id','clear'].includes(k))
        : Object.keys(value).some(k => !['id','reply','face','action'].includes(k))
          || typeof value.reply !== 'string' || !value.reply.trim() || [...value.reply].length > 4000
          || !(value.face === null || Number.isInteger(value.face)) || !['none','blink','hop'].includes(value.action)) return;
      chatHighWater = value.id;
      if (clear) {
        if (chatPresentation) {chatPresentation = null; if (engine) render();}
        return;
      }
      // Consume dropped replies; they cannot reappear after a later resume.
      if (!inputEnabled() || activePointer !== null || held || shellHidden || visibilityPaused) return;
      engine.clearFeedback();
      engine.setIdleBlocked(true);
      const durationMs = Math.min(15000, Math.max(3400, 1800 + Math.min([...value.reply].length,180)*70));
      chatPresentation = {id: value.id, text: value.reply, face: faces.has(String(value.face)) ? String(value.face) : null,
        kind: 'chat', durationMs, until: engine.snapshot().time + durationMs/1000};
      if (value.action === 'hop') engine.send({type:'jump'});
      if (value.action === 'blink') engine.send({type:'blink'});
      render(); notify();
    }
    // The existing director clock drives face interpolation; no extra RAF or
    // timer owns expression state. Re-target from the currently visible mix.
    let faceMix = [], faceFrom = [], faceTarget = null, faceStarted = 0, expressionVisible = false;
    let manualExpressionId = null;
    function updateFace(state, immediate = false) {
      const chat = currentChat();
      // A selection overrides the response already playing, not every future
      // interaction. New responses play, then return to the selected face.
      const newerInteraction = state.expression && state.expression.id !== manualExpressionId;
      const manualVisible = manualFace !== 'auto' && !newerInteraction;
      const target = manualVisible ? manualFace : (chat?.face ?? state.expression?.face ?? state.face);
      if (immediate || faceTarget === null) {
        faceMix = [{face: target, weight: 1}]; faceFrom = faceMix; faceTarget = target; faceStarted = state.time;
      } else {
        if (target !== faceTarget) {faceFrom = faceMix.map(p => ({...p})); faceTarget = target; faceStarted = state.time;}
        const t = Math.max(0, Math.min(1, (state.time - faceStarted) / 0.18)), eased = t*t*(3-2*t);
        const weights = new Map(faceFrom.map(p => [p.face, p.weight*(1-eased)]));
        weights.set(target, (weights.get(target)||0)+eased);
        faceMix = [...weights].filter(([,weight]) => weight > 0).map(([face,weight]) => ({face,weight}));
      }
      expressionVisible = !manualVisible && !!(chat?.face || state.expression);
      return target;
    }
    let idleEnabled = true, manualFace = 'auto', initialized = false, revision = 0, shellState = {};
    const listeners = [], subscriptions = [], errors = [], cancelReasons = [];

    function listen(target, type, fn, settings = false) {
      const guarded = event => {
        if (destroyed) return;
        try {fn(event);} catch (error) {cancel('input-error'); report(error);}
      };
      target.addEventListener(type, guarded, settings);
      listeners.push(() => target.removeEventListener(type, guarded, settings));
    }
    function report(error) {
      if (destroyed) return;
      errors.push(String((error && error.message) || error));
      if (errors.length > 60) errors.shift();
      if (onError) {try {onError(error);} catch (ignored) { /* Diagnostics must not spawn an unhandled rejection. */ }}
    }
    function notify() {
      if (!destroyed && onState) {try {onState(status());} catch (error) {report(error);}}
    }
    function invoke(name, args = [], accept) {
      if (destroyed) return;
      try {
        const value = pet[name](...args);
        if (value && typeof value.then === 'function') {
          Promise.resolve(value).then(result => {if (!destroyed && accept) accept(result);}).catch(report);
        } else if (accept) accept(value);
      } catch (error) {report(error);}
    }
    function subscribe(name, callback) {
      try {
        const result = pet[name](value => {if (!destroyed) callback(value);});
        const install = remove => {
          if (typeof remove !== 'function') return;
          if (destroyed) remove(); else subscriptions.push(remove);
        };
        if (result && typeof result.then === 'function') Promise.resolve(result).then(install).catch(report);
        else install(result);
      } catch (error) {report(error);}
    }
    function initialize() {
      if (initialized || destroyed) return;
      initialized = true;
      invoke('ready');
      const version = revision;
      invoke('getState', [], state => {if (version === revision) applyState(state);});
    }
    function local(event) {
      const r = canvas.getBoundingClientRect();
      const x = event.clientX - r.x, y = event.clientY - r.y;
      if (![r.x, r.y, r.width, r.height, event.clientX, event.clientY].every(Number.isFinite) || r.width <= 0 || r.height <= 0) return null;
      return {x, y, r, inside: x >= 0 && y >= 0 && x <= r.width && y <= r.height};
    }
    function normalizedX(point) {
      const binding = root.CharacterBinding.binding;
      const camera = root.PreviewView.cameraFor(point.r.width, point.r.height, false, binding);
      return (camera.x + point.x / point.r.width * camera.w) / binding.width;
    }
    function normalizedY(point) {
      const binding = root.CharacterBinding.binding;
      const camera = root.PreviewView.cameraFor(point.r.width, point.r.height, false, binding);
      return (camera.y + point.y / point.r.height * camera.h) / binding.height;
    }
    function ownsCapturedGrab() {
      return activePointer !== null && pointerKind === 'grab' && grabContact !== null
        && captureTarget === canvas && canvas.hasPointerCapture(activePointer);
    }
    function grabPoint(point) {
      // The renderer's drawable viewport excludes its right/bottom edges.
      // Clamp CSS input just inside them; the director keeps its original
      // material-space deformation limits. Never clamp a new/pending contact.
      const r = point.r;
      return [r.x + Math.max(0, Math.min(point.x, r.width - Math.min(0.5, r.width / 2))),
        r.y + Math.max(0, Math.min(point.y, r.height - Math.min(0.5, r.height / 2)))];
    }
    function leave(event, reason) {
      // Once released, leaving only changes hover ownership. Chieri keeps the
      // release springs and response alive; clearing them here snaps the rig.
      if (activePointer === null) {
        pointerPosition = null; updateInteractive(); return;
      }
      if (activePointer !== null && event.pointerId !== undefined && event.pointerId !== activePointer) return;
      if (ownsCapturedDrag()) {
        if ((event.buttons & 1) === 0) {cancel('primary-button-lost'); return;}
        pointerPosition=null;updateInteractive();return;
      }
      if (ownsCapturedGrab()) {
        if (!checkGrabViewport()) return;
        if ((event.buttons & 1) === 0) {cancel('primary-button-lost'); return;}
        if (!local(event)) {cancel('outside-canvas'); return;}
        // Boundary notifications are not capture loss or a button release.
        pointerPosition = null; updateInteractive(); return;
      }
      cancel(reason);
    }
    function release(id, target) {
      if (id === null) return;
      try {if (target && target.hasPointerCapture(id)) target.releasePointerCapture(id);} catch (error) {report(error);}
    }
    function clearPointer() {
      const id = activePointer, target = captureTarget;
      activePointer = null; pointerKind = null; captureTarget = null; dragPoint = null; pointerType = null; grabContact = null; touchContact = null; pointerTap = null;
      release(id, target);
    }
    function cancel(reason, {contactOnly = false} = {}) {
      const generation = epoch;
      if (destroyed) return false;
      // Global/lifecycle callers also own released recoil. Pointer-event callers
      // must pass their ownership gate before reaching this control path.
      const clearedFace=!contactOnly && !!engine && (!!engine.snapshot().expression || expressionVisible || faceMix.length>1);
      const clearedIdle=!contactOnly&&engine&&(activePointer!==null||!['pointer-leave','window-leave','window-pointer-leave','window-out'].includes(reason))?engine.cancelIdleAction():false;
      if (!contactOnly) {chatPresentation = null; engine?.clearFeedback();}
      const clearedGrab=engine?engine.cancelGrab():false;
      syncFeedback();
      if (activePointer !== null && ['head','chest'].includes(pointerKind) && engine) engine.send({type: 'cancel', pointerId: activePointer, reason});
      clearPointer(); // Clear ownership before release delivers lostpointercapture.
      if (destroyed || generation !== epoch) return false;
      // Stop/hide/destroy have no next RAF. Restore only the local limb now,
      // preserving the current parent pose/manual face; never start another loop.
      if(engine&&!contactOnly) updateFace(engine.snapshot(),true);
      if((clearedGrab||clearedFace||clearedIdle)&&reason!=='render-error'){
        const state=engine.snapshot(),face=updateFace(state,!contactOnly);
        try{renderer.render(state.pose,face,false,state.blink,false,faceMix);}catch(error){failRender(error);return false;}
        if (destroyed || generation !== epoch) return false;
        renderedFace=face;renderedFrames++;
      }
      pointerPosition = null;
      cancelReasons.push(reason);
      if (cancelReasons.length > 60) cancelReasons.shift();
      updateInteractive();
      return !destroyed && generation === epoch;
    }
    function inputEnabled() {return running && !destroyed && shellState.clickThrough !== true;}
    function checkGrabViewport(){
      if(!grabContact)return true;
      const frame=renderer.frameState();
      if(!frame||frame.viewportId!==grabContact.hit.viewportId){cancel('grab-viewport-changed');return false;}
      return true;
    }
    function onToolbar(event) {
      return !toolbar.hidden && (toolbar.contains(event.target) || toolbar.contains(doc.elementFromPoint(event.clientX, event.clientY)));
    }
    function ownsCapturedDrag() {
      return pointerKind==='drag' && activePointer!==null && captureTarget?.hasPointerCapture(activePointer);
    }
    function updateGrabTarget(){
      if(pointerKind!=='grab'||!grabContact||!checkGrabViewport())return;
      const hit=grabContact.hit,p=grabContact.pointer,frame=renderer.frameState();
      const mapped=renderer.clientToMaterial(p[0],p[1],frame,hit);
      if(!mapped||!(hit.influence>0.05)){cancel('stale-grab-frame');return;}
      engine.send({type:'grab-move',pointerId:activePointer,x:(mapped.point[0]-hit.materialPoint[0])/hit.influence,y:(mapped.point[1]-hit.materialPoint[1])/hit.influence});
    }
    function remember(event) {
      const point = local(event);
      pointerPosition = point && point.inside ? {clientX: event.clientX, clientY: event.clientY, screenX: event.screenX, screenY: event.screenY} : null;
      updateInteractive();
    }
    function validChestPoint(event) {
      return touchContact && Math.hypot(event.clientX-touchContact[0],event.clientY-touchContact[1])<=4
        && renderer.hitPart(event.clientX,event.clientY)?.partId==='chest';
    }
    function updateInteractive() {
      let next = false;
      if (inputEnabled()) {
        if (activePointer !== null) next = true;
        else if (pointerPosition) {
          // A frameless native window may resize/move without a new mousemove.
          // Screen coordinates and window.screenX/Y are both DOM CSS units.
          if ([pointerPosition.screenX, pointerPosition.screenY, win.screenX, win.screenY].every(Number.isFinite)) {
            pointerPosition.clientX = pointerPosition.screenX - win.screenX;
            pointerPosition.clientY = pointerPosition.screenY - win.screenY;
          }
          const point = local(pointerPosition);
          if (point && point.inside) {
            try {next = onToolbar(pointerPosition) || !!renderer.hitOpaque(pointerPosition.clientX, pointerPosition.clientY);}
            catch (error) {report(error);}
          }
        }
      }
      if (interactive !== next) {interactive = next; invoke('setInteractive', [next]);}
    }
    function capture(event, target, kind) {
      engine.setIdleBlocked(true);
      activePointer = event.pointerId; pointerKind = kind; captureTarget = target;
      pointerTap = {x:event.clientX,y:event.clientY,time:engine.snapshot().time};
      pointerType = event.pointerType || 'mouse'; lastInputTrusted = event.isTrusted === true;
      try {target.setPointerCapture(event.pointerId);if(!target.hasPointerCapture(event.pointerId))throw Error('Pointer capture was not acquired');} catch (error) {cancel('capture-failed'); report(error); return false;}
      remember(event); return true;
    }
    function validDown(event) {
      return inputEnabled() && activePointer === null && event.button === 0 && (event.buttons & 1) !== 0
        && Number.isSafeInteger(event.pointerId) && event.pointerId >= 0;
    }
    function copyShell(state) {
      const copy = {...state};
      if (state.bounds && typeof state.bounds === 'object') copy.bounds = {...state.bounds};
      return copy;
    }

    function status() {
      return {running, destroyed, renderedFrames, renderedFace, motion: engine ? engine.snapshot() : null,
        activePointer, pointerKind, dragging: pointerKind === 'drag', interactive, pointerPosition: pointerPosition ? {...pointerPosition} : null,
        lastInputTrusted, errors: errors.slice(), cancelReasons: cancelReasons.slice(),
        chatPresentation: currentChat() ? {...chatPresentation} : null,
        wantedRunning: wanted, held, pendingHop, shellHidden, visibilityPaused, idleEnabled, manualFace, shell: copyShell(shellState)};
    }
    function failRender(error) {
      wanted = false; halt('render-error'); report(error);
    }
    function syncFeedback() {
      const next = currentChat() || engine?.snapshot().feedback || null;
      if (next?.id === lastFeedback?.id && next?.text === lastFeedback?.text && next?.kind === lastFeedback?.kind) return;
      lastFeedback = next;
      // Transport ids belong to this runtime, not a director that idle toggles
      // may replace. The main process deduplicates these monotonic identities.
      if (typeof pet.feedback === 'function') invoke('feedback', [next ? {id: ++feedbackSequence, text: next.text, ...(next.kind === 'chat' ? {kind:'chat'} : {}), ...(next.durationMs !== undefined ? {durationMs: next.durationMs} : {})} : null]);
    }
    function render(immediateFace = false) {
      // Paused face controls may draw, but a cancelled lifecycle may not.
      const generation = epoch;
      if (destroyed) return;
      try {
        checkGrabViewport();
        if (destroyed || generation !== epoch) return;
        const state = engine.snapshot(), face = updateFace(state, immediateFace);
        renderer.render(state.pose, face, false, state.blink, false, faceMix);
        syncFeedback();
        renderedFace = face; renderedFrames++; updateInteractive();
      } catch (error) {failRender(error);}
    }
    function schedule() {
      if (!running || raf !== null) return;
      const generation = epoch;
      raf = root.requestAnimationFrame(now => {
        if (!running || destroyed || generation !== epoch) return;
        raf = null;
        const dt = last === null ? 0 : Math.max(0, (now - last) / 1000);
        last = now;
        try {
          // Frame timing does not revoke a native captured stroke/grab.
          // Pointer-up/lost-capture/blur remain the contact's end signals;
          // Uncaptured contacts still clear. Released motion has no input owner
          // to lose: advance it with the director's existing bounded timestep.
          const headCaptured=pointerKind==='head'&&activePointer!==null&&canvas.hasPointerCapture(activePointer);
          const grabCaptured=(pointerKind==='grab'||pointerKind==='grab-pending')&&activePointer!==null&&canvas.hasPointerCapture(activePointer);
          if (dt > 0.25 && activePointer !== null && !headCaptured && !grabCaptured && !ownsCapturedDrag()) cancel('long-frame', {contactOnly: true});
          if (!running || destroyed || generation !== epoch) return;
          updateGrabTarget();
          if (!running || destroyed || generation !== epoch) return;
          engine.setIdleBlocked(activePointer!==null||!!currentChat());
          engine.advance(dt,{headCaptured,grabCaptured});
          render();
          if (!destroyed && generation === epoch) schedule();
        } catch (error) {wanted = false; halt('frame-error'); report(error);}
      });
    }
    function resume() {
      if (destroyed || destroying || running || !wanted || held || shellHidden || visibilityPaused) return;
      if (!engine) engine = root.MotionDirector.createDirector({idle: idleEnabled, seed: 17, idleAction:'qianhuili', responseConfig: options.responseConfig});
      running = true; last = null;
      if (pendingHop) {pendingHop = false; if (inputEnabled()) engine.send({type: 'jump'});}
      if (pendingBlink) {pendingBlink = false; if (inputEnabled()) engine.send({type: 'blink'});}
      if (pendingMotion) {const name=pendingMotion;pendingMotion=null;if(inputEnabled())startMotion(name);}
      const generation = epoch;
      render();
      if (!destroyed && generation === epoch) schedule();
    }
    function start() {
      if (destroyed || destroying) return status();
      wanted = true; resume(); initialize(); notify();
      return status();
    }
    function halt(reason) {
      running = false; epoch++; last = null;
      if (reason !== 'idle-hold') {pendingHop = false; pendingBlink = false; pendingMotion = null;}
      if (raf !== null) root.cancelAnimationFrame(raf);
      raf = null;
      cancel(reason);
    }
    function stop() {
      wanted = false; halt('runtime-stopped'); notify();
      return status();
    }
    function destroy() {
      if (destroyed || destroying) return;
      // Do not publish an intermediate stopped state that an observer could restart.
      destroying = true;
      wanted = false; halt('runtime-destroyed'); destroyed = true;
      for (const remove of listeners.splice(0)) remove();
      for (const remove of subscriptions.splice(0)) {try {remove();} catch (error) { /* Already destroyed. */ }}
    }
    function setIdle(enabled) {
      if (enabled === idleEnabled) return;
      const generation = epoch;
      cancel('idle-changed');
      if (destroyed || generation !== epoch) return;
      idleEnabled = enabled; last = null;
      if (engine) {
        if (!engine.setAutomatic?.(idleEnabled)) engine = root.MotionDirector.createDirector({idle: idleEnabled, seed: 17, idleAction:'qianhuili', responseConfig: options.responseConfig});
        render();
      }
    }
    function applyState(state) {
      if (!state || typeof state !== 'object' || Array.isArray(state)) return;
      const generation = epoch;
      revision++;
      if(grabContact&&state.bounds&&['width','height'].some(k=>Number.isFinite(state.bounds[k])&&state.bounds[k]!==shellState.bounds?.[k]))cancel('grab-shell-resize');
      if (destroyed || generation !== epoch) return;
      // Keep the shell state separate from motion; no second animation owner.
      shellState = copyShell({...shellState, ...state});
      if (state.clickThrough === true) cancel('explicit-click-through');
      if (destroyed || generation !== epoch) return;
      if (typeof state.idleEnabled === 'boolean') setIdle(state.idleEnabled);
      if (destroyed || generation !== epoch) return;
      if (shellState.mode === 'hidden') {
        // Native visible=false is the isolation policy, not an app hide action.
        visibilityPaused = false; resume();
      } else if (typeof state.visible === 'boolean') {
        shellHidden = !state.visible;
        if (shellHidden) halt('shell-hidden'); else resume();
      }
      updateInteractive(); notify();
    }
    function startMotion(name) {
      if(!engine||activePointer!==null||currentChat())return false;
      engine.setIdleBlocked(false);
      if(name==='stop'){engine.cancelIdleAction();return true;}
      return name==='all'?engine.playAll():engine.playAction(name);
    }
    function action(name) {
      if (typeof name !== 'string') return;
      if (name==='toolbar:toggle') {
        cancel('toolbar-toggle');toolbar.hidden=!toolbar.hidden;updateInteractive();notify();return;
      }
      if(name.startsWith('motion:')&&motions.has(name.slice(7))){
        if(activePointer!==null||shellHidden||visibilityPaused||shellState.clickThrough===true)return;
        invoke('command',['chat-cancel']);chatPresentation=null;
        if(wanted&&held)pendingMotion=name.slice(7);
        else if(inputEnabled()){startMotion(name.slice(7));render();}
        notify();return;
      }
      if (name === 'face-next') {
        const order=[...faces],current=manualFace==='auto'?renderedFace:manualFace;
        name='face:'+order[(order.indexOf(current)+1)%order.length];
      }
      if (name === 'face:auto' || (name.startsWith('face:') && faces.has(name.slice(5)))) {
        invoke('command',['chat-cancel']);
        revision++; manualFace = name.slice(5);
        manualExpressionId = engine?.snapshot().expression?.id ?? null;
        if (engine) render(manualFace !== 'auto');
      } else if (name === 'idle:on' || name === 'idle:off') {
        revision++; setIdle(name === 'idle:on');
      } else if (name === 'idle:hold') {
        revision++; held = true; halt('idle-hold');
      } else if (name === 'idle:release') {
        revision++; held = false; resume();
      } else if (name === 'shell:hide') {
        revision++; shellHidden = true; halt('shell-hidden');
      } else if (name === 'shell:show') {
        revision++; shellHidden = false; resume();
      } else if (name === 'shell:cancel') {
        // Main may reset its interactive flag for a rescue/show transition.
        // Reassert false even if our previous local value was already false.
        revision++; interactive = null; pendingHop = false; pendingBlink = false;
        if (!cancel('shell-cancel')) return;
        last = null;
      } else if (name === 'blink') {
        invoke('command',['chat-cancel']);
        if (inputEnabled() && activePointer === null) engine.send({type:'blink'});
        else if (wanted && held && !shellHidden && !visibilityPaused && shellState.clickThrough !== true) pendingBlink=true;
      } else if (name === 'hop') {
        if (inputEnabled() && activePointer === null) engine.send({type: 'jump'});
        else if (wanted && held && !shellHidden && !visibilityPaused && shellState.clickThrough !== true) pendingHop = true;
      } else return;
      notify();
    }

    listen(canvas, 'pointerdown', event => {
      if (!validDown(event) || onToolbar(event)) return;
      const point = local(event);
      if (!point || !point.inside) return;
      if (event.ctrlKey && !event.altKey && !event.metaKey) {
        if (!renderer.hitOpaque(event.clientX,event.clientY)) return;
        if (!event.shiftKey && ![event.screenX,event.screenY].every(Number.isFinite)) return;
        if (capture(event,canvas,event.shiftKey?'hide-shortcut':'drag')) {
          if (!event.shiftKey) dragPoint={x:event.screenX,y:event.screenY};
          event.preventDefault();
        }
        return;
      }
      const hit = renderer.hitPart ? renderer.hitPart(event.clientX, event.clientY) : null;
      if (['arm-screen-left','arm-screen-right','skirt-front','skirt-right'].includes(hit?.partId) && Object.hasOwn(root.CharacterBinding.grabs,hit.partId)) {
        const mapped = renderer.clientToMaterial(event.clientX,event.clientY,hit);
        if (!mapped || !engine.send({type:'grab-down',pointerId:event.pointerId,partId:hit.partId,materialPoint:hit.materialPoint})) return;
        chatPresentation=null;invoke('command',['chat-cancel']);
        grabContact={hit,css:[event.clientX,event.clientY],pointer:[event.clientX,event.clientY]};
        if (!capture(event,canvas,'grab-pending')) return;
        syncFeedback();
        event.preventDefault();return;
      }
      if (renderer.hitPart ? !['head','chest'].includes(hit?.partId) : !renderer.hitTest(event.clientX,event.clientY)) {
        if (!hit || hit.partId !== null || !renderer.hitOpaque(event.clientX,event.clientY)) return;
        chatPresentation=null;engine.clearFeedback();invoke('command',['chat-cancel']);
        if(capture(event,canvas,'face')){syncFeedback();event.preventDefault();}return;
      }
      const kind=hit?.partId||'head';
      if (!engine.send({type: 'down', partId: kind, pointerId: event.pointerId, x: normalizedX(point), y: normalizedY(point)})) return;
      chatPresentation=null;invoke('command',['chat-cancel']);
      touchContact=[event.clientX,event.clientY];
      if (!capture(event, canvas, kind)) return;
      syncFeedback();
      event.preventDefault();
    });
    listen(win, 'pointermove', event => {
      if (!inputEnabled()) return;
      if (activePointer === null) {remember(event); return;}
      if (activePointer !== event.pointerId) return;
      if(pointerTap&&Math.hypot(event.clientX-pointerTap.x,event.clientY-pointerTap.y)>4)pointerTap=null;
      if (!checkGrabViewport()) return;
      if ((event.buttons & 1) === 0) {cancel('primary-button-lost'); return;}
      if (pointerKind === 'drag') {
        if (![event.screenX, event.screenY].every(Number.isFinite)) {cancel('invalid-drag-point'); return;}
        const dx = event.screenX - dragPoint.x, dy = event.screenY - dragPoint.y;
        dragPoint = {x: event.screenX, y: event.screenY};
        if (!Number.isFinite(dx) || !Number.isFinite(dy)) {cancel('invalid-drag-point'); return;}
        lastInputTrusted = event.isTrusted === true;
        if (dx || dy) invoke('drag', [dx, dy]);
        remember(event); return;
      }
      const point = local(event);
      const capturedGrab = ownsCapturedGrab();
      if (!point || (!point.inside && !capturedGrab)) {cancel('outside-canvas'); return;}
      lastInputTrusted = event.isTrusted === true;
      if (pointerKind === 'grab-pending' || pointerKind === 'grab') {
        const config=root.CharacterBinding.grabs[grabContact.hit.partId];
        if (pointerKind === 'grab-pending' && Math.hypot(event.clientX-grabContact.css[0],event.clientY-grabContact.css[1])<=config.thresholdCss) {remember(event);return;}
        const generation = epoch;
        pointerKind='grab';grabContact.pointer=capturedGrab?grabPoint(point):[event.clientX,event.clientY];updateGrabTarget();
        if (destroyed || generation !== epoch) return;
        syncFeedback();
        remember(event);return;
      }
      if (pointerKind === 'chest' && !validChestPoint(event)) {cancel('chest-moved');return;}
      if (pointerKind === 'face' && !pointerTap) {cancel('face-moved');return;}
      if (pointerKind === 'head') engine.send({type: 'move', pointerId: event.pointerId, x: normalizedX(point), y: normalizedY(point)});
      remember(event);
    });
    listen(win, 'pointerup', event => {
      if (!running || activePointer === null || activePointer !== event.pointerId) return;
      if (!checkGrabViewport()) return;
      const point = local(event);
      if (!point || (!point.inside && !ownsCapturedGrab() && !ownsCapturedDrag())) {cancel('released-outside'); return;}
      if (event.button !== 0) {if ((event.buttons & 1) === 0) cancel('primary-button-lost'); return;}
      lastInputTrusted = event.isTrusted === true;
      if (pointerKind === 'chest' && !validChestPoint(event)) {cancel('chest-release-outside');return;}
      // Head/hand/skirt contacts belong to interaction, even below the drag
      // threshold. Only unassigned body clicks are an explicit face cycle.
      const cycle=pointerTap&&pointerKind==='face'
        &&engine.snapshot().time-pointerTap.time<=0.35&&Math.hypot(event.clientX-pointerTap.x,event.clientY-pointerTap.y)<=4;
      if (pointerKind === 'head' || pointerKind === 'chest') engine.send({type: 'up', pointerId: activePointer});
      if (pointerKind === 'grab' || pointerKind === 'grab-pending') engine.send({type:'grab-up',pointerId:activePointer});
      syncFeedback();
      clearPointer(); remember(event);
      if(cycle)action('face-next');
    });
    listen(canvas,'dblclick',event=>{
      if (!inputEnabled() || event.button!==0 || !event.ctrlKey || !event.shiftKey || event.altKey || event.metaKey) return;
      const point=local(event);
      if (!point?.inside || onToolbar(event) || !renderer.hitOpaque(event.clientX,event.clientY)) return;
      event.preventDefault();cancel('hide-shortcut');invoke('command',['hide']);
    });
    listen(canvas,'contextmenu',event=>{
      if (!inputEnabled()) return;
      const point=local(event);
      if (!point?.inside || onToolbar(event) || !renderer.hitOpaque(event.clientX,event.clientY)) return;
      event.preventDefault();cancel('context-menu');invoke('menu',[{x:point.x,y:point.y}]);
    });
    for (const [type, reason] of [['pointercancel', 'pointer-cancel'], ['lostpointercapture', 'lost-capture']]) {
      listen(win, type, event => {if (activePointer !== null && activePointer === event.pointerId) cancel(reason);});
    }
    for (const target of [canvas, toolbar, ...Object.values(buttons)]) {
      listen(target, 'pointerleave', event => {if (activePointer !== null && activePointer === event.pointerId) leave(event, 'pointer-leave');});
    }
    listen(win, 'mousemove', event => {
      if (activePointer !== null && pointerType === 'mouse' && (event.buttons & 1) === 0) {cancel('primary-button-lost'); return;}
      remember(event);
    });
    listen(win, 'mouseleave', event => leave(event, 'window-leave'));
    listen(win, 'pointerleave', event => {
      if (event.target === win && (activePointer === null || event.pointerId === activePointer)) leave(event, 'window-pointer-leave');
    });
    listen(win, 'mouseout', event => {if (event.relatedTarget == null) leave(event, 'window-out');});
    for (const target of [toolbar, ...Object.values(buttons)]) {
      listen(target, 'pointerenter', remember);
    }
    for (const [id, button] of Object.entries(buttons)) {
      listen(button, 'pointerdown', event => {
        if (!validDown(event)) return;
        const point = local(event);
        if (!point || !point.inside) return;
        if (id === 'grip' && ![event.screenX, event.screenY].every(Number.isFinite)) return;
        if (!capture(event, button, id === 'grip' ? 'drag' : 'button')) return;
        if (id === 'grip') {dragPoint = {x: event.screenX, y: event.screenY}; event.preventDefault();}
      });
    }
    function buttonClick(id, fn) {
      listen(buttons[id], 'click', event => {
        if (!inputEnabled() || (event.button !== undefined && event.button !== 0)) return;
        if(id==='hop'&&grabContact)return;
        const generation = epoch;
        cancel('toolbar-click');
        if (destroyed || generation !== epoch) return;
        lastInputTrusted = event.isTrusted === true;
        fn(event);
      });
    }
    buttonClick('hop', () => action('hop'));
    buttonClick('hide', () => invoke('command', ['hide']));
    buttonClick('menu', event => {
      const point = local(event), r = toolbar.getBoundingClientRect(), c = canvas.getBoundingClientRect();
      invoke('menu', [point && point.inside ? {x: point.x, y: point.y} : {x: r.x + r.width / 2 - c.x, y: r.y + r.height - c.y}]);
    });
    for (const [id, factor] of [['smaller', 1 / 1.05], ['larger', 1.05]]) {
      buttonClick(id, event => {
        remember(event);
        invoke('resizeBy', [factor, {x: 0.5, y: 0}]);
        updateInteractive();
      });
      if (!buttons[id].title.includes('Ctrl+滚轮')) buttons[id].title += '（缩放：Ctrl+滚轮）';
    }
    toolbar.title='Ctrl+拖动搬动；Ctrl+滚轮缩放；Ctrl+Shift+双击隐藏；右键菜单收起功能栏';
    listen(win, 'wheel', event => {
      if (event.ctrlKey !== true) return; // Never capture ordinary page/desktop scrolling.
      // A held drag/stroke must neither resize the pet nor zoom the page.
      if (activePointer !== null) {event.preventDefault(); return;}
      if (!inputEnabled() || event.altKey || event.metaKey || event.shiftKey
          || (event.buttons !== undefined && event.buttons !== 0)
          || !Number.isFinite(event.deltaY) || event.deltaY === 0) return;
      const mode = event.deltaMode === undefined ? 0 : event.deltaMode;
      if (![0, 1, 2].includes(mode)) return;
      const point = local(event);
      if (!point || !point.inside) return;
      const unit = mode === 1 ? 16 : mode === 2 ? point.r.height : 1;
      const delta = -event.deltaY * unit;
      if (!Number.isFinite(delta)) return;
      const bar = onToolbar(event);
      if (!bar && !renderer.hitOpaque(event.clientX, event.clientY)) return;
      event.preventDefault(); lastInputTrusted = event.isTrusted === true;
      const factor = Math.max(0.8, Math.min(1.25, Math.exp(Math.max(-1000, Math.min(1000, delta)) * 0.0012)));
      const anchor = bar ? {x: 0.5, y: 0} : {x: point.x / point.r.width, y: point.y / point.r.height};
      remember(event); invoke('resizeBy', [factor, anchor]); updateInteractive();
    }, {passive: false});
    listen(win,'keydown',event=>{
      if(!inputEnabled()||activePointer!==null||event.repeat||event.isComposing||event.ctrlKey||event.altKey||event.metaKey||event.shiftKey
        ||event.target?.isContentEditable||['INPUT','TEXTAREA','SELECT','BUTTON'].includes(event.target?.tagName)||toolbar.contains(event.target))return;
      if(event.key===' '){event.preventDefault();action('blink');}
      else if(/^[0-9]$/.test(event.key)){const face=[...faces][event.key==='0'?9:Number(event.key)-1];if(face){event.preventDefault();action('face:'+face);}}
    });
    listen(win, 'blur', () => cancel('window-blur'));
    listen(win, 'resize', checkGrabViewport);
    listen(doc, 'visibilitychange', () => {
      // Do not read document.hidden as an initial start gate: offscreen windows
      // still require a first framebuffer. Only actual transitions pause here.
      const generation = epoch;
      cancel('document-visibility');
      if (destroyed || generation !== epoch) return;
      visibilityPaused = doc.hidden === true && shellState.mode !== 'hidden';
      if (visibilityPaused) halt('document-hidden'); else resume();
      notify();
    });
    subscribe('onAction', action);
    subscribe('onState', applyState);
    if (typeof pet.onCursor === 'function') subscribe('onCursor', point => {
      // Polling only restores hover/alpha ownership. Real button events still
      // own all gestures, and a captured drag must not be changed by polling.
      if (activePointer !== null || !point || ![point.x,point.y].every(Number.isFinite)) return;
      pointerPosition={clientX:point.x,clientY:point.y};
      updateInteractive();
    });
    if (typeof pet.onChatPresentation === 'function') subscribe('onChatPresentation', presentChat);
    updateInteractive();
    return {start, stop, status, destroy};
  }
  return {attach};
});
