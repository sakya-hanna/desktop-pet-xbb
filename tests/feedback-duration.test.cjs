'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { harness, settle, root } = require('./feedback-shell.test.cjs');

// Real desktop bridge -> trusted shell IPC -> real feedback manager; native surfaces only are faked.
function bridge(h, mainFrame = true) {
  const calls = []; let api;
  vm.runInNewContext(fs.readFileSync(path.join(root, 'desktop-preload.cjs'), 'utf8'), {
    process: { isMainFrame: mainFrame }, require(name) {
      assert.equal(name, 'electron');
      return { contextBridge: { exposeInMainWorld(_name, value) { api = value; } },
        ipcRenderer: { send(channel, value) {
          calls.push([channel, value]); h.electron.ipcMain.emit(channel, h.event(), value);
        } } };
    },
  });
  return { api, calls };
}

test('I10_duration bridge carries readable duration and expires from first receipt, not late load or duplicate', async () => {
  const h = harness({ mode: 'visible', deferred: true });
  try {
    await h.shell.ready;
    const { api, calls } = bridge(h);
    const value = { id: 1, text: '姐姐陪你慢慢读完这句话。', durationMs: 7500 };
    api.feedback(value);
    assert.equal(calls.length, 1, 'valid duration must cross the restricted bridge');
    value.text = 'mutated'; value.durationMs = 15000;
    assert.equal(calls[0][1].durationMs, 7500, 'bridge must copy the duration');
    const b = h.bubble(); assert.ok(b, 'trusted shell must accept readable duration');
    assert.ok(h.history.some(t => t.delay === 7500), 'timer begins on first receipt');
    h.advance(4000); b.finish(); await settle();
    assert.equal(b.visible, true, 'duration longer than the legacy 3400ms remains readable');
    assert.deepEqual(b.messages.at(-1), ['feedback:state', { id: 1, text: '姐姐陪你慢慢读完这句话。' }]);
    const timerCount = h.history.length, deliveries = b.messages.length;
    api.feedback({ id: 1, text: 'duplicate must not extend', durationMs: 15000 });
    assert.equal(h.history.length, timerCount); assert.equal(b.messages.length, deliveries);
    h.advance(3499); assert.equal(b.visible, true);
    h.advance(1); assert.equal(b.visible, false); assert.equal(b.messages.at(-1)[1], null);
    api.feedback({ id: 1, text: 'expired must not revive', durationMs: 15000 });
    assert.equal(b.messages.at(-1)[1], null);
  } finally { h.dispose(); }
  assert.equal(h.timers.size, 0);
});

for (const durationMs of [undefined, 3400, 15000]) test(`I10_duration legacy/default and inclusive boundary ${durationMs}`, async () => {
  const h = harness();
  try {
    await h.shell.ready;
    const { api, calls } = bridge(h);
    const payload = { id: 1, text: '😀'.repeat(200) };
    if (durationMs !== undefined) payload.durationMs = durationMs;
    api.feedback(payload); await settle();
    assert.equal(calls.length, 1); assert.equal(Object.hasOwn(calls[0][1], 'durationMs'), durationMs !== undefined);
    const b = h.bubble(); assert.ok(b);
    const duration = durationMs ?? 3400;
    assert.ok(h.history.some(t => t.delay === duration));
    assert.equal(b.messages.at(-1)[1].text, payload.text);
    h.advance(duration - 1); assert.notEqual(b.messages.at(-1)[1], null);
    h.advance(1); assert.equal(b.messages.at(-1)[1], null);
    assert.equal(h.windows.some(w => w.calls.some(c => ['show', 'showInactive', 'focus'].includes(c[0]))), false);
  } finally { h.dispose(); }
});

test('I10_duration both trust boundaries reject invalid durations, getters, extras and oversized text without cancelling live state', async () => {
  const h = harness();
  try {
    await h.shell.ready;
    const { api, calls } = bridge(h);
    api.feedback({ id: 1, text: 'live', durationMs: 7500 }); await settle();
    const b = h.bubble(); assert.ok(b);
    const count = b.messages.length, timers = h.history.length;
    const invalid = [undefined, null, '7500', true, 3399, 15001, 7500.5, NaN, Infinity, -Infinity, {}, []]
      .map(durationMs => ({ id: 99, text: 'bad', durationMs }));
    invalid.push({ id: 99, text: 'bad', durationMs: 7500, extra: true },
      { id: 99, text: 'bad', durationMs: 7500, [Symbol('extra')]: true },
      { id: 99, text: '😀'.repeat(201), durationMs: 7500 },
      { id: 99, text: '', durationMs: 7500 }, { id: 1.5, text: 'bad', durationMs: 7500 });
    for (const key of ['id', 'text', 'durationMs']) {
      invalid.push(Object.defineProperty({ id: 99, text: 'bad', durationMs: 7500 }, key,
        { get() { assert.fail(`must not invoke ${key} getter`); } }));
    }
    invalid.push(Object.defineProperty({ id: 99, text: 'bad', durationMs: 7500 }, 'hiddenExtra', { value: true }));
    for (const value of invalid) { api.feedback(value); h.send(value); }
    assert.equal(calls.length, 1, 'preload rejects instead of forwarding');
    assert.equal(b.messages.length, count, 'main process independently rejects without clearing');
    assert.equal(h.history.length, timers);
    h.send({ id: 2, text: 'invalid ids did not advance high water', durationMs: 3400 });
    assert.equal(b.messages.at(-1)[1].id, 2);
    assert.equal(bridge(h, false).api, undefined);
  } finally { h.dispose(); }
});

test('I10_duration retains main-frame, exact URL, sender and argument-count IPC restrictions', async () => {
  const h = harness();
  try {
    await h.shell.ready;
    const value = { id: 1, text: 'untrusted', durationMs: 15000 };
    for (const event of [{}, { sender: {}, senderFrame: h.event().senderFrame },
      { sender: h.event().sender, senderFrame: { url: h.event().senderFrame.url } }])
      h.electron.ipcMain.emit('desktop:feedback', event, value);
    const frame = h.event().senderFrame, url = frame.url;
    frame.url = url + '#wrong'; h.send(value); frame.url = url;
    h.send(value, 'extra'); h.send();
    assert.equal(h.windows.length, 1);
    h.send(value); await settle(); assert.ok(h.bubble());
  } finally { h.dispose(); }
});

test('I10_duration replacing a long timer with a short timer survives retired callbacks and late loading', async () => {
  const h = harness({ mode: 'visible', deferred: true });
  try {
    await h.shell.ready; h.send({ id: 1, text: 'old', durationMs: 15000 });
    const old = h.history.find(t => t.delay === 15000), b = h.bubble(); assert.ok(old); assert.ok(b);
    h.advance(1000); h.send({ id: 2, text: 'new', durationMs: 3400 });
    assert.equal(h.timers.has(old.id), false, 'old timer must be cleared');
    old.fn(); h.advance(2000); b.finish(); await settle();
    assert.deepEqual(b.messages.filter(m => m[1] !== null), [['feedback:state', { id: 2, text: 'new' }]]);
    assert.equal(b.visible, true);
    h.advance(1399); assert.equal(b.visible, true);
    h.advance(1); assert.equal(b.visible, false); assert.equal(b.messages.at(-1)[1], null);
  } finally { h.dispose(); }
});

for (const reason of ['timeout', 'null', 'hide', 'blur', 'idle-off', 'destroy'])
  test(`I10_duration late load after ${reason} never revives extended feedback`, async () => {
    const h = harness({ mode: 'visible', deferred: true });
    try {
      await h.shell.ready; h.send({ id: 10, text: 'pending', durationMs: 15000 });
      const b = h.bubble(), timer = h.history.find(t => t.delay === 15000); assert.ok(b); assert.ok(timer);
      if (reason === 'timeout') h.advance(15000);
      else if (reason === 'null') h.send(null);
      else if (reason === 'hide') h.shell.hide();
      else if (reason === 'blur') h.shell.window.emit('blur');
      else if (reason === 'idle-off') h.shell.setIdleEnabled(false);
      else h.shell.destroy();
      timer.fn(); b.finish(); await settle();
      assert.equal(b.messages.some(m => m[1] !== null), false);
      assert.equal(b.calls.some(c => ['show', 'showInactive', 'focus'].includes(c[0])), false);
      if (reason !== 'destroy') {
        if (reason === 'hide') { h.send({ id: 11, text: 'hidden', durationMs: 15000 }); h.shell.show(); }
        if (reason === 'idle-off') h.shell.setIdleEnabled(true);
        h.send({ id: reason === 'hide' ? 11 : 10, text: 'stale', durationMs: 15000 });
        assert.equal(b.messages.some(m => m[1] !== null), false);
        h.send({ id: 12, text: 'fresh', durationMs: 7500 }); await settle();
        assert.equal(b.messages.at(-1)[1].id, 12, 'only a fresh interaction may return');
      }
    } finally { h.dispose(); }
    assert.equal(h.timers.size, 0);
  });

test('I10_duration overdue clock with undispatched timer cannot display on load or geometry sync', async () => {
  for (const deferred of [true, false]) {
    const h = harness({ mode: 'visible', deferred });
    try {
      await h.shell.ready; h.send({ id: 1, text: 'expired', durationMs: 7500 }); await settle();
      const b = h.bubble(); assert.ok(b); h.clock.now = () => 7500;
      if (deferred) b.finish(); else h.shell.window.emit('move');
      await settle(); assert.equal(b.visible, false);
      if (deferred) assert.equal(b.messages.some(m => m[1] !== null), false);
      else assert.equal(b.messages.at(-1)[1], null);
    } finally { h.dispose(); }
  }
});
