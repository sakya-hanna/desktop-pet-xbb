'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = path.join(__dirname, '../src/desktop-runtime.js');
const realDirector = require('../src/director.js');
const view = require('../src/view.js');
const character = require('../src/character.js');

// Only DOM, RAF, the narrow preload and GPU output are seams. Motion and the
// adapter under test are real modules; this suite does not launch Electron.
function fixture(options = {}) {
  function hub(id, parent = null) {
    return {id, parent, listeners: new Map(), textContent: '', title: '',
      addEventListener(type, fn, settings = false) {
        const list = this.listeners.get(type) || [];
        list.push({fn, capture: settings === true || !!settings.capture, settings});
        this.listeners.set(type, list);
      },
      removeEventListener(type, fn, settings = false) {
        const capture = settings === true || !!settings.capture;
        this.listeners.set(type, (this.listeners.get(type) || []).filter(row => row.fn !== fn || row.capture !== capture));
      },
      contains(target) {for (; target; target = target.parent) if (target === this) return true; return false;},
      setAttribute(name, value) {this[name] = String(value);},
    };
  }
  const win = hub('window'), doc = hub('document', win), body = hub('body', doc);
  const canvas = hub('character', body), toolbar = hub('toolbar', body), notice = hub('notice', body);
  const buttons = Object.fromEntries(['grip', 'smaller', 'larger', 'menu', 'hop', 'hide'].map(id => [id, hub(id, toolbar)]));
  const nodes = [win, doc, body, canvas, toolbar, notice, ...Object.values(buttons)];
  const rect = {x: 100, y: 100, left: 100, top: 100, width: 240, height: 348};
  canvas.getBoundingClientRect = () => ({...rect});
  toolbar.getBoundingClientRect = () => ({x: rect.x + rect.width / 2 - 110, y: rect.y + 4, width: 220, height: 28});
  const captured = new Map();
  for (const el of [canvas, ...Object.values(buttons)]) {
    el.setPointerCapture = id => {if (options.captureFailure) throw Error('capture failed'); captured.set(id, el);};
    el.hasPointerCapture = id => captured.get(id) === el;
    el.releasePointerCapture = id => {if (captured.get(id) === el) {captured.delete(id); emit(el, 'lostpointercapture', {pointerId: id});}};
  }
  doc.hidden = options.hidden === true;
  doc.body = body;
  doc.querySelector = selector => nodes.find(node => '#' + node.id === selector) || null;
  toolbar.querySelector = doc.querySelector;
  doc.elementFromPoint = (x, y) => {
    const r = toolbar.getBoundingClientRect();
    return x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height ? toolbar : canvas;
  };
  win.innerWidth = rect.width; win.innerHeight = rect.height; win.devicePixelRatio = options.dpr || 1;
  const raf = new Map(), retired = []; let rafId = 0, now = 0, creations = 0;
  const sent = [], renders = [], calls = [], actions = new Set(), states = new Set(), presentations = new Set(), errors = [], published = [];
  const pet = {
    ready() {calls.push(['ready']); return options.readyPromise;},
    getState() {calls.push(['getState']); return options.statePromise || Promise.resolve(options.state || {visible: true, idleEnabled: true, clickThrough: false});},
    onAction(fn) {actions.add(fn); const remove = () => {calls.push(['unsubscribeAction']); actions.delete(fn);}; return options.subscriptionGate ? options.subscriptionGate.then(() => remove) : remove;},
    onState(fn) {states.add(fn); const remove = () => {calls.push(['unsubscribeState']); states.delete(fn);}; return options.subscriptionGate ? options.subscriptionGate.then(() => remove) : remove;},
    onChatPresentation(fn) {presentations.add(fn); return () => presentations.delete(fn);},
    ...Object.fromEntries(['drag', 'resizeBy', 'setInteractive', 'menu', 'command'].map(name => [name, (...args) => {calls.push([name, ...args]); return options[name]?.(...args);} ])),
  };
  let opaque = true, head = true;
  const renderer = {
    render(...args) {if (options.renderFailure) throw Error('render failed'); renders.push(args);},
    status: () => ({ready: true, renderedFrames: renders.length}),
    hitTest(x, y) {return typeof head === 'function' ? head(x, y) : head;},
    hitOpaque(x, y) {return typeof opaque === 'function' ? opaque(x, y) : opaque;},
    headInputPoint: () => ({x: 220, y: 170}),
  };
  const context = {window: win, document: doc, PreviewView: view, CharacterBinding: character,
    MotionDirector: {createDirector(config) {creations++; const engine = realDirector.createDirector(config); return {...engine, send(event) {sent.push({...event}); return engine.send(event);}};}},
    requestAnimationFrame(fn) {const id = ++rafId; raf.set(id, fn); return id;},
    cancelAnimationFrame(id) {if (raf.has(id)) retired.push(raf.get(id)); raf.delete(id);},
  };
  assert.ok(fs.existsSync(source), 'Desktop DOM runtime has not been implemented');
  vm.runInNewContext(fs.readFileSync(source, 'utf8'), context, {filename: 'desktop-runtime.js'});
  const runtime = context.DesktopRuntime.attach({canvas, toolbar, pet, renderer, onError: error => errors.push(error.message), onState: value => {published.push(value); options.onState?.(value);}});
  function emit(target, type, data = {}) {
    const event = {type, target, clientX: 220, clientY: 170, screenX: 520, screenY: 470,
      pointerId: 7, button: 0, buttons: 1, isTrusted: false, defaultPrevented: false,
      preventDefault() {this.defaultPrevented = true;}, ...data};
    const chain = []; for (let el = target; el; el = el.parent) chain.push(el);
    for (const el of [...chain].reverse()) for (const row of [...(el.listeners.get(type) || [])]) if (row.capture) row.fn(event);
    for (const el of chain) for (const row of [...(el.listeners.get(type) || [])]) if (!row.capture) row.fn(event);
    return event;
  }
  function tick(count = 1, step = 1000 / 60) {
    for (let i = 0; i < count; i++) {now += step; const batch = [...raf.values()]; raf.clear(); for (const fn of batch) fn(now);}
  }
  const act = value => {for (const fn of [...actions]) fn(value);};
  const state = value => {for (const fn of [...states]) fn(value);};
  return {win, doc, body, canvas, toolbar, notice, buttons, nodes, rect, captured, raf, retired, renders, calls, sent, errors, published,
    actions, states, runtime, emit, tick, act, state, renderer, present: value => presentations.forEach(fn => fn(value)), creations: () => creations,
    opaque: value => {opaque = value;}, head: value => {head = value;},
    down: (data = {}) => emit(canvas, 'pointerdown', data),
    move: (x, data = {}) => emit(win, 'pointermove', {clientX: x, ...data}),
    snapshot: () => runtime.status().motion,
    countListeners: () => nodes.reduce((count, node) => count + [...node.listeners.values()].reduce((n, rows) => n + rows.length, 0), 0),
  };
}
const flush = async () => {for (let i = 0; i < 8; i++) await Promise.resolve();};
const own = value => JSON.parse(JSON.stringify(value));
const calls = (f, name) => f.calls.filter(row => row[0] === name);

// First vertical slice: an immediately rendered, stoppable single loop.
test('one director and one RAF survive start, stop, restart and stale callbacks, including initially hidden documents', () => {
  const f = fixture({hidden: true});
  f.runtime.start(); f.runtime.start();
  assert.equal(f.creations(), 1); assert.equal(f.raf.size, 1);
  assert.ok(f.renders.length >= 1, 'Initial document.hidden must not suppress the first framebuffer');
  f.tick(4); assert.equal(f.raf.size, 1);
  assert.equal(f.runtime.status().running, true);
  assert.equal(f.runtime.status().renderedFrames, f.renders.length);
  for (const args of f.renders) {
    assert.equal(args[2], false); assert.equal(args[4], false, 'Desktop render must never request a gl.finish synchronization');
    assert.equal(args[0].headRoll, 0); assert.equal(typeof args[3], 'number');
  }
  const before = f.snapshot().time;
  f.runtime.stop(); assert.equal(f.raf.size, 0); assert.equal(f.runtime.status().running, false);
  f.runtime.start(); f.tick(1, 60000);
  assert.equal(f.snapshot().time, before, 'Restart must reset the wall-clock delta');
  assert.equal(f.creations(), 1); assert.equal(f.raf.size, 1);
  const frames = f.renders.length;
  for (const stale of f.retired) stale(120000);
  assert.equal(f.renders.length, frames); assert.equal(f.raf.size, 1);
  f.runtime.destroy(); f.runtime.start(); f.tick();
  assert.equal(f.renders.length, frames); assert.equal(f.raf.size, 0);
});

// Preserve every previously proven live-preview cancellation branch.
for (const buttons of [0, 2]) test('losing primary buttons (' + buttons + ') cancels contact with pose continuity', () => {
  const f = fixture(); f.runtime.start(); f.down(); f.move(200); f.tick(30);
  const before = f.snapshot().pose.headRoll;
  f.move(202, {buttons});
  assert.equal(f.snapshot().pointerId, null, 'Missing pointerup must not leave contact active');
  assert.equal(f.snapshot().bubble, null); assert.equal(f.snapshot().completedGestures, 0);
  assert.equal(f.snapshot().pose.headRoll, before); assert.equal(f.captured.size, 0);
  assert.ok(f.runtime.status().cancelReasons.includes('primary-button-lost'));
});

test('pointer movement and release recognize one stroke without altering motion or moving the window', () => {
  const f = fixture({dpr: 2}), control = fixture({dpr: 2}); f.runtime.start(); control.runtime.start();
  f.down({isTrusted: true}); f.move(200, {isTrusted: true}); f.tick(30); control.tick(30);
  assert.deepEqual(f.snapshot().pose, control.snapshot().pose);
  f.move(238, {isTrusted: true}); f.tick(30); control.tick(30); assert.deepEqual(f.snapshot().pose, control.snapshot().pose);
  const camera = view.cameraFor(f.rect.width, f.rect.height, false, character.binding);
  assert.equal(f.sent.find(event => event.type === 'down').x, (camera.x + 120 / 240 * camera.w) / character.binding.width);
  f.emit(f.win, 'pointerup', {clientX: 238, buttons: 0, isTrusted: true});
  assert.equal(f.snapshot().completedGestures, 1); assert.equal(f.snapshot().pointerId, null);
  assert.equal(f.snapshot().bubble, '怎么突然模姐姐的头，是希望姐姐做什么呢。');
  assert.equal(f.runtime.status().lastInputTrusted, true);
  f.emit(f.canvas, 'lostpointercapture');
  assert.equal(f.snapshot().completedGestures, 1);
  assert.equal(f.snapshot().bubble, '怎么突然模姐姐的头，是希望姐姐做什么呢。');
  assert.equal(calls(f, 'drag').length, 0);
});

test('stale cancel, capture loss, leave, move, release and second down cannot cancel the active pointer', () => {
  const f = fixture(); f.runtime.start(); f.down(); f.move(200); f.tick(30);
  for (const type of ['pointercancel', 'lostpointercapture', 'pointerleave']) f.emit(f.canvas, type, {pointerId: 999});
  f.move(20, {pointerId: 999, buttons: 0}); f.emit(f.win, 'pointerup', {pointerId: 999});
  f.down({pointerId: 999});
  assert.equal(f.snapshot().pointerId, 7); assert.equal(f.snapshot().phase, 'contact');
  assert.equal(f.runtime.status().activePointer, 7);
});

for (const [type, reason] of [['pointercancel', 'pointer-cancel'], ['lostpointercapture', 'lost-capture'], ['pointerleave', 'pointer-leave']]) {
  test('active ' + type + ' cancels without a success bubble and permits immediate re-entry', () => {
    const f = fixture(); f.runtime.start(); f.down(); f.move(200); f.tick(30);
    const before = f.snapshot().pose.headRoll;
    f.emit(f.canvas, type);
    assert.equal(f.snapshot().pointerId, null); assert.equal(f.snapshot().completedGestures, 0);
    assert.equal(f.snapshot().bubble, null); assert.equal(f.snapshot().pose.headRoll, before);
    assert.equal(f.captured.size, 0); assert.ok(f.runtime.status().cancelReasons.includes(reason));
    f.down({pointerId: 8}); f.emit(f.canvas, type, {pointerId: 7}); assert.equal(f.snapshot().pointerId, 8);
  });
}

for (const [type, reason] of [['pointermove', 'outside-canvas'], ['pointerup', 'released-outside']]) {
  test(type + ' outside the canvas cancels instead of completing a stroke', () => {
    const f = fixture(); f.runtime.start(); f.down(); f.move(200); f.tick(30);
    f.emit(f.win, type, {clientX: 99});
    assert.equal(f.snapshot().pointerId, null); assert.equal(f.snapshot().bubble, null);
    assert.equal(f.snapshot().completedGestures, 0); assert.equal(f.captured.size, 0);
    assert.ok(f.runtime.status().cancelReasons.includes(reason));
  });
}

test('blur, hidden-document and stop cancel real director contact and release capture', () => {
  const f = fixture(); f.runtime.start(); f.down(); f.emit(f.win, 'blur'); assert.equal(f.snapshot().pointerId, null);
  f.down(); f.doc.hidden = true; f.emit(f.doc, 'visibilitychange'); assert.equal(f.snapshot().pointerId, null);
  f.doc.hidden = false; f.emit(f.doc, 'visibilitychange'); f.down(); f.runtime.stop();
  assert.equal(f.snapshot().pointerId, null); assert.equal(f.snapshot().bubble, null); assert.equal(f.captured.size, 0);
});

test('invalid down, body hits and secondary release never become a window drag or a successful stroke', () => {
  const f = fixture(); f.runtime.start();
  for (const data of [{button: 2}, {buttons: 2}, {pointerId: -1}, {pointerId: 0.2}, {clientX: NaN}, {clientY: Infinity}, {clientX: 99}]) {
    f.down(data); assert.equal(f.snapshot().pointerId, null);
  }
  f.head(false); f.down(); assert.equal(f.snapshot().pointerId, null); assert.equal(calls(f, 'drag').length, 0);
  f.head(true); f.down(); f.emit(f.win, 'pointerup', {button: 2, buttons: 1});
  assert.equal(f.snapshot().pointerId, 7, 'A secondary release is not a primary release');
});

test('capture failure cancels and reports an error; a long frame releases adapter capture', () => {
  const f = fixture({captureFailure: true}); f.runtime.start(); f.down();
  assert.equal(f.snapshot().pointerId, null); assert.equal(f.captured.size, 0);
  assert.equal(f.errors.length, 1); assert.equal(f.runtime.status().errors.length, 1);
  assert.ok(f.runtime.status().cancelReasons.includes('capture-failed'));
  const g = fixture(); g.runtime.start(); g.down(); g.tick(); g.tick(1, 5000);
  assert.equal(g.snapshot().pointerId, null); assert.equal(g.captured.size, 0);
  assert.ok(g.snapshot().time <= 0.100001); assert.equal(g.snapshot().completedGestures, 0);
});

test('a long frame preserves the active action and its cues until completion', async t => {
  const f = fixture({state: {visible: true, idleEnabled: false, clickThrough: false}});
  t.after(() => f.runtime.destroy());
  f.runtime.start(); await flush(); f.tick(2);
  f.act('motion:hum'); f.tick(30);
  const before = f.snapshot();
  assert.equal(before.referenceMotion.active, 'hum');
  assert.ok(before.feedback);
  f.tick(1, 600);
  const after = f.snapshot();
  assert.equal(after.referenceMotion.active, 'hum', 'A stalled frame is not an action-stop request');
  assert.equal(after.referenceMotion.completed, before.referenceMotion.completed);
  assert.equal(after.feedback.text, before.feedback.text);
  assert.ok(after.time > before.time && after.time - before.time <= 0.100001);
  f.tick(54, 100);
  assert.equal(f.snapshot().referenceMotion.active, null);
  assert.equal(f.snapshot().referenceMotion.completed, before.referenceMotion.completed + 1);
  assert.deepEqual(f.errors, []);
});

test('long-frame recovery preserves queued actions, while explicit stop and hide still retire them', async t => {
  const f = fixture({state: {visible: true, idleEnabled: false, clickThrough: false}});
  t.after(() => f.runtime.destroy());
  f.runtime.start(); await flush(); f.tick(2);
  f.act('motion:all'); f.tick(6);
  const before = f.snapshot().referenceMotion;
  assert.ok(before.demoRemaining > 0);
  f.tick(1, 5000);
  assert.equal(f.snapshot().referenceMotion.active, before.active);
  assert.equal(f.snapshot().referenceMotion.demoRemaining, before.demoRemaining);
  f.act('motion:stop'); f.tick(30, 100);
  assert.equal(f.snapshot().referenceMotion.active, null);
  assert.equal(f.snapshot().referenceMotion.demoRemaining, 0);
  f.act('motion:all'); f.tick(6); f.act('shell:hide');
  assert.equal(f.raf.size, 0);
  f.act('shell:show'); f.tick(30, 100);
  assert.equal(f.snapshot().referenceMotion.active, null);
  assert.equal(f.snapshot().referenceMotion.demoRemaining, 0);
});

test('long-frame recovery preserves a chat reply and its ongoing expression transition', async t => {
  const config = {state: {visible: true, idleEnabled: false, clickThrough: false}};
  const f = fixture(config), control = fixture(config);
  t.after(() => {f.runtime.destroy(); control.runtime.destroy();});
  for (const h of [f, control]) {
    h.runtime.start(); await flush(); h.tick(2);
    h.present({id: 1, reply: '测试本地表现，不请求模型。', face: 3831, action: 'none'});
    h.tick(2);
  }
  f.tick(1, 600); control.tick(1, 100);
  assert.ok(f.runtime.status().chatPresentation);
  assert.deepEqual(own(f.runtime.status().chatPresentation), own(control.runtime.status().chatPresentation));
  assert.deepEqual(own(f.renders.at(-1)), own(control.renders.at(-1)), 'The gap must not snap the face blend or reset the body');
  assert.deepEqual(f.errors, []);
});

test('retiring released grab recoil preserves a newly selected action and its presentation', () => {
  const d = realDirector.createDirector({idleAction: 'qianhuili', idle: false});
  d.send({type: 'grab-down', pointerId: 7, partId: 'arm-screen-left'});
  d.send({type: 'grab-move', pointerId: 7, x: 10, y: 2});
  for (let i = 0; i < 30; i++) d.advance(1 / 120);
  d.send({type: 'grab-up', pointerId: 7});
  assert.equal(d.playAction('hum'), true); d.advance(1 / 120);
  const before = d.snapshot();
  assert.ok(Math.hypot(...before.pose.grab['arm-screen-left']) > 0);
  assert.ok(before.feedback);
  assert.equal(d.cancelGrab(), true);
  const after = d.snapshot();
  assert.deepEqual(after.pose.grab['arm-screen-left'], [0, 0]);
  assert.deepEqual(after.referenceMotion, before.referenceMotion);
  assert.deepEqual(after.feedback, before.feedback);
  assert.equal(after.face, before.face);
});

test('destroy detaches all DOM listeners and cannot accept any old input', () => {
  const f = fixture(); f.runtime.start(); f.down(); assert.ok(f.countListeners() > 0);
  f.runtime.destroy(); assert.equal(f.countListeners(), 0); assert.equal(f.captured.size, 0);
  f.down(); f.move(200); f.emit(f.win, 'pointerup'); f.tick();
  assert.equal(f.runtime.status().running, false); assert.equal(f.snapshot().pointerId, null);
});

test('ready and state initialize once without a second director or RAF; initial idle:false still permits touch and hop', async () => {
  const f = fixture({state: {visible: true, idleEnabled: false, clickThrough: false}});
  f.runtime.start(); f.runtime.start(); await flush();
  assert.equal(calls(f, 'ready').length, 1); assert.equal(calls(f, 'getState').length, 1);
  assert.equal(f.actions.size, 1); assert.equal(f.states.size, 1); assert.equal(f.raf.size, 1);
  assert.equal(f.runtime.status().idleEnabled, false);
  f.tick(240); assert.equal(f.snapshot().pose.bodyY, 0); assert.equal(f.snapshot().blink, 0);
  const still = f.snapshot().pose; f.down(); f.move(200); f.tick(30); assert.deepEqual(f.snapshot().pose, still);
  assert.equal(f.snapshot().phase, 'contact');
  f.emit(f.win, 'pointerup', {buttons: 0});
  f.act('hop'); f.tick(30); assert.equal(f.snapshot().phase, 'air');
  f.runtime.stop(); f.runtime.start(); await flush();
  assert.equal(calls(f, 'ready').length, 1); assert.equal(calls(f, 'getState').length, 1);
});

test('manual face wins over automatic contact/jump faces and survives idle reconstruction', async () => {
  const f = fixture(); f.runtime.start(); await flush();
  const ids = ['3901', '3942', '3599', '3831', '3711', '3751', '3791', '3496', '3665', '3563', '3625'];
  for (const id of ids) {f.act('face:' + id); f.tick(); assert.equal(f.runtime.status().renderedFace, id);}
  f.act('face:3831'); f.down(); f.tick(); assert.equal(f.runtime.status().renderedFace, '3831');
  f.act('idle:off'); assert.equal(f.snapshot().pointerId, null); assert.equal(f.captured.size, 0);
  assert.equal(f.runtime.status().manualFace, '3831'); assert.equal(f.raf.size, 1);
  const count = f.creations(); f.act('idle:off'); assert.equal(f.creations(), count);
  f.act('hop'); f.tick(30); assert.equal(f.snapshot().phase, 'air'); assert.equal(f.runtime.status().renderedFace, '3831');
  f.act('idle:on'); f.act('face:auto'); f.down(); f.tick();
  assert.equal(f.runtime.status().manualFace, 'auto'); assert.equal(f.runtime.status().renderedFace, '3901');
  assert.equal(f.raf.size, 1);
  for (const action of ['face:4006', 'face:3523', 'face:3861', 'face:foo', 'idle:false', 'blink', 'face-next', 'quit', null, {}, 'face: 3831']) f.act(action);
  assert.equal(f.runtime.status().manualFace, 'auto'); assert.equal(f.runtime.status().idleEnabled, true);
  assert.equal(calls(f, 'command').length, 0);
});

test('menu holds and shell hide/show compose without stale pointers, long delta or extra loops', async () => {
  const f = fixture(); f.runtime.start(); await flush(); f.tick(30); f.down();
  f.act('idle:hold'); const before = f.snapshot().time;
  assert.equal(f.runtime.status().running, false); assert.equal(f.raf.size, 0); assert.equal(f.snapshot().pointerId, null);
  f.down(); f.act('hop'); f.tick(2, 30000); assert.equal(f.snapshot().time, before);
  f.act('shell:hide'); f.act('idle:release'); assert.equal(f.raf.size, 0);
  f.act('shell:show'); f.act('shell:show'); assert.equal(f.raf.size, 1);
  f.tick(1, 60000); assert.equal(f.snapshot().time, before);
  f.down(); f.act('shell:cancel'); assert.equal(f.snapshot().pointerId, null); assert.equal(f.raf.size, 1);
  f.runtime.stop(); f.act('idle:release'); f.act('shell:show'); assert.equal(f.raf.size, 0);
});

test('visibility transitions pause and cancel, while a later visible event cannot defeat a shell hold', async () => {
  const f = fixture(); f.runtime.start(); await flush(); f.tick(30); f.down();
  f.doc.hidden = true; f.emit(f.doc, 'visibilitychange'); const time = f.snapshot().time;
  assert.equal(f.snapshot().pointerId, null); assert.equal(f.raf.size, 0);
  f.act('idle:hold'); f.doc.hidden = false; f.emit(f.doc, 'visibilitychange'); assert.equal(f.raf.size, 0);
  f.act('idle:release'); f.tick(1, 60000); assert.equal(f.snapshot().time, time); assert.equal(f.raf.size, 1);
});

test('a delayed getState cannot overwrite newer onState or onAction decisions', async () => {
  let resolveState;
  const f = fixture({statePromise: new Promise(resolve => {resolveState = resolve;})}); f.runtime.start();
  f.state({idleEnabled: false, visible: true}); f.act('shell:hide');
  resolveState({idleEnabled: true, visible: true}); await flush();
  assert.equal(f.runtime.status().idleEnabled, false); assert.equal(f.runtime.status().running, false);
  f.act('shell:show'); assert.equal(f.raf.size, 1);
  assert.ok(f.published.length > 0);
});

test('destroy unsubscribes actions/state and ignores delayed initialization and captured old callbacks', async () => {
  let resolveState, resolveReady;
  const f = fixture({statePromise: new Promise(resolve => {resolveState = resolve;}), readyPromise: new Promise(resolve => {resolveReady = resolve;})});
  f.runtime.start(); const action = [...f.actions][0], state = [...f.states][0];
  assert.equal(typeof action, 'function'); assert.equal(typeof state, 'function');
  f.runtime.destroy(); const frames = f.renders.length, count = f.creations();
  assert.equal(f.actions.size, 0); assert.equal(f.states.size, 0); assert.equal(f.countListeners(), 0);
  action('idle:off'); action('shell:show'); state({visible: true, idleEnabled: false});
  resolveState({visible: true, idleEnabled: false}); resolveReady(); await flush(); f.tick();
  assert.equal(f.renders.length, frames); assert.equal(f.creations(), count); assert.equal(f.raf.size, 0);
  assert.equal(calls(f, 'unsubscribeAction').length, 1); assert.equal(calls(f, 'unsubscribeState').length, 1);
});

test('render failure stops the loop and is visible in runtime diagnostics', () => {
  const f = fixture({renderFailure: true});
  assert.doesNotThrow(() => f.runtime.start());
  assert.equal(f.runtime.status().running, false); assert.equal(f.raf.size, 0);
  assert.equal(f.runtime.status().errors.length, 1); assert.equal(f.errors[0], 'render failed');
});

test('rejected initialization reports an error without unhandled rejection or a duplicate loop', async () => {
  const f = fixture({statePromise: Promise.reject(Error('state unavailable')), readyPromise: Promise.reject(Error('ready failed'))});
  f.runtime.start(); await flush();
  assert.equal(f.runtime.status().running, true); assert.equal(f.raf.size, 1);
  assert.equal(f.errors.length, 2); assert.equal(f.runtime.status().errors.length, 2);
});

test('explicit hidden validation mode keeps rendering despite native visible:false but shell hide still pauses', async () => {
  const f = fixture({hidden: true, state: {mode: 'hidden', visible: false, idleEnabled: true}});
  f.runtime.start(); await flush(); const frames = f.renders.length; f.tick(3);
  assert.equal(f.runtime.status().running, true); assert.ok(f.renders.length > frames);
  f.down(); f.emit(f.doc, 'visibilitychange'); assert.equal(f.snapshot().pointerId, null);
  assert.equal(f.raf.size, 1, 'An offscreen validation document is natively hidden by design');
  f.act('shell:hide'); f.state({mode: 'hidden', visible: false}); assert.equal(f.raf.size, 0);
  f.act('shell:show'); assert.equal(f.raf.size, 1);
});

test('automatic interactivity uses current framebuffer alpha each frame, not a stale head rectangle', async () => {
  const f = fixture(); f.runtime.start(); await flush();
  assert.equal(calls(f, 'setInteractive').at(-1)[1], false, 'No known pointer defaults to pass-through');
  f.head(false); f.opaque(true); f.emit(f.win, 'mousemove', {buttons: 0});
  assert.equal(f.runtime.status().interactive, true);
  f.opaque(false); f.tick(); assert.equal(f.runtime.status().interactive, false, 'Moving hair can leave a stationary pointer');
  f.opaque(true); f.tick(); assert.equal(f.runtime.status().interactive, true);
  const count = calls(f, 'setInteractive').length; f.tick(3); assert.equal(calls(f, 'setInteractive').length, count);
  f.emit(f.win, 'mouseout', {relatedTarget: f.canvas}); assert.equal(f.runtime.status().interactive, true);
  f.emit(f.win, 'mouseout', {relatedTarget: null}); assert.equal(f.runtime.status().interactive, false);
  f.emit(f.buttons.larger, 'pointerenter', {clientX: 220, clientY: 115, buttons: 0});
  assert.equal(f.runtime.status().interactive, true, 'Toolbar events can recover without an earlier mousemove');
  f.emit(f.win, 'mouseleave'); assert.equal(f.runtime.status().interactive, false);
  assert.ok(calls(f, 'setInteractive').every(row => typeof row[1] === 'boolean'));
});

test('active pointer keeps input while alpha moves away; cancellation drops ownership until a fresh hover', async () => {
  const f = fixture(); f.runtime.start(); await flush(); f.down();
  f.opaque(false); f.tick(); assert.equal(f.runtime.status().interactive, true);
  f.emit(f.win, 'blur'); assert.equal(f.runtime.status().interactive, false); assert.equal(f.snapshot().pointerId, null);
  f.tick(); assert.equal(f.runtime.status().interactive, false);
});

test('only grip produces finite incremental screen-space drag; stale pointer traffic cannot take it over', async () => {
  const f = fixture(); f.runtime.start(); await flush();
  f.emit(f.buttons.grip, 'pointerdown', {clientY: 115, screenX: 500, screenY: 300});
  assert.equal(f.runtime.status().dragging, true); assert.equal(f.runtime.status().activePointer, 7);
  assert.equal(f.snapshot().pointerId, null);
  f.emit(f.win, 'pointermove', {pointerId: 999, buttons: 0, screenX: 999, screenY: 999});
  for (const type of ['pointercancel', 'lostpointercapture', 'pointerleave']) f.emit(f.buttons.grip, type, {pointerId: 999});
  f.emit(f.win, 'pointerup', {pointerId: 999}); assert.equal(f.runtime.status().dragging, true);
  f.emit(f.win, 'pointermove', {clientX: 230, clientY: 115, screenX: 510, screenY: 306});
  f.emit(f.win, 'pointermove', {clientX: 230, clientY: 115, screenX: 517, screenY: 310});
  assert.deepEqual(own(calls(f, 'drag')), [['drag', 10, 6], ['drag', 7, 4]]);
  f.emit(f.win, 'pointerup', {clientY: 115, buttons: 0});
  assert.equal(f.runtime.status().dragging, false); assert.equal(f.runtime.status().activePointer, null); assert.equal(f.captured.size, 0);
  f.emit(f.win, 'pointermove', {screenX: 600, screenY: 400}); assert.equal(calls(f, 'drag').length, 2);
});

for (const how of ['buttons-zero', 'secondary-only', 'blur', 'pointercancel', 'lostpointercapture', 'pointerleave', 'invalid-screen']) {
  test('grip cancellation ' + how + ' releases ownership and cannot resume dragging without a new down', async () => {
    const f = fixture(); f.runtime.start(); await flush();
    f.emit(f.buttons.grip, 'pointerdown', {clientY: 115}); assert.equal(f.runtime.status().dragging, true);
    if (how === 'buttons-zero' || how === 'secondary-only') f.move(230, {buttons: how === 'buttons-zero' ? 0 : 2});
    else if (how === 'blur') f.emit(f.win, 'blur');
    else if (how === 'invalid-screen') f.move(230, {screenX: NaN});
    else f.emit(f.buttons.grip, how);
    assert.equal(f.runtime.status().dragging, false); assert.equal(f.runtime.status().activePointer, null); assert.equal(f.captured.size, 0);
    f.emit(f.win, 'pointermove', {screenX: 600, screenY: 400}); assert.equal(calls(f, 'drag').length, 0);
  });
}

test('toolbar button press/release and fallback mouse button loss cannot leave interactivity held', async () => {
  const f = fixture(); f.runtime.start(); await flush(); f.opaque(false);
  f.emit(f.buttons.larger, 'pointerdown', {clientY: 115});
  assert.equal(f.runtime.status().activePointer, 7); assert.equal(f.runtime.status().dragging, false);
  f.emit(f.win, 'pointerup', {clientY: 115, buttons: 0});
  assert.equal(f.runtime.status().activePointer, null); assert.equal(f.captured.size, 0);
  f.emit(f.buttons.grip, 'pointerdown', {clientY: 115}); f.emit(f.win, 'mousemove', {buttons: 2});
  assert.equal(f.runtime.status().dragging, false); assert.equal(calls(f, 'drag').length, 0);
  f.emit(f.win, 'mouseleave'); assert.equal(f.runtime.status().interactive, false);
});

test('toolbar hop/menu/hide route only to the director and narrow IPC, without editing bootstrap notice', async () => {
  const f = fixture(); f.notice.textContent = 'bootstrap owns this'; f.runtime.start(); await flush();
  f.emit(f.buttons.hop, 'click', {buttons: 0}); f.tick(30); assert.equal(f.snapshot().phase, 'air');
  f.down(); f.emit(f.buttons.menu, 'click', {clientX: 225, clientY: 116, buttons: 0});
  assert.equal(f.snapshot().pointerId, null); assert.deepEqual(own(calls(f, 'menu')), [['menu', {x: 125, y: 16}]]);
  assert.equal(f.raf.size, 1, 'Main owns menu hold/release; hidden menu rejection must not strand a local hold');
  f.emit(f.buttons.hide, 'click', {buttons: 0}); assert.deepEqual(own(calls(f, 'command')), [['command', 'hide']]);
  assert.equal(f.notice.textContent, 'bootstrap owns this'); assert.equal(calls(f, 'drag').length, 0);
});

test('explicit shell click-through cancels input and cannot be undone by automatic alpha or toolbar events', async () => {
  const f = fixture(); f.runtime.start(); await flush(); f.down(); f.state({clickThrough: true});
  assert.equal(f.snapshot().pointerId, null); assert.equal(f.runtime.status().interactive, false);
  f.down(); f.emit(f.buttons.grip, 'pointerdown', {clientY: 115});
  assert.equal(f.runtime.status().activePointer, null);
  f.emit(f.buttons.hop, 'click', {buttons: 0}); f.tick(30); assert.notEqual(f.snapshot().phase, 'air');
  f.state({clickThrough: false}); f.emit(f.buttons.grip, 'pointerenter', {clientY: 115});
  assert.equal(f.runtime.status().interactive, true);
});

function wheel(f, data = {}, target = f.canvas) {
  return f.emit(target, 'wheel', {ctrlKey: true, deltaY: -100, deltaMode: 0, buttons: 0, ...data});
}

test('Ctrl+wheel uses the existing bounded scale formula and CSS-normalized alpha-hit anchor, independent of DPR', async () => {
  const f = fixture({dpr: 2}); f.runtime.start(); await flush(); f.head(false);
  const event = wheel(f, {clientX: 160, clientY: 187, deltaY: -0.1});
  assert.equal(event.defaultPrevented, true);
  const sent = calls(f, 'resizeBy').at(-1);
  assert.equal(sent[1], Math.exp(0.1 * 0.0012)); assert.deepEqual(own(sent[2]), {x: 0.25, y: 0.25});
  assert.ok(f.win.listeners.get('wheel').some(row => row.settings.passive === false));
  assert.match(f.toolbar.title, /Ctrl\+滚轮/);
  wheel(f, {deltaY: -100000}); assert.equal(calls(f, 'resizeBy').at(-1)[1], 1.25);
  wheel(f, {deltaY: 100000}); assert.equal(calls(f, 'resizeBy').at(-1)[1], 0.8);
});

test('wheel line/page units use CSS dimensions and top-centered toolbar anchoring', async () => {
  const f = fixture(); f.runtime.start(); await flush();
  wheel(f, {deltaY: -1, deltaMode: 1}); assert.equal(calls(f, 'resizeBy').at(-1)[1], Math.exp(16 * 0.0012));
  wheel(f, {deltaY: 0.1, deltaMode: 2}); assert.equal(calls(f, 'resizeBy').at(-1)[1], Math.exp(-0.1 * 348 * 0.0012));
  f.opaque(false);
  const event = wheel(f, {clientX: 210, clientY: 115, deltaY: -1, deltaMode: undefined}, f.buttons.smaller);
  assert.equal(event.defaultPrevented, true); assert.deepEqual(own(calls(f, 'resizeBy').at(-1)[2]), {x: 0.5, y: 0});
});

test('ordinary, malformed, non-finite, modified and transparent-area wheel never resizes or consumes an unrelated scroll', async () => {
  const f = fixture(); f.runtime.start(); await flush();
  for (const data of [{ctrlKey: false}, {ctrlKey: 1}, {altKey: true}, {metaKey: true}, {shiftKey: true},
    {deltaY: 0}, {deltaY: NaN}, {deltaY: Infinity}, {deltaY: '1'}, {deltaMode: -1}, {deltaMode: 3}, {deltaMode: '1'},
    {clientX: NaN}, {clientY: Infinity}, {clientX: 99}, {clientX: 341}, {clientY: 449}, {buttons: 1},
    {deltaY: Number.MAX_VALUE, deltaMode: 1}]) {
    const event = wheel(f, data); assert.equal(event.defaultPrevented, false, JSON.stringify(data));
    assert.equal(calls(f, 'resizeBy').length, 0);
  }
  f.opaque(false); f.head(true); assert.equal(wheel(f).defaultPrevented, false, 'Head region is not whole-character alpha');
  f.rect.width = 0; assert.equal(wheel(f).defaultPrevented, false);
  f.rect.width = 240; f.state({clickThrough: true}); assert.equal(wheel(f).defaultPrevented, false);
  assert.equal(calls(f, 'resizeBy').length, 0);
});

test('Ctrl+wheel while dragging or touching is suppressed without allowing page zoom; ordinary wheel is untouched', async () => {
  const f = fixture(); f.runtime.start(); await flush();
  for (const target of [f.canvas, f.buttons.grip, f.buttons.larger]) {
    f.emit(target, 'pointerdown', target === f.canvas ? {} : {clientY: 115});
    const event = wheel(f, {clientX: 1, clientY: 1});
    assert.equal(event.defaultPrevented, true); assert.equal(calls(f, 'resizeBy').length, 0);
    assert.equal(wheel(f, {ctrlKey: false}).defaultPrevented, false);
    f.emit(f.win, 'pointerup', {buttons: 0});
  }
});

test('plus/minus retain fixed toolbar hit across actual shared geometry resizing and preserve fractional steps', async () => {
  const {createResizeSession} = require('../shared/resize-geometry.js');
  const session = createResizeSession(), area = {x: 0, y: 0, width: 1920, height: 1080};
  let bounds = {x: 600, y: 400, width: 240, height: 348};
  const f = fixture({resizeBy(factor, anchor) {
    bounds = session.resize(bounds, factor, area, anchor); assert.ok(bounds);
    f.rect.width = bounds.width; f.rect.height = bounds.height;
    f.win.innerWidth = bounds.width; f.win.innerHeight = bounds.height;
    f.win.screenX = bounds.x; f.win.screenY = bounds.y;
  }});
  Object.assign(f.rect, {x: 0, y: 0, left: 0, top: 0}); f.win.screenX = bounds.x; f.win.screenY = bounds.y;
  f.runtime.start(); await flush(); f.opaque(false);
  const screenX = 750, screenY = 415;
  for (const id of ['larger', 'larger', 'smaller', 'larger']) {
    f.emit(f.buttons[id], 'click', {clientX: screenX - bounds.x, clientY: screenY - bounds.y, screenX, screenY, buttons: 0});
    f.tick(); const point = f.runtime.status().pointerPosition;
    assert.equal(f.runtime.status().interactive, true); assert.equal(f.doc.elementFromPoint(point.clientX, point.clientY), f.toolbar);
    assert.ok(Math.abs(bounds.x + bounds.width / 2 - 720) <= 0.5); assert.equal(bounds.y, 400);
  }
  assert.deepEqual(calls(f, 'resizeBy').map(row => row[1]), [1.05, 1.05, 1 / 1.05, 1.05]);
  assert.ok(calls(f, 'resizeBy').every(row => row[2].x === 0.5 && row[2].y === 0));
  const before = bounds.height;
  for (let i = 0; i < 60; i++) wheel(f, {deltaY: -0.1, clientX: screenX - bounds.x, clientY: screenY - bounds.y, screenX, screenY}, f.buttons.larger);
  assert.ok(bounds.height > before, 'The real shared resize session must accumulate subpixel scale');
});

test('native menu hop selected during idle hold runs exactly once on release, not while the popup is open', async () => {
  const f = fixture(); f.runtime.start(); await flush();
  f.act('idle:hold'); f.act('hop'); f.act('hop');
  assert.equal(f.snapshot().phase, 'quiet'); assert.equal(f.raf.size, 0);
  f.act('idle:release'); assert.equal(f.snapshot().phase, 'prepare');
  f.tick(100); assert.equal(f.snapshot().completedJumps, 1);
  f.act('idle:release'); f.tick(100); assert.equal(f.snapshot().completedJumps, 1);
  f.act('idle:hold'); f.act('hop'); f.act('shell:hide'); f.act('idle:release'); f.act('shell:show'); f.tick(100);
  assert.equal(f.snapshot().completedJumps, 1, 'Hidden/cancelled menu actions must not replay later');
});

test('shell cancellation reasserts automatic pass-through even when main reset its own interactive cache', async () => {
  const f = fixture(); f.runtime.start(); await flush();
  assert.equal(f.runtime.status().interactive, false); const before = calls(f, 'setInteractive').length;
  f.act('shell:cancel');
  assert.equal(calls(f, 'setInteractive').length, before + 1);
  assert.equal(calls(f, 'setInteractive').at(-1)[1], false);
});

test('window pointerleave only cancels its active pointer and drops cached hover', async () => {
  const f = fixture(); f.runtime.start(); await flush(); f.down();
  f.emit(f.win, 'pointerleave', {pointerId: 999}); assert.equal(f.snapshot().pointerId, 7);
  f.emit(f.win, 'pointerleave'); assert.equal(f.snapshot().pointerId, null);
  assert.equal(f.runtime.status().interactive, false); assert.equal(f.captured.size, 0);
});

test('renderer input failures are diagnosed and cancelled, not uncaught DOM exceptions', async () => {
  const f = fixture(); f.runtime.start(); await flush();
  f.renderer.hitTest = () => {throw Error('head query failed');};
  assert.doesNotThrow(() => f.down()); assert.equal(f.runtime.status().errors.length, 1);
  assert.equal(f.snapshot().pointerId, null); assert.equal(f.raf.size, 1);
});

test('destroy is terminal even when the optional observer tries to restart on stop', async () => {
  let restart = false;
  const f = fixture({onState(state) {if (restart && !state.running) {restart = false; f.runtime.start();}}});
  f.runtime.start(); await flush(); const frames = f.renders.length;
  restart = true; f.runtime.destroy();
  assert.equal(f.raf.size, 0); assert.equal(f.renders.length, frames);
  assert.equal(f.runtime.status().destroyed, true); assert.equal(f.countListeners(), 0);
});

test('shell status is a detached read-only snapshot rather than a reference to received state', async () => {
  const f = fixture(); f.runtime.start(); await flush();
  const state = {bounds: {x: 10, y: 20, width: 240, height: 348}, idleEnabled: true}; f.state(state);
  state.bounds.x = 999;
  const status = f.runtime.status(); assert.equal(status.shell.bounds.x, 10);
  status.shell.bounds.y = 999; status.errors.push('caller'); status.cancelReasons.push('caller');
  assert.equal(f.runtime.status().shell.bounds.y, 20); assert.equal(f.runtime.status().errors.length, 0);
  assert.equal(f.runtime.status().cancelReasons.includes('caller'), false);
});

test('asynchronously supplied disposers are invoked after destroy and old callbacks are inert meanwhile', async () => {
  let resolve;
  const f = fixture({subscriptionGate: new Promise(done => {resolve = done;})});
  f.runtime.start(); await flush(); f.runtime.destroy(); const count = f.creations();
  f.act('idle:off'); f.act('shell:show'); assert.equal(f.creations(), count); assert.equal(f.raf.size, 0);
  resolve(); await flush(); assert.equal(f.actions.size, 0); assert.equal(f.states.size, 0);
  assert.equal(calls(f, 'unsubscribeAction').length, 1); assert.equal(calls(f, 'unsubscribeState').length, 1);
});
