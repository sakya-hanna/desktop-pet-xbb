(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else if (typeof define === 'function' && define.amd) define([], factory);
  else root.ExpressionBlend = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // Layers weight independently aligned original face meshes, not interpolated UVs.
  // No pruning: a domain of 14 face ids naturally has at most 14 distinct layers.
  return {
    create(initialId, {duration = 240} = {}) {
      const validId = id => Number.isSafeInteger(id) && id > 0;
      if (!validId(initialId)) throw new RangeError('initialId must be a positive safe integer');
      if (!Number.isFinite(duration) || duration < 0) throw new RangeError('duration must be finite and nonnegative');
      let target = initialId;
      let source = [{id: initialId, weight: 1}];
      let started = 0;
      let active = false;
      let lastTime = null;

      // Invalid reads hold time; finite reads advance the shared monotonic clock.
      function update(nowMs) {
        if (Number.isFinite(nowMs)) lastTime = lastTime === null ? nowMs : Math.max(lastTime, nowMs);
        nowMs = lastTime === null ? 0 : lastTime;
        if (!active) return [{id: target, weight: 1}];
        const t = Math.max(0, Math.min(1, (nowMs - started) / duration));
        if (t === 1) {
          active = false;
          return [{id: target, weight: 1}];
        }
        const eased = t * t * (3 - 2 * t);
        const layers = source.map(layer => ({id: layer.id, weight: layer.weight * (1 - eased)}));
        if (eased > 0) {
          const existing = layers.find(layer => layer.id === target);
          if (existing) existing.weight += eased;
          else layers.push({id: target, weight: eased});
        }
        return layers;
      }

      // True means a new target was accepted; invalid or unchanged requests return false.
      function set(id, nowMs) {
        if (!validId(id) || !Number.isFinite(nowMs)) return false;
        if (id === target) { update(nowMs); return false; }
        // Capture the displayed mixture BEFORE replacing its destination.
        source = update(nowMs);
        target = id;
        started = lastTime;
        active = duration > 0;
        return true;
      }

      function snapshot(nowMs) {
        const layers = update(nowMs);
        return {target, active, layers};
      }
      return {set, update, snapshot};
    }
  };
});
