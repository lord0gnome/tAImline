import { randomUUID } from "node:crypto";
import { and, asc, eq, gte, isNull, lte, or } from "drizzle-orm";
import { db } from "~/db/client.ts";
import { ERA_VISIBILITIES, type EraVisibility, PRECISIONS, type Precision, eras } from "~/db/schema.ts";
import { isValidISODate } from "~/lib/dates.ts";
import { renderMarkdown } from "~/lib/markdown.ts";
import type { EraDTO } from "~/timeline/types.ts";

type EraRow = typeof eras.$inferSelect;

export function toEraDTO(row: EraRow): EraDTO {
  return {
    id: row.id,
    title: row.title,
    slug: row.slug,
    descriptionMd: row.descriptionMd,
    descriptionHtml: row.descriptionHtml,
    startDate: row.startDate,
    startPrecision: row.startPrecision,
    endDate: row.endDate,
    endPrecision: row.endPrecision,
    color: row.color,
    category: row.category,
    visibility: row.visibility,
  };
}

function slugify(input: string): string {
  return (
    input
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "era"
  );
}

function uniqueSlug(userId: string, base: string, ignoreId?: string): string {
  const root = slugify(base);
  let candidate = root;
  let n = 1;
  for (;;) {
    const existing = db
      .select({ id: eras.id })
      .from(eras)
      .where(and(eq(eras.userId, userId), eq(eras.slug, candidate)))
      .get();
    if (!existing || existing.id === ignoreId) return candidate;
    n += 1;
    candidate = `${root}-${n}`;
  }
}

export interface EraInput {
  title?: unknown;
  descriptionMd?: unknown;
  startDate?: unknown;
  startPrecision?: unknown;
  endDate?: unknown;
  endPrecision?: unknown;
  color?: unknown;
  category?: unknown;
  visibility?: unknown;
}

export interface ParsedEra {
  title: string;
  descriptionMd: string | null;
  startDate: string;
  startPrecision: Precision;
  endDate: string | null;
  endPrecision: Precision | null;
  color: string | null;
  category: string | null;
  visibility: EraVisibility;
}

const asPrecision = (v: unknown, fallback: Precision): Precision =>
  PRECISIONS.includes(v as Precision) ? (v as Precision) : fallback;

const asString = (v: unknown): string | null =>
  typeof v === "string" && v.trim() ? v.trim() : null;

/** Validate + normalize raw input. Returns either a parsed era or an error. */
export function parseEra(input: EraInput): { ok: true; value: ParsedEra } | { ok: false; error: string } {
  const title = asString(input.title);
  if (!title) return { ok: false, error: "Title is required." };

  const startDate = asString(input.startDate);
  if (!startDate || !isValidISODate(startDate)) {
    return { ok: false, error: "A valid start date (YYYY-MM-DD) is required." };
  }

  const endDate = asString(input.endDate);
  if (endDate && !isValidISODate(endDate)) {
    return { ok: false, error: "End date must be YYYY-MM-DD." };
  }
  if (endDate && endDate < startDate) {
    return { ok: false, error: "End date cannot be before start date." };
  }

  const visibility = ERA_VISIBILITIES.includes(input.visibility as EraVisibility)
    ? (input.visibility as EraVisibility)
    : "inherit";

  return {
    ok: true,
    value: {
      title,
      descriptionMd: asString(input.descriptionMd),
      startDate,
      startPrecision: asPrecision(input.startPrecision, "day"),
      endDate,
      endPrecision: endDate ? asPrecision(input.endPrecision, "day") : null,
      color: asString(input.color),
      category: asString(input.category),
      visibility,
    },
  };
}

export function listErasForUser(
  userId: string,
  range?: { from: string; to: string },
): EraDTO[] {
  const filters = [eq(eras.userId, userId)];
  if (range) {
    // Overlap test: era.start <= to AND (era.end is null OR era.end >= from).
    filters.push(lte(eras.startDate, range.to));
    filters.push(or(isNull(eras.endDate), gte(eras.endDate, range.from))!);
  }
  return db
    .select()
    .from(eras)
    .where(and(...filters))
    .orderBy(asc(eras.startDate))
    .all()
    .map(toEraDTO);
}

export function createEra(userId: string, value: ParsedEra): EraDTO {
  const id = randomUUID();
  const row: typeof eras.$inferInsert = {
    id,
    userId,
    slug: uniqueSlug(userId, value.title),
    title: value.title,
    descriptionMd: value.descriptionMd,
    descriptionHtml: renderMarkdown(value.descriptionMd),
    startDate: value.startDate,
    startPrecision: value.startPrecision,
    endDate: value.endDate,
    endPrecision: value.endPrecision,
    color: value.color,
    category: value.category,
    visibility: value.visibility,
  };
  db.insert(eras).values(row).run();
  return toEraDTO(db.select().from(eras).where(eq(eras.id, id)).get()!);
}

/** Returns the owned era row, or null if missing / not owned by userId. */
export function getOwnedEra(userId: string, id: string): EraRow | null {
  const row = db.select().from(eras).where(eq(eras.id, id)).get();
  if (!row || row.userId !== userId) return null;
  return row;
}

export function updateEra(existing: EraRow, value: ParsedEra): EraDTO {
  const slug =
    value.title === existing.title
      ? existing.slug
      : uniqueSlug(existing.userId, value.title, existing.id);
  db.update(eras)
    .set({
      title: value.title,
      slug,
      descriptionMd: value.descriptionMd,
      descriptionHtml: renderMarkdown(value.descriptionMd),
      startDate: value.startDate,
      startPrecision: value.startPrecision,
      endDate: value.endDate,
      endPrecision: value.endPrecision,
      color: value.color,
      category: value.category,
      visibility: value.visibility,
      updatedAt: Math.floor(Date.now() / 1000),
    })
    .where(eq(eras.id, existing.id))
    .run();
  return toEraDTO(db.select().from(eras).where(eq(eras.id, existing.id)).get()!);
}

export function deleteEra(id: string): void {
  db.delete(eras).where(eq(eras.id, id)).run();
}
