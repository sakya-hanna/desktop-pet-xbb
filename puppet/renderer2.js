/* 白姐 · 17 层手偶
 * 呼吸（整体缩放，脖子不变形）/ 头部倾斜 / 后发滞后 / 眨眼 / 点击挤压
 * 动作：右键菜单可触发 眨眼 / 点头 / 扭动
 */

const backHair = document.getElementById('back-hair');
const figure = document.getElementById('figure');
const body = document.getElementById('body');
const head = document.getElementById('head');
const tilt = document.getElementById('tilt');
const eyewhite = document.getElementById('eyewhite');
const irides = document.getElementById('irides');
const eyelash = document.getElementById('eyelash');
const eyelashBot = document.getElementById('eyelash-bot');

const CFG = {
  maxTilt: 3.6,
  breathPeriod: 3.6,
  breathAmp: 0.006,
  breathBob: 0.6,
  blinkMs: 120,
  baseScale: 1.0,
};

const S = {
  t0: performance.now(),
  mouseX: 0.5, mouseY: 0.5,
  dragging: false, squash: 0,
  headAngle: 0, headV: 0,
  backAngle: 0, backV: 0,
  blinkUntil: 0, blinking: false, nextBlinkAt: 2000,
  action: null,   // { name, start, dur }
};

/* ---------------- 交互 ---------------- */
let dragStart = null;
document.getElementById('stage').addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  dragStart = { x: e.screenX, y: e.screenY };
  S.dragging = false; e.preventDefault();
});
window.addEventListener('mousemove', (e) => {
  S.mouseX = Math.min(1, Math.max(0, e.clientX / window.innerWidth));
  S.mouseY = Math.min(1, Math.max(0, e.clientY / window.innerHeight));
  if (!dragStart) return;
  const dx = e.screenX - dragStart.x, dy = e.screenY - dragStart.y;
  if (Math.abs(dx) + Math.abs(dy) > 3) S.dragging = true;
  if (S.dragging) { window.pet?.drag(dx, dy); dragStart = { x: e.screenX, y: e.screenY }; }
});
window.addEventListener('mouseup', () => {
  if (dragStart && !S.dragging) { S.squash = 1; triggerBlink(180); }
  dragStart = null; S.dragging = false;
});

// 右键 → 原生菜单（不再直接退出）
window.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  window.pet?.menu({ x: e.screenX, y: e.screenY });
});

// 菜单发来的动作
window.pet?.onAction((name) => playAction(name));

/* ---------------- 眨眼 ---------------- */
function triggerBlink(ms = CFG.blinkMs) { S.blinkUntil = performance.now() + ms; S.blinking = true; }
function scheduleBlink(now) {
  if (now < S.nextBlinkAt) return;
  triggerBlink(100 + Math.random() * 70);
  S.nextBlinkAt = now + (Math.random() < 0.18 ? 260 : 2400 + Math.random() * 3600);
}

/* ---------------- 动作 ---------------- */
function playAction(name) {
  const now = performance.now();
  if (name === 'blink') { triggerBlink(200); return; }
  const durs = { nod: 700, wiggle: 700 };
  S.action = { name, start: now, dur: durs[name] || 700 };
}

function actionOffsets(now) {
  const a = S.action;
  if (!a) return { headExtra: 0, headY: 0, figRot: 0 };
  const p = (now - a.start) / a.dur;
  if (p >= 1) { S.action = null; return { headExtra: 0, headY: 0, figRot: 0 }; }
  const s = Math.sin(Math.PI * p);           // 0 → 1 → 0
  if (a.name === 'nod') {
    return { headExtra: 0, headY: s * 5, figRot: 0 };
  }
  if (a.name === 'wiggle') {
    return { headExtra: 0, headY: 0, figRot: Math.sin(Math.PI * 2 * p) * 3.5 };
  }
  return { headExtra: 0, headY: 0, figRot: 0 };
}

/* ---------------- 主循环 ---------------- */
window.__FORCE_BLINK = false;
if (location.search.includes('blink')) window.__FORCE_BLINK = true;
let last = S.t0;
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  const t = (now - S.t0) / 1000;

  if (S.blinking && now > S.blinkUntil) S.blinking = false;
  scheduleBlink(now);

  const breath = Math.sin((t / CFG.breathPeriod) * Math.PI * 2);
  const sway = Math.sin(t * 0.5) * 0.45 + Math.sin(t * 0.21 + 1.3) * 0.25;

  const target = (S.mouseX - 0.5) * 2 * CFG.maxTilt * (S.dragging ? 1.4 : 1) + sway;
  S.headV += (target - S.headAngle) * 60 * dt;
  S.headV *= Math.pow(0.72, dt * 60);
  S.headAngle += S.headV * dt;

  const backTarget = S.headAngle * 0.55 + Math.sin(t * 0.85) * 0.3;
  S.backV += (backTarget - S.backAngle) * 16 * dt;
  S.backV *= Math.pow(0.88, dt * 60);
  S.backAngle += S.backV * dt;

  if (S.squash > 0) S.squash = Math.max(0, S.squash - dt * 4.5);

  const act = actionOffsets(now);

  /* ---- 应用 ---- */
  const sy = 1 + breath * CFG.breathAmp - S.squash * 0.012;
  const sx = 1 - breath * CFG.breathAmp * 0.4 + S.squash * 0.008;
  const bs = CFG.baseScale;
  figure.style.transform =
    `translateY(${(breath * -CFG.breathBob).toFixed(2)}px) ` +
    `rotate(${act.figRot.toFixed(2)}deg) ` +
    `scale(${(bs * sx).toFixed(4)}, ${(bs * sy).toFixed(4)})`;

  head.style.transform =
    `translateY(${act.headY.toFixed(2)}px) rotate(${(S.headAngle + act.headExtra).toFixed(2)}deg)`;

  backHair.style.transform = `rotate(${S.backAngle.toFixed(2)}deg)`;

  const blink = S.blinking || window.__FORCE_BLINK;  // FORCE_BLINK 调试
  eyewhite.style.opacity = blink ? '0' : '1';
  irides.style.opacity = blink ? '0' : '1';
  eyelash.style.transform = blink
    ? `translateY(${(window.innerHeight * 0.004).toFixed(2)}px)`
    : 'translateY(0)';
  // 下眼线在闭眼时要藏起来，否则会留下一条"边框"
  if (eyelashBot) eyelashBot.style.opacity = blink ? '0' : '1';

  tilt.style.transform = `skewX(${(S.headAngle * 0.04).toFixed(3)}deg)`;

  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
