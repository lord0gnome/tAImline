import { randomUUID } from "node:crypto";
import { and, asc, eq, gte, lte } from "drizzle-orm";
import { db } from "~/db/client.ts";
import { ERA_VISIBILITIES, type EraVisibility, PRECISIONS, type Precision, media, posts } from "~/db/schema.ts";
import { isValidISODate } from "~/lib/dates.ts";
import { getOwnedEra } from "~/lib/eras.ts";
import { renderPostBody } from "~/lib/postRender.ts";
import type { PostDTO } from "~/timeline/types.ts";

/** Media (id/name/mime) attached to a post, for resolving markdown references. */
function postMediaRefs(postId: string) {
  return db
    .select({ id: media.id, name: media.name, mime: media.mime })
    .from(media)
    .where(eq(media.postId, postId))
    .all();
}

type PostRow = typeof posts.$inferSelect;

export function toPostDTO(row: PostRow): PostDTO {
  return {
    id: row.id,
    eraId: row.eraId,
    title: row.title,
    slug: row.slug,
    bodyMd: row.bodyMd,
    bodyHtml: row.bodyHtml,
    eventDate: row.eventDate,
    eventPrecision: row.eventPrecision,
    eventEndDate: row.eventEndDate,
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
      .slice(0, 48) || "post"
  );
}

function uniqueSlug(userId: string, base: string, ignoreId?: string): string {
  const root = slugify(base);
  let candidate = root;
  let n = 1;
  for (;;) {
    const existing = db
      .select({ id: posts.id })
      .from(posts)
      .where(and(eq(posts.userId, userId), eq(posts.slug, candidate)))
      .get();
    if (!existing || existing.id === ignoreId) return candidate;
    n += 1;
    candidate = `${root}-${n}`;
  }
}

export interface PostInput {
  title?: unknown;
  bodyMd?: unknown;
  eraId?: unknown;
  eventDate?: unknown;
  eventPrecision?: unknown;
  eventEndDate?: unknown;
  visibility?: unknown;
}

export interface ParsedPost {
  title: string;
  bodyMd: string | null;
  eraId: string | null;
  eventDate: string;
  eventPrecision: Precision;
  eventEndDate: string | null;
  visibility: EraVisibility;
}

const asPrecision = (v: unknown, fallback: Precision): Precision =>
  PRECISIONS.includes(v as Precision) ? (v as Precision) : fallback;
const asString = (v: unknown): string | null =>
  typeof v === "string" && v.trim() ? v.trim() : null;

export function parsePost(
  input: PostInput,
): { ok: true; value: ParsedPost } | { ok: false; error: string } {
  const title = asString(input.title);
  if (!title) return { ok: false, error: "Title is required." };

  const eventDate = asString(input.eventDate);
  if (!eventDate || !isValidISODate(eventDate)) {
    return { ok: false, error: "A valid event date (YYYY-MM-DD) is required." };
  }

  const eventEndDate = asString(input.eventEndDate);
  if (eventEndDate && !isValidISODate(eventEndDate)) {
    return { ok: false, error: "Event end date must be YYYY-MM-DD." };
  }
  if (eventEndDate && eventEndDate < eventDate) {
    return { ok: false, error: "Event end date cannot be before the start." };
  }

  const visibility = ERA_VISIBILITIES.includes(input.visibility as EraVisibility)
    ? (input.visibility as EraVisibility)
    : "inherit";

  return {
    ok: true,
    value: {
      title,
      bodyMd: asString(input.bodyMd),
      eraId: asString(input.eraId),
      eventDate,
      eventPrecision: asPrecision(input.eventPrecision, "day"),
      eventEndDate,
      visibility,
    },
  };
}

/** Resolve & authorize the optional eraId. Returns error string if invalid. */
function checkEra(userId: string, eraId: string | null): string | null {
  if (eraId && !getOwnedEra(userId, eraId)) return `Era not found: ${eraId}`;
  return null;
}

export function listPostsForUser(
  userId: string,
  range?: { from: string; to: string },
): PostDTO[] {
  const filters = [eq(posts.userId, userId)];
  if (range) {
    filters.push(lte(posts.eventDate, range.to));
    filters.push(gte(posts.eventDate, range.from));
  }
  return db
    .select()
    .from(posts)
    .where(and(...filters))
    .orderBy(asc(posts.eventDate))
    .all()
    .map(toPostDTO);
}

export function createPost(
  userId: string,
  value: ParsedPost,
): { ok: true; post: PostDTO } | { ok: false; error: string } {
  const eraErr = checkEra(userId, value.eraId);
  if (eraErr) return { ok: false, error: eraErr };

  const id = randomUUID();
  const row: typeof posts.$inferInsert = {
    id,
    userId,
    eraId: value.eraId,
    title: value.title,
    slug: uniqueSlug(userId, value.title),
    bodyMd: value.bodyMd,
    bodyHtml: renderPostBody(value.bodyMd, []), // media (if any) attaches after; re-rendered then
    eventDate: value.eventDate,
    eventPrecision: value.eventPrecision,
    eventEndDate: value.eventEndDate,
    visibility: value.visibility,
  };
  db.insert(posts).values(row).run();
  return { ok: true, post: toPostDTO(db.select().from(posts).where(eq(posts.id, id)).get()!) };
}

export function getOwnedPost(userId: string, id: string): PostRow | null {
  const row = db.select().from(posts).where(eq(posts.id, id)).get();
  if (!row || row.userId !== userId) return null;
  return row;
}

export function getPostBySlug(userId: string, slug: string): PostRow | null {
  return (
    db.select().from(posts).where(and(eq(posts.userId, userId), eq(posts.slug, slug))).get() ?? null
  );
}

export function updatePost(
  existing: PostRow,
  value: ParsedPost,
): { ok: true; post: PostDTO } | { ok: false; error: string } {
  const eraErr = checkEra(existing.userId, value.eraId);
  if (eraErr) return { ok: false, error: eraErr };

  const slug =
    value.title === existing.title
      ? existing.slug
      : uniqueSlug(existing.userId, value.title, existing.id);
  db.update(posts)
    .set({
      eraId: value.eraId,
      title: value.title,
      slug,
      bodyMd: value.bodyMd,
      bodyHtml: renderPostBody(value.bodyMd, postMediaRefs(existing.id)),
      eventDate: value.eventDate,
      eventPrecision: value.eventPrecision,
      eventEndDate: value.eventEndDate,
      visibility: value.visibility,
      updatedAt: Math.floor(Date.now() / 1000),
    })
    .where(eq(posts.id, existing.id))
    .run();
  return { ok: true, post: toPostDTO(db.select().from(posts).where(eq(posts.id, existing.id)).get()!) };
}

export function deletePost(id: string): void {
  db.delete(posts).where(eq(posts.id, id)).run();
}
