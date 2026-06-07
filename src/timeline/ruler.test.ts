import { describe, expect, it } from "vitest";
import { MS_DAY } from "~/lib/dates.ts";
import { generateTicks, pickUnit } from "./ruler.ts";

const YEAR = 365 * MS_DAY;

describe("pickUnit", () => {
  it("uses coarse units when zoomed far out", () => {
    // Very small pxPerMs → a decade is still < minPx → falls through to day?
    // No: with tiny zoom even a decade is narrow, so it returns 'day' only when
    // nothing is wide enough. Use a zoom where a decade is wide.
    const pxPerMs = 100 / (3650 * MS_DAY); // ~100px per decade
    expect(pickUnit(pxPerMs)).toBe("decade");
  });

  it("uses fine units when zoomed in", () => {
    const pxPerMs = 120 / MS_DAY; // 120px per day
    expect(pickUnit(pxPerMs)).toBe("day");
  });

  it("picks year at a mid zoom", () => {
    const pxPerMs = 100 / YEAR; // ~100px per year
    expect(pickUnit(pxPerMs)).toBe("year");
  });
});

describe("generateTicks", () => {
  it("emits aligned year ticks within range", () => {
    const from = Date.UTC(2001, 5, 1);
    const to = Date.UTC(2005, 5, 1);
    const ticks = generateTicks(from, to, 100 / YEAR);
    expect(ticks.length).toBeGreaterThan(0);
    expect(ticks.every((t) => t.ms >= from && t.ms <= to)).toBe(true);
    // First year tick at/after `from` is 2002-01-01.
    expect(ticks[0].label).toBe("2002");
    expect(new Date(ticks[0].ms).getUTCMonth()).toBe(0);
  });

  it("returns nothing for an empty/invalid range", () => {
    expect(generateTicks(100, 100, 1e-7)).toEqual([]);
    expect(generateTicks(200, 100, 1e-7)).toEqual([]);
  });

  it("does not run away on huge ranges", () => {
    const from = Date.UTC(1000, 0, 1);
    const to = Date.UTC(3000, 0, 1);
    const ticks = generateTicks(from, to, 100 / (3650 * MS_DAY));
    expect(ticks.length).toBeLessThan(10_000);
    expect(ticks.every((t) => t.unit === "decade")).toBe(true);
  });
});
