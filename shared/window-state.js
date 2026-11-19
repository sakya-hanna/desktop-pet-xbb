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
    && (!Object.hasOwn(state,'idleEnabled') || typeof state.idleEnabled === 'boolean')
    && (!Object.hasOwn(state,'wanderEnabled') || typeof state.wanderEnabled === 'boolean')
    && (!Object.hasOwn(state,'followEnabled') || typeof state.followEnabled === 'boolean')
    && (!Object.hasOwn(state,'fxEnabled') || typeof state.fxEnabled === 'boolean'));
}

function snapshot(state) {
  const { x, y, width, height } = state.bounds;
  return { bounds: { x, y, width, height }, size: state.size, alwaysOnTop: state.alwaysOnTop,
    ...(Object.hasOwn(state,'idleEnabled') ? {idleEnabled:state.idleEnabled} : {}),
    ...(Object.hasOwn(state,'wanderEnabled') ? {wanderEnabled:state.wanderEnabled} : {}),
    ...(Object.hasOwn(state,'followEnabled') ? {followEnabled:state.followEnabled} : {}),
    ...(Object.hasOwn(state,'fxEnabled') ? {fxEnabled:state.fxEnabled} : {}) };
}

function loadStateResult(file, { fsImpl = fs } = {}) {
  let raw, state;
  try { raw = fsImpl.readFileSync(file, 'utf8'); }
  catch (error) { return { status: error?.code === 'ENOENT' ? 'missing' : 'read-error', value: null, reason: null }; }
  try { state = JSON.parse(raw); }
  catch { return { status: 'invalid', value: null, reason: 'json' }; }
  if (!state || typeof state !== 'object' || Array.isArray(state) || !Number.isSafeInteger(state.version))
    return { status: 'invalid', value: null, reason: 'schema' };
  if (state.version !== 1) return { status: 'unsupported-version', value: null, reason: null };
  if (!validState(state)) return { status: 'invalid', value: null, reason: 'schema' };
  return { status: 'valid', value: snapshot(state), reason: null };
}

// Read-only compatibility. null cannot distinguish missing from unsafe to write.
function loadState(file, options) {
  const result = loadStateResult(file, options);
  return result.status === 'valid' ? result.value : null;
}

function saveState(file, state, { fsImpl = fs } = {}) {
  if (!validState(state)) throw new TypeError('Invalid window state');
  fsImpl.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  let fd, owned = false;
  try {
    fd = fsImpl.openSync(temp, 'wx', 0o600);
    owned = true;
    fsImpl.writeFileSync(fd, JSON.stringify({ version: 1, ...snapshot(state) }));
    fsImpl.closeSync(fd); fd = undefined;
    fsImpl.renameSync(temp, file); owned = false;
  } catch (error) {
    if (fd !== undefined) { try { fsImpl.closeSync(fd); } catch { /* Keep the primary error. */ } }
    if (owned) { try { fsImpl.unlinkSync(temp); } catch { /* Keep the primary error. */ } }
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

module.exports = { SIZE_PRESETS, fitBounds, defaultBounds, validState, loadStateResult, loadState, saveState };
