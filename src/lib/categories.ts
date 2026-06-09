/**
 * Categories behave like tags: a small, free-form set per era/post, stored as a
 * JSON string array in a single `categories` text column (dialect-portable —
 * no SQLite-only JSON columns). These helpers normalize user/API input and
 * (de)serialize the column. The DTO layer always exposes `string[]`.
 */

const MAX_CATEGORIES = 16;
const MAX_LEN = 40;

/**
 * Normalize raw input into a clean tag list: accepts a string[] or a single
 * comma-separated string, trims, drops empties, caps length, and dedupes
 * case-insensitively (first spelling wins). Order is preserved.
 */
export function parseCategories(input: unknown): string[] {
  let raw: unknown[];
  if (Array.isArray(input)) raw = input;
  else if (typeof input === "string") raw = input.split(",");
  else return [];

  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const tag = item.trim().slice(0, MAX_LEN);
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
    if (out.length >= MAX_CATEGORIES) break;
  }
  return out;
}

/** Serialize a tag list for storage. Returns null when empty (no `[]` noise). */
export function serializeCategories(cats: string[]): string | null {
  return cats.length ? JSON.stringify(cats) : null;
}

/** Decode the stored column back into a tag list (tolerant of bad data). */
export function decodeCategories(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return parseCategories(parsed);
  } catch {
    // Legacy / hand-edited rows may hold a bare string.
    return parseCategories(value);
  }
}
