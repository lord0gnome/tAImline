import { describe, expect, it } from "vitest";
import { dateToX, fitRange, visibleRange, xToDate, zoomAt } from "./scale.ts";

const vp = { originMs: 0, pxPerMs: 1e-7 };

describe("scale", () => {
  it("round-trips date <-> x", () => {
    const ms = Date.UTC(2010, 5, 15);
    expect(xToDate(dateToX(ms, vp), vp)).toBeCloseTo(ms, 3);
  });

  it("places originMs at x=0", () => {
    expect(dateToX(vp.originMs, vp)).toBe(0);
  });

  it("zoomAt keeps the anchored date under the cursor", () => {
    const anchorX = 400;
    const anchorMs = xToDate(anchorX, vp);
    const z = zoomAt(vp, anchorX, 2);
    expect(z.pxPerMs).toBeCloseTo(vp.pxPerMs * 2, 20);
    expect(dateToX(anchorMs, z)).toBeCloseTo(anchorX, 6);
  });

  it("fitRange frames the requested span within the width", () => {
    const from = Date.UTC(2000, 0, 1);
    const to = Date.UTC(2020, 0, 1);
    const width = 1000;
    const fitted = fitRange(from, to, width, 0.05);
    const { from: vFrom, to: vTo } = visibleRange(fitted, width);
    // Range is fully visible with padding on both sides.
    expect(vFrom).toBeLessThan(from);
    expect(vTo).toBeGreaterThan(to);
  });
});
