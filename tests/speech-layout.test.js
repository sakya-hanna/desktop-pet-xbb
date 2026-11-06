const test = require('node:test');
const assert = require('node:assert/strict');
const { layoutSpeech } = require('../puppet/speech-layout');

test('prefers a readable bubble above the character', () => {
  assert.deepEqual(layoutSpeech({ x: 400, y: 400, width: 200, height: 300 },
    { x: 0, y: 0, width: 1000, height: 800 }),
  { x: 350, y: 258, width: 300, height: 130 });
});

test('falls back beside then below before shrinking into available space', () => {
  const area = { x: 0, y: 0, width: 1000, height: 800 };
  assert.deepEqual(layoutSpeech({ x: 400, y: 0, width: 200, height: 300 }, area),
    { x: 612, y: 85, width: 300, height: 130 });
  assert.deepEqual(layoutSpeech({ x: 100, y: 0, width: 800, height: 300 }, area),
    { x: 350, y: 312, width: 300, height: 130 });
  assert.deepEqual(layoutSpeech({ x: 200, y: 100, width: 600, height: 600 }, area),
    { x: 812, y: 335, width: 188, height: 130 });
});

test('keeps negative origins, enforces minimum room, and never intersects character', () => {
  const area = { x: -1000, y: -800, width: 1000, height: 800 };
  assert.equal(layoutSpeech(area, area), null);
  assert.equal(layoutSpeech({ x: -1000, y: -800, width: 850, height: 800 }, area), null);
  for (const x of [-1100, -1000, -850, -500, -100, 50]) {
    for (const y of [-900, -800, -600, -200, 50]) {
      const pet = { x, y, width: 200, height: 300 };
      const b = layoutSpeech(pet, area);
      if (!b) continue;
      assert.ok(b.width >= 160 && b.height >= 80);
      assert.ok(b.x >= area.x && b.y >= area.y);
      assert.ok(b.x + b.width <= 0 && b.y + b.height <= 0);
      assert.ok(b.x + b.width <= x || b.x >= x + 200 || b.y + b.height <= y || b.y >= y + 300);
    }
  }
});
