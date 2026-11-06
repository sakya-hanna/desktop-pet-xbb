'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const resizedBounds = (...args) => require('../puppet/resize-geometry').resizedBounds(...args);
test('requested scale is limited to canonical minimum and maximum', () => {
  assert.deepEqual(resizedBounds({ x: 600, y: 500, width: 96, height: 139 }, 0.5, area),
    { x: 600, y: 500, width: 96, height: 139 });
  assert.deepEqual(resizedBounds({ x: 600, y: 300, width: 480, height: 696 }, 2, area),
    { x: 480, y: 126, width: 600, height: 870 });
});

test('shrinking displays override minimum scale and floor dimensions without overshoot', () => {
  for (const [width, height] of [[101, 900], [900, 147], [11, 15], [1, 1], [0.25, 0.5]]) {
    const result = resizedBounds(bounds, 1, { x: 0, y: 0, width, height });
    assert.equal(result.width, Math.max(1, Math.floor(240 * Math.min(1, width / 240, height / 348))));
    assert.equal(result.height, Math.max(1, Math.floor(348 * Math.min(1, width / 240, height / 348))));
    assert.ok(result.width <= Math.max(1, width));
    assert.ok(result.height <= Math.max(1, height));
  }
});

test('coordinates clamp to every work-area edge including negative monitor origins', () => {
  const negative = { x: -1000, y: -800, width: 800, height: 700 };
  assert.deepEqual(resizedBounds({ x: -900, y: -700, width: 240, height: 348 }, 1.25, negative),
    { x: -960, y: -787, width: 300, height: 435 });
  for (const [x, y, expectedX, expectedY] of [
    [-2000, -2000, -1000, -800], [100, 100, -440, -448],
  ]) {
    assert.deepEqual(resizedBounds({ x, y, width: 240, height: 348 }, 1, negative),
      { x: expectedX, y: expectedY, width: 240, height: 348 });
  }
  assert.deepEqual(resizedBounds(bounds, 1, { x: -2, y: -3, width: 0.25, height: 0.5 }),
    { x: -2, y: -3, width: 1, height: 1 });
  const fractional = resizedBounds({ ...bounds, x: 600.8, y: 500.7 }, 1.01, area);
  assert.ok(Object.values(fractional).every(Number.isInteger));
});

test('rejects invalid factors without coercion', () => {
  for (const factor of [NaN, Infinity, -Infinity, undefined, null, '1', true, {}, [], 0, -1, 0.4999, 2.0001]) {
    assert.equal(resizedBounds(bounds, factor, area), null, String(factor));
  }
  for (const factor of [0.5, 2]) assert.notEqual(resizedBounds(bounds, factor, area), null);
});

test('rejects malformed rectangles and nonfinite or nonpositive fields', () => {
  for (const rectangle of [null, undefined, {}, [], 42, 'bounds']) {
    assert.equal(resizedBounds(rectangle, 1, area), null);
    assert.equal(resizedBounds(bounds, 1, rectangle), null);
  }
  for (const field of ['x', 'y', 'width', 'height']) {
    const invalid = [NaN, Infinity, -Infinity, undefined, null, '12', true];
    if (field === 'width' || field === 'height') invalid.push(0, -1);
    for (const value of invalid) {
      assert.equal(resizedBounds({ ...bounds, [field]: value }, 1, area), null, `bounds.${field}=${value}`);
      assert.equal(resizedBounds(bounds, 1, { ...area, [field]: value }), null, `area.${field}=${value}`);
    }
  }
});

const area = { x: 0, y: 0, width: 1920, height: 1080 };
const bounds = { x: 600, y: 500, width: 240, height: 348 };

test('returns fresh geometry without mutating either input', () => {
  const originalBounds = { ...bounds };
  const originalArea = { ...area };
  const frozenBounds = Object.freeze({ ...bounds });
  const frozenArea = Object.freeze({ ...area });
  const first = resizedBounds(frozenBounds, 1.25, frozenArea);
  const second = resizedBounds(frozenBounds, 1.25, frozenArea);
  assert.deepEqual(frozenBounds, originalBounds);
  assert.deepEqual(frozenArea, originalArea);
  assert.deepEqual(first, second);
  assert.notEqual(first, second);
  assert.notEqual(first, frozenBounds);
});

test('relative scaling uses current height and preserves the bottom-right anchor', () => {
  assert.deepEqual(resizedBounds(bounds, 1.25, area),
    { x: 540, y: 413, width: 300, height: 435 });
  assert.deepEqual(resizedBounds({ x: 540, y: 413, width: 300, height: 435 }, 0.8, area), bounds);
  assert.deepEqual(resizedBounds({ ...bounds, width: 999 }, 1, area),
    { x: 1359, y: 500, width: 240, height: 348 });
});
