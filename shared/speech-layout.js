'use strict';
// Adapted from the approved speech layout: DIP, inward rounding, no overlap.
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const { cameraFor } = require('../src/view.js');
const { binding } = require('../src/character.js');
// The render camera reserves transparent space around the character. Anchor
// speech to the head region, not to the outer transparent BrowserWindow.
function speechHeadBounds(parent) {
  const camera = cameraFor(parent.width, parent.height, false, binding);
  const scale = parent.height / camera.h;
  // Authored head region: manifest.head.rect (196, 0, 220, 208).
  return { x: parent.x + (196 - camera.x) * scale,
    y: parent.y - camera.y * scale, width: 220 * scale, height: 208 * scale };
}
function layoutFeedback(parent, area, options) {
  return layoutSpeech(speechHeadBounds(parent), area, options);
}
// Conservative 13px advances reserve enough space; CSS sizes the visible card
// intrinsically, leaving spare native-window pixels completely transparent.
function speechSize(text = '') {
  const advance = c => /[\u0000-\u007f]/u.test(c) ? (/[MW@#%]/.test(c) ? 13 : /[a-z0-9]/i.test(c) ? 9 : 6) : /\p{Extended_Pictographic}/u.test(c) ? 18 : 13;
  const widths = String(text).split('\n').map(line => [...line].reduce((sum,c) => sum + advance(c), 0));
  const width = Math.ceil(clamp(Math.max(...widths, 0) + 42, 104, 236));
  const inner = width - 42;
  const rows = widths.reduce((sum,w) => sum + Math.max(1, Math.ceil(w / inner)), 0);
  const wordSlack = /[a-z]{4}/i.test(text) && widths.some(w => w > inner) ? 1 : 0;
  return { width, height: 36 + (rows + wordSlack) * 19 };
}
function layoutSpeech(parent, area, { scale = 1, text = '', textLength = 0 } = {}) {
  if (![parent, area].every(r => r && ['x', 'y', 'width', 'height'].every(k => Number.isFinite(r[k]))
    && r.width > 0 && r.height > 0) || !Number.isFinite(scale) || scale <= 0) return null;
  const { width, height } = speechSize(text || '字'.repeat(Math.min(200, Math.max(0, textLength))));
  const ax = Math.ceil(area.x), ay = Math.ceil(area.y);
  const ar = Math.floor(area.x + area.width), ab = Math.floor(area.y + area.height);
  const regions = gap => [
    { x: ax, y: ay, r: ar, b: Math.min(ab, Math.floor(parent.y - gap)), side: 'above' },
    { x: Math.max(ax, Math.ceil(parent.x + parent.width + gap)), y: ay, r: ar, b: ab, side: 'right' },
    { x: ax, y: ay, r: Math.min(ar, Math.floor(parent.x - gap)), b: ab, side: 'left' },
    { x: ax, y: Math.max(ay, Math.ceil(parent.y + parent.height + gap)), r: ar, b: ab, side: 'below' },
  ];
  function place(r, w, h) {
    let x = parent.x + (parent.width - w) / 2, y = parent.y + parent.height * .16 - h / 2;
    if (r.side === 'above') y = r.b - h;
    if (r.side === 'below') y = r.y;
    if (r.side === 'right') x = r.x;
    if (r.side === 'left') x = r.r - w;
    return { x: clamp(Math.round(x), r.x, r.r - w), y: clamp(Math.round(y), r.y, r.b - h), width: w, height: h };
  }
  const preferred = regions(6);
  for (const r of preferred) if (r.r - r.x >= width && r.b - r.y >= height) return place(r, width, height);
  for (const candidates of [preferred, regions(0)]) {
    const usable = candidates.filter(r => r.r - r.x >= width && r.b - r.y >= height)
      .sort((a, b) => (b.r - b.x) * (b.b - b.y) - (a.r - a.x) * (a.b - a.y));
    if (usable.length) {
      const r = usable[0]; return place(r, Math.min(width, r.r - r.x), Math.min(height, r.b - r.y));
    }
  }
  return null;
}
module.exports = { layoutSpeech, layoutFeedback, speechHeadBounds, speechSize };
