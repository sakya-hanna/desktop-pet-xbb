'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path').join(__dirname, '../puppet/rig/js/expression-blend.js');
const ExpressionBlend = fs.existsSync(path) ? require(path) : {};

test('interruption starts from the exact displayed mixture and merges repeated faces', () => {
  const blend = ExpressionBlend.create(1);
  blend.set(2, 0);
  const before = blend.update(120);
  blend.set(3, 120);
  assert.deepEqual(blend.update(120), before);
  assert.deepEqual(blend.update(240), [{id: 1, weight: 0.25}, {id: 2, weight: 0.25}, {id: 3, weight: 0.5}]);
  const mixed = blend.update(240);
  blend.set(1, 240);
  assert.deepEqual(blend.update(240), mixed);
  assert.deepEqual(blend.update(360), [{id: 1, weight: 0.625}, {id: 2, weight: 0.125}, {id: 3, weight: 0.25}]);
  assert.deepEqual(blend.update(480), [{id: 1, weight: 1}]);
});

test('same target never restarts an active fade or activates an idle one', () => {
  const blend = ExpressionBlend.create(1);
  assert.equal(blend.set(1, 0), false);
  assert.equal(blend.snapshot(0).active, false);
  blend.set(2, 0);
  assert.equal(blend.set(2, 120), false);
  assert.deepEqual(blend.update(180), [{id: 1, weight: 0.15625}, {id: 2, weight: 0.84375}]);
  assert.equal(blend.set(2, 240), false);
  assert.equal(blend.snapshot(240).active, false);
});

test('invalid ids are rejected without changing state; invalid initial ids throw', () => {
  const invalid = [0, -1, 1.5, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1, '2', null, undefined, {}, 2n];
  const blend = ExpressionBlend.create(1);
  blend.set(2, 0);
  const before = blend.snapshot(60);
  for (const id of invalid) {
    assert.equal(blend.set(id, 10000), false);
    assert.deepEqual(blend.snapshot(60), before);
    assert.throws(() => ExpressionBlend.create(id), RangeError);
  }
  assert.equal(blend.set(Number.MAX_SAFE_INTEGER, 60), true);
});

test('timestamps are finite and monotonic across update, snapshot, and set', () => {
  const blend = ExpressionBlend.create(1);
  for (const time of [NaN, Infinity, -Infinity, undefined, null, '120']) {
    assert.equal(blend.set(2, time), false);
    assert.deepEqual(blend.update(time), [{id: 1, weight: 1}]);
  }
  blend.set(2, -240);
  const midpoint = blend.update(-120);
  assert.deepEqual(midpoint, [{id: 1, weight: 0.5}, {id: 2, weight: 0.5}]);
  for (const time of [-200, NaN, Infinity, undefined]) {
    assert.deepEqual(blend.snapshot(time).layers, midpoint);
  }
  blend.set(3, -200);
  assert.deepEqual(blend.update(-120), midpoint);
  assert.deepEqual(blend.update(0), [{id: 1, weight: 0.25}, {id: 2, weight: 0.25}, {id: 3, weight: 0.5}]);
  assert.deepEqual(blend.update(120), [{id: 3, weight: 1}]);
  assert.deepEqual(blend.update(-1000), [{id: 3, weight: 1}]);
});

test('UMD loads without DOM or timers as browser global and AMD module', () => {
  const code = fs.readFileSync(path, 'utf8');
  const browser = {};
  vm.runInNewContext(code, browser);
  assert.equal(typeof browser.ExpressionBlend.create, 'function');
  assert.equal(browser.ExpressionBlend.create(7).update(0)[0].id, 7);
  let amd;
  const define = (dependencies, factory) => { assert.equal(dependencies.length, 0); amd = factory(); };
  define.amd = {};
  vm.runInNewContext(code, {define});
  assert.equal(typeof amd.create, 'function');
  assert.equal(amd.create(8).update(0)[0].id, 8);
});

test('duration zero completes immediately; nonfinite or negative durations throw', () => {
  for (const duration of [-1, NaN, Infinity, -Infinity, '240', null]) {
    assert.throws(() => ExpressionBlend.create(1, {duration}), RangeError);
  }
  const blend = ExpressionBlend.create(1, {duration: 0});
  assert.equal(blend.set(2, 10), true);
  assert.deepEqual(blend.snapshot(10), {target: 2, active: false, layers: [{id: 2, weight: 1}]});
});

test('14-face interruption stress preserves normalized unique detached mixtures without pruning', () => {
  const blend = ExpressionBlend.create(1);
  let now = 0;
  for (let i = 0; i < 1400; i++) {
    now += 1 + (i % 13);
    const before = blend.update(now);
    const id = 1 + ((i + 1) % 14);
    blend.set(id, now);
    const after = blend.update(now);
    assert.deepEqual(after, before);
    assert.ok(after.length <= 14);
    assert.equal(new Set(after.map(layer => layer.id)).size, after.length);
    assert.ok(after.every(layer => Number.isFinite(layer.weight) && layer.weight >= 0));
    assert.ok(Math.abs(after.reduce((sum, layer) => sum + layer.weight, 0) - 1) < 1e-12);
    if (i === 12) assert.equal(after.length, 13);
    if (i === 13) assert.equal(after.length, 14);
    const saved = blend.snapshot(now);
    saved.layers.forEach(layer => { layer.id = 99; layer.weight = -1; });
    saved.layers.length = 0;
    saved.target = 99;
    assert.deepEqual(blend.update(now), before);
  }
  assert.deepEqual(blend.snapshot(now + 240), {target: 1, active: false, layers: [{id: 1, weight: 1}]});
});

test('initial face is a stable unit-weight layer with detached results', () => {
  assert.equal(typeof ExpressionBlend.create, 'function');
  const blend = ExpressionBlend.create(1);
  const layers = blend.update(0);
  assert.deepEqual(layers, [{id: 1, weight: 1}]);
  layers[0].weight = 0;
  layers.push({id: 2, weight: 1});
  const snapshot = blend.snapshot(0);
  assert.deepEqual(snapshot, {target: 1, active: false, layers: [{id: 1, weight: 1}]});
  snapshot.layers[0].id = 9;
  assert.deepEqual(blend.update(0), [{id: 1, weight: 1}]);
});

test('set fades using smoothstep over default and configured durations', () => {
  for (const duration of [240, 400]) {
    const blend = duration === 240 ? ExpressionBlend.create(1) : ExpressionBlend.create(1, {duration});
    assert.equal(blend.set(2, 100), true);
    assert.deepEqual(blend.snapshot(100), {target: 2, active: true, layers: [{id: 1, weight: 1}]});
    assert.deepEqual(blend.update(100 + duration / 4), [{id: 1, weight: 0.84375}, {id: 2, weight: 0.15625}]);
    assert.deepEqual(blend.update(100 + duration / 2), [{id: 1, weight: 0.5}, {id: 2, weight: 0.5}]);
    assert.deepEqual(blend.snapshot(100 + duration), {target: 2, active: false, layers: [{id: 2, weight: 1}]});
    assert.deepEqual(blend.update(10000), [{id: 2, weight: 1}]);
  }
});
