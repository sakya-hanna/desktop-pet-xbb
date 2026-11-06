'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const controllerPath = require('node:path').join(__dirname, '../puppet/rig/js/dialogue-controller.js');
const DialogueController = fs.existsSync(controllerPath) ? require(controllerPath) : null;

test('duration counts Unicode code points with 6000ms and 20000ms clamps', () => {
  const controller = DialogueController.create({ now: () => 500 });
  for (const [text, duration] of [['x', 6000], ['😀'.repeat(40), 6000], ['😀'.repeat(60), 7200], ['中'.repeat(100), 12000], ['x'.repeat(1000), 20000]]) {
    assert.equal(controller.show({ text }), true);
    assert.equal(controller.snapshot().expiresAt, 500 + duration);
  }
});

test('oversized text is truncated to 4000 Unicode code points without splitting emoji', () => {
  const controller = DialogueController.create({ now: () => 0 });
  assert.equal(controller.show({ text: '😀'.repeat(4001) }), true);
  assert.equal(controller.snapshot().text, '😀'.repeat(4000));
  assert.equal(controller.snapshot().expiresAt, 20000);
});

test('dismiss rejects stale ids and clears current content', () => {
  const controller = DialogueController.create({ now: () => 0 });
  assert.equal(typeof controller.dismiss, 'function');
  assert.equal(controller.dismiss(), false);
  controller.show({ text: 'old' });
  const oldId = controller.snapshot().id;
  controller.show({ text: 'new', source: 'script' });
  const current = controller.snapshot();
  assert.equal(controller.dismiss(oldId), false);
  assert.deepEqual(controller.snapshot(), current);
  assert.equal(controller.dismiss(current.id), true);
  assert.deepEqual(controller.snapshot(), { id: null, text: '', source: '', visible: false, expiresAt: null });
  assert.equal(controller.dismiss(current.id), false);
  controller.show({ text: 'next' });
  assert.equal(controller.snapshot().id, 3);
  assert.equal(controller.dismiss(), true);
});

test('update expires only current at the injected deadline, never on snapshot', () => {
  let time = 100;
  const controller = DialogueController.create({ now: () => time });
  assert.equal(typeof controller.update, 'function');
  assert.equal(controller.update(), false);
  controller.show({ text: 'old' });
  time = 6000;
  controller.show({ text: 'new' });
  time = 6100;
  assert.equal(controller.update(), false);
  assert.equal(controller.snapshot().text, 'new');
  time = 11999;
  assert.equal(controller.update(), false);
  time = 12000;
  assert.equal(controller.snapshot().visible, true);
  assert.equal(controller.update(), true);
  assert.deepEqual(controller.snapshot(), { id: null, text: '', source: '', visible: false, expiresAt: null });
  assert.equal(controller.update(), false);
});

test('interaction ids deduplicate across replacement, dismiss and expiry', () => {
  let time = 0;
  const controller = DialogueController.create({ now: () => time });
  assert.equal(controller.show({ text: '', interactionId: 'a' }), false);
  assert.equal(controller.show({ text: 'a', interactionId: 'a' }), true);
  const first = controller.snapshot();
  time = 50;
  assert.equal(controller.show({ text: 'duplicate', interactionId: 'a' }), false);
  assert.deepEqual(controller.snapshot(), first);
  controller.show({ text: 'b', interactionId: 'b' });
  assert.equal(controller.show({ text: 'a again', interactionId: 'a' }), false);
  controller.dismiss();
  assert.equal(controller.show({ text: 'b again', interactionId: 'b' }), false);
  controller.show({ text: 'c', interactionId: 0 });
  time = 100000;
  controller.update();
  assert.equal(controller.show({ text: 'c again', interactionId: 0 }), false);
  assert.equal(controller.show({ text: 'no id' }), true);
  assert.equal(controller.show({ text: 'no id' }), true);
});

test('deduplication retains only the latest 128 accepted interaction ids', () => {
  const controller = DialogueController.create({ now: () => 0 });
  for (let i = 0; i < 128; i++) assert.equal(controller.show({ text: 'line', interactionId: i }), true);
  assert.equal(controller.show({ text: 'duplicate', interactionId: 0 }), false);
  assert.equal(controller.show({ text: 'line', interactionId: 128 }), true);
  assert.equal(controller.show({ text: 'still retained', interactionId: 1 }), false);
  assert.equal(controller.show({ text: 'evicted', interactionId: 0 }), true);
  assert.equal(controller.snapshot().id, 130);
});

test('browser UMD exposes window.DialogueController without DOM or timers', () => {
  const context = { window: {} };
  vm.runInNewContext(fs.readFileSync(controllerPath, 'utf8'), context);
  assert.equal(typeof context.window.DialogueController.create, 'function');
  let time = 0;
  const controller = context.window.DialogueController.create({ now: () => time });
  assert.equal(controller.show({ text: 'browser' }), true);
  assert.equal(controller.snapshot().text, 'browser');
  time = 6000;
  assert.equal(controller.update(), true);
  assert.equal(controller.snapshot().visible, false);
});

test('CommonJS create starts hidden with an isolated snapshot', () => {
  assert.equal(typeof DialogueController?.create, 'function');
  const controller = DialogueController.create({ now: () => 100 });
  assert.deepEqual(controller.snapshot(), { id: null, text: '', source: '', visible: false, expiresAt: null });
  const snapshot = controller.snapshot();
  snapshot.text = 'outside mutation';
  assert.equal(controller.snapshot().text, '');
});


test('show replaces current with a fresh id and a local default source', () => {
  const controller = DialogueController.create({ now: () => 100 });
  assert.equal(typeof controller.show, 'function');
  assert.equal(controller.show({ text: '你好' }), true);
  const first = controller.snapshot();
  assert.deepEqual(first, { id: 1, text: '你好', source: 'local', visible: true, expiresAt: 6100 });
  assert.equal(controller.show({ text: 'new', source: 'script' }), true);
  assert.deepEqual(controller.snapshot(), { id: 2, text: 'new', source: 'script', visible: true, expiresAt: 6100 });
});

test('invalid or blank input is rejected without changing current', () => {
  const controller = DialogueController.create({ now: () => 0 });
  controller.show({ text: 'keep' });
  const before = controller.snapshot();
  for (const input of [undefined, null, 1, 'text', [], {}, { text: 123 }, { text: '' }, { text: ' \n\t ' }, { text: 'ok', source: null }, { text: 'ok', source: '' }, { text: 'ok', interactionId: {} }]) {
    assert.equal(controller.show(input), false);
    assert.deepEqual(controller.snapshot(), before);
  }
});
