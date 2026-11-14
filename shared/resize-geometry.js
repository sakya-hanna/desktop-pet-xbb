'use strict';

function validRectangle(rectangle) {
  return rectangle !== null && typeof rectangle === 'object'
    && ['x', 'y', 'width', 'height'].every(field => Number.isFinite(rectangle[field]))
    && rectangle.width > 0 && rectangle.height > 0;
}

function validAnchor(anchor) {
  return anchor !== null && typeof anchor === 'object' && !Array.isArray(anchor)
    && ['x','y'].every(k=>Number.isFinite(anchor[k]) && anchor[k]>=0 && anchor[k]<=1);
}
function pivotAt(bounds, anchor) {
  return {x:bounds.x+bounds.width*anchor.x,y:bounds.y+bounds.height*anchor.y,rx:anchor.x,ry:anchor.y};
}
function geometry(bounds, factor, workArea, scale, round, pivot) {
  if (!Number.isFinite(factor) || factor < 0.5 || factor > 2
    || !validRectangle(bounds) || !validRectangle(workArea)) return null;
  scale = Math.min(Math.max(0.4, Math.min(2.5, scale * factor)),
    workArea.width / 240, workArea.height / 348);
  const width = Math.max(1, Math.min(Math.floor(workArea.width), round(240 * scale)));
  const height = Math.max(1, Math.min(Math.floor(workArea.height), round(348 * scale)));
  return {scale, bounds:{
    x: Math.max(Math.ceil(workArea.x), Math.min(Math.floor(workArea.x + workArea.width - width),
      round(pivot ? pivot.x - width*pivot.rx : bounds.x + bounds.width - width))),
    y: Math.max(Math.ceil(workArea.y), Math.min(Math.floor(workArea.y + workArea.height - height),
      round(pivot ? pivot.y - height*pivot.ry : bounds.y + bounds.height - height))),
    width, height,
  }};
}

/** Stateless legacy geometry retains its floor rounding and bottom-right anchor. */
function resizedBounds(bounds, factor, workArea) {
  return geometry(bounds, factor, workArea, bounds?.height / 348, Math.floor)?.bounds || null;
}

/** Keep fractional scale, not a chain of already-rounded window dimensions. */
function createResizeSession() {
  let last = null;
  const same = (a,b) => a && b && ['x','y','width','height'].every(k=>a[k]===b[k]);
  return {
    reset(){ last = null; },
    resize(bounds, factor, workArea, anchor){
      if (anchor !== undefined && !validAnchor(anchor)) return null;
      if (!validRectangle(bounds)) return null;
      const continued = last && same(bounds,last.bounds) && same(workArea,last.workArea);
      const scale = continued ? last.scale : bounds.height / 348;
      let pivot = anchor === undefined ? null : pivotAt(bounds,anchor);
      // Preserve the original normalized point while the screen cursor is still.
      // Otherwise rounding each new local coordinate would slowly move the pet.
      if (continued && pivot && last.pivot) {
        const dx=Math.abs(pivot.x-last.pivot.x),dy=Math.abs(pivot.y-last.pivot.y);
        const fixedAnchor=pivot.rx===last.pivot.rx && pivot.ry===last.pivot.ry;
        // A fixed normalized toolbar anchor can shift half a DIP after rounding.
        if ((dx<1e-7 && dy<1e-7) || (fixedAnchor && dx<=.5 && dy<=.5)) pivot=last.pivot;
      }
      const next = geometry(bounds,factor,workArea,scale,Math.round,pivot);
      if (!next) return null;
      // Store the clamped scale: scrolling past either limit creates no debt.
      last = {...next,pivot,bounds:{...next.bounds},workArea:{...workArea}};
      return next.bounds;
    },
  };
}

module.exports = { resizedBounds, createResizeSession };
