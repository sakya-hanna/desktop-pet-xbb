/* 白姐 · 分层手偶桌宠
 * 结构：back-hair / body / [ head: face + front-hair + hat ]
 * 关键：头和帽子挂在同一个支点（脖子）上整体转，只有前发做一点点滞后，
 *       这样"拼接"永远是严丝合缝的，不会出现帽子飘走。
 */

const tiltEl = document.getElementById('tilt');
const headEl = document.getElementById('head');

const L = {
  backHair: document.getElementById('back-hair'),
  body: document.getElementById('body'),
  face: document.getElementById('face'),
  frontHair: document.getElementById('front-hair'),
  hat: document.getElementById('hat'),
};

const CFG = {
  maxTilt: 5.0,        // 鼠标带来的最大倾角（度）
  breathPeriod: 3.4,
  breathAmp: 1.15,     // 身体上下浮动（px）
  hairLag: 0.55,       // 前发相对头部的滞后幅度（度）
  backHairSway: 1.5,   // 后发自身摆动（度）
};

// ---------------------------------------------------------------- 状态
const S = {
  t0: performance.now(),
  mouseX: 0.5,
  dragging: false,
  squash: 0,
  blinkUntil: 0,
  blinking: false,
  nextBlinkAt: 2200,
  head: 0,     // 当前头部角度
  headV: 0,
  back: 0,     // 后发角度
  backV: 0,
  front: 0,    // 前发额外角度
  frontV: 0,
};

// ---------------------------------------------------------------- 交互
let dragStart = null;

document.getElementById('stage').addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  dragStart = { x: e.screenX, y: e.screenY };
  S.dragging = false;
  e.preventDefault();
});

window.addEventListener('mousemove', (e) => {
  S.mouseX = Math.min(1, Math.max(0, e.clientX / window.innerWidth));
  if (!dragStart) return;
  const dx = e.screenX - dragStart.x;
  const dy = e.screenY - dragStart.y;
  if (Math.abs(dx) + Math.abs(dy) > 3) S.dragging = true;
  if (S.dragging) {
    window.pet.drag(dx, dy);
    dragStart = { x: e.screenX, y: e.screenY };
  }
});

window.addEventListener('mouseup', () => {
  if (dragStart && !S.dragging) {
    S.squash = 1;
    triggerBlink(170);
  }
  dragStart = null;
  S.dragging = false;
});

window.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  window.pet.quit();
});

// ---------------------------------------------------------------- 眨眼
function triggerBlink(ms = 120) {
  S.blinkUntil = performance.now() + ms;
  S.blinking = true;
  L.face.src = 'layers/face-closed.png';
}

function scheduleBlink(now) {
  if (now < S.nextBlinkAt) return;
  triggerBlink(100 + Math.random() * 70);
  const double = Math.random() < 0.18;
  S.nextBlinkAt = now + (double ? 260 : 2400 + Math.random() * 3600);
}

// ---------------------------------------------------------------- 主循环
let last = S.t0;

function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  const t = (now - S.t0) / 1000;

  if (S.blinking && now > S.blinkUntil) {
    S.blinking = false;
    L.face.src = 'layers/face-open.png';
  }
  scheduleBlink(now);

  // 呼吸 / 待机轻摆
  const breath = Math.sin((t / CFG.breathPeriod) * Math.PI * 2);
  const sway = Math.sin(t * 0.55) * 0.7 + Math.sin(t * 0.23 + 1.1) * 0.35;

  // 头部目标角：鼠标 + 待机轻摆（拖动时更夸张）
  let target = (S.mouseX - 0.5) * 2 * CFG.maxTilt * (S.dragging ? 1.5 : 1) + sway;

  // 头部弹簧（较硬，跟手）
  S.headV += (target - S.head) * 70 * dt;
  S.headV *= Math.pow(0.72, dt * 60);
  S.head += S.headV * dt;

  // 后发弹簧（软，滞后）
  const backTarget = S.head * 0.55 + Math.sin(t * 0.9) * CFG.backHairSway * 0.25;
  S.backV += (backTarget - S.back) * 20 * dt;
  S.backV *= Math.pow(0.88, dt * 60);
  S.back += S.backV * dt;

  // 前发额外角（在头组内部再偏一点点，制造飘逸）
  const frontTarget = S.head * 0.12 + Math.sin(t * 1.3 + 0.7) * 0.25;
  S.frontV += (frontTarget - S.front) * 45 * dt;
  S.frontV *= Math.pow(0.80, dt * 60);
  S.front += S.frontV * dt;

  if (S.squash > 0) S.squash = Math.max(0, S.squash - dt * 4.5);

  // ---- 应用 ----
  // 头组整体转动（脸 + 前发 + 帽子 一起转，绝不会分离）
  headEl.style.transform = `translateY(${(breath * -0.7).toFixed(2)}px) rotate(${S.head.toFixed(2)}deg)`;

  // 前发：在头组内部再小幅偏移
  L.frontHair.style.transform = `rotate(${S.front.toFixed(2)}deg)`;

  // 帽子：跟随头部，只保留极小的惯性（不再单独转）
  L.hat.style.transform = `translateY(${(breath * 0.2).toFixed(2)}px)`;

  // 后发：绕肩部支点转动
  L.backHair.style.transformOrigin = '50% 42%';
  L.backHair.style.transform = `translateY(${(breath * -0.5).toFixed(2)}px) rotate(${S.back.toFixed(2)}deg)`;

  // 身体：呼吸缩放 + 点击挤压（支点在脚底，缩放不会让脚离地）
  const sy = 1 + breath * 0.007 - S.squash * 0.04;
  const sx = 1 - breath * 0.004 + S.squash * 0.028;
  L.body.style.transformOrigin = '50% 92%';
  L.body.style.transform =
    `translateY(${(breath * -CFG.breathAmp).toFixed(2)}px) scale(${sx.toFixed(4)}, ${sy.toFixed(4)})`;

  // 整体极轻微透视
  tiltEl.style.transform = `skewX(${(S.head * 0.05).toFixed(3)}deg)`;

  requestAnimationFrame(frame);
}

const pre = new Image();
pre.src = 'layers/face-closed.png';

requestAnimationFrame(frame);
