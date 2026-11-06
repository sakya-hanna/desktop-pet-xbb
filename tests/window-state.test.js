'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function temporary(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'baijie-window-state-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return path.join(dir, 'window-state.json');
}

const helper = require('../puppet/window-state');

test('loadState returns null for unreadable, corrupt or invalid versioned states', (t) => {
  const file = temporary(t);
  assert.equal(helper.loadState(file), null);
  assert.equal(helper.loadState(path.dirname(file)), null);
  for (const content of ['{broken', 'null', '[]', ...[
    {}, { version: 2, ...state }, { version: '1', ...state },
    ...[null, {}, { ...state.bounds, x: 1.2 }, { ...state.bounds, y: '0' },
      { ...state.bounds, x: 1e100 }, { ...state.bounds, width: 63 },
      { ...state.bounds, height: 4097 }, { ...state.bounds, width: 240.5 },
      { ...state.bounds, width: Infinity }].map(bounds => ({ version: 1, ...state, bounds })),
    { version: 1, ...state, size: 'giant' },
    { version: 1, ...state, alwaysOnTop: 'false' },
  ].map(value => JSON.stringify(value))]) {
    fs.writeFileSync(file, content);
    assert.equal(helper.loadState(file), null, content);
  }
  for (const dimension of [64, 4096]) {
    const valid = { ...state, bounds: { x: -1024, y: -80, width: dimension, height: dimension } };
    fs.writeFileSync(file, JSON.stringify({ version: 1, ...valid }));
    assert.deepEqual(helper.loadState(file), valid);
  }
});
test('saveState atomically replaces the file rather than truncating its inode', (t) => {
  const file = temporary(t);
  helper.saveState(file, state);
  const original = `${file}.previous`;
  fs.linkSync(file, original);
  const next = { ...state, alwaysOnTop: true };
  helper.saveState(file, next);
  assert.deepEqual(helper.loadState(original), state);
  assert.deepEqual(helper.loadState(file), next);
  assert.deepEqual(fs.readdirSync(path.dirname(file)).sort(), ['window-state.json', 'window-state.json.previous']);
});

test('failed replacement throws, keeps the old target and removes its temporary file', (t) => {
  const file = temporary(t);
  fs.mkdirSync(file);
  fs.writeFileSync(path.join(file, 'previous'), 'untouched');
  assert.throws(() => helper.saveState(file, state));
  assert.equal(fs.readFileSync(path.join(file, 'previous'), 'utf8'), 'untouched');
  assert.deepEqual(fs.readdirSync(path.dirname(file)), ['window-state.json']);
  assert.throws(() => helper.saveState(path.join(file, 'previous', 'state.json'), state));
});

test('saveState rejects invalid state without replacing the previous file', (t) => {
  const file = temporary(t);
  helper.saveState(file, state);
  const before = fs.readFileSync(file, 'utf8');
  assert.throws(() => helper.saveState(file, { ...state, bounds: { ...state.bounds, width: 0 } }), TypeError);
  assert.equal(fs.readFileSync(file, 'utf8'), before);
  assert.deepEqual(fs.readdirSync(path.dirname(file)), ['window-state.json']);
});

test('persistence whitelists state fields and drops credentials and clickthrough', (t) => {
  const file = temporary(t);
  helper.saveState(file, { ...state, version: 99, apiKey: 'private', clickThrough: true,
    bounds: { ...state.bounds, password: 'private' } });
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { version: 1, ...state });
  fs.writeFileSync(file, JSON.stringify({ version: 1, ...state, apiKey: 'private',
    bounds: { ...state.bounds, clickThrough: true } }));
  assert.deepEqual(helper.loadState(file), state);
});

test('size presets expose Chinese labels and the requested DIP sizes', () => {
  assert.deepEqual(helper.SIZE_PRESETS, {
    small: { w: 200, h: 290, label: '小' },
    medium: { w: 240, h: 348, label: '中' },
    large: { w: 300, h: 435, label: '大' },
  });
});

const primary = { id: 1, workArea: { x: 100, y: 30, width: 1200, height: 900 } };
const left = { id: 2, workArea: { x: -1280, y: -100, width: 1280, height: 1024 } };

test('fitBounds preserves valid negative coordinates and returns a fresh rectangle', () => {
  const bounds = Object.freeze({ x: -1200, y: -50, width: 240, height: 348 });
  const fitted = helper.fitBounds(bounds, [primary, left], primary);
  assert.deepEqual(fitted, bounds);
  assert.notEqual(fitted, bounds);
});

test('fitBounds moves offscreen bounds onto the nearest workArea without resizing', () => {
  assert.deepEqual(helper.fitBounds({ x: -4000, y: -200, width: 240, height: 348 }, [primary, left], primary),
    { x: -1280, y: -100, width: 240, height: 348 });
  assert.deepEqual(helper.fitBounds({ x: 4000, y: 2000, width: 240, height: 348 }, [left, primary], primary),
    { x: 1060, y: 582, width: 240, height: 348 });
  assert.deepEqual(helper.fitBounds({ x: -120, y: 100, width: 240, height: 348 }, [primary, left], primary),
    { x: -240, y: 100, width: 240, height: 348 });
});

test('fitBounds shrinks only axes larger than the workArea and rounds DIP values', () => {
  const tiny = { id: 3, workArea: { x: -500, y: 40, width: 180, height: 250 } };
  assert.deepEqual(helper.fitBounds({ x: -450, y: 80, width: 240, height: 348 }, [tiny], tiny),
    { x: -500, y: 40, width: 180, height: 250 });
  assert.deepEqual(helper.fitBounds({ x: -450, y: 80, width: 100, height: 348 }, [tiny], tiny),
    { x: -450, y: 40, width: 100, height: 250 });
  assert.deepEqual(helper.fitBounds({ x: -1200.4, y: -50.7, width: 239.8, height: 347.6 }, [left], left),
    { x: -1200, y: -51, width: 240, height: 348 });
});

test('fitBounds falls back to primary when displays is empty and uses primary for ties', () => {
  const b = { x: -20, y: 100, width: 240, height: 348 };
  assert.deepEqual(helper.fitBounds(b, [], primary), { ...b, x: 100 });
  const right = { id: 4, workArea: { x: 0, y: 0, width: 1280, height: 1024 } };
  const tied = { x: -120, y: 50, width: 240, height: 348 };
  assert.deepEqual(helper.fitBounds(tied, [left, right], right), { ...tied, x: 0 });
  assert.deepEqual(helper.fitBounds(tied, [right, left], left), { ...tied, x: -240 });
});

test('defaultBounds anchors each preset to primary origin plus right/bottom margins', () => {
  for (const display of [primary, left]) {
    for (const size of ['small', 'medium', 'large']) {
      const { w: width, h: height } = helper.SIZE_PRESETS[size];
      const a = display.workArea;
      assert.deepEqual(helper.defaultBounds([left, primary], display, size),
        { x: a.x + a.width - width - 40, y: a.y + a.height - height - 20, width, height });
    }
  }
});

test('defaultBounds stays on a small primary workArea and defaults to medium', () => {
  const tiny = { id: 3, workArea: { x: -500, y: -200, width: 180, height: 250 } };
  assert.deepEqual(helper.defaultBounds([primary, tiny], tiny, 'large'),
    { x: -500, y: -200, width: 180, height: 250 });
  assert.deepEqual(helper.defaultBounds([primary], primary), helper.defaultBounds([primary], primary, 'medium'));
  assert.deepEqual(helper.defaultBounds([primary], primary, 'toString'), helper.defaultBounds([primary], primary, 'medium'));
});

test('loadState rejects preset names supplied as arrays instead of strings', (t) => {
  const file = temporary(t);
  fs.writeFileSync(file, JSON.stringify({ version: 1, ...state, size: ['medium'] }));
  assert.equal(helper.loadState(file), null);
});

test('write and rename failures preserve the previous real file', (t) => {
  const file = temporary(t);
  helper.saveState(file, state);
  const before = fs.readFileSync(file, 'utf8');
  const originalWrite = fs.writeFileSync;
  const failure = new Error('injected I/O failure');
  for (const operation of ['writeFileSync', 'renameSync']) {
    const mock = t.mock.method(fs, operation, (...args) => {
      if (operation === 'writeFileSync') originalWrite(args[0], 'partial');
      throw failure;
    });
    try {
      assert.throws(() => helper.saveState(file, { ...state, alwaysOnTop: true }), error => error === failure);
      assert.equal(fs.readFileSync(file, 'utf8'), before);
      assert.deepEqual(fs.readdirSync(path.dirname(file)), ['window-state.json']);
    } finally {
      mock.mock.restore();
    }
  }
});

const state = { bounds: { x: -300, y: 50, width: 240, height: 348 }, size: 'medium', alwaysOnTop: false };

test('state roundtrips through a real file with version 1', (t) => {
  const { saveState, loadState } = require('../puppet/window-state');
  const file = temporary(t);
  saveState(file, state);
  assert.deepEqual(loadState(file), state);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { version: 1, ...state });
});

test('preset API remains compatible with main process w/h menu fields', () => {
  assert.equal(helper.SIZE_PRESETS.medium.w, 240);
  assert.equal(helper.SIZE_PRESETS.medium.h, 348);
});
test('first launch creates a project-scoped settings directory', t => {
  const rootFile = temporary(t);
  const nested = path.join(path.dirname(rootFile), 'baijie-desktop', 'window-state.json');
  helper.saveState(nested, state);
  assert.deepEqual(helper.loadState(nested), state);
});

test('idle preference persists as an optional boolean without rejecting old states',t=>{
 const file=temporary(t);
 helper.saveState(file,{...state,idleEnabled:false});
 assert.equal(helper.loadState(file).idleEnabled,false);
 helper.saveState(file,state);assert.deepEqual(helper.loadState(file),state);
 assert.throws(()=>helper.saveState(file,{...state,idleEnabled:'false'}));
});

test('continuous custom size roundtrips without losing window or idle preferences',t=>{
 const file=temporary(t),next={...state,size:'custom',bounds:{x:-100,y:0,width:263,height:382},idleEnabled:false};
 helper.saveState(file,next);assert.deepEqual(helper.loadState(file),next);
});
