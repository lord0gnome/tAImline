// Adaptive time ruler. Picks a tick granularity (decade → year → quarter →
// month → week → day) based on the current zoom so labels never crowd, then
// emits aligned ticks across the visible range. Pure → unit tested.

import { MS_DAY } from "~/lib/dates.ts";

export type RulerUnit = "decade" | "year" | "quarter" | "month" | "week" | "day";

export interface Tick {
  ms: number;
  label: string;
  unit: RulerUnit;
}

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

// Approximate width of one unit in ms, used only to choose granularity.
const APPROX_MS: Record<RulerUnit, number> = {
  decade: 3650 * MS_DAY,
  year: 365 * MS_DAY,
  quarter: 91 * MS_DAY,
  month: 30 * MS_DAY,
  week: 7 * MS_DAY,
  day: MS_DAY,
};

// Finest → coarsest. We want the finest granularity that is still wide enough
// to not crowd; if even a decade is too narrow (very zoomed out), use decade.
const ORDER: RulerUnit[] = ["day", "week", "month", "quarter", "year", "decade"];

/** Finest unit whose on-screen width is at least `minPx`. */
export function pickUnit(pxPerMs: number, minPx = 80): RulerUnit {
  for (const unit of ORDER) {
    if (APPROX_MS[unit] * pxPerMs >= minPx) return unit;
  }
  return "decade";
}

function startOfUnit(ms: number, unit: RulerUnit): number {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  switch (unit) {
    case "decade":
      return Date.UTC(y - (y % 10), 0, 1);
    case "year":
      return Date.UTC(y, 0, 1);
    case "quarter":
      return Date.UTC(y, Math.floor(d.getUTCMonth() / 3) * 3, 1);
    case "month":
      return Date.UTC(y, d.getUTCMonth(), 1);
    case "week": {
      // Align to Monday (UTC).
      const day = (d.getUTCDay() + 6) % 7;
      return Date.UTC(y, d.getUTCMonth(), d.getUTCDate() - day);
    }
    case "day":
      return Date.UTC(y, d.getUTCMonth(), d.getUTCDate());
  }
}

function step(ms: number, unit: RulerUnit): number {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  switch (unit) {
    case "decade":
      return Date.UTC(y + 10, 0, 1);
    case "year":
      return Date.UTC(y + 1, 0, 1);
    case "quarter":
      return Date.UTC(y, d.getUTCMonth() + 3, 1);
    case "month":
      return Date.UTC(y, d.getUTCMonth() + 1, 1);
    case "week":
      return ms + 7 * MS_DAY;
    case "day":
      return ms + MS_DAY;
  }
}

function label(ms: number, unit: RulerUnit): string {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  switch (unit) {
    case "decade":
    case "year":
      return String(y);
    case "quarter":
      return `Q${Math.floor(d.getUTCMonth() / 3) + 1} ${y}`;
    case "month":
      return `${MONTHS[d.getUTCMonth()]} ${y}`;
    case "week":
    case "day":
      return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
  }
}

/** Aligned ticks across [fromMs, toMs] at the zoom-appropriate granularity. */
export function generateTicks(
  fromMs: number,
  toMs: number,
  pxPerMs: number,
  minPx = 80,
): Tick[] {
  if (!(toMs > fromMs) || !(pxPerMs > 0)) return [];
  const unit = pickUnit(pxPerMs, minPx);
  const ticks: Tick[] = [];
  let ms = startOfUnit(fromMs, unit);
  // Guard against pathological ranges producing too many ticks.
  let guard = 0;
  while (ms <= toMs && guard < 10_000) {
    if (ms >= fromMs) ticks.push({ ms, label: label(ms, unit), unit });
    ms = step(ms, unit);
    guard++;
  }
  return ticks;
}
