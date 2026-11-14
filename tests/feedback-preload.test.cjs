'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const root = path.resolve(__dirname, '..');
function preload(file, mainFrame = true) {
  const calls = [], ipcRenderer = new EventEmitter(); let api;
  ipcRenderer.send = (...args) => calls.push(args);
  vm.runInNewContext(fs.readFileSync(path.join(root, file), 'utf8'), {
    process: { isMainFrame: mainFrame }, require(name) { assert.equal(name, 'electron'); return {
      contextBridge: { exposeInMainWorld(name, value) { api = value; } }, ipcRenderer }; } });
  return { calls, api, ipcRenderer };
}
test('I9_feedback desktop bridge validates strict id/text/null and copies payload', () => {
  const { api, calls } = preload('desktop-preload.cjs');
  assert.equal(typeof api.feedback, 'function', 'pet.feedback must be a narrow bridge method');
  assert.equal(Object.isFrozen(api), true);
  const value = { id: 1, text: '😀'.repeat(200) }; api.feedback(value); value.text = 'mutated'; api.feedback(null);
  assert.equal(calls.length, 2); assert.equal(calls[0][0], 'desktop:feedback');
  assert.equal(calls[0][1].text, '😀'.repeat(200)); assert.deepEqual(calls[1], ['desktop:feedback', null]);
  for (const value of [undefined, [], {}, 'x', { id: 0, text: 'x' }, { id: 1.5, text: 'x' },
    { id: Number.MAX_SAFE_INTEGER + 1, text: 'x' }, { id: 1, text: '' }, { id: 1, text: '😀'.repeat(201) },
    { id: 1, text: 1 }, { id: 1, text: 'x', extra: true }]) api.feedback(value);
  assert.equal(calls.length, 2);
  assert.equal(preload('desktop-preload.cjs', false).api, undefined);
});

test('I9_feedback receive-only bubble bridge strips event, rejects malformed traffic and releases listener', () => {
  const { api, calls, ipcRenderer } = preload('feedback-preload.cjs');
  assert.deepEqual(Object.keys(api), ['onState']); assert.equal(Object.isFrozen(api), true);
  assert.throws(() => api.onState(null), /callback/);
  const values = []; const off = api.onState((...args) => values.push(args));
  const value = { id: 1, text: '<img src=x onerror=alert(1)>' };
  ipcRenderer.emit('feedback:state', { secret: 'event must not cross' }, value);
  value.text = 'mutated'; ipcRenderer.emit('feedback:state', {}, null);
  for (const bad of [undefined, [], {}, { id: 0, text: 'x' }, { id: 2, text: '' },
    { id: 2, text: '😀'.repeat(201) }, { id: 2, text: 'x', other: true }]) ipcRenderer.emit('feedback:state', {}, bad);
  ipcRenderer.emit('feedback:state', {}, { id: 3, text: 'extra args' }, 1);
  assert.equal(values.length, 2); assert.equal(values[0].length, 1);
  assert.equal(values[0][0].text, '<img src=x onerror=alert(1)>'); assert.equal(values[1][0], null);
  off(); off(); assert.equal(ipcRenderer.listenerCount('feedback:state'), 0); assert.equal(calls.length, 0);
  assert.equal(preload('feedback-preload.cjs', false).api, undefined);
});

test('I9_feedback real bubble preload and view use textContent, clear and dispose without outbound IPC', () => {
  const { api, ipcRenderer, calls } = preload('feedback-preload.cjs');
  const card = { hidden: true }, text = { textContent: '' }; let onHide;
  Object.defineProperty(text, 'innerHTML', { set() { assert.fail('Never use HTML for feedback'); } });
  vm.runInNewContext(fs.readFileSync(path.join(root, 'src/feedback-view.js'), 'utf8'), {
    document: { getElementById(id) { return id === 'feedback-card' ? card : text; } },
    window: { feedback: api, addEventListener(name, fn, options) { assert.equal(name, 'pagehide'); assert.equal(options.once, true); onHide = fn; } },
  });
  ipcRenderer.emit('feedback:state', {}, { id: 1, text: '<script>bad()</script>' });
  assert.equal(text.textContent, '<script>bad()</script>'); assert.equal(card.hidden, false);
  ipcRenderer.emit('feedback:state', {}, null); assert.equal(text.textContent, ''); assert.equal(card.hidden, true);
  ipcRenderer.emit('feedback:state', {}, { id: 2, text: 'latest' }); onHide();
  assert.equal(text.textContent, ''); assert.equal(card.hidden, true); assert.equal(ipcRenderer.eventNames().length, 0);
  assert.equal(calls.length, 0);
  const html = fs.readFileSync(path.join(root, 'feedback.html'), 'utf8');
  assert.match(html, /default-src 'none'/); assert.match(html, /connect-src 'none'/);
  assert.match(html, /script-src 'self'/); assert.match(html, /style-src 'self'/);
  assert.doesNotMatch(html, /<button|onclick=|https?:|file:/);
});
