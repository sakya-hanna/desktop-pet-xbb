// 2D rig —— 结构照搬「千绘莉」那套（权重预计算 + 每帧顶点变换）。
// 保留了它的形变顺序：发束摆 → 后发视差 → 戳脸 → 头(穹面+转+滚) → 呼吸 → 身体 → 裙摆 → 跳跃挤压
// 去掉了我们没有的东西（尾巴、猫耳）。

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

function ellipseW(px, py, e, feather) {
  const dx = (px - e.c[0]) / e.rx, dy = (py - e.c[1]) / e.ry;
  const d = Math.sqrt(dx * dx + dy * dy);
  const f = (feather || 0) / Math.min(e.rx, e.ry);
  return f > 0 ? 1 - smooth(1, 1 + f, d) : (d <= 1 ? 1 : 0);
}

function prepPoly(pts) {
  const lens = []; let total = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const l = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
    lens.push(l); total += l;
  }
  // Reject degenerate centerlines before polyNearest divides by their total length.
  if (!(total > 0) || !Number.isFinite(total)) {
    throw new Error('Invalid strand centerline: expected positive finite length');
  }
  return { pts, lens, total };
}

function polyNearest(px, py, P) {
  let best = 1e9, bs = 0, acc = 0;
  for (let i = 0; i < P.pts.length - 1; i++) {
    const [ax, ay] = P.pts[i], [bx, by] = P.pts[i + 1];
    const vx = bx - ax, vy = by - ay, L2 = vx * vx + vy * vy;
    let t = L2 > 0 ? ((px - ax) * vx + (py - ay) * vy) / L2 : 0;
    t = clamp(t, 0, 1);
    const qx = ax + vx * t - px, qy = ay + vy * t - py, d = qx * qx + qy * qy;
    if (d < best) { best = d; bs = (acc + P.lens[i] * t) / P.total; }
    acc += P.lens[i];
  }
  return { d: Math.sqrt(best), s: bs };
}

function strandW(px, py, P, r, f) {
  const n = polyNearest(px, py, P);
  return { w: 1 - smooth(r, r + f, n.d), s: n.s };
}

class Rig {
  constructor(cfg, hairAt) {
    this.cfg = cfg;
    this.hairAt = hairAt || (() => 0);
    this.strands = cfg.strands.map(s => ({ ...s, P: prepPoly(s.pts) }));
  }

  weights(rest) {
    const n = rest.length / 2, c = this.cfg, S = this.strands.length;
    const W = {
      n,
      head: new Float32Array(n), back: new Float32Array(n), dome: new Float32Array(n),
      upper: new Float32Array(n), body: new Float32Array(n), skirt: new Float32Array(n),
      stW: this.strands.map(() => new Float32Array(n)),
      stS: this.strands.map(() => new Float32Array(n)),
    };
    for (let i = 0; i < n; i++) {
      const x = rest[i * 2], y = rest[i * 2 + 1];
      let head = ellipseW(x, y, c.head, c.head.feather);
      head *= 1 - smooth(c.neck[1] - 30, c.neck[1] + 5, y);   // 脖子以下不跟头

      const dx = (x - c.dome.c[0]) / c.dome.rx, dy = (y - c.dome.c[1]) / c.dome.ry;
      const r2 = dx * dx + dy * dy;
      W.dome[i] = r2 < 1 ? (1 - r2) * (1 - r2) : 0;

      let back = 0;
      const hairK = this.hairAt(x, y);
      for (let k = 0; k < S; k++) {
        const st = this.strands[k];
        const sw = strandW(x, y, st.P, st.r, st.f);
        sw.w *= hairK;                       // 只作用于"像头发"的像素
        W.stW[k][i] = sw.w;
        W.stS[k][i] = sw.s;
        head = Math.max(head, sw.w * (1 - 0.55 * sw.s));
        if (st.back) back = Math.max(back, sw.w);
      }
      W.head[i] = head;
      W.back[i] = back;
      W.upper[i] = 1 - smooth(c.upper[0], c.upper[1], y);
      W.body[i] = 1 - smooth(c.body[0], c.body[1], y);

      const sk = c.skirt;
      const skx = smooth(sk.x[0], sk.x[0] + 60, x) * (1 - smooth(sk.x[1] - 60, sk.x[1], x));
      W.skirt[i] = smooth(sk.y[0], sk.y[1], y) * (1 - smooth(sk.y[2], sk.y[3], y)) * skx;
    }
    return W;
  }

  deform(rest, W, P, out) {
    const c = this.cfg, n = W.n;
    const [nx, ny] = c.neck, [hx, hy] = c.hips;
    const strands = this.strands;
    const feet = c.feetY, cx = c.canvas[0] / 2;
    const pokes = P.pokes || [];
    const breathY = -P.breath * 3.2, breathX = P.breath * 0.006;
    const sq = P.squash || 0;

    for (let i = 0; i < n; i++) {
      let x = rest[i * 2], y = rest[i * 2 + 1];

      // --- 发束：绕根部摆（越往发梢越大）
      for (let k = 0; k < strands.length; k++) {
        const w = W.stW[k][i];
        if (w < 0.001) continue;
        const st = strands[k], s = W.stS[k][i], root = st.pts[0];
        // 单层图不能大角度旋转（会被拉成丝）：改成沿 x 的柔性推移，越靠发梢越多
        const a = (P.hair[k] || 0) * w * Math.pow(s, 1.2);
        x += a * 26;
        y += Math.abs(a) * 2.0 * s;
      }

      // --- 后发视差（与脸反向）
      x -= P.angleX * 5 * W.back[i];

      // --- 戳脸
      for (let k = 0; k < pokes.length; k++) {
        const pk = pokes[k], ddx = x - pk.x, ddy = y - pk.y;
        const g = Math.exp(-(ddx * ddx + ddy * ddy) / (2 * 22 * 22)) * pk.a;
        x -= ddx * 0.35 * g; y -= ddy * 0.35 * g;
      }

      // --- 头：穹面伪 3D + 位移 + 绕颈滚
      const hw = W.head[i];
      if (hw > 0.001) {
        const dm = W.dome[i];
        x += (P.angleX * 13 * dm + P.angleX * 4) * hw;
        y += (P.angleY * 10 * dm + P.angleY * 3) * hw;
        const a = P.roll * hw;
        if (a !== 0) {
          const ca = Math.cos(a), sa = Math.sin(a), rx = x - nx, ry = y - ny;
          x = nx + rx * ca - ry * sa;
          y = ny + rx * sa + ry * ca;
        }
      }

      // --- 呼吸
      const uw = W.upper[i];
      y += breathY * uw;
      x += (x - nx) * breathX * uw;

      // --- 身体绕髋摆
      const bw = W.body[i];
      if (bw > 0.001) {
        const cb = Math.cos(P.bodyRoll || 0), sb = Math.sin(P.bodyRoll || 0);
        const ca = 1 + (cb - 1) * bw, sa = sb * bw, rx = x - hx, ry = y - hy;
        x = hx + rx * ca - ry * sa + P.bodyX * 7 * bw;
        y = hy + rx * sa + ry * ca;
      }

      // --- 裙摆
      x += (P.skirt || 0) * W.skirt[i];

      // --- 跳跃挤压（以脚底为锚）
      y = feet - (feet - y) * (1 + sq) - (P.hop || 0);
      x = cx + (x - cx) * (1 - sq * 0.5);

      out[i * 2] = x;
      out[i * 2 + 1] = y;
    }
    return out;
  }
}

window.Rig = Rig;
