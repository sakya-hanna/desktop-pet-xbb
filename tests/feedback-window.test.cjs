'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { harness, settle, root, FEEDBACK } = require('./feedback-shell.test.cjs');
const path = require('node:path');
const {speechHeadBounds}=require('../shared/speech-layout.js');
function outsideHead(a,b){return outside(a,speechHeadBounds(b));}
function outside(a, b) { return a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y; }

for (const mode of ['hidden', 'visible']) test(`I9_feedback ${mode}: passive window placement, scaling, topmost, navigation and cleanup`, async () => {
  const h = harness({ mode });
  try {
    await h.shell.ready; h.send({ id: 1, text: '白姐在这里。' }); await settle();
    const b = h.bubble(); assert.ok(b, 'separate feedback window must exist');
    assert.equal(b.options.focusable, false); assert.equal(b.options.show, false);
    assert.equal(b.options.webPreferences.offscreen, mode === 'hidden');
    assert.equal(b.options.webPreferences.sandbox, true); assert.equal(b.options.webPreferences.nodeIntegration, false);
    assert.equal(b.options.webPreferences.contextIsolation, true);
    assert.equal(b.options.webPreferences.preload, path.join(root, 'feedback-preload.cjs'));
    assert.deepEqual(b.calls.find(c => c[0] === 'ignore'), ['ignore', true, { forward: true }]);
    assert.equal(b.calls.some(c => c[0] === 'show' || c[0] === 'focus'), false);
    assert.equal(b.calls.some(c => c[0] === 'showInactive'), mode === 'visible');
    assert.ok(outsideHead(b.bounds, h.shell.window.bounds));
    const old = b.getBounds(); h.shell.drag({ dx: -250, dy: -200 });
    assert.notDeepEqual(b.bounds, old); assert.ok(outsideHead(b.bounds, h.shell.window.bounds));
    h.shell.resizeBy(1.2); assert.ok(outsideHead(b.bounds, h.shell.window.bounds));
    h.shell.setTopmost(false); assert.equal(b.top, false);
    for (const name of ['will-navigate', 'will-frame-navigate', 'will-redirect', 'will-attach-webview']) {
      let prevented = false; b.webContents.emit(name, { preventDefault() { prevented = true; } }); assert.equal(prevented, true, name);
    }
    assert.deepEqual(b.open(), { action: 'deny' });
    h.shell.window.emit('blur'); assert.equal(b.messages.at(-1)[1], null); assert.equal(b.visible, false);
    h.send({ id: 2, text: 'second' }); await settle(); h.shell.hide(); assert.equal(b.visible, false);
    h.shell.show(); assert.equal(b.visible, false, 'show must not revive previous feedback');
    h.send({ id: 3, text: 'third' }); await settle(); h.shell.window.destroy();
    assert.equal(b.dead, true); assert.equal(h.timers.size, 0);
    assert.equal(h.electron.screen.eventNames().length, 0);
    if (mode === 'hidden') assert.equal(h.windows.some(w => w.calls.some(c => ['show', 'showInactive', 'focus'].includes(c[0]))), false);
  } finally { h.dispose(); }
});

for (const clear of ['timeout', 'null', 'hide', 'blur', 'destroy']) test(`I9_feedback late load after ${clear} cannot revive content`, async () => {
  const h = harness({ mode: 'visible', deferred: true });
  try {
    await h.shell.ready; h.send({ id: 10, text: 'pending' });
    const b = h.bubble(); assert.ok(b, 'feedback load must begin on receipt');
    assert.equal(b.visible, false);
    if (clear === 'timeout') h.advance(3400);
    else if (clear === 'null') h.send(null);
    else if (clear === 'hide') h.shell.hide();
    else if (clear === 'blur') h.shell.window.emit('blur');
    else h.shell.destroy();
    b.finish(); await settle();
    assert.equal(b.calls.some(c => ['show', 'showInactive', 'focus'].includes(c[0])), false);
    assert.equal(b.messages.some(m => m[1] !== null), false);
  } finally { h.dispose(); }
});

test('I9_feedback partial late load keeps original deadline and sends only newest state', async () => {
  const h = harness({ mode: 'visible', deferred: true });
  try {
    await h.shell.ready; h.send({ id: 1, text: 'one' });
    const b = h.bubble(); assert.ok(b);
    h.advance(1000); h.send({ id: 2, text: 'two' }); h.advance(2000);
    b.finish(); await settle();
    assert.deepEqual(b.messages.filter(m => m[1] !== null), [['feedback:state', { id: 2, text: 'two' }]]);
    h.advance(1400); assert.equal(b.visible, false); assert.equal(b.messages.at(-1)[1], null);
  } finally { h.dispose(); }
});

test('I9_feedback failed load never closes or resizes parent and retains rejected id', async () => {
  const h = harness({ mode: 'visible', failure: true });
  try {
    await h.shell.ready; const parent = h.shell.window, bounds = parent.getBounds();
    h.send({ id: 1, text: 'fail' }); await settle();
    assert.ok(h.bubble(), 'attempt to load the bubble is required');
    assert.equal(parent.dead, false); assert.equal(parent.visible, true); assert.deepEqual(parent.bounds, bounds);
    assert.equal(h.bubble().visible, false);
    const count = h.windows.length; h.send({ id: 1, text: 'retry forbidden' }); await settle();
    assert.equal(h.windows.length, count);
  } finally { h.dispose(); }
});

test('I9_feedback delayed timer dispatch cannot revive expired text on load or geometry sync', async () => {
  const h = harness({ mode: 'visible', deferred: true });
  try {
    await h.shell.ready; h.send({ id: 1, text: 'pending' });
    const b = h.bubble(); assert.ok(b); h.clock.now = () => 3401;
    b.finish(); await settle(); assert.equal(b.visible, false); assert.equal(b.messages.some(m => m[1] !== null), false);
  } finally { h.dispose(); }
});

test('I9_feedback native load/crash failures retire only the child; late old load cannot affect replacement', async () => {
  const h = harness({ mode: 'visible', deferred: true });
  try {
    await h.shell.ready; const bounds = h.shell.window.getBounds();
    h.send({ id: 1, text: 'one' }); const old = h.bubble();
    old.webContents.emit('did-fail-load', {}, -1, 'fixture', FEEDBACK, true);
    assert.equal(old.dead, true); assert.equal(h.shell.window.dead, false);
    h.send({ id: 2, text: 'two' }); const next = h.windows.at(-1);
    assert.notEqual(old, next); next.finish(); await settle(); old.finish(); await settle();
    assert.equal(next.messages.at(-1)[1].id, 2); assert.equal(next.visible, true);
    next.webContents.emit('render-process-gone', {}, { reason: 'crashed' });
    assert.equal(next.dead, true); assert.equal(h.shell.window.dead, false);
    assert.deepEqual(h.shell.window.bounds, bounds);
  } finally { h.dispose(); }
});

test('I9_feedback placement handles negative/fractional displays without parent overlap; no available strip hides', () => {
  const { layoutSpeech } = require('../shared/speech-layout.js');
  const area = { x: -1000.5, y: -200.5, width: 1000.5, height: 800.5 };
  for (const parent of [
    { x: -400, y: 200, width: 240, height: 348 },
    { x: -999, y: -199, width: 240, height: 348 },
    { x: -240, y: -199, width: 240, height: 348 },
  ]) {
    const b = layoutSpeech(parent, area); assert.ok(b); assert.ok(outside(b, parent));
    assert.ok(b.x >= area.x && b.y >= area.y && b.x + b.width <= area.x + area.width && b.y + b.height <= area.y + area.height);
    assert.ok(Object.values(b).every(Number.isInteger));
  }
  assert.equal(layoutSpeech(area, area), null);
});

test('I9_feedback approved protocol serves only exact bubble resources', () => {
  const policy = require('../resource-policy.cjs');
  for (const name of ['feedback.html', 'feedback.css', 'src/feedback-view.js']) {
    assert.equal(policy.resolveResource(`baijie28://app/${name}`, root), path.join(root, name));
  }
  for (const url of [FEEDBACK + '?x=1', FEEDBACK + '#x', 'baijie28://app/../feedback.html',
    'baijie28://app/%66eedback.html', 'baijie28://app/feedback-preload.cjs', 'file:///feedback.html', 'https://example.invalid/']) {
    assert.equal(policy.resolveResource(url, root), null);
  }
});
