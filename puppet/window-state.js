'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const SIZE_PRESETS = Object.freeze({
  small: Object.freeze({ w: 200, h: 290, label: '小' }),
  medium: Object.freeze({ w: 240, h: 348, label: '中' }),
  large: Object.freeze({ w: 300, h: 435, label: '大' }),
});

function validState(state) {
  const b = state && state.bounds;
  return Boolean(b && Number.isSafeInteger(b.x) && Number.isSafeInteger(b.y)
    && ['width', 'height'].every(key => Number.isInteger(b[key]) && b[key] >= 64 && b[key] <= 4096)
    && typeof state.size === 'string' && (state.size === 'custom' || Object.hasOwn(SIZE_PRESETS, state.size))
    && typeof state.alwaysOnTop === 'boolean'
    && (!Object.hasOwn(state,'idleEnabled') || typeof state.idleEnabled === 'boolean'));
}

function snapshot(state) {
  const { x, y, width, height } = state.bounds;
  return { bounds: { x, y, width, height }, size: state.size, alwaysOnTop: state.alwaysOnTop,
    ...(Object.hasOwn(state,'idleEnabled') ? {idleEnabled:state.idleEnabled} : {}) };
}

function loadState(file) {
  try {
    const state = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!state || state.version !== 1 || !validState(state)) return null;
    return snapshot(state);
  } catch {
    return null;
  }
}

function saveState(file, state) {
  if (!validState(state)) throw new TypeError('Invalid window state');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temp, JSON.stringify({ version: 1, ...snapshot(state) }), { flag: 'wx', mode: 0o600 });
    fs.renameSync(temp, file);
  } catch (error) {
    try { fs.unlinkSync(temp); } catch { /* Keep the original write error. */ }
    throw error;
  }
}

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

// Pick the workArea requiring the least movement to make the entire pet visible.
function fitBounds(bounds, displays, primary) {
  const b = Object.fromEntries(['x', 'y', 'width', 'height'].map(key => [key, Math.round(bounds[key])]));
  let best;
  let distance = Infinity;
  for (const display of (displays.length ? displays : [primary])) {
    const a = display.workArea;
    const width = Math.min(b.width, a.width);
    const height = Math.min(b.height, a.height);
    const fitted = {
      x: clamp(b.x, a.x, a.x + a.width - width),
      y: clamp(b.y, a.y, a.y + a.height - height),
      width,
      height,
    };
    const movement = Math.hypot(fitted.x - b.x, fitted.y - b.y);
    if (movement < distance || (movement === distance && display.id === primary?.id)) {
      best = fitted;
      distance = movement;
    }
  }
  return best;
}

function defaultBounds(displays, primary, size = 'medium') {
  const { w: width, h: height } = Object.hasOwn(SIZE_PRESETS, size) ? SIZE_PRESETS[size] : SIZE_PRESETS.medium;
  const a = primary.workArea;
  return fitBounds({ x: a.x + a.width - width - 40, y: a.y + a.height - height - 20, width, height },
    [primary], primary);
}

module.exports = { SIZE_PRESETS, fitBounds, defaultBounds, loadState, saveState };
