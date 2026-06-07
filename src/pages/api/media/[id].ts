import type { APIRoute } from "astro";
import { json, jsonError } from "~/lib/http.ts";
import { deleteMedia, getOwnedMedia } from "~/lib/media.ts";

export const prerender = false;

export const DELETE: APIRoute = async ({ locals, params }) => {
  if (!locals.user) return jsonError("Not authenticated.", 401);
  const row = getOwnedMedia(locals.user.id, params.id!);
  if (!row) return jsonError("Media not found.", 404);
  await deleteMedia(row);
  return json({ ok: true });
};
