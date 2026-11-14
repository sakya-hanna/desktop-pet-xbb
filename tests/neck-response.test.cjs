'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { binding, parts } = require('../src/character.js');
const { deformPoint } = require('../src/material-rig.js');
const { createDirector } = require('../src/director.js');
const meta = require('../assets/manifest.json');
function stroke(direction) {
  const engine = createDirector({ idle: false, seed: 17 });
  engine.send({ type: 'down', pointerId: 1, x: 0.55 });
  engine.send({ type: 'move', pointerId: 1, x: direction < 0 ? 0.4 : 0.7 });
  for (let i = 0; i < 72; i++) engine.advance(1 / 120);
  return { engine, pose: engine.snapshot().pose };
}
const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
function tangent(pose, y) {
  const a = deformPoint([298.2, y - 1], pose, binding);
  const b = deformPoint([298.2, y + 1], pose, binding);
  return Math.atan2(b[0] - a[0], b[1] - a[1]);
}

test('stroking leaves upper-chest material on the torso rather than the head transform', () => {
  for (const direction of [-1, 1]) {
    const { pose } = stroke(direction);
    const torso = { ...pose, headRoll: 0, headX: 0, headY: 0 };
    const diagnostics = [];
    for (const y of [145, 155, 165, 175, 190, 210]) {
      const p = [298.2, y];
      diagnostics.push({ y, extraHeadDisplacement: distance(deformPoint(p, pose, binding), deformPoint(p, torso, binding)), tangent: tangent(pose, y) });
    }
    console.log('NECK_DIAGNOSTIC ' + JSON.stringify({ direction, binding, diagnostics }));
    // Image landmarks: chin ends near y140; the blue crossed straps and upper
    // chest below y175 must not be the flexible hinge of a head stroke.
    for (const x of [260, 298.2, 335]) for (const y of [175, 185, 200, 215]) {
      const p = [x, y];
      assert.ok(distance(deformPoint(p, pose, binding), deformPoint(p, torso, binding)) < 1e-7,
        'Head stroke leaked into chest/shoulder-between material at ' + p);
    }
  }
});

test('head contact leaves the visible neck undeformed under the revised interaction requirement', () => {
  for (const direction of [-1, 1]) {
    const { pose } = stroke(direction);
    // The user rejected neck bending during head touch; do not restore it by
    // optimizing the previous candidate's now-obsolete bend requirement.
    for (let y = 140; y <= 175; y++) for (const x of [260, 298.2, 335]) {
      const p = [x, y];
      assert.ok(distance(deformPoint(p, pose, binding), p) < 1e-7,
        'Head touch must not deform neck material at ' + p);
    }
  }
});

test('all face rectangles remain rigid under the actual left and right stroke poses', () => {
  for (const direction of [-1, 1]) {
    const { pose } = stroke(direction);
    for (const rect of Object.values(meta.character.faces)) {
      const a = [rect.x, rect.y], b = [rect.x + rect.w, rect.y + rect.h];
      assert.ok(Math.abs(distance(deformPoint(a, pose, binding), deformPoint(b, pose, binding)) - distance(a, b)) < 1e-6);
    }
  }
});

test('neck transition has positive bounded area at maximum stroke and reversal', () => {
  for (const direction of [-1, 1]) {
    const { engine } = stroke(direction);
    engine.send({ type: 'move', pointerId: 1, x: direction < 0 ? 0.7 : 0.4 });
    for (let i = 0; i < 120; i++) {
      const pose = engine.advance(1 / 120).pose;
      for (let y = 132; y <= 185; y += 2) for (let x = 245; x <= 350; x += 5) {
        const p = deformPoint([x, y], pose, binding), px = deformPoint([x + 0.1, y], pose, binding), py = deformPoint([x, y + 0.1], pose, binding);
        const determinant = ((px[0] - p[0]) * (py[1] - p[1]) - (px[1] - p[1]) * (py[0] - p[0])) / 0.01;
        assert.ok(determinant > 0.35 && determinant < 1.8, 'Fold or excessive area distortion: ' + JSON.stringify({ x, y, determinant }));
      }
    }
  }
});

test('hair root bands continue to share the revised head and torso material mapping', () => {
  const { pose } = stroke(1);
  for (const part of Object.values(parts)) {
    for (const dx of [-4, 0, 4]) for (const dy of [-1, 0, 1]) {
      const p = [part.root[0] + dx, Math.min(part.rootLockY, part.root[1] + dy)];
      assert.deepEqual(deformPoint(p, pose, binding, part), deformPoint(p, pose, binding));
    }
  }
});
