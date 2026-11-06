// Pure dialogue state: callers drive expiry by calling update() in their render loop.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DialogueController = factory();
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  function hidden() {
    return { id: null, text: '', source: '', visible: false, expiresAt: null };
  }

  function create({ now = Date.now } = {}) {
    const seen = new Set();
    let sequence = 0;
    let state = hidden();

    function clear() {
      state = hidden();
      return true;
    }

    return {
      show(input) {
        if (!input || typeof input !== 'object' || Array.isArray(input)) return false;
        const { text, source = 'local', interactionId } = input;
        if (typeof text !== 'string' || !text.trim()) return false;
        if (typeof source !== 'string' || !source.trim()) return false;
        if (interactionId !== undefined && typeof interactionId !== 'string' &&
            !(typeof interactionId === 'number' && Number.isFinite(interactionId))) return false;
        if (interactionId !== undefined) {
          if (seen.has(interactionId)) return false;
          seen.add(interactionId);
          if (seen.size > 128) seen.delete(seen.values().next().value);
        }
        // Count and truncate code points, not UTF-16 units (never split an emoji pair).
        const points = Array.from(text).slice(0, 4000);
        const duration = Math.max(6000, Math.min(20000, points.length * 120));
        state = { id: ++sequence, text: points.join(''), source, visible: true, expiresAt: now() + duration };
        return true;
      },
      dismiss(id) {
        if (!state.visible || (id !== undefined && id !== state.id)) return false;
        return clear();
      },
      update() {
        if (!state.visible || now() < state.expiresAt) return false;
        return clear();
      },
      snapshot: () => ({ ...state })
    };
  }

  return { create };
});
