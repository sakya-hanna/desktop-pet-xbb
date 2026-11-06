/* 后发弯曲测试 v2
 * 8 段链式：每段都是同一张后发图，用 clip-path 只露自己那一条
 * 每段绕自己顶边旋转，越往下角度累加 → 整束弯成弧线
 */

const N = 8;
const Y0 = 48, Y1 = 526, H = 824;     // 后发在画布里的纵向范围
const SOFT = [0.18, 0.32, 0.46, 0.60, 0.74, 0.88, 1.00, 1.10];
const SPRING = [
  { k: 90, d: 0.70 }, { k: 80, d: 0.72 }, { k: 70, d: 0.74 }, { k: 60, d: 0.76 },
  { k: 50, d: 0.78 }, { k: 42, d: 0.80 }, { k: 34, d: 0.82 }, { k: 28, d: 0.84 },
];

const segs = [];
for (let i = 0; i < N; i++) segs.push(document.getElementById('seg' + i));

// 切分：每段 [top, bottom)，向上多留 10px 遮接缝
const bandH = (Y1 - Y0) / N;
for (let i = 0; i < N; i++) {
  const top = Y0 + i * bandH - (i > 0 ? 10 : 0);
  const bottom = (i === N - 1) ? Y1 : Y0 + (i + 1) * bandH;
  const el = segs[i];
  el.style.clipPath = `inset(${(top / H * 100).toFixed(2)}% 0 ${((H - bottom) / H * 100).toFixed(2)}% 0)`;
  el.style.transformOrigin = `50% ${(top / H * 100).toFixed(2)}%`;
  el.style.zIndex = String(100 - i);   // 上面的段压住下面的段，遮住接缝
}

const headEl = document.getElementById('head');

const S = {
  t0: performance.now(),
  mouseX: 0.5,
  head: 0, headV: 0,
  a: new Array(N).fill(0),
  v: new Array(N).fill(0),
};

window.addEventListener('mousemove', (e) => {
  S.mouseX = Math.min(1, Math.max(0, e.clientX / window.innerWidth));
});

let last = S.t0;
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  const t = (now - S.t0) / 1000;

  const headTarget = (S.mouseX - 0.5) * 2 * 3.6 + Math.sin(t * 0.5) * 0.4;
  S.headV += (headTarget - S.head) * 60 * dt;
  S.headV *= Math.pow(0.72, dt * 60);
  S.head += S.headV * dt;

  for (let i = 0; i < N; i++) {
    const phase = Math.sin(t * 0.9 - i * 0.5) * 1.1 * (0.35 + i * 0.08);
    const target = S.head * SOFT[i] * 0.55 + phase;
    const { k, d } = SPRING[i];
    S.v[i] += (target - S.a[i]) * k * dt;
    S.v[i] *= Math.pow(d, dt * 60);
    S.a[i] += S.v[i] * dt;
    segs[i].style.transform = `rotate(${S.a[i].toFixed(3)}deg)`;
  }

  headEl.style.transform = `rotate(${S.head.toFixed(2)}deg)`;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
