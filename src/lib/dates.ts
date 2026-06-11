// Date + precision helpers. Dates are stored as "YYYY-MM-DD" ISO strings; the
// precision says how much of that to trust/display ("2009" vs "Mar 2009" vs
// "12 Mar 2009"). All math is done in UTC to stay timezone-stable.

export type Precision = "year" | "month" | "day";

export const MS_DAY = 86_400_000;

/** Parse a stored ISO date ("YYYY-MM-DD", "YYYY-MM", or "YYYY") to UTC ms. */
export function toMs(iso: string): number {
  const [y, m = "1", d = "1"] = iso.split("-");
  // Date.UTC maps years 0–99 to 1900–1999, which would place e.g. year 1 CE at
  // 1901. setUTCFullYear takes the literal year, so ancient dates stay correct.
  const dt = new Date(0);
  dt.setUTCFullYear(Number(y), Number(m) - 1, Number(d));
  return dt.getTime();
}

/** UTC ms → "YYYY-MM-DD". */
export function msToISO(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** Human label for a date honoring its precision. */
export function formatByPrecision(iso: string, precision: Precision): string {
  const d = new Date(toMs(iso));
  const y = d.getUTCFullYear();
  const mon = MONTHS[d.getUTCMonth()];
  if (precision === "year") return String(y);
  if (precision === "month") return `${mon} ${y}`;
  return `${d.getUTCDate()} ${mon} ${y}`;
}

/** Span label like "Mar 2009 – Jun 2012" / "2009 – present". */
export function formatSpan(
  start: string,
  startPrecision: Precision,
  end: string | null,
  endPrecision: Precision | null,
): string {
  const left = formatByPrecision(start, startPrecision);
  const right = end ? formatByPrecision(end, endPrecision ?? "day") : "present";
  return `${left} – ${right}`;
}

/** Validate a "YYYY-MM-DD" string. */
export function isValidISODate(iso: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  return !Number.isNaN(toMs(iso));
}
