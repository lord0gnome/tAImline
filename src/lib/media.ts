import { randomUUID } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import { db } from "~/db/client.ts";
import { media, posts } from "~/db/schema.ts";
import { getOwnedPost } from "~/lib/posts.ts";
import { renderPostBody } from "~/lib/postRender.ts";
import { deleteObject, putObject, storageConfigured } from "~/storage/s3.ts";

type MediaRow = typeof media.$inferSelect;

export type MediaKind = "image" | "video" | "other";

export function kindOf(mime: string | null): MediaKind {
  if (mime?.startsWith("image/")) return "image";
  if (mime?.startsWith("video/")) return "video";
  return "other";
}

export interface MediaDTO {
  id: string;
  postId: string | null;
  mime: string | null;
  kind: MediaKind;
  /** Clean reference name to use in markdown: ![caption](name). */
  name: string | null;
  width: number | null;
  height: number | null;
  alt: string | null;
  caption: string | null;
  /** Authz-checked proxy URLs that 302 to short-lived signed object URLs. */
  url: string;
  thumbUrl: string;
}

export function toMediaDTO(row: MediaRow): MediaDTO {
  return {
    id: row.id,
    postId: row.postId,
    mime: row.mime,
    kind: kindOf(row.mime),
    name: row.name,
    width: row.width,
    height: row.height,
    alt: row.alt,
    caption: row.caption,
    url: `/api/media/${row.id}/raw`,
    thumbUrl: row.thumbKey ? `/api/media/${row.id}/thumb` : `/api/media/${row.id}/raw`,
  };
}

export interface RegisterMediaInput {
  postId?: string | null;
  storageKey: string;
  thumbKey?: string | null;
  mime?: string | null;
  name?: string | null;
  width?: number | null;
  height?: number | null;
  alt?: string | null;
  caption?: string | null;
}

function slugifyName(input: string): string {
  return (
    input
      .toLowerCase()
      .replace(/\.[a-z0-9]+$/i, "") // drop extension
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "media"
  );
}

function uniqueMediaName(postId: string | null, base: string, kind: MediaKind): string {
  const root = slugifyName(base) || (kind === "video" ? "video" : "image");
  if (!postId) return root;
  let candidate = root;
  let n = 1;
  while (
    db
      .select({ id: media.id })
      .from(media)
      .where(and(eq(media.postId, postId), eq(media.name, candidate)))
      .get()
  ) {
    n += 1;
    candidate = `${root}-${n}`;
  }
  return candidate;
}

/** Recompute a post's cached HTML so markdown media references resolve. */
function rerenderPost(postId: string): void {
  const post = db.select().from(posts).where(eq(posts.id, postId)).get();
  if (!post) return;
  const refs = db
    .select({ id: media.id, name: media.name, mime: media.mime })
    .from(media)
    .where(eq(media.postId, postId))
    .all();
  db.update(posts).set({ bodyHtml: renderPostBody(post.bodyMd, refs) }).where(eq(posts.id, postId)).run();
}

export function registerMedia(
  userId: string,
  input: RegisterMediaInput,
): { ok: true; media: MediaDTO } | { ok: false; error: string } {
  if (!input.storageKey) return { ok: false, error: "storageKey is required." };
  if (input.postId && !getOwnedPost(userId, input.postId)) {
    return { ok: false, error: `Post not found: ${input.postId}` };
  }
  // Keys must live under this user's prefix (defense against forged keys).
  const prefix = `u/${userId}/`;
  if (!input.storageKey.startsWith(prefix)) {
    return { ok: false, error: "Invalid storage key." };
  }

  const id = randomUUID();
  const kind = kindOf(input.mime ?? null);
  const name = uniqueMediaName(input.postId ?? null, input.name?.trim() || kind, kind);
  const row: typeof media.$inferInsert = {
    id,
    userId,
    postId: input.postId ?? null,
    storageKey: input.storageKey,
    thumbKey: input.thumbKey ?? null,
    mime: input.mime ?? null,
    name,
    width: input.width ?? null,
    height: input.height ?? null,
    alt: input.alt ?? null,
    caption: input.caption ?? null,
  };
  db.insert(media).values(row).run();
  if (input.postId) rerenderPost(input.postId); // resolve any markdown references
  return { ok: true, media: toMediaDTO(db.select().from(media).where(eq(media.id, id)).get()!) };
}

export function listMediaByPost(userId: string, postId: string): MediaDTO[] {
  return db
    .select()
    .from(media)
    .where(and(eq(media.userId, userId), eq(media.postId, postId)))
    .orderBy(asc(media.sortOrder), asc(media.createdAt))
    .all()
    .map(toMediaDTO);
}

export function getOwnedMedia(userId: string, id: string): MediaRow | null {
  const row = db.select().from(media).where(eq(media.id, id)).get();
  if (!row || row.userId !== userId) return null;
  return row;
}

export function getMediaById(id: string): MediaRow | null {
  return db.select().from(media).where(eq(media.id, id)).get() ?? null;
}

export async function deleteMedia(row: MediaRow): Promise<void> {
  // Best-effort object cleanup; always remove the DB row.
  await deleteObject(row.storageKey).catch(() => {});
  if (row.thumbKey) await deleteObject(row.thumbKey).catch(() => {});
  db.delete(media).where(eq(media.id, row.id)).run();
  if (row.postId) rerenderPost(row.postId); // drop any now-broken references
}

/** Generate a namespaced object key for an upload under the user's prefix. */
export function newObjectKey(userId: string, ext: string): string {
  const clean = ext.replace(/[^a-z0-9]/gi, "").slice(0, 5).toLowerCase() || "bin";
  return `u/${userId}/${randomUUID()}.${clean}`;
}

const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
};

const MAX_FETCH_BYTES = 50 * 1024 * 1024; // 50 MB

/**
 * Fetch an external image/video URL, store it in the bucket, and register it.
 * Used by the MCP attach-by-URL tool. No thumbnail is generated (server-side
 * transcoding is intentionally avoided); thumbUrl falls back to the original.
 */
export async function attachMediaFromUrl(
  userId: string,
  input: { postId: string; url: string; alt?: string | null; caption?: string | null },
): Promise<{ ok: true; media: MediaDTO } | { ok: false; error: string }> {
  if (!storageConfigured()) return { ok: false, error: "Media storage is not configured." };
  if (!getOwnedPost(userId, input.postId)) {
    return { ok: false, error: `Post not found: ${input.postId}` };
  }
  let res: Response;
  try {
    res = await fetch(input.url);
  } catch {
    return { ok: false, error: `Could not fetch URL: ${input.url}` };
  }
  if (!res.ok) return { ok: false, error: `Fetch failed (${res.status}) for ${input.url}` };

  const mime = (res.headers.get("content-type") ?? "").split(";")[0].trim();
  if (!mime.startsWith("image/") && !mime.startsWith("video/")) {
    return { ok: false, error: `Unsupported content-type: ${mime || "unknown"}` };
  }
  const ab = await res.arrayBuffer();
  if (ab.byteLength > MAX_FETCH_BYTES) {
    return { ok: false, error: "File exceeds the 50 MB limit." };
  }

  const key = newObjectKey(userId, EXT_BY_MIME[mime] ?? mime.split("/")[1] ?? "bin");
  try {
    await putObject(key, new Blob([ab], { type: mime }), mime);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Upload failed." };
  }
  const base = input.url.split("/").pop()?.split("?")[0] || "media";
  return registerMedia(userId, { postId: input.postId, storageKey: key, mime, name: base, alt: input.alt, caption: input.caption });
}
