'use strict';
// Adapted from the approved speech layout: DIP, inward rounding, no overlap.
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
function layoutSpeech(parent, area, { scale = 1, textLength = 0 } = {}) {
  if (![parent, area].every(r => r && ['x', 'y', 'width', 'height'].every(k => Number.isFinite(r[k]))
    && r.width > 0 && r.height > 0) || !Number.isFinite(scale) || scale <= 0) return null;
  const width = Math.round(300 * scale), height = Math.round((textLength > 100 ? 220 : 130) * scale);
  const ax = Math.ceil(area.x), ay = Math.ceil(area.y);
  const ar = Math.floor(area.x + area.width), ab = Math.floor(area.y + area.height);
  const regions = gap => [
    { x: ax, y: ay, r: ar, b: Math.min(ab, Math.floor(parent.y - gap)), side: 'above' },
    { x: Math.max(ax, Math.ceil(parent.x + parent.width + gap)), y: ay, r: ar, b: ab, side: 'right' },
    { x: ax, y: ay, r: Math.min(ar, Math.floor(parent.x - gap)), b: ab, side: 'left' },
    { x: ax, y: Math.max(ay, Math.ceil(parent.y + parent.height + gap)), r: ar, b: ab, side: 'below' },
  ];
  function place(r, w, h) {
    let x = parent.x + (parent.width - w) / 2, y = parent.y + (parent.height - h) / 2;
    if (r.side === 'above') y = r.b - h;
    if (r.side === 'below') y = r.y;
    if (r.side === 'right') x = r.x;
    if (r.side === 'left') x = r.r - w;
    return { x: clamp(Math.round(x), r.x, r.r - w), y: clamp(Math.round(y), r.y, r.b - h), width: w, height: h };
  }
  const preferred = regions(12);
  for (const r of preferred) if (r.r - r.x >= width && r.b - r.y >= height) return place(r, width, height);
  for (const candidates of [preferred, regions(0)]) {
    const usable = candidates.filter(r => r.r - r.x >= 160 && r.b - r.y >= 80)
      .sort((a, b) => (b.r - b.x) * (b.b - b.y) - (a.r - a.x) * (a.b - a.y));
    if (usable.length) {
      const r = usable[0]; return place(r, Math.min(width, r.r - r.x), Math.min(height, r.b - r.y));
    }
  }
  return null;
}
module.exports = { layoutSpeech };
