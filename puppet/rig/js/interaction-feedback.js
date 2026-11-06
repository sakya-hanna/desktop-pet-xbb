// Pure additive feedback; the caller retains ownership of its manual face.
// Call begin for each recognized gesture (including chest: it has no preview).
// release is the accepted onTrigger callback, before end('release'). Other end
// reasons, cancel and manual immediately drop the numeric face override and
// retain pose only for a 180ms fade. A new begin re-arms after cancellation.
// update/snapshot return fresh values; active includes a residual pose decay.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.InteractionFeedback = factory();
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  function zero() { return { angleX: 0, angleY: 0, roll: 0, bodyX: 0 }; }
  function create({ now = Date.now } = {}) {
    let state = null;
    let blocked = false;
    const accepted = new Set();
    function smooth(t) { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); }
    function poseAt(time) {
      const onset = smooth((time - state.startedAt) / 120);
      const from = state.fromGain || 0;
      let gain = state.region === 'chest_touch' && state.phase === 'preview'
        ? from * (1 - smooth((time - state.startedAt) / 180))
        : from + (1 - from) * onset;
      if (state.phase === 'reply') gain *= smooth((state.expiresAt - time) / 180);
      return { angleX: .06 * gain, angleY: .1 * gain, roll: .012 * gain, bodyX: .5 * gain };
    }
    function decay(time) {
      blocked = true;
      if (!state || state.phase === 'decay') return;
      state = { region: state.region, phase: 'decay', startedAt: time, pose: poseAt(time) };
    }
    function update() {
      const time = now();
      if (state && state.phase === 'reply' && time >= state.expiresAt) state = null;
      if (state && state.phase === 'preview' && time >= state.startedAt + 2500) decay(state.startedAt + 2500);
      if (state && state.phase === 'decay' && time >= state.startedAt + 180) state = null;
      if (!state) return { face: null, pose: zero(), active: false, phase: 'idle', region: null };
      if (state.phase === 'decay') {
        const gain = 1 - smooth((time - state.startedAt) / 180);
        const pose = zero();
        Object.keys(pose).forEach(key => { pose[key] = state.pose[key] * gain; });
        return { face: null, pose, active: true, phase: 'decay', region: state.region };
      }
      const face = state.region === 'head_pat' ? 3942 :
        state.phase === 'preview' ? null : time - state.releasedAt < 250 ? 3563 : 3665;
      return { face, pose: poseAt(time), active: true, phase: state.phase, region: state.region };
    }
    function begin(region, baseFace, pointerId) {
      if (!['head_pat', 'chest_touch'].includes(region)) { cancel(); return false; }
      const fromGain = update().pose.angleY / .1;
      blocked = false;
      state = { region, pointerId, startedAt: now(), phase: 'preview', fromGain };
      return true;
    }
    function cancel() { update(); decay(now()); }
    function release(event, baseFace) {
      update();
      if (blocked || !event || !['head_pat', 'chest_touch'].includes(event.type) ||
          accepted.has(event.interactionId) || (state && state.region !== event.type)) return false;
      accepted.add(event.interactionId);
      if(accepted.size>128)accepted.delete(accepted.values().next().value);
      blocked = true;
      const time = now(), fromGain=update().pose.angleY/.1;
      state = { region: event.type, phase: 'reply',
        fromGain, startedAt: time,
        releasedAt: time, expiresAt: time + (event.type === 'head_pat' ? 1100 : 1300) };
      return true;
    }
    function end(reason = 'release') {
      if (reason !== 'release' || !state || state.phase !== 'reply') cancel();
    }
    function move(snapshot) {
      if (state && (!snapshot || !snapshot.active || snapshot.canceled || snapshot.region !== state.region)) cancel();
    }
    return { begin, move, release, end, cancel, manual: cancel, update, snapshot: update };
  }
  return { create };
});
