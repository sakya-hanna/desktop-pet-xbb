'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

function sourceOnlyHarness() {
  const file = path.join(__dirname, 'helpers/renderer-harness.cjs');
  const local = createRequire(file), module = { exports: {} };
  const rejectArt = file => assert.doesNotMatch(String(file), /\.png$/i, 'Node logic harness must not inspect private PNG assets');
  const sourceOnlyFS = {
    ...fs,
    existsSync(file) { rejectArt(file); return fs.existsSync(file); },
    readFileSync(file, ...args) { rejectArt(file); return fs.readFileSync(file, ...args); }
  };
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
    module, exports: module.exports, __dirname: path.dirname(file),
    require: name => name === 'fs' ? sourceOnlyFS : local(name),
    setImmediate, queueMicrotask, Uint8ClampedArray, URLSearchParams
  });
  return module.exports;
}

test('public source-only renderer harness loads all front strands without reading local art', async () => {
  const h = await sourceOnlyHarness().boot('', { frames: 180 });
  const d = h.rig.diagnostics();
  assert.equal(d.frontHair.length, 3);
  assert.equal(d.frontFallback, null);
  assert.ok(d.frontHair.some(p => p.actualSource !== 0));
});

test('source-only image metadata keeps explicit bad-size and missing-asset injections effective', async () => {
  for (const options of [
    { dimensions: src => src.includes('front-right-receiver') ? [1, 1] : null },
    { fail: src => src.includes('front-right-caster') }
  ]) {
    const h = await sourceOnlyHarness().boot('', { ...options, frames: 1 });
    assert.equal(h.rig.diagnostics().frontHair.length, 0);
    assert.ok(h.rig.diagnostics().frontFallback);
  }
});
