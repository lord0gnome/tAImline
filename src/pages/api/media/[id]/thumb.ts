import type { APIRoute } from "astro";
import { getOwnedMedia } from "~/lib/media.ts";
import { presignGet } from "~/storage/s3.ts";

export const prerender = false;

// Thumbnail variant; falls back to the original if no thumb was generated.
export const GET: APIRoute = async ({ locals, params }) => {
  if (!locals.user) return new Response("Unauthorized", { status: 401 });
  const row = getOwnedMedia(locals.user.id, params.id!);
  if (!row) return new Response("Not found", { status: 404 });
  const signed = await presignGet(row.thumbKey ?? row.storageKey);
  return new Response(null, {
    status: 302,
    headers: { location: signed, "cache-control": "private, max-age=300" },
  });
};
