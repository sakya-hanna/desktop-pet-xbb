// Pure placement in Electron DIP. Never use the character rectangle as bubble space.
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
function layoutSpeech(parent, area) {
  if (![parent, area].every(r => r && ['x', 'y', 'width', 'height'].every(k => Number.isFinite(r[k]))
    && r.width > 0 && r.height > 0)) return null;
  // Round inward so even fractional work areas cannot leak outside the display.
  const ax = Math.ceil(area.x), ay = Math.ceil(area.y);
  const ar = Math.floor(area.x + area.width), ab = Math.floor(area.y + area.height);
  const regions = gap => [
    { x: ax, y: ay, r: ar, b: Math.min(ab, Math.floor(parent.y - gap)), side: 'above' },
    { x: Math.max(ax, Math.ceil(parent.x + parent.width + gap)), y: ay, r: ar, b: ab, side: 'right' },
    { x: ax, y: ay, r: Math.min(ar, Math.floor(parent.x - gap)), b: ab, side: 'left' },
    { x: ax, y: Math.max(ay, Math.ceil(parent.y + parent.height + gap)), r: ar, b: ab, side: 'below' },
  ];
  function place(r, width, height) {
    let x = parent.x + (parent.width - width) / 2;
    let y = parent.y + (parent.height - height) / 2;
    if (r.side === 'above') y = r.b - height;
    if (r.side === 'below') y = r.y;
    if (r.side === 'right') x = r.x;
    if (r.side === 'left') x = r.r - width;
    return { x: clamp(Math.round(x), r.x, r.r - width),
      y: clamp(Math.round(y), r.y, r.b - height), width, height };
  }
  const preferred = regions(12);
  for (const r of preferred) {
    if (r.r - r.x >= 300 && r.b - r.y >= 130) return place(r, 300, 130);
  }
  // Largest usable strip wins when none fits the preferred readable size.
  for (const candidates of [preferred, regions(0)]) {
    const usable = candidates.filter(r => r.r - r.x >= 160 && r.b - r.y >= 80)
      .sort((a, b) => (b.r - b.x) * (b.b - b.y) - (a.r - a.x) * (a.b - a.y));
    if (usable.length) {
      const r = usable[0];
      return place(r, Math.min(300, r.r - r.x), Math.min(130, r.b - r.y));
    }
  }
  return null;
}
module.exports = { layoutSpeech };
