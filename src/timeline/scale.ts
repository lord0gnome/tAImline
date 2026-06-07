// Pure scale math mapping time <-> horizontal pixels. Single source of truth:
// `pxPerMs` (zoom) and `originMs` (the date at x=0). Pan changes originMs; zoom
// changes pxPerMs. Layout is recomputed from these — never CSS scaleX (which
// would distort text/images).

export interface Viewport {
  /** Date (UTC ms) at x = 0 (the left edge of the content area). */
  originMs: number;
  /** Pixels per millisecond. */
  pxPerMs: number;
}

export function dateToX(ms: number, vp: Viewport): number {
  return (ms - vp.originMs) * vp.pxPerMs;
}

export function xToDate(x: number, vp: Viewport): number {
  return vp.originMs + x / vp.pxPerMs;
}

/** The [from, to] date window currently visible across a container of `widthPx`. */
export function visibleRange(vp: Viewport, widthPx: number): { from: number; to: number } {
  return { from: vp.originMs, to: xToDate(widthPx, vp) };
}

/**
 * Zoom by `factor` (>1 zoom in) while keeping the date under `anchorX` fixed —
 * the natural "zoom toward cursor" behavior. Returns a new viewport.
 */
export function zoomAt(vp: Viewport, anchorX: number, factor: number): Viewport {
  const anchorMs = xToDate(anchorX, vp);
  const pxPerMs = vp.pxPerMs * factor;
  // Keep anchorMs at anchorX: anchorX = (anchorMs - originMs) * pxPerMs
  const originMs = anchorMs - anchorX / pxPerMs;
  return { originMs, pxPerMs };
}

/** Fit [fromMs, toMs] into `widthPx` with a fractional padding on each side. */
export function fitRange(
  fromMs: number,
  toMs: number,
  widthPx: number,
  pad = 0.05,
): Viewport {
  const span = Math.max(toMs - fromMs, MS_MIN_SPAN);
  const padded = span * (1 + pad * 2);
  const pxPerMs = widthPx / padded;
  const originMs = fromMs - span * pad;
  return { originMs, pxPerMs };
}

const MS_MIN_SPAN = 86_400_000; // 1 day, avoids divide-by-zero on a single point
