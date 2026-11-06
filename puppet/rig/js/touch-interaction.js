// Pure rest-world gesture recognition; the caller owns picking and pointer lifecycle.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TouchInteraction = factory();
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  function regionAt(point) {
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
    const { x, y } = point;
    if (y >= 6 && y <= 94 && ((x - 294) / 62) ** 2 + ((y - 50) / 44) ** 2 <= 1)
      return 'head_pat';
    if (point.part !== 'hair' && ((x - 295) / 45) ** 2 + ((y - 222) / 25) ** 2 <= 1)
      return 'chest_touch';
    return null;
  }

  const LINES = Object.freeze({
    head_pat: '怎么突然模姐姐的头，是希望姐姐做什么呢。',
    chest_touch: '姆，弟弟你这个色鬼。'
  });

  function finiteEvent(e) {
    return !!e && [e.pointerId, e.button, e.clientX, e.clientY].every(Number.isFinite);
  }

  function create({ now = Date.now, onTrigger = () => {} } = {}) {
    let active = null;
    let sequence = 0;
    let lastTriggerAt = -Infinity;
    function foreign(e) {
      return e && Number.isFinite(e.pointerId) && e.pointerId !== active.pointerId;
    }
    function sample(e, point, time = now()) {
      if (!finiteEvent(e) || regionAt(point) !== active.region ||
          !Number.isFinite(time) || time < active.lastSampleAt) active.canceled = true;
      active.lastSampleAt = time;
      if (active.canceled) return;
      active.maxCss = Math.max(active.maxCss, Math.hypot(e.clientX - active.cssX, e.clientY - active.cssY));
      active.maxWorld = Math.max(active.maxWorld, Math.hypot(point.x - active.worldX, point.y - active.worldY));
      // Hysteresis ignores tiny direction noise: both legs must span 14 world units.
      if (active.region === 'head_pat') {
        active.horizontalTravel += Math.abs(point.x - active.lastWorldX);
        active.cssTravel += Math.hypot(e.clientX - active.lastCssX, e.clientY - active.lastCssY);
        active.lastWorldX = point.x;
        active.lastCssX = e.clientX;
        active.lastCssY = e.clientY;
        const delta = point.x - active.extremeX;
        if (active.direction === 0) {
          if (Math.abs(delta) >= 14) {
            active.direction = Math.sign(delta);
            active.extremeX = point.x;
          }
        } else if (delta * active.direction > 0) {
          active.extremeX = point.x;
        } else if (delta * active.direction <= -14) {
          active.reversals++;
          active.direction *= -1;
          active.extremeX = point.x;
        }
      }
      if (active.region === 'chest_touch' && (active.maxCss > 4 || active.maxWorld > 12))
        active.canceled = true;
    }
    return {
      begin(e, point) {
        const startedAt = now();
        const region = finiteEvent(e) && e.button === 0 && Number.isFinite(startedAt) ? regionAt(point) : null;
        active = region ? {
          region, pointerId: e.pointerId, startedAt, lastSampleAt: startedAt, canceled: false,
          cssX: e.clientX, cssY: e.clientY, worldX: point.x, worldY: point.y,
          maxCss: 0, maxWorld: 0, extremeX: point.x, direction: 0, reversals: 0,
          lastWorldX: point.x, lastCssX: e.clientX, lastCssY: e.clientY,
          horizontalTravel: 0, cssTravel: 0
        } : null;
        return !!active;
      },
      move(e, point) {
        if (!active || foreign(e)) return false;
        sample(e, point);
        return true;
      },
      cancel() {
        const hadActive = !!active;
        active = null;
        return hadActive;
      },
      snapshot() {
        return { active: !!active, ...(active || {}) };
      },
      end(e, point) {
        if (!active || foreign(e)) return false;
        const releasedAt = now();
        sample(e, point, releasedAt);
        const gesture = active;
        active = null;
        const elapsed = releasedAt - gesture.startedAt;
        const validChest = gesture.region === 'chest_touch' && elapsed <= 650;
        const validHead = gesture.region === 'head_pat' && gesture.reversals >= 1 &&
          gesture.horizontalTravel >= 40 && gesture.cssTravel >= 8 && elapsed >= 180 && elapsed <= 2500;
        // One release clock and one cooldown shared by both regions, committed before callbacks.
        if (!gesture.canceled && e.button === 0 && (validChest || validHead) && releasedAt - lastTriggerAt >= 1200) {
          lastTriggerAt = releasedAt;
          onTrigger({ type: gesture.region, text: LINES[gesture.region], interactionId: 'touch-' + (++sequence) });
        }
        return true;
      }
    };
  }

  return { regionAt, LINES, create };
});
