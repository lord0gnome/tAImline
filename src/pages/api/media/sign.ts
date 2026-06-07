import type { APIRoute } from "astro";
import { json, jsonError, readJson } from "~/lib/http.ts";
import { newObjectKey } from "~/lib/media.ts";
import { presignPut, storageConfigured } from "~/storage/s3.ts";

export const prerender = false;

const EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
};

/** Issue a presigned PUT URL for a single object under the user's prefix. */
export const POST: APIRoute = async ({ locals, request }) => {
  if (!locals.user) return jsonError("Not authenticated.", 401);
  if (!storageConfigured()) return jsonError("Media storage is not configured.", 503);

  const body = await readJson<{ contentType?: string }>(request);
  const contentType = typeof body.contentType === "string" ? body.contentType : "";
  if (!contentType.startsWith("image/") && !contentType.startsWith("video/")) {
    return jsonError("Only image/* and video/* uploads are allowed.", 422);
  }

  const ext = EXT[contentType] ?? contentType.split("/")[1] ?? "bin";
  const key = newObjectKey(locals.user.id, ext);
  const uploadUrl = await presignPut(key);
  return json({ key, uploadUrl, expiresIn: 900 });
};
