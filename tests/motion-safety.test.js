const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Exercise browser scripts directly, without a renderer or a replacement rig.
const ctx = vm.createContext({ window: {} });
for (const file of ['assets.js', 'rig.js', 'hair-assets.js', 'hair-motion.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../puppet/rig/js', file), 'utf8'), ctx, { filename: file });
}
const { Rig, HairMotion, RIG_ASSETS, HAIR_ASSETS } = ctx.window;
const cfg = RIG_ASSETS.baijie;
const parts = HAIR_ASSETS.baijie.layers;

function grid(x0, y0, x1, y1, step = 10) {
  const xs = [], ys = [], points = [], triangles = [];
  for (let x = x0; x < x1; x += step) xs.push(x);
  for (let y = y0; y < y1; y += step) ys.push(y);
  xs.push(x1); ys.push(y1);
  for (const y of ys) for (const x of xs) points.push(x, y);
  for (let row = 0; row < ys.length - 1; row++) {
    for (let col = 0; col < xs.length - 1; col++) {
      const a = row * xs.length + col, b = a + 1, c = a + xs.length, d = c + 1;
      triangles.push([a, b, d], [a, d, c]);
    }
  }
  return { rest: new Float32Array(points), triangles };
}

const full = grid(0, 0, ...cfg.canvas);
// Conservative regular subgrids inside the two extracted outer-lock regions.
// These are NOT an alpha mesh or a claim about all body triangles. Coordinates
// are in the real 530x800 baked canvas, not a normalized/toy rig.
const local = [grid(20, 220, 110, 475, 5), grid(480, 247, 520, 438, 5)];
// Maximal hair mask exercises all legacy strand weights; no mocked Rig methods.
const rig = new Rig(cfg, () => 1);
const zeroHair = () => cfg.strands.map(() => 0);
const neutral = () => ({ angleX: 0, angleY: 0, roll: 0, breath: 0,
  bodyX: 0, bodyRoll: 0, hop: 0, squash: 0, skirt: 0, hair: zeroHair() });

function* combinations() {
  // Sample every corner of this explicit bounded motion envelope. Triangle
  // assertions below apply only to local grids at these samples, not arbitrary
  // CLI-forced values or a mathematical proof over the continuous interval.
  for (let bits = 0; bits < 64; bits++) {
    const sign = bit => bits & (1 << bit) ? 1 : -1;
    yield { ...neutral(), angleX: sign(0) * 0.95, angleY: sign(1) * 0.60,
      roll: sign(0) * 0.030, breath: (sign(2) + 1) / 2,
      bodyX: sign(3) * 1.10, bodyRoll: sign(3) * 0.025,
      skirt: sign(3) * 2.9, hop: bits & 16 ? 30 : 0,
      squash: bits & 16 ? -0.06 : 0.06, hairAngle: sign(5) * 0.08 };
  }
}

function weights(rest, part = null) {
  const W = rig.weights(rest);
  return part ? HairMotion.isolateLockWeights(W, rest, part) : W;
}

function deform(rest, W, P) {
  return rig.deform(rest, W, P, new Float32Array(rest.length));
}

function lock(rest, W, part, angle, P) {
  const bent = HairMotion.bendLock(rest, part, angle, new Float32Array(rest.length));
  // Keep weights frozen at rest, as the renderer does, even after bending.
  return deform(bent, W, P);
}

function finite(values, label) {
  for (let i = 0; i < values.length; i++) assert.ok(Number.isFinite(values[i]), `${label}[${i}]`);
}

function area(points, [a, b, c]) {
  return (points[b * 2] - points[a * 2]) * (points[c * 2 + 1] - points[a * 2 + 1])
    - (points[b * 2 + 1] - points[a * 2 + 1]) * (points[c * 2] - points[a * 2]);
}

test('rejects zero-length strand centerlines before NaN can enter weights', () => {
  for (const pts of [[[199, 194], [199, 194]], [], [[199, 194]], [[199, 194], [199, 194], [199, 194]]]) {
    const invalid = { ...cfg, strands: [{ ...cfg.strands[0], pts }] };
    assert.throws(() => new Rig(invalid, () => 1), /Invalid strand centerline.*positive finite length/);
  }
});

test('rejects non-finite centerline length instead of silently emitting NaN', () => {
  for (const value of [NaN, Infinity, -Infinity]) {
    const invalid = { ...cfg, strands: [{ ...cfg.strands[0], pts: [[0, 0], [value, 1]] }] };
    assert.throws(() => new Rig(invalid), /Invalid strand centerline.*positive finite length/);
  }
});

test('a repeated vertex on an otherwise valid centerline preserves normal deformation', () => {
  const original = new Rig(cfg, () => 1);
  const repeated = new Rig({ ...cfg, strands: cfg.strands.map(st => ({
    ...st, pts: [st.pts[0], ...st.pts],
  })) }, () => 1);
  const before = original.weights(full.rest), after = repeated.weights(full.rest);
  assert.deepEqual(after, before);
  const P = { ...neutral(), angleX: 0.95, breath: 1, hair: cfg.strands.map(() => 0.08) };
  assert.deepEqual(repeated.deform(full.rest, after, P, new Float32Array(full.rest.length)),
    original.deform(full.rest, before, P, new Float32Array(full.rest.length)));
});

test('530x800 grid weights and combined body/independent-lock coordinates stay finite', () => {
  assert.deepEqual(Array.from(cfg.canvas), [530, 800]);
  const W = weights(full.rest);
  for (const [key, value] of Object.entries(W)) {
    if (key === 'n') continue;
    if (Array.isArray(value)) value.forEach((v, k) => finite(v, `${key}.${k}`));
    else finite(value, key);
  }
  const lockWeights = parts.map(part => weights(full.rest, part));
  for (const P of [neutral(), ...combinations()]) {
    finite(deform(full.rest, W, P), 'body');
    for (let k = 0; k < parts.length; k++) {
      finite(lock(full.rest, lockWeights[k], parts[k], P.hairAngle || 0, P), parts[k].name);
    }
  }
});

test('fixed roots receive exactly the same base deformation as the body', () => {
  for (const part of parts) {
    const [x, y] = part.root;
    const rest = new Float32Array([x, y, x - 2, y, x + 2, y]);
    const W = weights(rest), lockW = weights(rest, part);
    assert.ok(W.skirt.every(w => w === 0), 'actual roots are above the skirt band');
    for (const P of combinations()) {
      assert.deepEqual(lock(rest, lockW, part, P.hairAngle, P), deform(rest, W, P));
    }
  }
});

test('the stationary attachment band matches when shared material weights are consistent', () => {
  for (const part of parts) {
    const rest = new Float32Array([...part.root, part.root[0], part.start]);
    // Root skirt weights remain equal through the donor band before fading out.
    const bodyW = weights(rest), sharedW = weights(rest, part);
    for (const P of combinations()) {
      assert.deepEqual(lock(rest, sharedW, part, P.hairAngle, P), deform(rest, bodyW, P));
    }
  }
});

test('changing only independent hair leaves body and face bit-for-bit unchanged', () => {
  const face = grid(240, 50, 350, 140, 5).rest;
  const Wbody = weights(full.rest), Wface = weights(face);
  const lockW = local.map((mesh, i) => weights(mesh.rest, parts[i]));
  for (const P of combinations()) {
    const bodyBefore = deform(full.rest, Wbody, P), faceBefore = deform(face, Wface, P);
    const zero = local.map((mesh, i) => lock(mesh.rest, lockW[i], parts[i], 0, P));
    const moved = local.map((mesh, i) => lock(mesh.rest, lockW[i], parts[i], P.hairAngle, P));
    moved.forEach((out, i) => assert.notDeepEqual(out, zero[i], 'independent tip must actually move'));
    assert.ok(P.hair.every(v => v === 0), 'never route independent angle through P.hair');
    assert.deepEqual(deform(full.rest, Wbody, P), bodyBefore);
    assert.deepEqual(deform(face, Wface, P), faceBefore);
  }
});

test('left and right lock motion does not mutate or contaminate the other side', () => {
  const W = local.map((mesh, i) => weights(mesh.rest, parts[i]));
  const pristine = local.map(mesh => mesh.rest.slice());
  const P = { ...neutral(), angleX: 0.95, breath: 1, bodyX: 1.1, hop: 30, squash: -0.06 };
  for (const angle of [-0.08, 0.08]) {
    const rightBefore = lock(local[1].rest, W[1], parts[1], 0, P);
    const left = lock(local[0].rest, W[0], parts[0], angle, P);
    assert.deepEqual(lock(local[1].rest, W[1], parts[1], 0, P), rightBefore);
    lock(local[1].rest, W[1], parts[1], -angle, P);
    assert.deepEqual(lock(local[0].rest, W[0], parts[0], angle, P), left);
    local.forEach((mesh, i) => assert.deepEqual(mesh.rest, pristine[i]));
  }
});

test('sampled legal combinations preserve winding of the independent outer-lock local triangles', () => {
  for (let k = 0; k < local.length; k++) {
    const mesh = local[k], W = weights(mesh.rest, parts[k]);
    assert.ok(mesh.triangles.length > 0);
    for (const P of [neutral(), ...combinations()]) {
      const out = lock(mesh.rest, W, parts[k], P.hairAngle || 0, P);
      for (const triangle of mesh.triangles) {
        assert.ok(area(mesh.rest, triangle) * area(out, triangle) > 0,
          `${parts[k].name} triangle ${triangle}, params ${JSON.stringify(P)}`);
      }
    }
  }
});
