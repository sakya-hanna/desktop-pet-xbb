'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Feedback = require('../puppet/rig/js/interaction-feedback');
const ZERO = { angleX: 0, angleY: 0, roll: 0, bodyX: 0 };
function setup() {
  let time = 0;
  return { feedback: Feedback.create({ now: () => time }), at(value) { time = value; } };
}

test('head preview eases in over 120ms and stays gentle during a valid hold', () => {
  const { feedback: f, at } = setup();
  f.begin('head_pat', 'base', 7);
  assert.equal(f.update().face, 3942);
  assert.deepEqual(f.update().pose, ZERO);
  at(60);
  assert.deepEqual(f.update().pose, { angleX: .03, angleY: .05, roll: .006, bodyX: .25 });
  at(120);
  assert.deepEqual(f.update().pose, { angleX: .06, angleY: .1, roll: .012, bodyX: .5 });
  at(2400);
  assert.equal(f.update().face, 3942);
  assert.equal(f.update().phase, 'preview');
  assert.equal(f.update().active, true);
  assert.equal(f.update().region, 'head_pat');
});

test('preview timeout removes face at 2500ms and decays pose over 180ms even without intermediate updates', () => {
  const { feedback: f, at } = setup();
  f.begin('head_pat', 'base', 7);
  at(2500);
  assert.equal(f.update().face, null);
  assert.equal(f.update().phase, 'decay');
  assert.equal(f.update().pose.angleY, .1);
  at(2590);
  assert.equal(f.update().pose.angleY, .05);
  at(2680);
  assert.deepEqual(f.update(), { face: null, pose: ZERO, active: false, phase: 'idle', region: null });
});

for (const [name, invalidate] of [
  ['cancel', f => f.cancel()], ['manual', f => f.manual()],
  ['unsuccessful release', f => f.end()], ['blur', f => f.end('blur')],
  ['inactive move', f => f.move({ active: false })],
  ['canceled move', f => f.move({ active: true, region: 'head_pat', canceled: true })],
  ['outside move', f => f.move({ active: true, region: null })]
]) test(name + ' clears face immediately while preserving current pose for smooth decay', () => {
  const { feedback: f, at } = setup();
  f.begin('head_pat', 'base', 7);
  at(60);
  const before = f.update().pose;
  invalidate(f);
  assert.equal(f.update().face, null);
  assert.deepEqual(f.update().pose, before);
  at(150);
  assert.equal(f.update().pose.angleY, before.angleY / 2);
  invalidate(f); // Repeated cleanup must not restart the fade.
  at(240);
  assert.deepEqual(f.update().pose, ZERO);
});

test('valid move maintains preview', () => {
  const { feedback: f, at } = setup();
  f.begin('head_pat', null, 7);
  at(1000);
  f.move({ active: true, region: 'head_pat', canceled: false });
  assert.equal(f.update().face, 3942);
});

test('accepted head release survives synchronous end hook and completes in 1100ms', () => {
  const { feedback: f, at } = setup();
  const base = Object.freeze({ faceId: 'manual' });
  f.begin('head_pat', base, 7);
  at(200);
  const before = f.update().pose;
  f.release({ type: 'head_pat', text: 'ok', interactionId: 'touch-1' }, base);
  f.end('release');
  assert.equal(f.update().face, 3942);
  assert.equal(f.update().phase, 'reply');
  assert.deepEqual(f.update().pose, before);
  at(1200);
  assert.equal(f.update().face, 3942);
  assert.ok(f.update().pose.angleY > 0 && f.update().pose.angleY < .1);
  at(1300);
  assert.equal(f.update().face, null);
  assert.deepEqual(f.update().pose, ZERO);
  assert.equal(base.faceId, 'manual');
});

test('chest stays visually neutral until accepted, then surprised 250ms and pout through 1300ms', () => {
  const { feedback: f, at } = setup();
  f.begin('chest_touch', 'manual', 1);
  at(300);
  assert.equal(f.update().face, null);
  assert.deepEqual(f.update().pose, ZERO);
  assert.equal(f.release({ type: 'chest_touch', interactionId: 'touch-2' }, 'manual'), true);
  f.end();
  assert.equal(f.update().face, 3563);
  assert.deepEqual(f.update().pose, ZERO);
  at(549);
  assert.equal(f.update().face, 3563);
  at(550);
  assert.equal(f.update().face, 3665);
  at(1599);
  assert.equal(f.update().face, 3665);
  at(1600);
  assert.equal(f.update().face, null);
  assert.deepEqual(f.update().pose, ZERO);
});

for (const [name, stop] of [
  ['manual', f => f.manual()], ['cancel', f => f.cancel()],
  ['end-before-trigger', f => f.end()],
  ['timeout', (f, at) => { at(2800); f.update(); }]
]) test(name + ' rejects late releases but a new begin is allowed', () => {
  const { feedback: f, at } = setup();
  f.begin('head_pat', 'old-base', 1);
  at(200);
  stop(f, at);
  assert.equal(f.release({ type: 'head_pat', interactionId: 'stale' }, 'new-manual'), false);
  assert.equal(f.update().face, null);
  f.end();
  f.begin('head_pat', 'new-manual', 2);
  assert.equal(f.update().face, 3942);
  assert.equal(f.release({ type: 'head_pat', interactionId: 'fresh' }), true);
});

test('duplicate trigger does not restart reply or overwrite a newer preview', () => {
  const { feedback: f, at } = setup();
  const event = { type: 'head_pat', interactionId: 'once' };
  f.begin('head_pat', 'base', 1);
  at(200);
  f.release(event);
  at(600);
  assert.equal(f.release(event), false);
  f.begin('chest_touch', 'new-base', 2);
  assert.equal(f.release(event), false);
  assert.equal(f.update().face, null);
  at(5000);
  assert.equal(f.update().face, null);
});

test('non-release cancellation also stops accepted reply at its actual current offsets', () => {
  const { feedback: f, at } = setup();
  f.begin('head_pat', null, 1);
  at(200);
  f.release({ type: 'head_pat', interactionId: 'x' });
  at(1210);
  const pose = f.update().pose;
  f.end('pointercancel');
  assert.equal(f.update().face, null);
  assert.deepEqual(f.update().pose, pose);
  at(1300);
  assert.equal(f.update().pose.angleY, pose.angleY / 2);
  at(1390);
  assert.deepEqual(f.update().pose, ZERO);
});

test('unrecognized begin clears override rather than inventing a reaction', () => {
  const { feedback: f, at } = setup();
  f.begin('head_pat', null, 1);
  at(200);
  f.begin('face', 'manual', 2);
  assert.equal(f.update().face, null);
  assert.equal(f.release({ type: 'face', interactionId: 'bad' }), false);
  at(400);
  assert.deepEqual(f.update().pose, ZERO);
  assert.equal(f.update().phase, 'idle');
});

test('new preview preserves existing head offsets instead of snapping to zero', () => {
  const { feedback: f, at } = setup();
  f.begin('head_pat', null, 1);
  at(200);
  f.release({ type: 'head_pat', interactionId: 'first' });
  at(400);
  const before = f.update().pose;
  f.begin('head_pat', 'different-manual', 2);
  assert.deepEqual(f.update().pose, before);
  at(1400); // Old reply expiry must not clear the replacement preview.
  assert.equal(f.update().face, 3942);
  f.manual();
  at(5000);
  assert.equal(f.update().face, null);
  assert.deepEqual(f.update().pose, ZERO);
});

test('all sampled preview, reply and cancellation poses stay finite within rig limits', () => {
  const limits = { angleX: .06, angleY: .1, roll: .012, bodyX: .5 };
  for (const region of ['head_pat', 'chest_touch']) {
    for (const stopAt of [0, 30, 120, 200, 900]) {
      const { feedback: f, at } = setup();
      f.begin(region, 'manual', 1);
      at(stopAt);
      f.release({ type: region, interactionId: 'accepted' });
      for (let elapsed = 0; elapsed <= 1500; elapsed += 15) {
        at(stopAt + elapsed);
        if (elapsed === 300) f.cancel();
        const result = f.update();
        assert.deepEqual(result, f.snapshot());
        for (const key of Object.keys(limits)) {
          assert.ok(Number.isFinite(result.pose[key]), key);
          assert.ok(Math.abs(result.pose[key]) <= limits[key], key);
        }
      }
      assert.deepEqual(f.update().pose, ZERO);
    }
  }
});

test('browser UMD export operates without timers, random or external state writes', () => {
  const fs = require('node:fs');
  const vm = require('node:vm');
  const forbidden = () => { throw new Error('side effect'); };
  const window = {};
  const math = Object.create(Math);
  math.random = forbidden;
  const sandbox = { window, Math: math, setTimeout: forbidden, setInterval: forbidden };
  vm.runInNewContext(fs.readFileSync(require.resolve('../puppet/rig/js/interaction-feedback'), 'utf8'), sandbox);
  let time = 0;
  const f = window.InteractionFeedback.create({ now: () => time });
  assert.equal(f.release({ type: 'chest_touch', interactionId: 'trusted' }), true);
  assert.equal(f.update().face, 3563);
  time = 300;
  assert.equal(f.update().face, 3665);
  f.manual();
  time = 500;
  assert.equal(f.update().face, null);
  assert.deepEqual(Object.keys(window), ['InteractionFeedback']);
});

test('idle exposes independent neutral update and snapshot values', () => {
  const { feedback: f } = setup();
  assert.deepEqual(f.update(), { face: null, pose: ZERO, active: false, phase: 'idle', region: null });
  f.snapshot().pose.angleX = 99;
  assert.deepEqual(f.snapshot(), f.update());
});

test('head to chest contact preserves and decays existing offset without a speculative chest reaction',()=>{
 const {feedback:f,at}=setup();f.begin('head_pat',3496,7);at(120);const before=f.update().pose;
 f.cancel();f.begin('chest_touch',3496,8);assert.deepEqual(f.update().pose,before);assert.equal(f.update().face,null);
 at(210);assert.ok(f.update().pose.angleY>0&&f.update().pose.angleY<before.angleY);
 at(300);assert.deepEqual(f.update().pose,ZERO);
});

test('accepting chest release starts from any residual pose rather than snapping',()=>{
 const {feedback:f,at}=setup();f.begin('head_pat',3496,7);at(120);f.cancel();f.begin('chest_touch',3496,8);at(180);const before=f.update().pose;
 f.release({type:'chest_touch',interactionId:'new'},3496);assert.deepEqual(f.update().pose,before);
});
test('accepted event retention is bounded to the most recent 128 identifiers',()=>{
 const {feedback:f}=setup();for(let i=0;i<129;i++){f.begin('head_pat',3496,i);assert.equal(f.release({type:'head_pat',interactionId:'id'+i},3496),true);}
 f.begin('head_pat',3496,130);assert.equal(f.release({type:'head_pat',interactionId:'id128'},3496),false);
 f.begin('head_pat',3496,131);assert.equal(f.release({type:'head_pat',interactionId:'id0'},3496),true);
});
